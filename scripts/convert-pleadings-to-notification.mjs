/**
 * تحويل أسماء «مرافعات» غير المكلفة إلى مهمة «التبليغ»،
 * مع استثناء من لديهم تاريخ مرافعة خلال يومين أو أقل (الشارة الحمراء).
 *
 *   node --env-file=.env.local scripts/convert-pleadings-to-notification.mjs --dry-run
 *   node --env-file=.env.local scripts/convert-pleadings-to-notification.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

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

function localTodayYmd(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function plusDays(todayYmd, n) {
  const d = new Date(`${todayYmd}T12:00:00`)
  d.setDate(d.getDate() + n)
  return localTodayYmd(d)
}

const today = localTodayYmd()
const redEnd = plusDays(today, 2)

const { data: pleadingDefs, error: pErr } = await admin
  .from('task_definitions')
  .select('id')
  .eq('task_type', 'pleading')
  .eq('is_active', true)
if (pErr) throw new Error(pErr.message)
const pleadingIds = (pleadingDefs ?? []).map(d => d.id)
if (!pleadingIds.length) throw new Error('No pleading defs')

const { data: notifDefs, error: nErr } = await admin
  .from('task_definitions')
  .select('id, branch_id, label, task_type, fee_amount')
  .eq('task_type', 'notification')
  .eq('is_active', true)
  .eq('label', 'التبليغ')
if (nErr) throw new Error(nErr.message)
const notifByBranch = new Map((notifDefs ?? []).map(d => [d.branch_id, d]))

const candidates = []
let from = 0
while (true) {
  const { data, error } = await admin
    .from('debtors')
    .select(
      'id, full_name, branch_id, first_hearing_date, current_task_id, branches(name), current_task:tasks!current_task_id!inner(id, assigned_to, task_status, task_definition_id, task_type)',
    )
    .eq('case_type', 'civil')
    .not('case_status', 'eq', 'closed')
    .not('case_status', 'eq', 'payment_in_progress')
    .is('special_status_id', null)
    .in('current_task.task_definition_id', pleadingIds)
    .is('current_task.assigned_to', null)
    .not('current_task.task_status', 'in', '(approved,completed,closed,rejected)')
    .range(from, from + 999)
  if (error) throw new Error(error.message)
  candidates.push(...(data ?? []))
  if (!data || data.length < 1000) break
  from += 1000
}

function isRed(d) {
  const hd = d.first_hearing_date && String(d.first_hearing_date).slice(0, 10)
  return Boolean(hd && hd >= today && hd <= redEnd)
}

const keep = candidates.filter(isRed)
const convert = candidates.filter(d => !isRed(d))

console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===')
console.log(`Today=${today} redEnd=${redEnd}`)
console.log(`Unassigned pleadings: ${candidates.length}`)
console.log(`Keep (red ≤2 days): ${keep.length}`)
console.log(`Convert → التبليغ: ${convert.length}`)
console.log('\nKept:')
for (const d of keep) {
  console.log(`  ${d.full_name} | ${d.first_hearing_date} | ${d.branches?.name}`)
}

const missing = convert.filter(d => !notifByBranch.get(d.branch_id))
if (missing.length) {
  console.error(`\nMissing التبليغ def for ${missing.length} debtors — abort`)
  for (const d of missing.slice(0, 10)) console.error(' ', d.full_name, d.branches?.name)
  process.exit(1)
}

if (dryRun) {
  const byBranch = new Map()
  for (const d of convert) {
    const n = d.branches?.name ?? '?'
    byBranch.set(n, (byBranch.get(n) ?? 0) + 1)
  }
  console.log('\nConvert by branch:')
  for (const [n, c] of [...byBranch.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}: ${c}`)
  }
  console.log('\nDry run only. Re-run with --confirm to apply.')
  process.exit(0)
}

let updated = 0
const errors = []

for (const d of convert) {
  const def = notifByBranch.get(d.branch_id)
  const task = d.current_task
  if (!def || !task?.id) {
    errors.push(`${d.full_name}: missing def/task`)
    continue
  }
  if (task.task_definition_id === def.id) {
    updated++
    continue
  }

  const fee = Number(def.fee_amount) || 0
  const { error: updErr } = await admin
    .from('tasks')
    .update({
      task_definition_id: def.id,
      task_type: def.task_type,
      reward_amount: fee,
      assigned_to: null,
      task_status: 'waiting_assignment',
      due_date: null,
    })
    .eq('id', task.id)
    .is('assigned_to', null)

  if (updErr) {
    errors.push(`${d.full_name}: ${updErr.message}`)
    continue
  }
  updated++
}

console.log(`\nUpdated: ${updated}`)
if (errors.length) {
  console.log(`Errors (${errors.length}):`)
  for (const e of errors.slice(0, 30)) console.log(' ', e)
  process.exitCode = 1
} else {
  console.log('Done. Kept red names on مرافعات.')
}
