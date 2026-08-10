/**
 * تحويل كل الأسماء غير المكلفة تحت «إقامة دعوى» → «تحت إسناد مهمة».
 * الطريقة: مسح task_definition_id للمهمة الحالية (غير مكلفة) فيبقى المدين
 * في كارد الأسماء التي تحت إسناد مهمة (مهمة بلا تعريف).
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/move-lawsuit-to-awaiting-assignment.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/move-lawsuit-to-awaiting-assignment.ts --confirm
 */
import { createClient } from '@supabase/supabase-js'

const EDITABLE = new Set(['waiting_assignment', 'pending_assignment', 'draft', 'new'])
const BATCH = 200

async function main() {
  const confirm = process.argv.includes('--confirm')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: branches } = await admin.from('branches').select('id, name')
  const branchName = new Map((branches ?? []).map(b => [b.id, b.name]))

  // تعريفات إقامة دعوى (حسب النوع أو الاسم)
  const { data: defs, error: defErr } = await admin
    .from('task_definitions')
    .select('id, label, task_type, branch_id')
  if (defErr) throw new Error(defErr.message)

  const lawsuitDefIds = new Set(
    (defs ?? [])
      .filter(d => {
        const label = String(d.label ?? '')
        return d.task_type === 'file_lawsuit' || label.includes('إقامة دعوى')
      })
      .map(d => d.id),
  )

  console.log(`Lawsuit definitions matched: ${lawsuitDefIds.size}`)
  if (!lawsuitDefIds.size) {
    console.log('No definitions found — nothing to do')
    return
  }

  type Target = {
    debtorId: string
    name: string
    branch: string
    taskId: string
    status: string
    defLabel: string
  }

  const targets: Target[] = []
  const PAGE = 500
  let from = 0

  while (true) {
    const { data: rows, error } = await admin
      .from('debtors')
      .select(`
        id, full_name, branch_id, case_status, case_type, current_task_id,
        current_task:tasks!debtors_current_task_id_fkey (
          id, task_type, task_status, assigned_to, task_definition_id
        )
      `)
      .neq('case_status', 'closed')
      .not('current_task_id', 'is', null)
      .is('special_status_id', null)
      .order('id')
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    if (!rows?.length) break

    for (const d of rows) {
      const t = (Array.isArray(d.current_task) ? d.current_task[0] : d.current_task) as {
        id: string
        task_type: string | null
        task_status: string | null
        assigned_to: string | null
        task_definition_id: string | null
      } | null
      if (!t?.id) continue
      if (t.assigned_to) continue
      if (!EDITABLE.has(String(t.task_status ?? ''))) continue

      const isLawsuit =
        t.task_type === 'file_lawsuit'
        || (t.task_definition_id != null && lawsuitDefIds.has(t.task_definition_id))
      if (!isLawsuit) continue
      // بالفعل بلا تعريف → تحت إسناد مهمة أصلاً
      if (!t.task_definition_id) continue

      const defLabel = (defs ?? []).find(x => x.id === t.task_definition_id)?.label ?? t.task_type ?? '—'
      targets.push({
        debtorId: d.id,
        name: String(d.full_name ?? ''),
        branch: branchName.get(d.branch_id) ?? d.branch_id ?? '—',
        taskId: t.id,
        status: String(t.task_status),
        defLabel: String(defLabel),
      })
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  const byBranch = new Map<string, number>()
  for (const t of targets) {
    byBranch.set(t.branch, (byBranch.get(t.branch) ?? 0) + 1)
  }

  console.log(`\nTargets: ${targets.length}`)
  console.log('Per branch:')
  for (const [name, n] of [...byBranch.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${n}`)
  }

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to apply.')
    return
  }

  let updated = 0
  let failed = 0
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    const ids = chunk.map(t => t.taskId)
    const { error: updErr } = await admin
      .from('tasks')
      .update({
        task_definition_id: null,
        assigned_to: null,
        task_status: 'waiting_assignment',
        due_date: null,
      })
      .in('id', ids)

    if (updErr) {
      console.error(`Batch ${i}: ${updErr.message}`)
      failed += chunk.length
    } else {
      updated += chunk.length
      console.log(`  updated ${updated}/${targets.length}`)
    }
  }

  console.log(`\nDone. updated=${updated} failed=${failed}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
