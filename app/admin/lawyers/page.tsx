import { createClient } from '@/lib/supabase/server'
import { getBranchContext } from '@/lib/branch-context'
import { USER_ROLE_LABELS, LAWYER_TYPE_LABELS, ACCOUNTANT_TYPE_LABELS, displayRoleLabel } from '@/lib/types'
import type { UserRole, LawyerType, AccountantType } from '@/lib/types'
import Link from 'next/link'
import LawyerActions from '@/components/LawyerActions'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { fmtDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { canCreateLawyerUser, canEditLawyerProfile, canDeleteUsers } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

const ROLE_BADGE: Partial<Record<UserRole, 'navy' | 'info' | 'success' | 'orange' | 'purple' | 'gray'>> = {
  admin: 'purple',
  employee: 'info',
  accountant: 'success',
  lawyer: 'orange',
  viewer: 'gray',
}

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

  if (branchId || viewAllBranches) {
    let profilesQ = supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (branchId) profilesQ = (profilesQ as any).eq('branch_id', branchId)

    const result = await Promise.all([
      profilesQ,
      supabase.from('lawyer_attachments').select('lawyer_id'),
      showBranchCol
        ? supabase.from('branches').select('id, name')
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])
    profiles = (result[0].data as any[]) ?? []
    attachmentRows = (result[1].data as { lawyer_id: string }[]) ?? []
    branchRows = (result[2].data as { id: string; name: string }[]) ?? []
  }

  const branchNameMap = new Map(branchRows.map(b => [b.id, b.name]))
  const attachCountMap = new Map<string, number>()
  for (const row of attachmentRows) {
    attachCountMap.set(row.lawyer_id, (attachCountMap.get(row.lawyer_id) ?? 0) + 1)
  }

  const activeCount = profiles.filter(p => p.is_active).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="المستخدمون"
        subtitle={
          viewAllBranches
            ? `${profiles.length} مستخدم في كل الفروع • ${activeCount} نشط`
            : branchId
              ? `${profiles.length} مستخدم • ${activeCount} نشط`
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
        {!profiles?.length ? (
          <EmptyState
            title="لا يوجد مستخدمون"
            description={showAllBranches ? 'لا يوجد مستخدمون مسجلون في النظام' : 'لا يوجد مستخدمون مرتبطون بهذا الفرع'}
            action={showUserActions ? <Link href="/admin/lawyers/new"><Button variant="primary" size="sm">+ إضافة مستخدم</Button></Link> : undefined}
          />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>الاسم</TH>
                    <TH>اسم المستخدم</TH>
                    <TH>الدور</TH>
                    <TH>النوع</TH>
                    {showBranchCol && <TH>الفرع</TH>}
                    <TH>الهاتف</TH>
                    <TH>الحالة</TH>
                    <TH>المستمسكات</TH>
                    <TH>تاريخ الإنشاء</TH>
                    <TH className="text-center">الإجراءات</TH>
                  </tr>
                </THead>
                <TBody>
                  {profiles.map(user => (
                    <TR key={user.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
                            <span className="text-white text-xs font-bold">
                              {user.full_name?.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '؟'}
                            </span>
                          </div>
                          {canEditLawyerProfile(myProfile?.role, user.role) ? (
                            <Link href={`/admin/lawyers/${user.id}/edit`} className="font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors">
                              {user.full_name}
                            </Link>
                          ) : (
                            <span className="font-semibold text-[#231F20]">{user.full_name}</span>
                          )}
                        </div>
                      </TD>
                      <TD>
                        {user.username
                          ? <span className="font-mono text-xs text-[#767676] bg-[rgba(118,118,118,0.06)] px-2 py-1 rounded-lg" dir="ltr">{user.username}</span>
                          : <Badge variant="warning">لا يوجد</Badge>}
                      </TD>
                      <TD>
                        <Badge variant={ROLE_BADGE[user.role as UserRole] ?? 'default'}>
                          {displayRoleLabel(user.role, { accountant_type: user.accountant_type, lawyer_type: user.lawyer_type })}
                        </Badge>
                      </TD>
                      <TD>
                        {user.role === 'lawyer' ? (
                          <Badge variant={user.lawyer_type === 'general' ? 'purple' : 'info'}>
                            {LAWYER_TYPE_LABELS[(user.lawyer_type as LawyerType) ?? 'normal']}
                          </Badge>
                        ) : user.role === 'accountant' ? (
                          <Badge variant={user.accountant_type === 'general' ? 'purple' : 'info'}>
                            {ACCOUNTANT_TYPE_LABELS[(user.accountant_type as AccountantType) ?? 'branch']}
                          </Badge>
                        ) : (
                          <span className="text-[rgba(118,118,118,0.3)] text-xs">—</span>
                        )}
                      </TD>
                      {showBranchCol && (
                        <TD><span className="text-xs text-[#767676]">{branchNameMap.get(user.branch_id) ?? '—'}</span></TD>
                      )}
                      <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{user.phone ?? '—'}</span></TD>
                      <TD>
                        <Badge variant={user.is_active ? 'success' : 'danger'} dot>
                          {user.is_active ? 'نشط' : 'موقوف'}
                        </Badge>
                      </TD>
                      <TD className="text-center">
                        {(attachCountMap.get(user.id) ?? 0) > 0
                          ? <span className="text-xs font-semibold text-[#2C8780] bg-[#2C8780]/8 border border-[#2C8780]/20 px-2 py-1 rounded-full">{attachCountMap.get(user.id)} ملف</span>
                          : <span className="text-[rgba(118,118,118,0.3)] text-xs">—</span>}
                      </TD>
                      <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{fmtDate(user.created_at)}</span></TD>
                      <TD>
                        <LawyerActions
                          userId={user.id}
                          isActive={user.is_active}
                          fullName={user.full_name}
                          role={user.role}
                          canDelete={canDelete}
                          showEdit={canEditLawyerProfile(myProfile?.role, user.role)}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {profiles.map(user => (
                <div key={user.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
                        <span className="text-white text-xs font-bold">
                          {user.full_name?.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '؟'}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-[#231F20] text-sm">{user.full_name}</p>
                        {user.username && <p className="text-xs text-[#767676] font-mono">{user.username}</p>}
                      </div>
                    </div>
                    <Badge variant={user.is_active ? 'success' : 'danger'}>{user.is_active ? 'نشط' : 'موقوف'}</Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={ROLE_BADGE[user.role as UserRole] ?? 'default'}>
                      {displayRoleLabel(user.role, { accountant_type: user.accountant_type, lawyer_type: user.lawyer_type })}
                    </Badge>
                    {user.role === 'lawyer' && (
                      <Badge variant={user.lawyer_type === 'general' ? 'purple' : 'info'}>
                        {LAWYER_TYPE_LABELS[(user.lawyer_type as LawyerType) ?? 'normal']}
                      </Badge>
                    )}
                    {user.role === 'accountant' && (
                      <Badge variant={user.accountant_type === 'general' ? 'purple' : 'info'}>
                        {ACCOUNTANT_TYPE_LABELS[(user.accountant_type as AccountantType) ?? 'branch']}
                      </Badge>
                    )}
                    {showBranchCol && user.branch_id && (
                      <span className="text-xs text-[#767676]">{branchNameMap.get(user.branch_id) ?? '—'}</span>
                    )}
                    {(attachCountMap.get(user.id) ?? 0) > 0 && (
                      <span className="text-xs text-[#2C8780]">{attachCountMap.get(user.id)} مستمسك</span>
                    )}
                  </div>
                  <LawyerActions
                    userId={user.id}
                    isActive={user.is_active}
                    fullName={user.full_name}
                    role={user.role}
                    canDelete={canDelete}
                    showEdit={canEditLawyerProfile(myProfile?.role, user.role)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}