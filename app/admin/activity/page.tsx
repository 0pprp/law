'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { displayRoleLabel } from '@/lib/types'
import {
  ACTIVITY_ACTION_BADGE,
  activityActionLabel,
  activityEntityLabel,
  activityLogDescription,
  fmtActivityDate,
  fmtActivityTime,
} from '@/lib/activity-labels'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

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
    let cancelled = false

    async function load() {
      setLoading(true)
      const userSelectWithType =
        '*, user:profiles!activity_logs_user_id_fkey(full_name, role, accountant_type, lawyer_type)'
      const userSelectFallback =
        '*, user:profiles!activity_logs_user_id_fkey(full_name, role, lawyer_type)'

      let lq = supabase
        .from('activity_logs')
        .select(userSelectWithType)
        .order('created_at', { ascending: false })
        .limit(1000)
      let uq = supabase.from('profiles').select('id, full_name').order('full_name')
      if (branchId) {
        lq = (lq as any).eq('branch_id', branchId)
        uq = (uq as any).eq('branch_id', branchId)
      }

      let [{ data: l, error: lErr }, { data: u }] = await Promise.all([lq, uq])

      if (lErr && String(lErr.message ?? '').includes('accountant_type')) {
        let lq2 = supabase
          .from('activity_logs')
          .select(userSelectFallback)
          .order('created_at', { ascending: false })
          .limit(1000)
        if (branchId) lq2 = (lq2 as any).eq('branch_id', branchId)
        const retry = await lq2
        l = retry.data
      }

      if (!cancelled) {
        setLogs(l ?? [])
        setUsers(u ?? [])
        setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
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

  function resetFilters() {
    setFilterUser('')
    setFilterAction('')
    setFilterEntity('')
    setDateFrom('')
    setDateTo('')
  }

  const {
    visibleItems: visibleLogs,
    expanded: logsExpanded,
    toggle: toggleLogs,
    hasMore: logsHasMore,
    total: logsTotal,
  } = useShowMore(filtered, LOG_PREVIEW_LIMIT)

  return (
    <div className="space-y-5">
      <PageHeader title="سجل النشاط" subtitle={`${filtered.length} إجراء مسجّل`} />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">تصفية السجل</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t) }}
          />
          <PremiumSelect
            value={filterUser}
            onChange={setFilterUser}
            options={[
              { value: '', label: 'كل المستخدمين' },
              ...users.map(u => ({ value: u.id, label: u.full_name })),
            ]}
            fieldLabel="المستخدم"
            placeholder="كل المستخدمين"
            headerTitle="تصفية حسب المستخدم"
            searchPlaceholder="بحث بالاسم..."
            searchable={users.length > 1}
          />
          <PremiumSelect
            value={filterAction}
            onChange={setFilterAction}
            options={[
              { value: '', label: 'كل الإجراءات' },
              ...uniqueActions.map(a => ({ value: a, label: activityActionLabel(a) })),
            ]}
            fieldLabel="الإجراء"
            placeholder="كل الإجراءات"
            headerTitle="تصفية حسب الإجراء"
            searchPlaceholder="بحث في الإجراءات..."
            searchable={uniqueActions.length > 1}
          />
          <PremiumSelect
            value={filterEntity}
            onChange={setFilterEntity}
            options={[
              { value: '', label: 'كل الكيانات' },
              ...uniqueEntities.map(e => ({ value: e as string, label: activityEntityLabel(e as string) })),
            ]}
            fieldLabel="الكيان"
            placeholder="كل الكيانات"
            headerTitle="تصفية حسب الكيان"
            searchPlaceholder="بحث في الكيانات..."
            searchable={uniqueEntities.length > 1}
          />
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-[#767676]">تصفية نشطة — {filtered.length} من {logs.length}</p>
            <button type="button" onClick={resetFilters} className="text-xs text-[#2C8780] hover:underline">إلغاء التصفية</button>
          </div>
        )}
      </div>

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
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>التاريخ</TH>
                    <TH>الوقت</TH>
                    <TH>المستخدم</TH>
                    <TH>الدور</TH>
                    <TH>نوع العملية</TH>
                    <TH>الوصف</TH>
                    <TH>الكيان</TH>
                  </tr>
                </THead>
                <TBody>
                  {visibleLogs.map((log: any) => (
                    <TR key={log.id}>
                      <TD>
                        <span className="text-xs font-mono text-[#231F20] font-semibold whitespace-nowrap" dir="ltr">
                          {fmtActivityDate(log.created_at)}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-xs font-mono text-[#767676] whitespace-nowrap" dir="ltr">
                          {fmtActivityTime(log.created_at)}
                        </span>
                      </TD>
                      <TD className="font-semibold text-[#231F20] whitespace-nowrap">
                        {log.user?.full_name ?? 'مستخدم غير معروف'}
                      </TD>
                      <TD className="text-[#767676] text-xs whitespace-nowrap">
                        {displayRoleLabel(log.user?.role, {
                          accountant_type: log.user?.accountant_type,
                          lawyer_type: log.user?.lawyer_type,
                        })}
                      </TD>
                      <TD>
                        <Badge variant={ACTIVITY_ACTION_BADGE[log.action] ?? 'orange'}>
                          {activityActionLabel(log.action)}
                        </Badge>
                      </TD>
                      <TD className="text-[#767676] text-xs max-w-[240px]">
                        <span className="line-clamp-2">{activityLogDescription(log)}</span>
                      </TD>
                      <TD className="text-[#767676] text-xs whitespace-nowrap">
                        {activityEntityLabel(log.entity_type)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {visibleLogs.map((log: any) => (
                <div key={log.id} className="px-4 py-3 flex gap-3">
                  <div className="w-1.5 mt-2 shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#2C8780]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <Badge variant={ACTIVITY_ACTION_BADGE[log.action] ?? 'orange'}>
                        {activityActionLabel(log.action)}
                      </Badge>
                      <span className="text-[10px] text-[#767676] font-mono shrink-0 text-left" dir="ltr">
                        {fmtActivityDate(log.created_at)}
                        <span className="mx-1">·</span>
                        {fmtActivityTime(log.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-[#231F20]">{activityLogDescription(log)}</p>
                    <p className="text-xs text-[#767676] mt-0.5">
                      {log.user?.full_name ?? 'مستخدم غير معروف'}
                      {' · '}
                      {activityEntityLabel(log.entity_type)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <ShowMoreFooter
              hasMore={logsHasMore}
              expanded={logsExpanded}
              onToggle={toggleLogs}
              total={logsTotal}
            />
          </>
        )}
      </div>
    </div>
  )
}
