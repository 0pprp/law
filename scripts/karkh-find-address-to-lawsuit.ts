/**
 * بغداد الكرخ: تحويل المدينين المدنيين غير المكلفين
 * من «إيجاد عنوان المدين والإنذار» → «إقامة دعوى» (تبقى غير مكلفة).
 *
 * Dry-run:  npx tsx scripts/karkh-find-address-to-lawsuit.ts
 * Confirm:  npx tsx scripts/karkh-find-address-to-lawsuit.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const BRANCH_NAME = 'بغداد الكرخ'
const EDITABLE = new Set(['waiting_assignment', 'pending_assignment', 'draft', 'new'])

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

async function main() {
  loadEnv()
  const confirm = process.argv.includes('--confirm')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: branch, error: bErr } = await admin
    .from('branches')
    .select('id, name')
    .eq('name', BRANCH_NAME)
    .maybeSingle()
  if (bErr || !branch) throw new Error(`فرع غير موجود: ${BRANCH_NAME} — ${bErr?.message ?? ''}`)

  const { data: defs, error: dErr } = await admin
    .from('task_definitions')
    .select('id, label, task_type, fee_amount, is_active, case_type')
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .or('case_type.eq.civil,case_type.is.null')
    .in('task_type', ['find_address', 'file_lawsuit'])
  if (dErr) throw new Error(dErr.message)

  const findDef = (defs ?? []).find(d => d.task_type === 'find_address')
  const lawsuitDef = (defs ?? []).find(d => d.task_type === 'file_lawsuit')
  if (!findDef) throw new Error('تعريف إيجاد عنوان غير موجود في الفرع')
  if (!lawsuitDef) throw new Error('تعريف إقامة دعوى غير موجود في الفرع')

  // مدينون مدنيون غير مغلقين في الكرخ ومهمتهم الحالية = إيجاد عنوان وغير مكلفة
  const { data: debtors, error: debErr } = await admin
    .from('debtors')
    .select(`
      id, full_name, case_status, case_type, current_task_id,
      current_task:tasks!debtors_current_task_id_fkey (
        id, task_definition_id, task_type, task_status, assigned_to
      )
    `)
    .eq('branch_id', branch.id)
    .neq('case_status', 'closed')
    .or('case_type.eq.civil,case_type.is.null')
    .not('current_task_id', 'is', null)
  if (debErr) throw new Error(debErr.message)

  type TaskRow = {
    id: string
    task_definition_id: string | null
    task_type: string | null
    task_status: string | null
    assigned_to: string | null
  }

  const targets: { debtorId: string; name: string; taskId: string }[] = []
  for (const d of debtors ?? []) {
    const t = d.current_task as TaskRow | TaskRow[] | null
    const task = Array.isArray(t) ? t[0] : t
    if (!task) continue
    if (task.task_definition_id !== findDef.id) continue
    if (task.assigned_to) continue
    if (!EDITABLE.has(String(task.task_status ?? ''))) continue
    targets.push({
      debtorId: d.id,
      name: String(d.full_name ?? ''),
      taskId: task.id,
    })
  }

  const fee = Number(lawsuitDef.fee_amount) || 0
  console.log(`Branch: ${branch.name} (${branch.id})`)
  console.log(`From: ${findDef.label} (${findDef.id})`)
  console.log(`To:   ${lawsuitDef.label} (${lawsuitDef.id}) fee=${fee}`)
  console.log(`Matches: ${targets.length}`)
  for (const row of targets.slice(0, 10)) {
    console.log(`  - ${row.name}`)
  }
  if (targets.length > 10) console.log(`  ... +${targets.length - 10} more`)

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to apply.')
    return
  }

  let ok = 0
  for (const row of targets) {
    const { error } = await admin
      .from('tasks')
      .update({
        task_definition_id: lawsuitDef.id,
        task_type: 'file_lawsuit',
        reward_amount: fee,
        assigned_to: null,
        task_status: 'waiting_assignment',
        due_date: null,
      })
      .eq('id', row.taskId)
    if (error) {
      console.error(`  FAIL ${row.name}: ${error.message}`)
      continue
    }
    ok++
    console.log(`  updated: ${row.name}`)
  }

  console.log(`\n=== DONE ===\nUpdated: ${ok}/${targets.length}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
