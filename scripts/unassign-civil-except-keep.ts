/**
 * إلغاء تكليف القضايا المدنية المكلفة → غير مكلفة.
 *
 * يستثنى:
 * 1) علي عبد الحسين حميد ، بهاء حامد حسن (يبقون مكلّفين)
 * 2) إقامة دعوى (file_lawsuit) المتأخرة (due_date < اليوم) — لا تُمس
 * 3) مهام بانتظار الاعتماد (submitted / pending_review) — لا تُمس
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/unassign-civil-except-keep.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/unassign-civil-except-keep.ts --confirm
 */
import { createClient } from '@supabase/supabase-js'
import { unassignTasksToWaiting } from '../lib/task-assignment'
import { localTodayYmd, isActiveOverdueTask } from '../lib/local-date'

const KEEP_NAMES = [
  'علي عبد الحسين حميد',
  'بهاء حامد حسن',
]

/** حالات «مكلفة» النشطة فقط — بدون بانتظار الاعتماد */
const ACTIVE_ASSIGNED = new Set([
  'assignment_pending_acceptance',
  'assigned',
  'in_progress',
  'needs_revision',
  'rejected',
])

function normName(s: string): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

function isKeepName(fullName: string): boolean {
  const n = normName(fullName)
  return KEEP_NAMES.some(k => n === k || n.includes(k) || k.includes(n))
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const admin = createClient(url, key, { auth: { persistSession: false } })
  const today = localTodayYmd()

  const { data: branches } = await admin.from('branches').select('id, name')
  const branchName = new Map((branches ?? []).map(b => [b.id, b.name]))

  const { data: debtors, error } = await admin
    .from('debtors')
    .select(`
      id, full_name, case_type, case_status, branch_id,
      current_task:tasks!debtors_current_task_id_fkey (
        id, task_type, task_status, assigned_to, due_date, fee_status, delegate_fee_status
      )
    `)
    .neq('case_status', 'closed')
    .or('case_type.eq.civil,case_type.is.null')
    .not('current_task_id', 'is', null)
  if (error) throw new Error(error.message)

  type TaskRow = {
    id: string
    task_type: string | null
    task_status: string | null
    assigned_to: string | null
    due_date: string | null
    fee_status?: string | null
    delegate_fee_status?: string | null
  }

  const keepNamed: { name: string; status: string; type: string | null; branch: string }[] = []
  const keepOverdueLawsuit: { name: string; due: string; status: string; branch: string }[] = []
  const keepPendingReview: { name: string; status: string; branch: string }[] = []
  const toUnassign: { taskId: string; name: string; status: string; type: string | null; branch: string }[] = []

  for (const d of debtors ?? []) {
    const t = (Array.isArray(d.current_task) ? d.current_task[0] : d.current_task) as TaskRow | null
    if (!t?.assigned_to) continue

    const status = String(t.task_status ?? '')
    const name = normName(String(d.full_name ?? ''))
    const branch = branchName.get(d.branch_id) ?? d.branch_id

    if (isKeepName(name)) {
      keepNamed.push({ name, status, type: t.task_type, branch })
      continue
    }

    // إقامة دعوى المتأخرة — لا تُمس
    if (
      t.task_type === 'file_lawsuit'
      && isActiveOverdueTask(t.due_date, status)
    ) {
      keepOverdueLawsuit.push({ name, due: String(t.due_date), status, branch })
      continue
    }

    // بانتظار الاعتماد — لا تُمس
    if (status === 'submitted' || status === 'pending_review') {
      keepPendingReview.push({ name, status, branch })
      continue
    }

    if (!ACTIVE_ASSIGNED.has(status)) continue

    toUnassign.push({
      taskId: t.id,
      name,
      status,
      type: t.task_type,
      branch,
    })
  }

  console.log(`Today: ${today}`)
  console.log(`\nKEEP by name (${keepNamed.length}):`)
  for (const r of keepNamed) console.log(`  - [${r.branch}] ${r.name} | ${r.type} | ${r.status}`)

  console.log(`\nKEEP overdue file_lawsuit (${keepOverdueLawsuit.length}):`)
  for (const r of keepOverdueLawsuit.slice(0, 15)) {
    console.log(`  - [${r.branch}] ${r.name} | due ${r.due} | ${r.status}`)
  }
  if (keepOverdueLawsuit.length > 15) console.log(`  ... +${keepOverdueLawsuit.length - 15}`)

  console.log(`\nKEEP pending review (other) (${keepPendingReview.length}):`)
  for (const r of keepPendingReview.slice(0, 10)) {
    console.log(`  - [${r.branch}] ${r.name} | ${r.status}`)
  }
  if (keepPendingReview.length > 10) console.log(`  ... +${keepPendingReview.length - 10}`)

  console.log(`\nTO UNASSIGN (${toUnassign.length}):`)
  const byBranch: Record<string, number> = {}
  for (const r of toUnassign) byBranch[r.branch] = (byBranch[r.branch] ?? 0) + 1
  for (const [b, n] of Object.entries(byBranch)) console.log(`  ${b}: ${n}`)
  for (const r of toUnassign.slice(0, 20)) {
    console.log(`  - [${r.branch}] ${r.name} | ${r.type} | ${r.status}`)
  }
  if (toUnassign.length > 20) console.log(`  ... +${toUnassign.length - 20}`)

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to apply.')
    return
  }

  const ids = toUnassign.map(r => r.taskId)
  let ok = 0
  let fail = 0
  const CHUNK = 80
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const result = await unassignTasksToWaiting(admin, chunk, {
      reason: 'إلغاء تكليف جماعي — مدني (استثناء أسماء محددة + إقامة دعوى متأخرة)',
    })
    if (!result.ok) {
      console.error(`Chunk fail @${i}: ${result.error}`)
      // حاول واحداً واحداً
      for (const id of chunk) {
        const one = await unassignTasksToWaiting(admin, [id], {
          reason: 'إلغاء تكليف جماعي — مدني',
        })
        if (one.ok) ok++
        else {
          fail++
          const row = toUnassign.find(r => r.taskId === id)
          console.error(`  FAIL ${row?.name ?? id}: ${one.error}`)
        }
      }
    } else {
      ok += result.updatedIds.length
    }
  }

  console.log(`\n=== DONE ===\nUnassigned: ${ok}  Failed: ${fail}  Kept name: ${keepNamed.length}  Kept overdue lawsuit: ${keepOverdueLawsuit.length}  Kept pending review: ${keepPendingReview.length}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
