'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Table, THead, TBody, TR, TD } from '@/components/ui/data-table'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import LawyerWalletHistory from '@/components/LawyerWalletHistory'
import AdminCompleteAsLawyerFlow from '@/components/AdminCompleteAsLawyerFlow'
import { IncompleteWithoutCompletionModal } from '@/components/TaskUpdateForm'
import { fmtDate, fmtMoney, fmtNum } from '@/lib/utils'
import {
  fetchLawyerDetailLogs,
  fetchLawyerFeeTxsForStats,
  fetchLawyerSavingsTxsForStats,
  fetchLawyerExpensesForStats,
  fetchLawyerCompletedTasks,
  achievementLabel,
  achievementFee,
  achievementDate,
  STATIONERY_ITEM_LABELS,
  LAWYER_ADMIN_COMPLETABLE_STATUSES,
  type LawyerProfileBrief,
  type LawyerCompletedTaskRow,
  type LawyerExpenseRow,
  type LawyerAssignedTaskRow,
} from '@/lib/admin-lawyer-stats'
import { fetchStationeryTransactions, type StationeryTxRow } from '@/lib/lawyer-stationery-wallet'
import type { LawyerWalletRow } from '@/lib/lawyer-wallet'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'
import { canApproveCompletions } from '@/lib/permissions'
import { resolveTaskLabel } from '@/lib/task-display-label'
import { lawyerTaskStatusLabel } from '@/lib/lawyer-task-display'
import {
  EXPORT_LIMIT,
  EXPORT_SECTIONS,
  DEFAULT_EXPORT_CHOICE,
  STATIONERY_TYPE_LABELS,
  type ExportChoice,
  ymdOf,
  inExportDateRange,
  safeExcelName,
  lawyerTypeLabel,
  caseTypeLabel,
  expenseStatusLabel,
  lawyerInitials,
  walletTxRows,
  sheetOrEmpty,
  taskSheetRows,
  expenseSheetRows,
  stationerySheetRows,
} from '@/lib/lawyer-stats-excel'

function unwrapDef(raw: unknown): { label?: string | null; fee_amount?: number | null; task_type?: string | null } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { label?: string | null; fee_amount?: number | null; task_type?: string | null }) ?? null
  return raw as { label?: string | null; fee_amount?: number | null; task_type?: string | null }
}

function assignedTaskLabel(row: LawyerAssignedTaskRow) {
  const def = unwrapDef(row.task_definitions)
  return resolveTaskLabel(def?.task_type ?? row.task_type ?? '', def?.label)
}

