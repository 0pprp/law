/**
 * بغداد الكرخ — كارد «تحت إسناد مهمة»:
 * أسند مهمة «تسديد بالتنفيذ» فقط إن وُجدت عبارة «يسدد بالتنفيذ» في assignment_note.
 *
 * Dry-run:  npx tsx scripts/karkh-assign-execution-payment.ts
 * Confirm:  npx tsx scripts/karkh-assign-execution-payment.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const BRANCH_NAME = 'بغداد الكرخ'
const NOTE_PHRASE = 'يسدد بالتنفيذ'
const TASK_TYPE = 'first_registration' // تسديد بالتنفيذ

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}

function noteMatches(note: string | null | undefined): boolean {
  return String(note ?? '').includes(NOTE_PHRASE)
}

async function main() {
  loadEnv()
  const confirm = process.argv.includes('--confirm')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: branch, error: bErr } = await admin
    .from('branches')
    .select('id, name')
    .eq('name', BRANCH_NAME)
    .maybeSingle()
  if (bErr || !branch) throw new Error(`فرع غير موجود: ${BRANCH_NAME}`)

  const { data: def, error: dErr } = await admin
    .from('task_definitions')
    .select('id, label, task_type, fee_amount, is_active')
    .eq('branch_id', branch.id)
    .eq('task_type', TASK_TYPE)
    .eq('is_active', true)
    .maybeSingle()
  if (dErr || !def) throw new Error('تعريف تسديد بالتنفيذ غير موجود')

  // تحت إسناد: بلا مهمة حالية، غير مغلق
  const { data: debtors, error: debErr } = await admin
    .from('debtors')
    .select('id, full_name, assignment_note, case_type, case_status, current_task_id')
    .eq('branch_id', branch.id)
    .is('current_task_id', null)
    .neq('case_status', 'closed')
  if (debErr) throw new Error(debErr.message)

  const targets = (debtors ?? []).filter(d => noteMatches(d.assignment_note))
  const skipped = (debtors ?? []).length - targets.length

  console.log(`Branch: ${branch.name}`)
  console.log(`Task: ${def.label} (${def.id}) fee=${def.fee_amount}`)
  console.log(`Awaiting (no current task): ${(debtors ?? []).length}`)
  console.log(`Match note «${NOTE_PHRASE}»: ${targets.length}`)
  console.log(`Skipped (no matching note): ${skipped}`)
  for (const d of targets) {
    console.log(`  - ${d.full_name} | ${JSON.stringify(d.assignment_note)}`)
  }

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to apply.')
    return
  }

  const fee = Number(def.fee_amount) || 0
  let ok = 0
  for (const d of targets) {
    const { data: created, error: cErr } = await admin
      .from('tasks')
      .insert({
        debtor_id: d.id,
        task_definition_id: def.id,
        task_type: def.task_type,
        task_status: 'waiting_assignment',
        reward_amount: fee,
        branch_id: branch.id,
      })
      .select('id')
      .single()
    if (cErr || !created) {
      console.error(`  FAIL ${d.full_name}: ${cErr?.message}`)
      continue
    }
    const { error: uErr } = await admin
      .from('debtors')
      .update({ current_task_id: created.id })
      .eq('id', d.id)
      .is('current_task_id', null)
    if (uErr) {
      console.error(`  FAIL link ${d.full_name}: ${uErr.message}`)
      continue
    }
    ok++
    console.log(`  assigned: ${d.full_name}`)
  }

  console.log(`\n=== DONE ===\nAssigned: ${ok}/${targets.length}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
