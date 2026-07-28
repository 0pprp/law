import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, isAdmin } from '@/lib/permissions'
import { CRIMINAL_TASK_DEF_ADMIN_COLUMNS } from '@/lib/criminal-task-def-columns'

const APPROVED = ['approved', 'completed'] as const
const CHUNK = 500

export type CriminalActualFeeRow = {
  label: string
  count: number
  actualFee: number
  total: number
}

/** تقرير الأتعاب الجزائية الفعلية — للمدير فقط */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!isAdmin(auth.profile?.role)) return apiForbiddenResponse()

  const url = new URL(request.url)
  const branchId = url.searchParams.get('branchId')?.trim() || null
  const dateFrom = url.searchParams.get('dateFrom')?.trim() || ''
  const dateTo = url.searchParams.get('dateTo')?.trim() || ''

  const admin = createAdminClient()

  let defsQ = admin
    .from('criminal_case_task_definitions')
    .select(CRIMINAL_TASK_DEF_ADMIN_COLUMNS)
    .eq('is_active', true)
    .order('sort_order')

  if (branchId) defsQ = defsQ.eq('branch_id', branchId)

  const { data: defs, error: defsErr } = await defsQ
  if (defsErr) return NextResponse.json({ error: defsErr.message }, { status: 500 })

  type DefRow = {
    id: string
    label: string
    actual_fee_amount?: number | null
    branch_id: string
  }
  const definitions = (defs ?? []) as DefRow[]
  if (!definitions.length) {
    return NextResponse.json({ rows: [] as CriminalActualFeeRow[], grandTotal: 0 })
  }

  const defById = new Map(definitions.map(d => [d.id, d]))
  const counts = new Map<string, number>()

  let offset = 0
  while (true) {
    let q = admin
      .from('criminal_case_tasks')
      .select('id, task_definition_id, task_status, completed_at, branch_id')
      .in('task_status', [...APPROVED])
      .order('completed_at', { ascending: true, nullsFirst: false })
      .range(offset, offset + CHUNK - 1)

    if (branchId) q = q.eq('branch_id', branchId)
    if (dateFrom) q = q.gte('completed_at', `${dateFrom}T00:00:00`)
    if (dateTo) q = q.lte('completed_at', `${dateTo}T23:59:59`)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break

    for (const row of data as {
      task_definition_id: string | null
      completed_at: string | null
    }[]) {
      const defId = row.task_definition_id
      if (!defId || !defById.has(defId)) continue
      counts.set(defId, (counts.get(defId) ?? 0) + 1)
    }

    if (data.length < CHUNK) break
    offset += CHUNK
  }

  /** تجميع بالاسم عند عرض كل الفروع */
  const byLabel = new Map<string, { count: number; actualFee: number }>()
  for (const def of definitions) {
    const label = def.label.trim()
    const count = counts.get(def.id) ?? 0
    const actualFee = Number(def.actual_fee_amount ?? 0) || 0
    const prev = byLabel.get(label)
    if (!prev) {
      byLabel.set(label, { count, actualFee })
    } else {
      byLabel.set(label, {
        count: prev.count + count,
        actualFee: prev.actualFee || actualFee,
      })
    }
  }

  const rows: CriminalActualFeeRow[] = [...byLabel.entries()]
    .map(([label, v]) => ({
      label,
      count: v.count,
      actualFee: v.actualFee,
      total: v.count * v.actualFee,
    }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.label.localeCompare(b.label, 'ar'))

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  return NextResponse.json({ rows, grandTotal })
}
