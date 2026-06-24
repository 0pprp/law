'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { USER_ROLE_LABELS } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtDateTime } from '@/lib/utils'

const ACTION_LABELS: Record<string, string> = {
  assign_task: 'تكليف مهمة',
  update_task: 'تعديل مهمة',
  complete_task: 'إنجاز مهمة',
  upload_task_file: 'رفع ملف مهمة',
  add_expense: 'إضافة صرفية',
  add_payment: 'تسجيل تسديد',
  create_debtor: 'إضافة مدين',
  update_debtor: 'تعديل مدين',
  delete_debtor: 'حذف مدين',
  upload_debtor_file: 'رفع ملف مدين',
  create_lawyer: 'إضافة محامي',
  update_payment: 'تعديل تسديد',
  delete_payment: 'حذف تسديد',
  delete_task: 'حذف مهمة',
  login: 'تسجيل دخول',
}
const ENTITY_LABELS: Record<string, string> = {
  task: 'مهمة', debtor: 'مدين', expense: 'صرفية', payment: 'تسديد', lawyer: 'محامي', file: 'ملف',
}

const ACTION_BADGE_MAP: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'orange' | 'navy'> = {
  complete_task: 'success',
  assign_task: 'info',
  update_task: 'warning',
  delete_debtor: 'danger',
  delete_payment: 'danger',
  delete_task: 'danger',
  add_payment: 'success',
  add_expense: 'warning',
}

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

export default function ActivityPage() {
  const branchId = useBranchId()
  const [logs, setLogs] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    const supabase = createClient()
    let lq = supabase.from('activity_logs').select(`*, user:profiles!activity_logs_user_id_fkey(full_name, role)`).order('created_at', { ascending: false }).limit(1000)
    let uq = supabase.from('profiles').select('id, full_name').order('full_name')
    if (branchId) {
      lq = (lq as any).eq('branch_id', branchId)
      uq = (uq as any).eq('branch_id', branchId)
    }
    Promise.all([lq, uq]).then(([{ data: l }, { data: u }]) => {
      setLogs(l ?? [])
      setUsers(u ?? [])
      setLoading(false)
    })
  }, [branchId])

  const filtered = useMemo(() => logs.filter(l => {
    if (filterUser && l.user_id !== filterUser) return false
    if (filterAction && l.action !== filterAction) return false
    if (filterEntity && l.entity_type !== filterEntity) return false
    const date = l.created_at?.split('T')[0]
    if (dateFrom && date < dateFrom) return false
    if (dateTo && date > dateTo) return false
    return true
  }), [logs, filterUser, filterAction, filterEntity, dateFrom, dateTo])

  const uniqueActions = useMemo(() => [...new Set(logs.map(l => l.action))].sort(), [logs])
  const uniqueEntities = useMemo(() => [...new Set(logs.map(l => l.entity_type).filter(Boolean))].sort(), [logs])
  const hasFilters = filterUser || filterAction || filterEntity || dateFrom || dateTo
  function resetFilters() { setFilterUser(''); setFilterAction(''); setFilterEntity(''); setDateFrom(''); setDateTo('') }

  return (
    <div className="space-y-5">
      <PageHeader title="سجل النشاط" subtitle={`${filtered.length} إجراء مسجّل`} />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={SEL} dir="ltr" title="من تاريخ" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={SEL} dir="ltr" title="إلى تاريخ" />
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className={SEL}>
            <option value="">كل المستخدمين</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className={SEL}>
            <option value="">كل الإجراءات</option>
            {uniqueActions.map(a => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
          </select>
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className={SEL}>
            <option value="">كل الكيانات</option>
            {uniqueEntities.map(e => <option key={e as string} value={e as string}>{ENTITY_LABELS[e as string] ?? e}</option>)}
          </select>
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-[#767676]">تصفية نشطة — {filtered.length} من {logs.length}</p>
            <button onClick={resetFilters} className="text-xs text-[#2C8780] hover:underline">إلغاء التصفية</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState title="لا توجد سجلات نشاط" description="ستظهر هنا جميع العمليات التي يجريها المستخدمون" />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>التاريخ والوقت</TH>
                    <TH>المستخدم</TH>
                    <TH>الدور</TH>
                    <TH>نوع العملية</TH>
                    <TH>الوصف</TH>
                    <TH>الكيان</TH>
                  </tr>
                </THead>
                <TBody>
                  {filtered.map((log: any) => (
                    <TR key={log.id}>
                      <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{fmtDateTime(log.created_at)}</span></TD>
                      <TD className="font-semibold text-[#231F20] whitespace-nowrap">{log.user?.full_name ?? '—'}</TD>
                      <TD className="text-[#767676] text-xs whitespace-nowrap">
                        {log.user?.role ? (USER_ROLE_LABELS[log.user.role as UserRole] ?? log.user.role) : '—'}
                      </TD>
                      <TD>
                        <Badge variant={ACTION_BADGE_MAP[log.action] ?? 'orange'}>
                          {ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </TD>
                      <TD className="text-[#767676] text-xs max-w-[200px]">
                        <span className="line-clamp-2">{log.new_data?.description ?? '—'}</span>
                      </TD>
                      <TD className="text-[#767676] text-xs whitespace-nowrap">
                        {log.entity_type ? (ENTITY_LABELS[log.entity_type] ?? log.entity_type) : '—'}
                        {log.entity_id && <span className="text-[rgba(118,118,118,0.4)] mr-1">#{log.entity_id.slice(0, 6)}</span>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile timeline */}
            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {filtered.map((log: any) => (
                <div key={log.id} className="px-4 py-3 flex gap-3">
                  <div className="w-1.5 mt-2 shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#2C8780]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <Badge variant={ACTION_BADGE_MAP[log.action] ?? 'orange'}>{ACTION_LABELS[log.action] ?? log.action}</Badge>
                      <span className="text-[10px] text-[#767676] font-mono shrink-0" dir="ltr">{log.created_at?.split('T')[0] ?? '—'}</span>
                    </div>
                    <p className="text-sm text-[#231F20]">{log.new_data?.description ?? '—'}</p>
                    <p className="text-xs text-[#767676] mt-0.5">{log.user?.full_name ?? '—'}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}