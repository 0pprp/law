/**
 * استعادة الحالة بعد اختبار QA — تصفير المحافظ والمهام المطبّقة، حذف حسابات qa_*.
 * يُبقي: المدينون (29) + ملفاتهم + المستخدمون الحقيقيون + تعريفات المهام.
 *
 *   node --env-file=.env.local scripts/restore-after-qa.mjs --dry-run
 *   node --env-file=.env.local scripts/restore-after-qa.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!dryRun && !confirm) {
  console.error('Use --dry-run to preview or --confirm to execute.')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function isQaUser(p) {
  return String(p.username ?? '').toLowerCase().startsWith('qa_')
}

async function count(table, filter) {
  let q = sb.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count: c, error } = await q
  if (error) return { error: error.message }
  return { count: c ?? 0 }
}

async function run(label, fn) {
  if (dryRun) {
    console.log(`  [dry] ${label}`)
    return
  }
  const res = await fn()
  if (res?.error) throw new Error(`${label}: ${res.error}`)
  console.log(`  [ok] ${label}`)
}

async function detachUser(userId) {
  await sb.from('tasks').update({ assigned_to: null }).eq('assigned_to', userId)
  await sb.from('tasks').update({ assignment_rejected_by: null }).eq('assignment_rejected_by', userId)
  await sb.from('tasks').update({ created_by: null }).eq('created_by', userId)
  await sb.from('lawyer_attachments').delete().eq('lawyer_id', userId)
  await sb.from('lawyer_wallet_transactions').delete().eq('lawyer_id', userId)
  await sb.from('delegate_wallet_transactions').delete().eq('delegate_id', userId)
  await sb.from('delegate_wallets').delete().eq('delegate_id', userId)
  await sb.from('activity_logs').delete().eq('user_id', userId)
}

async function deleteQaUser(p) {
  await detachUser(p.id)
  const { error: pe } = await sb.from('profiles').delete().eq('id', p.id)
  if (pe) return { error: pe.message }
  const { error: ae } = await sb.auth.admin.deleteUser(p.id)
  if (ae && !/not found/i.test(ae.message)) return { error: ae.message }
  return {}
}

async function listAllPaths(bucket, prefix = '') {
  const paths = []
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) paths.push(...(await listAllPaths(bucket, path)))
    else paths.push(path)
  }
  return paths
}

async function emptyBucket(bucket) {
  const paths = await listAllPaths(bucket)
  if (!paths.length) return
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100))
    if (error) throw new Error(error.message)
  }
}

async function main() {
  console.log(dryRun ? '\n=== DRY RUN ===\n' : '\n=== RESTORE AFTER QA ===\n')

  const { data: profiles, error: profErr } = await sb.from('profiles').select('id, username, role, full_name').order('username')
  if (profErr) throw new Error(profErr.message)

  const qaUsers = (profiles ?? []).filter(isQaUser)
  const keepUsers = (profiles ?? []).filter(p => !isQaUser(p))

  console.log(`Keep ${keepUsers.length} users:`)
  for (const p of keepUsers) console.log(`  + ${p.username} (${p.role})`)
  console.log(`Delete ${qaUsers.length} QA users:`)
  for (const p of qaUsers) console.log(`  - ${p.username}`)

  const metrics = [
    'debtors', 'tasks', 'expenses', 'activity_logs',
    'lawyer_wallet_transactions', 'lawyer_payout_requests', 'task_payment_receipts',
    'task_attachments', 'delegate_wallets', 'delegate_wallet_transactions',
  ]
  console.log('\nBefore:')
  for (const t of metrics) {
    const c = await count(t)
    console.log(`  ${t}: ${c.error ?? c.count}`)
  }

  // 1) تصفير المحافظ والصرفيات
  await run('delete lawyer_wallet_transactions', async () => {
    const { error } = await sb.from('lawyer_wallet_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })
  await run('delete lawyer_payout_requests', async () => {
    const { error } = await sb.from('lawyer_payout_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })
  await run('delete task_payment_receipts', async () => {
    const { error } = await sb.from('task_payment_receipts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })
  await run('delete delegate_wallet_transactions', async () => {
    const { error } = await sb.from('delegate_wallet_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })
  await run('delete delegate_wallets', async () => {
    const { error } = await sb.from('delegate_wallets').delete().neq('delegate_id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })

  // 2) حذف صرفيات المهام وسجل النشاط
  await run('delete expenses', async () => {
    const { error } = await sb.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })
  await run('delete activity_logs', async () => {
    const { error } = await sb.from('activity_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })
  await run('delete task_attachments', async () => {
    const { error } = await sb.from('task_attachments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message }
  })

  // 3) حذف المهام المطبّقة (غير بانتظار التكليف) — يُبقى مهمة إيجاد عنوان لكل مدين
  await run('delete non-waiting tasks', async () => {
    const { error } = await sb.from('tasks').delete().neq('task_status', 'waiting_assignment')
    return { error: error?.message }
  })

  // 4) إعادة ضبط المدينين: مهمة حالية واحدة + تصفير أتعاب الاختبار
  await run('reset debtor task pointers and fee totals', async () => {
    const { data: debtors } = await sb.from('debtors').select('id, current_task_id')
    for (const d of debtors ?? []) {
      const { data: waiting } = await sb
        .from('tasks')
        .select('id, task_definitions(task_type)')
        .eq('debtor_id', d.id)
        .eq('task_status', 'waiting_assignment')
        .order('created_at', { ascending: true })
        .limit(5)

      const findTask = (waiting ?? []).find(t => {
        const def = Array.isArray(t.task_definitions) ? t.task_definitions[0] : t.task_definitions
        return def?.task_type === 'find_address'
      })
      const currentId = findTask?.id ?? waiting?.[0]?.id ?? null

      const { error } = await sb.from('debtors').update({
        current_task_id: currentId,
        last_task_id: null,
        total_expenses: 0,
        lawyer_fees: 0,
        legal_manager_fees: 0,
        total_payments: 0,
      }).eq('id', d.id)
      if (error) return { error: error.message }
    }
    return {}
  })

  // 5) حذف مهام زائدة (أكثر من مهمة بانتظار التكليف لنفس المدين)
  await run('dedupe extra waiting tasks per debtor', async () => {
    const { data: debtors } = await sb.from('debtors').select('id, current_task_id')
    for (const d of debtors ?? []) {
      if (!d.current_task_id) continue
      const { error } = await sb
        .from('tasks')
        .delete()
        .eq('debtor_id', d.id)
        .eq('task_status', 'waiting_assignment')
        .neq('id', d.current_task_id)
      if (error) return { error: error.message }
    }
    return {}
  })

  // 6) إعادة ضبط حقول المهام المتبقية
  await run('reset remaining tasks to find_address waiting', async () => {
    const { data: tasks } = await sb.from('tasks').select('id, task_definition_id, task_definitions(task_type)')
    for (const t of tasks ?? []) {
      const def = Array.isArray(t.task_definitions) ? t.task_definitions[0] : t.task_definitions
      const patch = {
        task_status: 'waiting_assignment',
        assigned_to: null,
        assigned_at: null,
        assignment_expires_at: null,
        assignment_rejected_by: null,
        accepted_at: null,
        completed_at: null,
        due_date: null,
        completion_data: {},
        lawyer_notes: null,
        admin_notes: null,
        fee_status: null,
        delegate_fee_status: 'none',
        debtor_notified: 'unset',
        legal_result: null,
        given_up_at: null,
        give_up_reason: null,
        task_type: def?.task_type === 'find_address' ? 'find_address' : null,
      }
      const { error } = await sb.from('tasks').update(patch).eq('id', t.id)
      if (error) return { error: error.message }
    }
    return {}
  })

  // 7) حذف حسابات QA
  for (const p of qaUsers) {
    await run(`delete QA user ${p.username}`, () => deleteQaUser(p))
  }

  // 8) تفريغ ملفات المهام فقط (ملفات المدينين تبقى)
  await run('empty task-files storage bucket', async () => {
    await emptyBucket('task-files')
    return {}
  })

  console.log('\nAfter:')
  for (const t of metrics) {
    const c = await count(t)
    console.log(`  ${t}: ${c.error ?? c.count}`)
  }

  const { data: left } = await sb.from('profiles').select('username, role').order('username')
  console.log(`\nUsers remaining (${left?.length ?? 0}):`, left?.map(p => p.username).join(', '))

  const debtorCount = await count('debtors')
  const taskCount = await count('tasks')
  console.log(`\nDebtors: ${debtorCount.count}, Tasks: ${taskCount.count}`)
  console.log(dryRun ? '\nDry run done.' : '\nRestore complete.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
