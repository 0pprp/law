/**
 * مسح فرع «تجريبي» بالكامل (مدينون + مهام + يوزرات demo_* + الفرع نفسه).
 *
 *   node --env-file=.env.local scripts/purge-experimental-branch.mjs --dry-run
 *   node --env-file=.env.local scripts/purge-experimental-branch.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const BRANCH_NAME = 'تجريبي'
const DEMO_PREFIX = 'demo_'
const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')

if (!dryRun && !confirm) {
  console.error('Use --dry-run or --confirm')
  process.exit(1)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: branch } = await admin
  .from('branches')
  .select('id, name')
  .eq('name', BRANCH_NAME)
  .maybeSingle()

if (!branch) {
  console.log('Branch not found — nothing to purge')
  process.exit(0)
}

const branchId = branch.id
console.log(dryRun ? '=== DRY RUN ===' : '=== PURGE ===')
console.log(`Branch: ${BRANCH_NAME} (${branchId})`)

const { count: debtorCount } = await admin
  .from('debtors')
  .select('id', { count: 'exact', head: true })
  .eq('branch_id', branchId)
const { count: taskCount } = await admin
  .from('tasks')
  .select('id', { count: 'exact', head: true })
  .eq('branch_id', branchId)
const { data: demoUsers } = await admin
  .from('profiles')
  .select('id, username, role')
  .ilike('username', `${DEMO_PREFIX}%`)

console.log(`debtors: ${debtorCount ?? 0}`)
console.log(`tasks: ${taskCount ?? 0}`)
console.log(`demo users: ${(demoUsers ?? []).map(u => u.username).join(', ') || 'none'}`)

if (dryRun) {
  console.log('\nDry run only. Re-run with --confirm to delete.')
  process.exit(0)
}

const { data: debtorIds } = await admin.from('debtors').select('id').eq('branch_id', branchId)
const ids = (debtorIds ?? []).map(d => d.id)

if (ids.length) {
  await admin.from('debtors').update({ current_task_id: null, last_task_id: null }).in('id', ids)
  for (const table of [
    'task_attachments',
    'debtor_attachments',
    'debtor_notes',
    'debtor_payments',
    'expenses',
    'task_payment_receipts',
  ]) {
    const { error } = await admin.from(table).delete().in('debtor_id', ids)
    if (error) console.warn(`${table}: ${error.message}`)
    else console.log(`deleted ${table}`)
  }
  await admin.from('tasks').delete().eq('branch_id', branchId)
  await admin.from('debtors').delete().eq('branch_id', branchId)
  console.log('deleted debtors + tasks')
} else {
  await admin.from('tasks').delete().eq('branch_id', branchId)
}

const { data: defIds } = await admin.from('task_definitions').select('id').eq('branch_id', branchId)
const dIds = (defIds ?? []).map(d => d.id)
if (dIds.length) {
  await admin.from('task_required_fields').delete().in('task_definition_id', dIds)
  await admin.from('task_definition_expenses').delete().in('task_definition_id', dIds)
  await admin.from('task_definitions').delete().eq('branch_id', branchId)
  console.log(`deleted task_definitions: ${dIds.length}`)
}

await admin.from('chief_accountant_branches').delete().eq('branch_id', branchId)

for (const u of demoUsers ?? []) {
  await admin.from('delegate_wallets').delete().eq('delegate_id', u.id)
  await admin.from('profiles').delete().eq('id', u.id)
  await admin.auth.admin.deleteUser(u.id)
  console.log(`deleted user ${u.username}`)
}

await admin.from('branches').delete().eq('id', branchId)
console.log(`deleted branch ${BRANCH_NAME}`)
console.log('\nDone. Reminder: remove «تجريبي» from lib/branch-constants.ts APPROVED_BRANCH_NAMES if still listed.')
