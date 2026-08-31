'use client'

import Link from 'next/link'
import LawyerActions from '@/components/LawyerActions'
import { Badge } from '@/components/ui/badge'
import { Table, THead, TBody, TR, TH, TD, SortableTH } from '@/components/ui/data-table'
import { fmtDate } from '@/lib/utils'
import { ACCOUNTANT_TYPE_LABELS, displayRoleLabel } from '@/lib/types'
import { lawyerTypeDisplayLabel } from '@/lib/lawyer-type'
import type { UserRole, AccountantType } from '@/lib/types'
import { useTableSort } from '@/hooks/use-table-sort'

const ROLE_BADGE: Partial<Record<UserRole, 'navy' | 'info' | 'success' | 'orange' | 'purple' | 'gray'>> = {
  admin: 'purple',
  employee: 'info',
  accountant: 'success',
  lawyer: 'orange',
  viewer: 'gray',
  chief_accountant: 'navy',
  branch_manager: 'orange',
}

export type LawyersTableRow = {
  id: string
  full_name: string
  username: string | null
  role: string
  lawyer_type: string | null
  accountant_type: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  branch_name: string | null
  attach_count: number
  chief_branch_count: number
  can_edit: boolean
}

export default function LawyersTable({
  rows,
  showBranchCol,
  canDelete,
}: {
  rows: LawyersTableRow[]
  showBranchCol: boolean
  canDelete: boolean
}) {
  const {
    rows: sortedRows,
    sortKey,
    sortDirection,
    cycleSort,
  } = useTableSort(rows, {
    name: u => u.full_name,
    username: u => u.username,
    role: u => displayRoleLabel(u.role, {
      accountant_type: u.accountant_type,
      lawyer_type: u.lawyer_type,
    }),
    type: u => {
      if (u.role === 'lawyer') return lawyerTypeDisplayLabel(u.lawyer_type, u.branch_name)
      if (u.role === 'accountant') return ACCOUNTANT_TYPE_LABELS[(u.accountant_type as AccountantType) ?? 'branch']
      return null
    },
    branch: u => u.branch_name,
    phone: u => u.phone,
    status: u => (u.is_active ? 'نشط' : 'موقوف'),
    attachments: u => u.attach_count,
    createdAt: u => u.created_at,
  })

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <tr>
              <SortableTH sortKey="name" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الاسم</SortableTH>
              <SortableTH sortKey="username" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>اسم المستخدم</SortableTH>
              <SortableTH sortKey="role" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الدور</SortableTH>
              <SortableTH sortKey="type" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>النوع</SortableTH>
              {showBranchCol && (
                <SortableTH sortKey="branch" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الفرع</SortableTH>
              )}
              <SortableTH sortKey="phone" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الهاتف</SortableTH>
              <SortableTH sortKey="status" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الحالة</SortableTH>
              <SortableTH sortKey="attachments" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>المستمسكات</SortableTH>
              <SortableTH sortKey="createdAt" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>تاريخ الإنشاء</SortableTH>
              <TH className="text-center">الإجراءات</TH>
            </tr>
          </THead>
          <TBody>
            {sortedRows.map(user => (
              <TR key={user.id}>
                <TD>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
                      <span className="text-white text-xs font-bold">
                        {user.full_name?.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '؟'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {user.can_edit ? (
                        <Link href={`/admin/lawyers/${user.id}/edit`} className="font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors">
                          {user.full_name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-[#231F20]">{user.full_name}</span>
                      )}
                      {user.role === 'chief_accountant' && (
                        <span className="text-[11px] font-semibold text-[#2C8780] bg-[#2C8780]/8 border border-[#2C8780]/20 px-2 py-0.5 rounded-full">
                          {user.chief_branch_count} فرع
                        </span>
                      )}
                    </div>
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
                      {lawyerTypeDisplayLabel(user.lawyer_type, user.branch_name)}
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
                  <TD><span className="text-xs text-[#767676]">{user.branch_name ?? '—'}</span></TD>
                )}
                <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{user.phone ?? '—'}</span></TD>
                <TD>
                  <Badge variant={user.is_active ? 'success' : 'danger'} dot>
                    {user.is_active ? 'نشط' : 'موقوف'}
                  </Badge>
                </TD>
                <TD className="text-center">
                  {user.attach_count > 0
                    ? <span className="text-xs font-semibold text-[#2C8780] bg-[#2C8780]/8 border border-[#2C8780]/20 px-2 py-1 rounded-full">{user.attach_count} ملف</span>
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
                    showEdit={user.can_edit}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
        {sortedRows.map(user => (
          <div key={user.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
                  <span className="text-white text-xs font-bold">
                    {user.full_name?.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '؟'}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-[#231F20] text-sm">
                    {user.full_name}
                    {user.role === 'chief_accountant' && (
                      <span className="mr-2 text-[11px] font-semibold text-[#2C8780]">
                        ({user.chief_branch_count} فرع)
                      </span>
                    )}
                  </p>
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
                  {lawyerTypeDisplayLabel(user.lawyer_type, user.branch_name)}
                </Badge>
              )}
              {user.role === 'accountant' && (
                <Badge variant={user.accountant_type === 'general' ? 'purple' : 'info'}>
                  {ACCOUNTANT_TYPE_LABELS[(user.accountant_type as AccountantType) ?? 'branch']}
                </Badge>
              )}
              {showBranchCol && user.branch_name && (
                <span className="text-xs text-[#767676]">{user.branch_name}</span>
              )}
              {user.attach_count > 0 && (
                <span className="text-xs text-[#2C8780]">{user.attach_count} مستمسك</span>
              )}
            </div>
            <LawyerActions
              userId={user.id}
              isActive={user.is_active}
              fullName={user.full_name}
              role={user.role}
              canDelete={canDelete}
              showEdit={user.can_edit}
            />
          </div>
        ))}
      </div>
    </>
  )
}
