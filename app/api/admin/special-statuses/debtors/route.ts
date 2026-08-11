import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canManageSpecialStatuses } from '@/lib/permissions'
import { filterBySection } from '@/lib/case-scope'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { formatLastNotePreview, LEGACY_NOTE_AUTHOR } from '@/lib/debtor-last-notes'
import { resolveBranchListName, resolveDebtorCourtName } from '@/lib/awaiting-assignment'
import { resolveSpecialStatus } from '@/lib/special-statuses'

/**
 * قائمة مديني المراقبة — تُفلتر بصفة واحدة عند التوسيع (سريعة).
 * query: statusId | statusIds | statusName + branchId | viewAll
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const viewAll = searchParams.get('viewAll') === '1'
  const statusId = searchParams.get('statusId')?.trim() || null
  const statusName = searchParams.get('statusName')?.trim() || null
  const statusIdsParam = searchParams.get('statusIds')?.trim() || null
  const section = filterBySection(sessionCaseScope(auth.profile))

  const admin = createAdminClient()

  let statusIds: string[] = []
  if (statusIdsParam) {
    statusIds = [...new Set(statusIdsParam.split(',').map(s => s.trim()).filter(Boolean))]
  } else if (statusId) {
    statusIds = [statusId]
  } else if (statusName) {
    let sq = admin.from('special_statuses').select('id, branch_id').eq('name', statusName)
    if (!viewAll && branchId) sq = sq.eq('branch_id', branchId)
    const { data: siblings, error: sErr } = await sq
    if (sErr) return apiServerError('special-statuses:debtors:status', sErr)
    statusIds = (siblings ?? []).map(s => s.id)
  }

  if (!statusIds.length) {
    return safeClientError('حدّد صفة لعرض الأسماء (statusId أو statusName)', 400)
  }

  const selectCols =
    'id, full_name, phone, branch_id, special_status_id, notes, case_status, current_task_id, special_status_return_task_id, branch_list:branch_lists(name, court_name), special_status:special_statuses(id, name, color)'

  let q = admin
    .from('debtors')
    .select(selectCols)
    .neq('case_status', 'closed')
    .in('special_status_id', statusIds)
    .order('full_name')
    .limit(500)

  if (!viewAll && branchId) q = q.eq('branch_id', branchId)
  if (section) q = q.eq('case_type', section)

  let raw: Array<Record<string, unknown>> = []
  {
    const primary = await q
    if (primary.error && (
      primary.error.message?.includes('special_status_return_task_id')
      || primary.error.code === 'PGRST204'
      || primary.error.code === '42703'
    )) {
      let fb = admin
        .from('debtors')
        .select('id, full_name, phone, branch_id, special_status_id, notes, case_status, current_task_id, branch_list:branch_lists(name, court_name), special_status:special_statuses(id, name, color)')
        .neq('case_status', 'closed')
        .in('special_status_id', statusIds)
        .order('full_name')
        .limit(500)
      if (!viewAll && branchId) fb = fb.eq('branch_id', branchId)
      if (section) fb = fb.eq('case_type', section)
      const fallback = await fb
      if (fallback.error) return apiServerError('special-statuses:debtors', fallback.error)
      raw = (fallback.data ?? []) as unknown as Array<Record<string, unknown>>
    } else if (primary.error) {
      return apiServerError('special-statuses:debtors', primary.error)
    } else {
      raw = (primary.data ?? []) as unknown as Array<Record<string, unknown>>
    }
  }

  const branchIds = [...new Set(raw.map(d => d.branch_id as string | null).filter(Boolean))] as string[]
  const returnTaskIds = [...new Set(
    raw
      .map(d => (d.special_status_return_task_id || d.current_task_id || null) as string | null)
      .filter(Boolean),
  )] as string[]

  const [branchesRes, tasksRes] = await Promise.all([
    branchIds.length
      ? admin.from('branches').select('id, name').in('id', branchIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    returnTaskIds.length
      ? admin.from('tasks').select('id, task_type, task_definitions(label)').in('id', returnTaskIds)
      : Promise.resolve({ data: [] as Array<{ id: string; task_type: string | null; task_definitions: unknown }> }),
  ])

  const branchNames = new Map<string, string>()
  for (const b of branchesRes.data ?? []) branchNames.set(b.id, b.name)

  const taskLabelById = new Map<string, string>()
  for (const t of tasksRes.data ?? []) {
    const def = Array.isArray(t.task_definitions) ? t.task_definitions[0] : t.task_definitions
    const label = (def as { label?: string } | null)?.label
      || (t.task_type ? String(t.task_type) : null)
      || 'مهمة'
    taskLabelById.set(t.id, label)
  }

  // ملاحظة سريعة من عمود notes (بدون جلب كل debtor_notes)
  const mapped = raw.map((row) => {
    const d = row as {
      id: string
      full_name: string | null
      phone: string | null
      branch_id: string | null
      special_status_id: string | null
      notes: string | null
      court_name?: string | null
      current_task_id?: string | null
      special_status_return_task_id?: string | null
      branch_list?: Parameters<typeof resolveBranchListName>[0]
      special_status?: Parameters<typeof resolveSpecialStatus>[0]
    }
    const ss = resolveSpecialStatus(d.special_status)
    const linkedTaskId = d.special_status_return_task_id || d.current_task_id || null
    const legacy = String(d.notes ?? '').trim()
    return {
      id: d.id,
      full_name: d.full_name ?? '—',
      phone: d.phone ?? null,
      branch_id: d.branch_id ?? null,
      branch_name: d.branch_id ? branchNames.get(d.branch_id) ?? null : null,
      branch_list_name: resolveBranchListName(d.branch_list),
      court_name: resolveDebtorCourtName(d),
      special_status_id: d.special_status_id ?? null,
      special_status_name: ss.name,
      special_status_color: ss.color,
      notes: d.notes ?? null,
      return_task_id: linkedTaskId,
      return_task_label: linkedTaskId ? (taskLabelById.get(linkedTaskId) ?? 'مهمة محفوظة') : null,
      last_note: legacy ? formatLastNotePreview(LEGACY_NOTE_AUTHOR, legacy) : '—',
    }
  })

  return NextResponse.json({ debtors: mapped })
}
