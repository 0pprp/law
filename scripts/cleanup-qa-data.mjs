/**
 * تصفير بيانات فحص QA فقط — يُبقي المدينين القدماء (29) والمستخدمين الحقيقيين.
 *
 *   node --env-file=.env.local scripts/cleanup-qa-data.mjs --dry-run
 *   node --env-file=.env.local scripts/cleanup-qa-data.mjs --confirm
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
  const u = String(p.username ?? '').toLowerCase()
  const name = String(p.full_name ?? '')
  if (u.startsWith('qa_')) return true
  if (u.startsWith('e2eadmin') || u.startsWith('lawqa') || u.startsWith('acctqa')) return true
  if (u === 'test') return true
  if (/QA/.test(name)) return true
  return false
}

function isQaDebtor(d) {
  const n = String(d.full_name ?? '')
  return /مدين\s*QA|QA\s*تجريبي|QA\s*متأخر|^مدين QA/i.test(n) || /QA/.test(n)
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
  console.log(`  [ok] ${label}${res?.detail ? ` — ${res.detail}` : ''}`)
}

async function deleteIn(table, column, ids) {
  if (!ids.length) return { error: null, deleted: 0 }
  let deleted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { error, count } = await sb.from(table).delete({ count: 'exact' }).in(column, chunk)
    if (error) return { error: error.message }
    deleted += count ?? chunk.length
  }
  return { error: null, deleted }
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

async function main() {
  console.log(dryRun ? '\n=== DRY RUN — cleanup QA only ===\n' : '\n=== CLEANUP QA DATA ===\n')

  const { data: profiles, error: pe } = await sb
    .from('profiles')
    .select('id, username, full_name, role')
    .order('username')
  if (pe) throw new Error(pe.message)

  const qaUsers = (profiles ?? []).filter(isQaUser)
  const keepUsers = (profiles ?? []).filter(p => !isQaUser(p))
  const qaIds = qaUsers.map(p => p.id)

  const { data: debtors, error: de } = await sb
    .from('debtors')
    .select('id, full_name, created_at')
    .order('created_at')
  if (de) throw new Error(de.message)

  const qaDebtors = (debtors ?? []).filter(isQaDebtor)
  const keepDebtors = (debtors ?? []).filter(d => !isQaDebtor(d))
  const qaDebtorIds = qaDebtors.map(d => d.id)

  console.log(`Keep users: ${keepUsers.length}`)
  console.log(`Delete QA users (${qaUsers.length}):`)
  for (const p of qaUsers) console.log(`  - ${p.username} (${p.role}) — ${p.full_name}`)

  console.log(`\nKeep debtors: ${keepDebtors.length}`)
  console.log(`Delete QA debtors (${qaDebtors.length}):`)
  for (const d of qaDebtors) console.log(`  - ${d.full_name} (${d.id})`)

  if (keepDebtors.length !== 29) {
    console.warn(`\n⚠ Expected 29 old debtors, found ${keepDebtors.length}`)
  }

  // Tasks belonging to QA debtors OR assigned/created by QA users
  const { data: qaDebtorTasks } = qaDebtorIds.length
    ? await sb.from('tasks').select('id').in('debtor_id', qaDebtorIds)
    : { data: [] }
  const taskIds = new Set((qaDebtorTasks ?? []).map(t => t.id))

  if (qaIds.length) {
    const { data: assigned } = await sb.from('tasks').select('id').in('assigned_to', qaIds)
    for (const t of assigned ?? []) taskIds.add(t.id)
    const { data: created } = await sb.from('tasks').select('id').in('created_by', qaIds)
    for (const t of created ?? []) taskIds.add(t.id)
  }
  const qaTaskIds = [...taskIds]

  console.log(`\nQA-related tasks to delete: ${qaTaskIds.length}`)

  const before = {
    debtors: debtors?.length ?? 0,
    profiles: profiles?.length ?? 0,
    activity_logs: (await count('activity_logs')).count,
    lawyer_wallet_tx: (await count('lawyer_wallet_transactions')).count,
    delegate_wallet_tx: (await count('delegate_wallet_transactions')).count,
    expenses: (await count('expenses')).count,
    payments: (await count('debtor_payments')).count,
    tasks: (await count('tasks')).count,
  }
  console.log('\nBefore:', before)

  // 1) Clear pointers on QA debtors
  await run('null QA debtor task pointers', async () => {
    if (!qaDebtorIds.length) return {}
    const { error } = await sb.from('debtors')
      .update({ current_task_id: null, last_task_id: null })
      .in('id', qaDebtorIds)
    return { error: error?.message }
  })

  // 2) Child rows for QA tasks / debtors
  await run('delete task_attachments (QA tasks)', async () => {
    if (!qaTaskIds.length) return { detail: '0' }
    const r = await deleteIn('task_attachments', 'task_id', qaTaskIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete expenses (QA tasks/lawyers)', async () => {
    let n = 0
    if (qaTaskIds.length) {
      const r = await deleteIn('expenses', 'task_id', qaTaskIds)
      if (r.error) return { error: r.error }
      n += r.deleted ?? 0
    }
    if (qaIds.length) {
      const r = await deleteIn('expenses', 'lawyer_id', qaIds)
      if (r.error) return { error: r.error }
      n += r.deleted ?? 0
    }
    // leftover QA-described expenses
    const { error } = await sb.from('expenses').delete().ilike('description', '%QA%')
    if (error && !/0 rows/i.test(error.message)) return { error: error.message }
    return { detail: String(n) }
  })

  await run('delete debtor_payments (QA debtors)', async () => {
    if (!qaDebtorIds.length) return { detail: '0' }
    const r = await deleteIn('debtor_payments', 'debtor_id', qaDebtorIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete debtor_attachments (QA debtors)', async () => {
    if (!qaDebtorIds.length) return { detail: '0' }
    const r = await deleteIn('debtor_attachments', 'debtor_id', qaDebtorIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete debtor_notes (QA debtors)', async () => {
    if (!qaDebtorIds.length) return { detail: '0' }
    const r = await deleteIn('debtor_notes', 'debtor_id', qaDebtorIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete task_payment_receipts (QA tasks)', async () => {
    if (!qaTaskIds.length) return { detail: '0' }
    const r = await deleteIn('task_payment_receipts', 'task_id', qaTaskIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  // 3) Wallets — QA users only + QA-originated LM fee on real legal manager
  await run('delete lawyer_wallet_transactions (QA lawyers + QA task fees)', async () => {
    let n = 0
    if (qaIds.length) {
      const r = await deleteIn('lawyer_wallet_transactions', 'lawyer_id', qaIds)
      if (r.error) return { error: r.error }
      n += r.deleted ?? 0
    }
    // QA-originated rows on real users (e.g. LM 5% from qa_lawyer approval)
    const { data: leftover, error: le } = await sb
      .from('lawyer_wallet_transactions')
      .select('*')
    if (le) return { error: le.message }
    const kill = (leftover ?? []).filter(r => {
      const blob = JSON.stringify(r)
      return /QA|مدين QA|محامي عادي QA|مدير اختبار QA/i.test(blob)
    }).map(r => r.id)
    if (kill.length) {
      const { error } = await sb.from('lawyer_wallet_transactions').delete().in('id', kill)
      if (error) return { error: error.message }
      n += kill.length
    }
    return { detail: String(n) }
  })

  await run('delete lawyer_payout_requests (QA)', async () => {
    if (!qaIds.length) return { detail: '0' }
    const r = await deleteIn('lawyer_payout_requests', 'lawyer_id', qaIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete lawyer_attachments (QA)', async () => {
    if (!qaIds.length) return { detail: '0' }
    const r = await deleteIn('lawyer_attachments', 'lawyer_id', qaIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete delegate_wallet_transactions (QA)', async () => {
    if (!qaIds.length) return { detail: '0' }
    const r = await deleteIn('delegate_wallet_transactions', 'delegate_id', qaIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  await run('delete delegate_wallets (QA only)', async () => {
    if (!qaIds.length) return { detail: '0' }
    const { error, count } = await sb.from('delegate_wallets').delete({ count: 'exact' }).in('delegate_id', qaIds)
    return { error: error?.message, detail: String(count ?? 0) }
  })

  // 4) Activity logs — all current logs are from QA cycle (18); clear all
  await run('delete activity_logs', async () => {
    const { error, count } = await sb
      .from('activity_logs')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    return { error: error?.message, detail: String(count ?? 0) }
  })

  // 5) Delete QA tasks
  await run('delete QA tasks', async () => {
    if (!qaTaskIds.length) return { detail: '0' }
    // detach any remaining pointers
    await sb.from('debtors').update({ current_task_id: null }).in('current_task_id', qaTaskIds)
    await sb.from('debtors').update({ last_task_id: null }).in('last_task_id', qaTaskIds)
    const r = await deleteIn('tasks', 'id', qaTaskIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  // 6) Delete QA debtors
  await run('delete QA debtors', async () => {
    if (!qaDebtorIds.length) return { detail: '0' }
    const r = await deleteIn('debtors', 'id', qaDebtorIds)
    return { error: r.error, detail: String(r.deleted ?? 0) }
  })

  // 7) Detach then delete QA users
  for (const p of qaUsers) {
    await run(`delete QA user ${p.username}`, async () => {
      await sb.from('tasks').update({ assigned_to: null }).eq('assigned_to', p.id)
      await sb.from('tasks').update({ assignment_rejected_by: null }).eq('assignment_rejected_by', p.id)
      await sb.from('tasks').update({ created_by: null }).eq('created_by', p.id)
      await sb.from('activity_logs').delete().eq('user_id', p.id)
      await sb.from('lawyer_wallet_transactions').delete().eq('lawyer_id', p.id)
      await sb.from('delegate_wallet_transactions').delete().eq('delegate_id', p.id)
      await sb.from('delegate_wallets').delete().eq('delegate_id', p.id)
      await sb.from('lawyer_attachments').delete().eq('lawyer_id', p.id)
      const { error: pe2 } = await sb.from('profiles').delete().eq('id', p.id)
      if (pe2) return { error: pe2.message }
      const { error: ae } = await sb.auth.admin.deleteUser(p.id)
      if (ae && !/not found/i.test(ae.message)) return { error: ae.message }
      return {}
    })
  }

  // 8) Remove orphaned QA task files from storage (best-effort)
  await run('remove QA task-files from storage', async () => {
    try {
      const paths = await listAllPaths('task-files')
      const kill = paths.filter(p => qaTaskIds.some(id => p.startsWith(id + '/') || p.includes(id)))
      if (!kill.length) return { detail: '0 files' }
      for (let i = 0; i < kill.length; i += 100) {
        const { error } = await sb.storage.from('task-files').remove(kill.slice(i, i + 100))
        if (error) return { error: error.message }
      }
      return { detail: `${kill.length} files` }
    } catch (e) {
      return { error: e.message }
    }
  })

  const { data: leftUsers } = await sb.from('profiles').select('username, role').order('username')
  const { data: leftDebtors } = await sb.from('debtors').select('id, full_name').order('full_name')
  const after = {
    debtors: leftDebtors?.length ?? 0,
    profiles: leftUsers?.length ?? 0,
    activity_logs: (await count('activity_logs')).count,
    lawyer_wallet_tx: (await count('lawyer_wallet_transactions')).count,
    delegate_wallet_tx: (await count('delegate_wallet_transactions')).count,
    expenses: (await count('expenses')).count,
    payments: (await count('debtor_payments')).count,
    tasks: (await count('tasks')).count,
    qa_users_left: (leftUsers ?? []).filter(p => String(p.username).startsWith('qa_')).length,
    qa_debtors_left: (leftDebtors ?? []).filter(d => /QA/.test(d.full_name)).length,
  }

  console.log('\nAfter:', after)
  console.log(`\nUsers remaining: ${after.profiles}`)
  console.log(`Debtors remaining: ${after.debtors}`)
  if (!dryRun && (after.qa_users_left || after.qa_debtors_left)) {
    console.error('⚠ QA leftovers still present')
    process.exit(1)
  }
  if (dryRun) {
    console.log(`\nWould delete: ${qaUsers.length} users, ${qaDebtors.length} debtors, ${qaTaskIds.length} tasks`)
    console.log('Dry run done. Re-run with --confirm to apply.')
  } else {
    console.log('\nCleanup complete.')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
