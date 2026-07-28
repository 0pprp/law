/**
 * إسناد «إقامة دعوى» لكل الأسماء تحت إسناد مهمة في السماوة وبابل
 * (مدين بلا current_task أو مهمة بلا تعريف وغير مكلفة).
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/assign-lawsuit-samawa-babil.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/assign-lawsuit-samawa-babil.ts --confirm
 */
import { createClient } from '@supabase/supabase-js'

const BRANCH_NAMES = ['السماوة', 'بابل'] as const
const EDITABLE = new Set(['waiting_assignment', 'pending_assignment', 'draft', 'new'])
const TERMINAL = new Set(['approved', 'completed', 'closed', 'cancelled', 'rejected_final'])

async function main() {
  const confirm = process.argv.includes('--confirm')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: branches, error: bErr } = await admin
    .from('branches')
    .select('id, name')
    .in('name', [...BRANCH_NAMES])
  if (bErr) throw new Error(bErr.message)

  type Target = {
    branchName: string
    branchId: string
    debtorId: string
    name: string
    mode: 'create' | 'update'
    taskId: string | null
    lawsuitDefId: string
    fee: number
    taskType: string
  }

  const targets: Target[] = []

  for (const branch of branches ?? []) {
    const { data: defs, error: dErr } = await admin
      .from('task_definitions')
      .select('id, label, task_type, fee_amount, is_active, case_type')
      .eq('branch_id', branch.id)
      .eq('is_active', true)
      .eq('task_type', 'file_lawsuit')
      .or('case_type.eq.civil,case_type.is.null')
      .limit(1)
    if (dErr) throw new Error(`${branch.name}: ${dErr.message}`)
    const lawsuitDef = defs?.[0]
    if (!lawsuitDef) {
      console.log(`Skip ${branch.name}: no file_lawsuit definition`)
      continue
    }

    const fee = Number(lawsuitDef.fee_amount) || 0

    // 1) بلا مهمة حالية
    let q1 = admin
      .from('debtors')
      .select('id, full_name, case_type, case_status, current_task_id, duplicate_flagged_at')
      .eq('branch_id', branch.id)
      .neq('case_status', 'closed')
      .is('current_task_id', null)
      .or('case_type.eq.civil,case_type.is.null')

    const { data: noTask, error: e1 } = await q1
    if (e1 && e1.message.includes('duplicate_flagged_at')) {
      const retry = await admin
        .from('debtors')
        .select('id, full_name, case_type, case_status, current_task_id')
        .eq('branch_id', branch.id)
        .neq('case_status', 'closed')
        .is('current_task_id', null)
        .or('case_type.eq.civil,case_type.is.null')
      if (retry.error) throw new Error(`${branch.name}: ${retry.error.message}`)
      for (const d of retry.data ?? []) {
        targets.push({
          branchName: branch.name,
          branchId: branch.id,
          debtorId: d.id,
          name: String(d.full_name ?? ''),
          mode: 'create',
          taskId: null,
          lawsuitDefId: lawsuitDef.id,
          fee,
          taskType: String(lawsuitDef.task_type),
        })
      }
    } else if (e1) {
      throw new Error(`${branch.name}: ${e1.message}`)
    } else {
      for (const d of noTask ?? []) {
        if (d.duplicate_flagged_at) continue
        targets.push({
          branchName: branch.name,
          branchId: branch.id,
          debtorId: d.id,
          name: String(d.full_name ?? ''),
          mode: 'create',
          taskId: null,
          lawsuitDefId: lawsuitDef.id,
          fee,
          taskType: String(lawsuitDef.task_type),
        })
      }
    }

    // 2) مهمة يتيمة بلا تعريف وغير مكلفة
    const { data: withTask, error: e2 } = await admin
      .from('debtors')
      .select(`
        id, full_name, duplicate_flagged_at,
        current_task:tasks!debtors_current_task_id_fkey (
          id, task_definition_id, task_status, assigned_to
        )
      `)
      .eq('branch_id', branch.id)
      .neq('case_status', 'closed')
      .not('current_task_id', 'is', null)
      .or('case_type.eq.civil,case_type.is.null')
    if (e2) throw new Error(`${branch.name}: ${e2.message}`)

    for (const d of withTask ?? []) {
      if ((d as { duplicate_flagged_at?: string | null }).duplicate_flagged_at) continue
      const t = Array.isArray(d.current_task) ? d.current_task[0] : d.current_task
      if (!t) continue
      if (t.task_definition_id) continue
      if (t.assigned_to) continue
      if (TERMINAL.has(String(t.task_status ?? ''))) continue
      if (!EDITABLE.has(String(t.task_status ?? '')) && t.task_status !== 'waiting_assignment') {
        // still allow waiting_assignment
      }
      targets.push({
        branchName: branch.name,
        branchId: branch.id,
        debtorId: d.id,
        name: String(d.full_name ?? ''),
        mode: 'update',
        taskId: t.id,
        lawsuitDefId: lawsuitDef.id,
        fee,
        taskType: String(lawsuitDef.task_type),
      })
    }
  }

  const byBranch: Record<string, number> = {}
  for (const t of targets) byBranch[t.branchName] = (byBranch[t.branchName] ?? 0) + 1

  console.log('Per branch:')
  for (const [b, n] of Object.entries(byBranch)) console.log(`  ${b}: ${n}`)
  console.log(`Total: ${targets.length}`)
  for (const t of targets.slice(0, 15)) {
    console.log(`  - [${t.branchName}] ${t.name} (${t.mode})`)
  }
  if (targets.length > 15) console.log(`  ... +${targets.length - 15}`)

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to apply.')
    return
  }

  let ok = 0
  let fail = 0
  for (const row of targets) {
    try {
      if (row.mode === 'create') {
        const { data: created, error } = await admin
          .from('tasks')
          .insert({
            debtor_id: row.debtorId,
            task_definition_id: row.lawsuitDefId,
            task_type: row.taskType,
            task_status: 'waiting_assignment',
            reward_amount: row.fee,
            branch_id: row.branchId,
          })
          .select('id')
          .single()
        if (error || !created) throw new Error(error?.message ?? 'create failed')
        const { error: uErr } = await admin
          .from('debtors')
          .update({ current_task_id: created.id })
          .eq('id', row.debtorId)
        if (uErr) throw new Error(uErr.message)
      } else {
        const { error } = await admin
          .from('tasks')
          .update({
            task_definition_id: row.lawsuitDefId,
            task_type: row.taskType,
            reward_amount: row.fee,
            assigned_to: null,
            task_status: 'waiting_assignment',
            due_date: null,
          })
          .eq('id', row.taskId!)
        if (error) throw new Error(error.message)
      }
      ok++
    } catch (e) {
      fail++
      console.error(`  FAIL [${row.branchName}] ${row.name}:`, e instanceof Error ? e.message : e)
    }
  }

  console.log(`\n=== DONE ===\nOK: ${ok}  Failed: ${fail}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
