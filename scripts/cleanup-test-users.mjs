/**
 * حذف مستخدمي الاختبار (@test.local / أسماء «اختبار - …») وبياناتهم الوهمية فقط.
 * لا يمس المستخدمين الحقيقيين ولا المدينين الحقيقيين ولا يسجّل نشاط الفرع بالكامل.
 *
 *   node --env-file=.env.local scripts/cleanup-test-users.mjs --dry-run
 *   node --env-file=.env.local scripts/cleanup-test-users.mjs --confirm
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

function isTestProfile(p) {
  const name = String(p.full_name ?? '').trim()
  const username = String(p.username ?? '').trim().toLowerCase()
  if (/^اختبار(\s|-|$)/.test(name)) return true
  if (name.startsWith('اختبار -')) return true
  if (username.startsWith('qa_')) return true
  if (username.startsWith('e2eadmin') || username.startsWith('lawqa') || username.startsWith('acctqa')) return true
  if (username === 'test') return true
  return false
}

function isTestDebtor(d) {
  const name = String(d.full_name ?? '').trim()
  if (name === 'اختبار') return true
  if (/^اختبار\s*-/.test(name)) return true
  if (/مدين\s*وهمي|وهمي للتجربة/i.test(name)) return true
  if (/مدين\s*QA|QA\s*تجريبي|^مدين QA/i.test(name)) return true
  if (String(d.receipt_number ?? '').toUpperCase().startsWith('TEST-')) return true
  return false
}

async function deleteIn(table, column, ids) {
  if (!ids.length) return 0
  let deleted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { error, count } = await sb.from(table).delete({ count: 'exact' }).in(column, chunk)
    if (error) throw new Error(`${table}.${column}: ${error.message}`)
    deleted += count ?? chunk.length
  }
  return deleted
}

async function run(label, fn) {
  if (dryRun) {
    console.log(`  [dry] ${label}`)
    return
  }
  const detail = await fn()
  console.log(`  [ok] ${label}${detail != null ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log(dryRun ? '\n=== DRY RUN — test users only ===\n' : '\n=== DELETE TEST USERS + FAKE DATA ===\n')

  const { data: profiles, error: pe } = await sb
    .from('profiles')
    .select('id, username, full_name, role')
    .order('full_name')
  if (pe) throw new Error(pe.message)

  // Also catch auth-only emails @test.local that may map to these profiles
  const { data: listed } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const testAuthIds = new Set(
    (listed?.users ?? [])
      .filter(u => String(u.email ?? '').toLowerCase().endsWith('@test.local'))
      .map(u => u.id),
  )

  const testUsers = (profiles ?? []).filter(p => isTestProfile(p) || testAuthIds.has(p.id))
  const keepUsers = (profiles ?? []).filter(p => !testUsers.some(t => t.id === p.id))
  const testUserIds = testUsers.map(p => p.id)

  const { data: debtors, error: de } = await sb
    .from('debtors')
    .select('id, full_name, receipt_number, created_by')
    .order('full_name')
  if (de) throw new Error(de.message)

  const testDebtors = (debtors ?? []).filter(isTestDebtor)
  const keepDebtors = (debtors ?? []).filter(d => !isTestDebtor(d))
  const testDebtorIds = testDebtors.map(d => d.id)

  console.log(`Keep users: ${keepUsers.length}`)
  console.log(`Delete test users (${testUsers.length}):`)
  for (const p of testUsers) {
    console.log(`  - [${p.role}] ${p.username || '(no username)'} — ${p.full_name} (${p.id})`)
  }

  console.log(`\nKeep debtors: ${keepDebtors.length}`)
  console.log(`Delete test debtors (${testDebtors.length}):`)
  for (const d of testDebtors) {
    console.log(`  - ${d.full_name} / ${d.receipt_number ?? '—'} (${d.id})`)
  }

  const taskIds = new Set()
  if (testDebtorIds.length) {
    const { data } = await sb.from('tasks').select('id').in('debtor_id', testDebtorIds)
    for (const t of data ?? []) taskIds.add(t.id)
  }
  if (testUserIds.length) {
    const { data: assigned } = await sb.from('tasks').select('id, debtor_id').in('assigned_to', testUserIds)
    for (const t of assigned ?? []) taskIds.add(t.id)
  }
  const testTaskIds = [...taskIds]

  // Safety: refuse if any selected task belongs to a NON-test debtor
  if (testTaskIds.length) {
    const { data: taskRows } = await sb
      .from('tasks')
      .select('id, debtor_id, debtors(full_name)')
      .in('id', testTaskIds)
    const unsafe = (taskRows ?? []).filter(t => {
      const name = Array.isArray(t.debtors) ? t.debtors[0]?.full_name : t.debtors?.full_name
      return !isTestDebtor({ full_name: name ?? '', receipt_number: '' })
        && !testDebtorIds.includes(t.debtor_id)
    })
    if (unsafe.length) {
      console.error('\nABORT: some tasks assigned to test users belong to real debtors:')
      for (const t of unsafe) {
        const name = Array.isArray(t.debtors) ? t.debtors[0]?.full_name : t.debtors?.full_name
        console.error(`  task ${t.id} → debtor ${name}`)
      }
      console.error('Unassign manually first; refusing to delete those tasks.')
      process.exit(1)
    }
  }

  console.log(`\nTest-related tasks to delete: ${testTaskIds.length}`)

  await run('null test debtor task pointers', async () => {
    if (!testDebtorIds.length) return '0'
    const { error } = await sb.from('debtors')
      .update({ current_task_id: null, last_task_id: null })
      .in('id', testDebtorIds)
    if (error) throw new Error(error.message)
    return String(testDebtorIds.length)
  })

  await run('delete task_attachments', async () => deleteIn('task_attachments', 'task_id', testTaskIds))
  await run('delete task_payment_receipts', async () => deleteIn('task_payment_receipts', 'task_id', testTaskIds))
  await run('delete expenses (by task)', async () => deleteIn('expenses', 'task_id', testTaskIds))
  await run('delete expenses (by lawyer)', async () => deleteIn('expenses', 'lawyer_id', testUserIds))
  await run('delete debtor_payments', async () => deleteIn('debtor_payments', 'debtor_id', testDebtorIds))
  await run('delete debtor_attachments', async () => deleteIn('debtor_attachments', 'debtor_id', testDebtorIds))
  await run('delete debtor_notes', async () => deleteIn('debtor_notes', 'debtor_id', testDebtorIds))
  await run('delete lawyer_wallet_transactions', async () => deleteIn('lawyer_wallet_transactions', 'lawyer_id', testUserIds))
  await run('delete lawyer_payout_requests', async () => deleteIn('lawyer_payout_requests', 'lawyer_id', testUserIds))
  await run('delete lawyer_attachments', async () => deleteIn('lawyer_attachments', 'lawyer_id', testUserIds))
  await run('delete delegate_wallet_transactions', async () => deleteIn('delegate_wallet_transactions', 'delegate_id', testUserIds))
  await run('delete delegate_wallets', async () => deleteIn('delegate_wallets', 'delegate_id', testUserIds))
  await run('delete activity_logs (test users only)', async () => deleteIn('activity_logs', 'user_id', testUserIds))

  await run('delete test tasks', async () => {
    if (!testTaskIds.length) return 0
    await sb.from('debtors').update({ current_task_id: null }).in('current_task_id', testTaskIds)
    await sb.from('debtors').update({ last_task_id: null }).in('last_task_id', testTaskIds)
    return deleteIn('tasks', 'id', testTaskIds)
  })

  await run('delete test debtors', async () => deleteIn('debtors', 'id', testDebtorIds))

  for (const p of testUsers) {
    await run(`delete user ${p.full_name}`, async () => {
      await sb.from('tasks').update({ assigned_to: null }).eq('assigned_to', p.id)
      await sb.from('tasks').update({ assignment_rejected_by: null }).eq('assignment_rejected_by', p.id)
      await sb.from('tasks').update({ created_by: null }).eq('created_by', p.id)
      const { error: pe2 } = await sb.from('profiles').delete().eq('id', p.id)
      if (pe2) throw new Error(pe2.message)
      const { error: ae } = await sb.auth.admin.deleteUser(p.id)
      if (ae && !/not found/i.test(ae.message)) throw new Error(ae.message)
      return 'profile+auth'
    })
  }

  // Orphan auth @test.local without profile
  for (const uid of testAuthIds) {
    if (testUserIds.includes(uid)) continue
    await run(`delete orphan auth ${uid}`, async () => {
      const { error } = await sb.auth.admin.deleteUser(uid)
      if (error && !/not found/i.test(error.message)) throw new Error(error.message)
      return 'auth-only'
    })
  }

  const { data: leftUsers } = await sb.from('profiles').select('id, username, full_name, role')
  const { data: leftDebtors } = await sb.from('debtors').select('id, full_name')
  const leftoverUsers = (leftUsers ?? []).filter(isTestProfile)
  const leftoverDebtors = (leftDebtors ?? []).filter(isTestDebtor)

  console.log(`\nUsers remaining: ${leftUsers?.length ?? 0}`)
  console.log(`Debtors remaining: ${leftDebtors?.length ?? 0}`)
  console.log(`Test users left: ${leftoverUsers.length}`)
  console.log(`Test debtors left: ${leftoverDebtors.length}`)

  if (dryRun) {
    console.log(`\nWould delete: ${testUsers.length} users, ${testDebtors.length} debtors, ${testTaskIds.length} tasks`)
    console.log('Dry run done. Re-run with --confirm to apply.')
  } else if (leftoverUsers.length || leftoverDebtors.length) {
    console.error('⚠ leftovers still present')
    process.exit(1)
  } else {
    console.log('\nCleanup complete — real users/debtors untouched.')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
