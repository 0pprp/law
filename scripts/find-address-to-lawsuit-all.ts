/**
 * تحويل كل المدينين المدنيين غير المكلفين
 * من «إيجاد عنوان المدين والإنذار» → «إقامة دعوى» (تبقى غير مكلفة).
 * يشمل كل الفروع النشطة.
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/find-address-to-lawsuit-all.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/find-address-to-lawsuit-all.ts --confirm
 */
import { createClient } from '@supabase/supabase-js'

const EDITABLE = new Set(['waiting_assignment', 'pending_assignment', 'draft', 'new'])

async function main() {
  const confirm = process.argv.includes('--confirm')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: branches, error: bErr } = await admin
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
  if (bErr) throw new Error(bErr.message)

  type Target = {
    branchName: string
    debtorId: string
    name: string
    taskId: string
    lawsuitDefId: string
    fee: number
  }

  const targets: Target[] = []
  const perBranch: Record<string, number> = {}

  for (const branch of branches ?? []) {
    const { data: defs, error: dErr } = await admin
      .from('task_definitions')
      .select('id, label, task_type, fee_amount, is_active, case_type')
      .eq('branch_id', branch.id)
      .eq('is_active', true)
      .or('case_type.eq.civil,case_type.is.null')
      .in('task_type', ['find_address', 'file_lawsuit'])
    if (dErr) throw new Error(`${branch.name}: ${dErr.message}`)

    const findDef = (defs ?? []).find(d => d.task_type === 'find_address')
    const lawsuitDef = (defs ?? []).find(d => d.task_type === 'file_lawsuit')
    if (!findDef || !lawsuitDef) {
      console.log(`Skip ${branch.name}: missing find_address or file_lawsuit def`)
      continue
    }

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
    if (debErr) throw new Error(`${branch.name}: ${debErr.message}`)

    type TaskRow = {
      id: string
      task_definition_id: string | null
      task_type: string | null
      task_status: string | null
      assigned_to: string | null
    }

    let count = 0
    for (const d of debtors ?? []) {
      const t = d.current_task as TaskRow | TaskRow[] | null
      const task = Array.isArray(t) ? t[0] : t
      if (!task) continue
      if (task.task_definition_id !== findDef.id) continue
      if (task.assigned_to) continue
      if (!EDITABLE.has(String(task.task_status ?? ''))) continue
      targets.push({
        branchName: branch.name,
        debtorId: d.id,
        name: String(d.full_name ?? ''),
        taskId: task.id,
        lawsuitDefId: lawsuitDef.id,
        fee: Number(lawsuitDef.fee_amount) || 0,
      })
      count++
    }
    if (count > 0) perBranch[branch.name] = count
  }

  console.log('Per branch:')
  for (const [name, n] of Object.entries(perBranch)) {
    console.log(`  ${name}: ${n}`)
  }
  console.log(`\nTotal matches: ${targets.length}`)
  for (const row of targets.slice(0, 15)) {
    console.log(`  - [${row.branchName}] ${row.name}`)
  }
  if (targets.length > 15) console.log(`  ... +${targets.length - 15} more`)

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to apply.')
    return
  }

  let ok = 0
  for (const row of targets) {
    const { error } = await admin
      .from('tasks')
      .update({
        task_definition_id: row.lawsuitDefId,
        task_type: 'file_lawsuit',
        reward_amount: row.fee,
        assigned_to: null,
        task_status: 'waiting_assignment',
        due_date: null,
      })
      .eq('id', row.taskId)
    if (error) {
      console.error(`  FAIL [${row.branchName}] ${row.name}: ${error.message}`)
      continue
    }
    ok++
  }

  console.log(`\n=== DONE ===\nUpdated: ${ok}/${targets.length}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
