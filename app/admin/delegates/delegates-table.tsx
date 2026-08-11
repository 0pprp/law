'use client'

import { Badge } from '@/components/ui/badge'
import { Table, THead, TBody, TR, TH, TD, SortableTH } from '@/components/ui/data-table'
import { fmtDate, fmtMoney } from '@/lib/utils'
import DelegateActions from '@/components/DelegateActions'
import { useTableSort } from '@/hooks/use-table-sort'

export type DelegatesTableRow = {
  id: string
  full_name: string
  username: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  branch_name: string | null
  pending_balance: number
  available_balance: number
}

export default function DelegatesTable({
  rows,
  showBranchCol,
  canDelete,
}: {
  rows: DelegatesTableRow[]
  showBranchCol: boolean
  canDelete: boolean
}) {
  const {
    rows: sortedRows,
    sortKey,
    sortDirection,
    cycleSort,
  } = useTableSort(rows, {
    name: d => d.full_name,
    username: d => d.username,
    branch: d => d.branch_name,
    phone: d => d.phone,
    pending: d => Number(d.pending_balance ?? 0),
    available: d => Number(d.available_balance ?? 0),
    status: d => (d.is_active ? 'نشط' : 'موقوف'),
    createdAt: d => d.created_at,
  })

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <tr>
              <SortableTH sortKey="name" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الاسم</SortableTH>
              <SortableTH sortKey="username" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>اسم المستخدم</SortableTH>
              {showBranchCol && (
                <SortableTH sortKey="branch" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الفرع</SortableTH>
              )}
              <SortableTH sortKey="phone" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الهاتف</SortableTH>
              <SortableTH sortKey="pending" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>معلق</SortableTH>
              <SortableTH sortKey="available" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>قابل للصرف</SortableTH>
              <SortableTH sortKey="status" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الحالة</SortableTH>
              <SortableTH sortKey="createdAt" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>تاريخ الإنشاء</SortableTH>
              <TH className="text-center">الإجراءات</TH>
            </tr>
          </THead>
          <TBody>
            {sortedRows.map(d => (
              <TR key={d.id}>
                <TD>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
                    >
                      <span className="text-white text-xs font-bold">
                        {d.full_name?.split(' ').filter(Boolean).slice(0, 2).map((x: string) => x[0]).join('') || '؟'}
                      </span>
                    </div>
                    <span className="font-semibold text-[#231F20]">{d.full_name}</span>
                  </div>
                </TD>
                <TD>
                  {d.username
                    ? <span className="font-mono text-xs text-[#767676] bg-[rgba(118,118,118,0.06)] px-2 py-1 rounded-lg" dir="ltr">{d.username}</span>
                    : <Badge variant="warning">لا يوجد</Badge>}
                </TD>
                {showBranchCol && (
                  <TD><span className="text-xs text-[#767676]">{d.branch_name ?? '—'}</span></TD>
                )}
                <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{d.phone ?? '—'}</span></TD>
                <TD><span className="text-xs font-bold tabular-nums" dir="ltr">{fmtMoney(d.pending_balance)}</span></TD>
                <TD><span className="text-xs font-bold text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(d.available_balance)}</span></TD>
                <TD>
                  <Badge variant={d.is_active ? 'success' : 'danger'} dot>
                    {d.is_active ? 'نشط' : 'موقوف'}
                  </Badge>
                </TD>
                <TD><span className="text-xs text-[#767676]" dir="ltr">{fmtDate(d.created_at)}</span></TD>
                <TD>
                  <DelegateActions
                    userId={d.id}
                    isActive={d.is_active}
                    fullName={d.full_name}
                    canDelete={canDelete}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
        {sortedRows.map(d => (
          <div key={d.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-[#231F20]">{d.full_name}</p>
              <Badge variant={d.is_active ? 'success' : 'danger'} dot>
                {d.is_active ? 'نشط' : 'موقوف'}
              </Badge>
            </div>
            <p className="text-xs text-[#767676]" dir="ltr">{d.username ?? '—'} · {d.phone ?? '—'}</p>
            <div className="flex gap-4 text-xs">
              <span>معلق: <b dir="ltr">{fmtMoney(d.pending_balance)}</b></span>
              <span>قابل للصرف: <b className="text-[#2C8780]" dir="ltr">{fmtMoney(d.available_balance)}</b></span>
            </div>
            <DelegateActions
              userId={d.id}
              isActive={d.is_active}
              fullName={d.full_name}
              canDelete={canDelete}
            />
          </div>
        ))}
      </div>
    </>
  )
}
