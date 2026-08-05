import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canManageSpecialStatuses } from '@/lib/permissions'
import { filterBySection } from '@/lib/case-scope'
import { apiServerError } from '@/lib/safe-api-error'
import { attachLastNotes } from '@/lib/debtor-last-notes'
import { resolveBranchListName, resolveDebtorCourtName } from '@/lib/awaiting-assignment'
import { resolveSpecialStatus } from '@/lib/special-statuses'

export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const viewAll = searchParams.get('viewAll') === '1'

  const admin = createAdminClient()
  let q = admin
    .from('debtors')
    .select(`
      id, full_name, phone, branch_id, special_status_id, notes, case_status,
      branch_list:branch_lists(name, court_name),
      special_status:special_statuses(id, name, color)
    `)
    .neq('case_status', 'closed')
    .not('special_status_id', 'is', null)
    .order('full_name')

  if (!viewAll && branchId) q = q.eq('branch_id', branchId)

  const section = filterBySection(sessionCaseScope(auth.profile))
  if (section) q = q.eq('case_type', section)

  const { data, error } = await q
  if (error) return apiServerError('special-statuses:debtors', error)

  const raw = data ?? []
  const branchIds = [...new Set(raw.map(d => d.branch_id).filter(Boolean))] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await admin.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }

  const mapped = raw.map((row) => {
    const d = row as {
      id: string
      full_name: string | null
      phone: string | null
      branch_id: string | null
      special_status_id: string | null
      notes: string | null
      court_name?: string | null
      branch_list?: Parameters<typeof resolveBranchListName>[0]
      special_status?: Parameters<typeof resolveSpecialStatus>[0]
    }
    const ss = resolveSpecialStatus(d.special_status)
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
      last_note: '—' as string,
    }
  })

  const withNotes = await attachLastNotes(admin, mapped)

  return NextResponse.json({ debtors: withNotes })
}
