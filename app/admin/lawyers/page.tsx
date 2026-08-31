import { createClient } from '@/lib/supabase/server'
import { getBranchContext } from '@/lib/branch-context'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { canCreateLawyerUser, canEditLawyerProfile, canDeleteUsers } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'
import { filterBySection, normalizeCaseType, resolveCaseScope } from '@/lib/case-scope'
import LawyersTable, { type LawyersTableRow } from './lawyers-table'

export default async function LawyersPage() {
  const supabase = await createClient()
  const { branchId, viewAllBranches } = await getBranchContext()

  const { data: { user } } = await supabase.auth.getUser()
  const myProfile = user ? await fetchStaffRoleFields(supabase, user.id) : null
  const canDelete = canDeleteUsers(myProfile?.role)
  const canAddUser = canCreateLawyerUser(myProfile?.role)
  const showUserActions = canAddUser
  const showAllBranches = viewAllBranches
  const showBranchCol = viewAllBranches

  let profiles: any[] = []
  let attachmentRows: { lawyer_id: string }[] = []
  let branchRows: { id: string; name: string }[] = []
  let chiefBranchRows: { profile_id: string }[] = []

  if (branchId || viewAllBranches) {
    let profilesQ = supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (branchId) profilesQ = (profilesQ as any).eq('branch_id', branchId)

    const result = await Promise.all([
      profilesQ,
      supabase.from('lawyer_attachments').select('lawyer_id'),
      supabase.from('branches').select('id, name'),
      supabase.from('chief_accountant_branches').select('profile_id'),
    ])
    profiles = (result[0].data as any[]) ?? []
    attachmentRows = (result[1].data as { lawyer_id: string }[]) ?? []
    branchRows = (result[2].data as { id: string; name: string }[]) ?? []
    const chiefRes = result[3] as { data: { profile_id: string }[] | null; error?: unknown }
    chiefBranchRows = chiefRes.error ? [] : (chiefRes.data ?? [])

    const scope = resolveCaseScope(myProfile?.role, {
      canAccessCivil: myProfile?.can_access_civil,
      canAccessCriminal: myProfile?.can_access_criminal,
    })
    const sectionFilter = filterBySection(scope)
    if (sectionFilter) {
      const lockedRole = myProfile?.role === 'viewer' || myProfile?.role === 'criminal_legal_manager'
      profiles = profiles.filter(p => {
        if (p.role === 'lawyer') {
          return normalizeCaseType(p.case_type) === sectionFilter
        }
        if (lockedRole) {
          return p.id === user?.id || p.role === myProfile?.role
        }
        return true
      })
    }
  }

  const branchNameMap = new Map(branchRows.map(b => [b.id, b.name]))
  const attachCountMap = new Map<string, number>()
  for (const row of attachmentRows) {
    attachCountMap.set(row.lawyer_id, (attachCountMap.get(row.lawyer_id) ?? 0) + 1)
  }
  const chiefBranchCountMap = new Map<string, number>()
  for (const row of chiefBranchRows) {
    chiefBranchCountMap.set(row.profile_id, (chiefBranchCountMap.get(row.profile_id) ?? 0) + 1)
  }

  const tableRows: LawyersTableRow[] = profiles.map(p => ({
    id: p.id,
    full_name: p.full_name,
    username: p.username ?? null,
    role: p.role,
    lawyer_type: p.lawyer_type ?? null,
    accountant_type: p.accountant_type ?? null,
    phone: p.phone ?? null,
    is_active: Boolean(p.is_active),
    created_at: p.created_at,
    branch_name: branchNameMap.get(p.branch_id) ?? null,
    attach_count: attachCountMap.get(p.id) ?? 0,
    chief_branch_count: chiefBranchCountMap.get(p.id) ?? 0,
    can_edit: canEditLawyerProfile(myProfile?.role, p.role),
  }))

  const activeCount = tableRows.filter(p => p.is_active).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="المستخدمون"
        subtitle={
          viewAllBranches
            ? `${tableRows.length} مستخدم في كل الفروع • ${activeCount} نشط`
            : branchId
              ? `${tableRows.length} مستخدم • ${activeCount} نشط`
              : 'اختر فرعاً أو «الكل» لعرض المستخدمين'
        }
        actions={
          showUserActions ? (
            <Link href="/admin/lawyers/new">
              <Button variant="primary" size="sm">+ إضافة مستخدم</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {!tableRows.length ? (
          <EmptyState
            title="لا يوجد مستخدمون"
            description={showAllBranches ? 'لا يوجد مستخدمون مسجلون في النظام' : 'لا يوجد مستخدمون مرتبطون بهذا الفرع'}
            action={showUserActions ? <Link href="/admin/lawyers/new"><Button variant="primary" size="sm">+ إضافة مستخدم</Button></Link> : undefined}
          />
        ) : (
          <LawyersTable
            rows={tableRows}
            showBranchCol={showBranchCol}
            canDelete={canDelete}
          />
        )}
      </div>
    </div>
  )
}
