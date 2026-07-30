/**
 * Hard-delete all [TEST] / test.* accounts and related data.
 * Run: node --env-file=.env.local scripts/e2e-full-audit/99-delete-test-accounts.mjs
 */
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: profiles } = await admin
  .from('profiles')
  .select('id, username, full_name, role')
  .or('username.ilike.test.%,full_name.ilike.%[TEST]%')

const targets = profiles ?? []
console.log(`Found ${targets.length} test accounts:`)
for (const p of targets) console.log(`  - ${p.username} (${p.role}) ${p.id}`)

async function tryUpdate(table, patch, col, id) {
  const { error } = await admin.from(table).update(patch).eq(col, id)
  if (error && !/does not exist|Could not find|schema cache/i.test(error.message)) {
    console.log(`  warn update ${table}.${col}: ${error.message}`)
  }
}
async function tryDelete(table, col, id) {
  const { error } = await admin.from(table).delete().eq(col, id)
  if (error && !/does not exist|Could not find|schema cache/i.test(error.message)) {
    console.log(`  warn delete ${table}.${col}: ${error.message}`)
  }
}

async function purgeUser(p) {
  const id = p.id
  console.log(`\nDeleting ${p.username}...`)

  // wallets / attachments owned by user
  await tryDelete('lawyer_attachments', 'lawyer_id', id)
  await tryDelete('lawyer_wallet_transactions', 'lawyer_id', id)
  await tryDelete('delegate_wallet_transactions', 'delegate_id', id)
  await tryDelete('delegate_wallets', 'delegate_id', id)
  await tryDelete('lawyer_payout_requests', 'lawyer_id', id)
  await tryDelete('legal_manager_wallet_transactions', 'legal_manager_id', id)
  await tryDelete('legal_manager_wallets', 'legal_manager_id', id)

  // nullify FKs
  for (const [table, col] of [
    ['tasks', 'assigned_to'],
    ['tasks', 'assignment_rejected_by'],
    ['tasks', 'created_by'],
    ['lawyer_attachments', 'uploaded_by'],
    ['lawyer_wallet_transactions', 'created_by'],
    ['delegate_wallet_transactions', 'created_by'],
    ['expenses', 'created_by'],
    ['expenses', 'lawyer_id'],
    ['lawyer_payout_requests', 'reviewed_by'],
    ['lawyer_payout_requests', 'created_by'],
    ['debtors', 'created_by'],
    ['debtors', 'duplicate_flagged_by'],
    ['debtor_notes', 'user_id'],
    ['debtor_attachments', 'uploaded_by'],
    ['task_attachments', 'uploaded_by'],
    ['payments', 'created_by'],
    ['payments', 'recorded_by'],
    ['activity_logs', 'user_id'],
    ['branch_lists', 'created_by'],
    ['special_statuses', 'created_by'],
  ]) {
    await tryUpdate(table, { [col]: null }, col, id)
  }

  // if activity_logs can't nullify, delete
  await tryDelete('activity_logs', 'user_id', id)

  // any remaining [TEST] debtors created by this user already cleaned — skip

  const { error: profileErr } = await admin.from('profiles').delete().eq('id', id)
  if (profileErr) {
    console.log(`  PROFILE DELETE FAILED: ${profileErr.message}`)
    // last-resort: find blocking FKs by scanning common tables for remaining refs
    return false
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(id)
  if (authErr && !/not found|user not found/i.test(authErr.message)) {
    console.log(`  AUTH DELETE FAILED: ${authErr.message}`)
    return false
  }
  console.log(`  OK deleted profile + auth`)
  return true
}

let ok = 0
let fail = 0
for (const p of targets) {
  const success = await purgeUser(p)
  if (success) ok++
  else fail++
}

// leftover [TEST] operational data
const { data: debtors } = await admin.from('debtors').select('id').ilike('full_name', '%[TEST]%')
if (debtors?.length) {
  const ids = debtors.map(d => d.id)
  const { data: tasks } = await admin.from('tasks').select('id').in('debtor_id', ids)
  const taskIds = (tasks ?? []).map(t => t.id)
  if (taskIds.length) {
    await admin.from('task_attachments').delete().in('task_id', taskIds)
    await admin.from('expenses').delete().in('task_id', taskIds)
    await admin.from('tasks').delete().in('id', taskIds)
  }
  await admin.from('expenses').delete().in('debtor_id', ids)
  await admin.from('debtor_attachments').delete().in('debtor_id', ids)
  await admin.from('debtor_notes').delete().in('debtor_id', ids)
  await admin.from('debtors').update({ current_task_id: null, last_task_id: null, special_status_id: null }).in('id', ids)
  await admin.from('debtors').delete().in('id', ids)
  console.log(`\nCleaned leftover [TEST] debtors: ${ids.length}`)
}
await admin.from('special_statuses').delete().ilike('name', '[TEST]%')

// verify
const { data: left } = await admin
  .from('profiles')
  .select('id, username, full_name, role')
  .or('username.ilike.test.%,full_name.ilike.%[TEST]%')
const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const leftAuth = (authUsers?.users ?? []).filter(u => (u.email ?? '').endsWith('@test.local') || (u.email ?? '').includes('test.'))

console.log(`\n=== DONE ok=${ok} fail=${fail} ===`)
console.log('Remaining profiles:', left?.length ? JSON.stringify(left) : 'none')
console.log('Remaining @test.local auth:', leftAuth.map(u => u.email).join(', ') || 'none')