export default function LawyerWorkspacePage() {
  const params = useParams<{ id: string }>()
  const lawyerId = params?.id ?? ''
  const branchId = useBranchId()
  const role = useAdminRole()
  const canComplete = canApproveCompletions(role)

  const [tab, setTab] = useState<'assigned' | 'records'>('assigned')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lawyer, setLawyer] = useState<LawyerProfileBrief | null>(null)
  const [assigned, setAssigned] = useState<LawyerAssignedTaskRow[]>([])
  const [completeRow, setCompleteRow] = useState<LawyerAssignedTaskRow | null>(null)
  const [incompleteRow, setIncompleteRow] = useState<LawyerAssignedTaskRow | null>(null)
  const [savingsBalance, setSavingsBalance] = useState(0)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [completed, setCompleted] = useState<LawyerCompletedTaskRow[]>([])
  const [expenses, setExpenses] = useState<LawyerExpenseRow[]>([])
  const [feeTxs, setFeeTxs] = useState<LawyerWalletRow[]>([])
  const [savingsTxs, setSavingsTxs] = useState<LawyerWalletRow[]>([])
  const [stationeryTxs, setStationeryTxs] = useState<StationeryTxRow[]>([])
  const [recordsLoaded, setRecordsLoaded] = useState(false)

  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exportChoice, setExportChoice] = useState<ExportChoice>(DEFAULT_EXPORT_CHOICE)

  const loadAssigned = useCallback(async () => {
    if (!lawyerId) return
    setLoading(true)
    setError('')
    try {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''
      const res = await fetch(`/api/admin/lawyer-workspace/${encodeURIComponent(lawyerId)}${qs}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل تحميل صفحة المحامي')
        setLawyer(null)
        setAssigned([])
        setSavingsBalance(0)
        return
      }
      setLawyer(data.lawyer as LawyerProfileBrief)
      setAssigned((data.assigned ?? []) as LawyerAssignedTaskRow[])
      setSavingsBalance(Number(data.balances?.savings ?? 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحميل صفحة المحامي')
      setLawyer(null)
      setAssigned([])
      setSavingsBalance(0)
    } finally {
      setLoading(false)
    }
  }, [lawyerId, branchId])

  useEffect(() => {
    void loadAssigned()
  }, [loadAssigned])

  const loadRecords = useCallback(async () => {
    if (!lawyerId) return
    setRecordsLoading(true)
    const supabase = createClient()
    try {
      const [tasks, exps, logs] = await Promise.all([
        fetchLawyerCompletedTasks(supabase, {
          lawyerIds: [lawyerId],
          branchId,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
        fetchLawyerExpensesForStats(supabase, {
          lawyerIds: [lawyerId],
          branchId,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
        fetchLawyerDetailLogs(supabase, lawyerId, {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      ])
      setCompleted(tasks)
      setExpenses(exps)
      setFeeTxs(logs.feeTxs)
      setSavingsTxs(logs.savingsTxs)
      setStationeryTxs(logs.stationeryTxs)
      setRecordsLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحميل السجلات')
    } finally {
      setRecordsLoading(false)
    }
  }, [lawyerId, branchId, dateFrom, dateTo])

  useEffect(() => {
    if (tab !== 'records') return
    void loadRecords()
  }, [tab, loadRecords])

  const tasksShow = useShowMore(completed, LOG_PREVIEW_LIMIT)
  const expensesShow = useShowMore(expenses, LOG_PREVIEW_LIMIT)
  const stationeryShow = useShowMore(stationeryTxs, LOG_PREVIEW_LIMIT)

  const feesEarned = useMemo(
    () => completed.reduce((s, t) => s + achievementFee(t, role), 0),
    [completed, role],
  )
  const expensesTotal = useMemo(
    () => expenses
      .filter(e => {
        const st = (e.status ?? 'approved').toLowerCase()
        return st === 'approved' || st === 'pending' || st === 'pending_review' || st === 'pending_approval'
      })
      .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [expenses],
  )

  async function confirmExportExcel() {
    if (!lawyer || exporting) return
    const anySelected =
      exportChoice.tasks || exportChoice.fees || exportChoice.expenses || exportChoice.stationery
    if (!anySelected) return

    setExporting(true)
    setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const from = exportFrom || undefined
      const to = exportTo || undefined
      const dateOpts = { dateFrom: from, dateTo: to, limit: EXPORT_LIMIT }
      const supabase = createClient()

      const [exportTasks, exportFeeTxs, exportSavingsTxs, exportExpenses, exportStationery] =
        await Promise.all([
          exportChoice.tasks
            ? fetchLawyerCompletedTasks(supabase, {
                lawyerIds: [lawyer.id],
                branchId,
                dateFrom: from,
                dateTo: to,
              })
            : Promise.resolve([] as LawyerCompletedTaskRow[]),
          exportChoice.fees
            ? fetchLawyerFeeTxsForStats(supabase, lawyer.id, dateOpts)
            : Promise.resolve([] as LawyerWalletRow[]),
          exportChoice.expenses
            ? fetchLawyerSavingsTxsForStats(supabase, lawyer.id, dateOpts)
            : Promise.resolve([] as LawyerWalletRow[]),
          exportChoice.expenses
            ? fetchLawyerExpensesForStats(supabase, {
                lawyerIds: [lawyer.id],
                branchId,
                dateFrom: from,
                dateTo: to,
              })
            : Promise.resolve([] as LawyerExpenseRow[]),
          exportChoice.stationery
            ? fetchStationeryTransactions(supabase, lawyer.id, EXPORT_LIMIT).then(rows =>
                rows.filter(r => inExportDateRange(ymdOf(r.created_at), from, to)),
              )
            : Promise.resolve([] as StationeryTxRow[]),
        ])

      const selectedLabels = EXPORT_SECTIONS.filter(s => exportChoice[s.key]).map(s => s.label).join('، ')
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet([
          {
            'المحامي': lawyer.full_name,
            'الهاتف': lawyer.phone ?? '—',
            'النوع': lawyerTypeLabel(lawyer.lawyer_type, lawyer.branch_name),
            'القسم': caseTypeLabel(lawyer.case_type) ?? '—',
            'من': from || 'الكل',
            'إلى': to || 'الكل',
            'الأقسام المصدرة': selectedLabels,
            'مهام منجزة': exportChoice.tasks ? exportTasks.length : completed.length,
            'أتعاب الفترة': feesEarned,
            'إجمالي الصرفيات': expensesTotal,
          },
        ]),
        safeExcelName('ملخص'),
      )

      if (exportChoice.tasks) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetOrEmpty(XLSX, taskSheetRows(exportTasks, role), 'لا مهام منجزة ضمن الفترة'),
          safeExcelName('المهام المنجزة'),
        )
      }
      if (exportChoice.fees) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetOrEmpty(XLSX, walletTxRows(exportFeeTxs), 'لا حركات أتعاب ضمن الفترة'),
          safeExcelName('سجل الأتعاب'),
        )
      }
      if (exportChoice.expenses) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetOrEmpty(XLSX, expenseSheetRows(exportExpenses), 'لا صرفيات ضمن الفترة'),
          safeExcelName('سجل الصرفيات'),
        )
        XLSX.utils.book_append_sheet(
          wb,
          sheetOrEmpty(XLSX, walletTxRows(exportSavingsTxs), 'لا حركات محفظة صرفيات ضمن الفترة'),
          safeExcelName('محفظة الصرفيات'),
        )
      }
      if (exportChoice.stationery) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetOrEmpty(XLSX, stationerySheetRows(exportStationery), 'لا حركات قرطاسية ضمن الفترة'),
          safeExcelName('سجل القرطاسية'),
        )
      }

      const safeName = lawyer.full_name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
      XLSX.writeFile(wb, `محامي-${safeName}-${from || 'الكل'}-${to || 'الكل'}.xlsx`)
      setExportOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تصدير Excel')
    } finally {
      setExporting(false)
    }
  }

  const section = caseTypeLabel(lawyer?.case_type)

  return (
    <div className="max-w-6xl mx-auto px-0 sm:px-1 pb-10">
      <PageHeader
        title={lawyer?.full_name ?? 'صفحة المحامي'}
        subtitle={lawyer
          ? `${lawyerTypeLabel(lawyer.lawyer_type, lawyer.branch_name)}${section ? ` · ${section}` : ''}${lawyer.phone ? ` · ${lawyer.phone}` : ''}`
          : 'المكلف بهم والسجلات'}
        breadcrumb={[
          { label: 'المحامين', href: '/admin/lawyer-stats' },
          { label: lawyer?.full_name ?? 'المحامي' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => {
              setExportFrom(dateFrom)
              setExportTo(dateTo)
              setExportChoice(DEFAULT_EXPORT_CHOICE)
              setExportOpen(true)
            }} disabled={!lawyer || exporting}>
              تصدير Excel
            </Button>
            <Button variant="outline" onClick={() => void loadAssigned()} disabled={loading}>
              تحديث
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-semibold">
          {error}
        </div>
      )}

      {lawyer && (
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-12 h-12 rounded-xl shrink-0 flex items-center justify-center text-white font-black"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            {lawyerInitials(lawyer.full_name)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="gray">{lawyerTypeLabel(lawyer.lawyer_type, lawyer.branch_name)}</Badge>
            {section ? <Badge variant="info">{section}</Badge> : null}
            {lawyer.is_active === false ? <Badge variant="danger">موقوف</Badge> : null}
            <Badge variant="info">{fmtNum(assigned.length)} مكلف بها</Badge>
            <Badge variant="orange">متبقي الصرفيات: {fmtMoney(savingsBalance)}</Badge>
          </div>
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-xl bg-[#F3F1F2] mb-5 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setTab('assigned')}
          className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            tab === 'assigned' ? 'bg-white text-[#2C8780] shadow-sm' : 'text-[#767676] hover:text-[#231F20]'
          }`}
        >
          المكلف بهم
        </button>
        <button
          type="button"
          onClick={() => setTab('records')}
          className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            tab === 'records' ? 'bg-white text-[#2C8780] shadow-sm' : 'text-[#767676] hover:text-[#231F20]'
          }`}
        >
          السجلات
        </button>
      </div>

      {tab === 'assigned' && (
        loading ? (
          <div className="py-16 text-center text-[#454042] font-semibold">جارٍ تحميل المهام المكلّف بها…</div>
        ) : assigned.length === 0 ? (
          <EmptyState title="لا مهام مكلّف بها" description="لا توجد مهام نشطة لهذا المحامي حالياً." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {assigned.map(row => {
              const completable = LAWYER_ADMIN_COMPLETABLE_STATUSES.has(row.task_status)
              const debtorId = row.debtor_id
              return (
                <div
                  key={row.id}
                  className="rounded-2xl border border-[rgba(118,118,118,0.15)] bg-white p-4 shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-[#231F20] truncate">{row.debtors?.full_name ?? '—'}</p>
                      {row.debtors?.receipt_number && (
                        <p className="text-[11px] text-[#767676] mt-0.5">وصل: {row.debtors.receipt_number}</p>
                      )}
                    </div>
                    <Badge variant={row.task_status === 'submitted' || row.task_status === 'pending_review' ? 'purple' : 'info'}>
                      {lawyerTaskStatusLabel(row.task_status, row, lawyerId)}
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold text-[#1D6365]">{assignedTaskLabel(row)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {debtorId && (
                      <Link
                        href={`/admin/debtors/${debtorId}/profile`}
                        className="text-xs font-bold text-[#2C8780] hover:underline"
                      >
                        ملف المدين
                      </Link>
                    )}
                    {canComplete && (row.task_status === 'submitted' || row.task_status === 'pending_review') && (
                      <Link
                        href="/admin/tasks/review"
                        className="text-xs font-bold text-purple-700 hover:underline"
                      >
                        في طابور المراجعة
                      </Link>
                    )}
                  </div>
                  {canComplete && completable && (
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setCompleteRow(row)}
                        className="flex-1 text-xs font-black text-white px-3 py-2 rounded-xl"
                        style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                      >
                        إنجاز كمدير
                      </button>
                      <button
                        type="button"
                        onClick={() => setIncompleteRow(row)}
                        className="flex-1 sm:flex-none text-xs font-black text-white px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700"
                      >
                        إرسال بدون إنجاز
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'records' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
            <DateRangePicker
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={({ dateFrom: f, dateTo: t }) => {
                setDateFrom(f)
                setDateTo(t)
              }}
              fieldLabel="فترة السجلات"
              headerTitle="اختر فترة السجلات"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                className="mt-3 text-xs font-bold text-[#2C8780] hover:underline"
                onClick={() => { setDateFrom(''); setDateTo('') }}
              >
                مسح الفترة (عرض الكل)
              </button>
            )}
          </div>

          {recordsLoading && !recordsLoaded ? (
            <div className="py-16 text-center text-[#454042] font-semibold">جارٍ تحميل السجلات…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <StatCard label="مهام منجزة" value={fmtNum(completed.length)} accent="teal" />
                <StatCard label="أتعاب الفترة" value={fmtMoney(feesEarned)} accent="green" />
                <StatCard label="صرفيات الفترة" value={fmtMoney(expensesTotal)} sub={`${fmtNum(expenses.length)} عملية`} accent="orange" />
                <StatCard
                  label="متبقي الصرفيات"
                  value={fmtMoney(savingsBalance)}
                  sub="الرصيد الحالي في محفظة الصرفيات"
                  accent="blue"
                />
              </div>

              <section className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
                  <h3 className="font-bold text-[#231F20] text-sm">المهام المنجزة مع المدين</h3>
                </div>
                {completed.length === 0 ? (
                  <p className="text-sm text-[#767676] text-center py-10">لا مهام منجزة ضمن الفترة</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <THead>
                          <TR>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">المهمة</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">المدين</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">الأتعاب</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">التاريخ</th>
                          </TR>
                        </THead>
                        <TBody>
                          {tasksShow.visibleItems.map(t => (
                            <TR key={t.id}>
                              <TD className="px-3 py-2.5 text-sm font-semibold text-[#231F20]">{achievementLabel(t)}</TD>
                              <TD className="px-3 py-2.5 text-sm text-[#454042]">
                                <div>{t.debtors?.full_name ?? '—'}</div>
                                {t.debtors?.receipt_number && (
                                  <div className="text-[11px] text-[#767676]">وصل: {t.debtors.receipt_number}</div>
                                )}
                              </TD>
                              <TD className="px-3 py-2.5 text-sm font-bold tabular-nums" dir="ltr">{fmtMoney(achievementFee(t, role))}</TD>
                              <TD className="px-3 py-2.5 text-xs text-[#767676]" dir="ltr">{fmtDate(achievementDate(t))}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                    <ShowMoreFooter
                      hasMore={tasksShow.hasMore}
                      expanded={tasksShow.expanded}
                      onToggle={tasksShow.toggle}
                      total={tasksShow.total}
                    />
                  </>
                )}
              </section>

              <section className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
                  <h3 className="font-bold text-[#231F20] text-sm">سجل الصرفيات</h3>
                </div>
                {expenses.length === 0 ? (
                  <p className="text-sm text-[#767676] text-center py-10">لا صرفيات ضمن الفترة</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <THead>
                          <TR>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">النوع</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">المدين</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">المبلغ</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">الحالة</th>
                            <th className="text-right px-3 py-2 text-xs font-bold text-[#454042]">التاريخ</th>
                          </TR>
                        </THead>
                        <TBody>
                          {expensesShow.visibleItems.map(e => (
                            <TR key={e.id}>
                              <TD className="px-3 py-2.5 text-sm font-semibold">{e.expense_type ?? '—'}</TD>
                              <TD className="px-3 py-2.5 text-sm text-[#454042]">{e.debtors?.full_name ?? '—'}</TD>
                              <TD className="px-3 py-2.5 text-sm font-bold tabular-nums" dir="ltr">{fmtMoney(Number(e.amount ?? 0))}</TD>
                              <TD className="px-3 py-2.5 text-xs">{expenseStatusLabel(e.status)}</TD>
                              <TD className="px-3 py-2.5 text-xs text-[#767676]" dir="ltr">{e.expense_date ? fmtDate(e.expense_date) : '—'}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                    <ShowMoreFooter
                      hasMore={expensesShow.hasMore}
                      expanded={expensesShow.expanded}
                      onToggle={expensesShow.toggle}
                      total={expensesShow.total}
                    />
                  </>
                )}
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <LawyerWalletHistory title="سجل محفظة الأتعاب" transactions={feeTxs} />
                <LawyerWalletHistory title="سجل محفظة الصرفيات / التوفير" transactions={savingsTxs} />
              </div>

              <section className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
                  <h3 className="font-bold text-[#231F20] text-sm">سجل محفظة القرطاسية</h3>
                </div>
                {stationeryTxs.length === 0 ? (
                  <p className="text-sm text-[#767676] text-center py-10">لا حركات قرطاسية ضمن الفترة</p>
                ) : (
                  <>
                    <div className="divide-y divide-slate-100">
                      {stationeryShow.visibleItems.map(tx => {
                        const amt = Number(tx.amount ?? 0)
                        return (
                          <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-black tabular-nums ${amt >= 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
                                {amt > 0 ? '+' : ''}{fmtNum(amt)} {STATIONERY_ITEM_LABELS[tx.item] ?? ''}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {STATIONERY_TYPE_LABELS[tx.type] ?? tx.type}
                                {tx.notes ? ` · ${tx.notes}` : ''}
                              </p>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0" dir="ltr">
                              {fmtDate(tx.created_at)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <ShowMoreFooter
                      hasMore={stationeryShow.hasMore}
                      expanded={stationeryShow.expanded}
                      onToggle={stationeryShow.toggle}
                      total={stationeryShow.total}
                    />
                  </>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {completeRow && (
        <AdminCompleteAsLawyerFlow
          taskRow={completeRow}
          viewerRole={role}
          onClose={() => setCompleteRow(null)}
          onFinished={() => {
            setCompleteRow(null)
            void loadAssigned()
          }}
        />
      )}

      {incompleteRow && (
        <IncompleteWithoutCompletionModal
          task={incompleteRow as any}
          taskLabel={assignedTaskLabel(incompleteRow)}
          adminAutoApprove
          skipRouterRefresh
          onClose={() => setIncompleteRow(null)}
          onSubmitted={() => {
            setIncompleteRow(null)
            void loadAssigned()
          }}
        />
      )}

      {exportOpen && lawyer && (
        <CenteredModalPortal
          onBackdropClick={() => !exporting && setExportOpen(false)}
          ariaLabelledBy="lawyer-export-modal-title"
          zIndex={70}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[rgba(118,118,118,0.1)]">
              <div className="min-w-0">
                <h2 id="lawyer-export-modal-title" className="font-bold text-[#231F20] text-lg">تصدير Excel</h2>
                <p className="text-sm text-[#767676] mt-0.5 truncate">{lawyer.full_name}</p>
              </div>
              <button
                type="button"
                onClick={() => !exporting && setExportOpen(false)}
                className="text-[#767676] hover:text-[#231F20] w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[rgba(118,118,118,0.08)] text-xl leading-none shrink-0"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>
            <DateRangePicker
              dateFrom={exportFrom}
              dateTo={exportTo}
              onChange={({ dateFrom: f, dateTo: t }) => {
                setExportFrom(f)
                setExportTo(t)
              }}
              fieldLabel="فترة التصدير"
              headerTitle="فترة السجل المصدر"
              placeholder="كل التواريخ — السجل الكامل"
              disabled={exporting}
            />
            <p className="text-[11px] text-[#767676] -mt-2">اترك الفترة فارغة لتصدير السجل الكامل.</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-[#231F20]">ماذا تريد تصديره؟</p>
                <div className="flex gap-3">
                  <button type="button" className="text-[11px] font-bold text-[#2C8780] hover:underline" disabled={exporting}
                    onClick={() => setExportChoice(DEFAULT_EXPORT_CHOICE)}>تحديد الكل</button>
                  <button type="button" className="text-[11px] font-bold text-[#767676] hover:underline" disabled={exporting}
                    onClick={() => setExportChoice({ tasks: false, fees: false, expenses: false, stationery: false })}>إلغاء الكل</button>
                </div>
              </div>
              {EXPORT_SECTIONS.map(sectionItem => {
                const checked = exportChoice[sectionItem.key]
                return (
                  <label
                    key={sectionItem.key}
                    className={[
                      'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                      checked ? 'border-[#2C8780] bg-[#2C8780]/5' : 'border-[rgba(118,118,118,0.18)] hover:border-[#2C8780]/40',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 w-4 h-4 accent-[#2C8780]"
                      checked={checked}
                      disabled={exporting}
                      onChange={e => setExportChoice(prev => ({ ...prev, [sectionItem.key]: e.target.checked }))}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#231F20]">{sectionItem.label}</p>
                      <p className="text-[11px] text-[#767676] mt-0.5">{sectionItem.hint}</p>
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" disabled={exporting} onClick={() => setExportOpen(false)}>إلغاء</Button>
              <Button
                type="button"
                className="flex-1"
                loading={exporting}
                disabled={!(exportChoice.tasks || exportChoice.fees || exportChoice.expenses || exportChoice.stationery)}
                onClick={() => void confirmExportExcel()}
              >
                {exporting ? 'جارٍ التصدير…' : 'تصدير'}
              </Button>
            </div>
          </div>
        </CenteredModalPortal>
      )}
    </div>
  )
}
