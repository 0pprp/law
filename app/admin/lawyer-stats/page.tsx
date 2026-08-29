'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { fmtDate, fmtMoney, fmtNum } from '@/lib/utils'
import {
  buildLawyerStatsSummaries,
  fetchLawyerDetailLogs,
  fetchLawyerFeeTxsForStats,
  fetchLawyerSavingsTxsForStats,
  fetchLawyerExpensesForStats,
  fetchLawyerCompletedTasks,
  achievementLabel,
  achievementFee,
  achievementDate,
  STATIONERY_ITEM_LABELS,
  type LawyerStatsSummary,
  type LawyerCompletedTaskRow,
  type LawyerExpenseRow,
} from '@/lib/admin-lawyer-stats'
import type { LawyerWalletRow } from '@/lib/lawyer-wallet'
import { fetchStationeryTransactions, type StationeryTxRow } from '@/lib/lawyer-stationery-wallet'
import type { LawyerWalletKind, WalletTransactionType } from '@/lib/types'
import { walletTransactionLabel } from '@/lib/wallet-transaction-display'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

const EXPORT_LIMIT = 5000

const EXPORT_SECTIONS = [
  { key: 'tasks', label: 'المهام المنجزة', hint: 'كل المهام المنجزة مع المدين والأتعاب والتاريخ' },
  { key: 'fees', label: 'سجل الأتعاب', hint: 'حركات محفظة الأتعاب كاملة مع التواريخ' },
  { key: 'expenses', label: 'الصرفيات', hint: 'سجل الصرفيات + محفظة الصرفيات مع التواريخ' },
  { key: 'stationery', label: 'القرطاسية', hint: 'حركات الطوابع كاملة مع التواريخ' },
] as const

type ExportSectionKey = (typeof EXPORT_SECTIONS)[number]['key']
type ExportChoice = Record<ExportSectionKey, boolean>

const DEFAULT_EXPORT_CHOICE: ExportChoice = { tasks: true, fees: true, expenses: true, stationery: true }

function ymdOf(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.split('T')[0]
}

function inExportDateRange(ymd: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && ymd < dateFrom) return false
  if (dateTo && ymd > dateTo) return false
  return true
}

function safeExcelName(name: string, max = 31) {
  return name.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'ورقة'
}

const STATIONERY_TYPE_LABELS: Record<string, string> = {
  deposit: 'إيداع',
  withdrawal: 'سحب',
  lawsuit_deduction: 'خصم دعوى',
}

function lawyerTypeLabel(t: string | null | undefined) {
  if (t === 'general') return 'محامي عام'
  return 'محامي فرع'
}

function caseTypeLabel(t: string | null | undefined) {
  if (t === 'criminal') return 'جزائي'
  if (t === 'civil') return 'مدني'
  return null
}

function expenseStatusLabel(s: string | null | undefined) {
  const v = (s ?? 'approved').toLowerCase()
  if (v === 'pending' || v === 'pending_review' || v === 'pending_approval') return 'بانتظار'
  if (v === 'rejected') return 'مرفوضة'
  if (v === 'approved') return 'معتمدة'
  return s ?? '—'
}

function lawyerInitials(name: string | null | undefined) {
  return (name || 'م').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')
}

export default function LawyerStatsPage() {
  const branchId = useBranchId()
  const role = useAdminRole()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summaries, setSummaries] = useState<LawyerStatsSummary[]>([])
  const [completedByLawyer, setCompletedByLawyer] = useState<Map<string, LawyerCompletedTaskRow[]>>(new Map())
  const [expensesByLawyer, setExpensesByLawyer] = useState<Map<string, LawyerExpenseRow[]>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [feeTxs, setFeeTxs] = useState<LawyerWalletRow[]>([])
  const [savingsTxs, setSavingsTxs] = useState<LawyerWalletRow[]>([])
  const [stationeryTxs, setStationeryTxs] = useState<StationeryTxRow[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exportChoice, setExportChoice] = useState<ExportChoice>(DEFAULT_EXPORT_CHOICE)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const supabase = createClient()
    try {
      const result = await buildLawyerStatsSummaries(supabase, {
        branchId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        viewerRole: role,
      })
      setSummaries(result.summaries)
      setCompletedByLawyer(result.completedByLawyer)
      setExpensesByLawyer(result.expensesByLawyer)
      setSelectedId(prev => {
        if (prev && result.summaries.some(s => s.lawyer.id === prev)) return prev
        return null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحميل البيانات')
      setSummaries([])
    } finally {
      setLoading(false)
    }
  }, [branchId, dateFrom, dateTo, role])

  useEffect(() => {
    load()
  }, [load])

  const selected = useMemo(
    () => summaries.find(s => s.lawyer.id === selectedId) ?? null,
    [summaries, selectedId],
  )

  const selectedTasks = useMemo(
    () => (selectedId ? completedByLawyer.get(selectedId) ?? [] : []),
    [completedByLawyer, selectedId],
  )
  const selectedExpenses = useMemo(
    () => (selectedId ? expensesByLawyer.get(selectedId) ?? [] : []),
    [expensesByLawyer, selectedId],
  )

  useEffect(() => {
    if (!selectedId) {
      setFeeTxs([])
      setSavingsTxs([])
      setStationeryTxs([])
      return
    }
    let cancelled = false
    ;(async () => {
      setDetailLoading(true)
      const supabase = createClient()
      const logs = await fetchLawyerDetailLogs(supabase, selectedId, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      if (cancelled) return
      setFeeTxs(logs.feeTxs)
      setSavingsTxs(logs.savingsTxs)
      setStationeryTxs(logs.stationeryTxs)
      setDetailLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, dateFrom, dateTo])

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, s) => {
        acc.completed += s.completedCount
        acc.feesEarned += s.feesEarnedInPeriod
        acc.expenses += s.expensesTotalInPeriod
        acc.stamps += s.stationery.stamps
        return acc
      },
      { completed: 0, feesEarned: 0, expenses: 0, stamps: 0 },
    )
  }, [summaries])

  const tasksShow = useShowMore(selectedTasks, LOG_PREVIEW_LIMIT)
  const expensesShow = useShowMore(selectedExpenses, LOG_PREVIEW_LIMIT)
  const stationeryShow = useShowMore(stationeryTxs, LOG_PREVIEW_LIMIT)

  function openExportModal() {
    if (!selected) return
    setExportFrom(dateFrom)
    setExportTo(dateTo)
    setExportChoice(DEFAULT_EXPORT_CHOICE)
    setExportOpen(true)
  }

  function walletTxRows(rows: LawyerWalletRow[]) {
    return rows.map(tx => {
      const amt = Number(tx.amount ?? 0)
      const wallet = (tx.wallet ?? 'fees') as LawyerWalletKind
      return {
        'المبلغ': amt,
        'النوع': walletTransactionLabel(tx.type as WalletTransactionType, wallet, amt),
        'ملاحظة': tx.notes ?? '—',
        'التاريخ': tx.created_at ? fmtDate(tx.created_at) : '—',
      }
    })
  }

  function sheetOrEmpty(
    XLSX: typeof import('xlsx'),
    rows: Record<string, unknown>[],
    emptyNote: string,
  ) {
    if (rows.length) return XLSX.utils.json_to_sheet(rows)
    return XLSX.utils.json_to_sheet([{ 'ملاحظة': emptyNote }])
  }

  function taskSheetRows(rows: LawyerCompletedTaskRow[]) {
    return rows.map(t => ({
      'المهمة': achievementLabel(t),
      'المدين': t.debtors?.full_name ?? '—',
      'رقم الوصل': t.debtors?.receipt_number ?? '—',
      'الأتعاب': achievementFee(t, role),
      'التاريخ': achievementDate(t) || '—',
    }))
  }

  function expenseSheetRows(rows: LawyerExpenseRow[]) {
    return rows.map(e => ({
      'النوع': e.expense_type ?? '—',
      'المدين': e.debtors?.full_name ?? '—',
      'المبلغ': Number(e.amount ?? 0),
      'الحالة': expenseStatusLabel(e.status),
      'التاريخ': e.expense_date ? fmtDate(e.expense_date) : '—',
      'الوصف': e.description ?? '—',
      'المهمة': e.tasks?.task_definitions?.label ?? e.tasks?.task_type ?? '—',
    }))
  }

  function stationerySheetRows(rows: StationeryTxRow[]) {
    return rows.map(tx => {
      const amt = Number(tx.amount ?? 0)
      const itemLabel = STATIONERY_ITEM_LABELS[tx.item] ?? tx.item
      const typeLabel = STATIONERY_TYPE_LABELS[tx.type] ?? tx.type
      return {
        'التاريخ': tx.created_at ? fmtDate(tx.created_at) : '—',
        'الكمية/الصنف': `${amt > 0 ? '+' : ''}${amt} ${itemLabel}`.trim(),
        'الكمية': amt,
        'الصنف': itemLabel,
        'النوع': typeLabel,
        'البيان': [typeLabel, tx.notes].filter(Boolean).join(' — ') || '—',
      }
    })
  }

  async function confirmExportExcel() {
    if (!selected || exporting) return
    const anySelected =
      exportChoice.tasks || exportChoice.fees || exportChoice.expenses || exportChoice.stationery
    if (!anySelected) return

    setExporting(true)
    setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const lawyer = selected.lawyer
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
            'النوع': lawyerTypeLabel(lawyer.lawyer_type),
            'القسم': caseTypeLabel(lawyer.case_type) ?? '—',
            'من': from || 'الكل',
            'إلى': to || 'الكل',
            'الأقسام المصدرة': selectedLabels,
            'مهام منجزة': exportChoice.tasks ? exportTasks.length : selected.completedCount,
            'أتعاب الفترة': selected.feesEarnedInPeriod,
            'رصيد الأتعاب': selected.feesBalance,
            'رصيد الصرفيات': selected.savingsBalance,
            'إجمالي الصرفيات': selected.expensesTotalInPeriod,
            'رصيد الطوابع': selected.stationery.stamps,
          },
        ]),
        safeExcelName('ملخص'),
      )

      if (exportChoice.tasks) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetOrEmpty(XLSX, taskSheetRows(exportTasks), 'لا مهام منجزة ضمن الفترة'),
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
          sheetOrEmpty(
            XLSX,
            stationerySheetRows(exportStationery),
            'لا حركات قرطاسية ضمن الفترة',
          ),
          safeExcelName('سجل القرطاسية'),
        )
      }

      const fromPart = from || 'الكل'
      const toPart = to || 'الكل'
      const safeName = lawyer.full_name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40)
      XLSX.writeFile(wb, `محامي-${safeName}-${fromPart}-${toPart}.xlsx`)
      setExportOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تصدير Excel')
    } finally {
      setExporting(false)
    }
  }

  async function exportAllExcel() {
    if (!summaries.length || exporting) return
    setExporting(true)
    setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const from = dateFrom || undefined
      const to = dateTo || undefined
      const dateOpts = { dateFrom: from, dateTo: to, limit: EXPORT_LIMIT }
      const supabase = createClient()
      const lawyerIds = summaries.map(s => s.lawyer.id)
      const nameById = new Map(summaries.map(s => [s.lawyer.id, s.lawyer.full_name]))

      const [allTasks, allExpenses, detailLogs] = await Promise.all([
        fetchLawyerCompletedTasks(supabase, {
          lawyerIds,
          branchId,
          dateFrom: from,
          dateTo: to,
        }),
        fetchLawyerExpensesForStats(supabase, {
          lawyerIds,
          branchId,
          dateFrom: from,
          dateTo: to,
        }),
        Promise.all(
          lawyerIds.map(async id => {
            const logs = await fetchLawyerDetailLogs(supabase, id, dateOpts)
            return { id, ...logs }
          }),
        ),
      ])

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          summaries.map(s => ({
            'المحامي': s.lawyer.full_name,
            'الهاتف': s.lawyer.phone ?? '—',
            'النوع': lawyerTypeLabel(s.lawyer.lawyer_type),
            'القسم': caseTypeLabel(s.lawyer.case_type) ?? '—',
            'من': from || 'الكل',
            'إلى': to || 'الكل',
            'مهام منجزة': s.completedCount,
            'أتعاب الفترة': s.feesEarnedInPeriod,
            'رصيد الأتعاب': s.feesBalance,
            'رصيد الصرفيات': s.savingsBalance,
            'إجمالي الصرفيات': s.expensesTotalInPeriod,
            'عدد الصرفيات': s.expensesCountInPeriod,
            'رصيد الطوابع': s.stationery.stamps,
            'آخر إنجاز': s.lastCompletedAt ?? '—',
          })),
        ),
        safeExcelName('ملخص'),
      )

      XLSX.utils.book_append_sheet(
        wb,
        sheetOrEmpty(
          XLSX,
          allTasks.map(t => ({
            'المحامي': (t.assigned_to && nameById.get(t.assigned_to)) || '—',
            ...taskSheetRows([t])[0],
          })),
          'لا مهام منجزة ضمن الفترة',
        ),
        safeExcelName('المهام المنجزة'),
      )

      XLSX.utils.book_append_sheet(
        wb,
        sheetOrEmpty(
          XLSX,
          allExpenses.map(e => ({
            'المحامي': (e.created_by && nameById.get(e.created_by)) || '—',
            ...expenseSheetRows([e])[0],
          })),
          'لا صرفيات ضمن الفترة',
        ),
        safeExcelName('سجل الصرفيات'),
      )

      const allFeeRows: Record<string, unknown>[] = []
      const allSavingsRows: Record<string, unknown>[] = []
      const allStationeryRows: Record<string, unknown>[] = []
      for (const log of detailLogs) {
        const name = nameById.get(log.id) ?? '—'
        for (const tx of log.feeTxs) {
          allFeeRows.push({ 'المحامي': name, ...walletTxRows([tx])[0] })
        }
        for (const tx of log.savingsTxs) {
          allSavingsRows.push({ 'المحامي': name, ...walletTxRows([tx])[0] })
        }
        for (const tx of log.stationeryTxs) {
          allStationeryRows.push({ 'المحامي': name, ...stationerySheetRows([tx])[0] })
        }
      }

      XLSX.utils.book_append_sheet(
        wb,
        sheetOrEmpty(XLSX, allFeeRows, 'لا حركات أتعاب ضمن الفترة'),
        safeExcelName('سجل الأتعاب'),
      )
      XLSX.utils.book_append_sheet(
        wb,
        sheetOrEmpty(XLSX, allSavingsRows, 'لا حركات محفظة صرفيات ضمن الفترة'),
        safeExcelName('محفظة الصرفيات'),
      )
      XLSX.utils.book_append_sheet(
        wb,
        sheetOrEmpty(XLSX, allStationeryRows, 'لا حركات قرطاسية ضمن الفترة'),
        safeExcelName('سجل القرطاسية'),
      )

      XLSX.writeFile(wb, `محامون-${dateFrom || 'الكل'}-${dateTo || 'الكل'}.xlsx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تصدير Excel')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-0 sm:px-1 pb-10">
      <PageHeader
        title="المحامين"
        subtitle="إحصائيات المحامين حسب الفرع المحدد — إنجاز، أتعاب، صرفيات، وقرطاسية"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportAllExcel} disabled={!summaries.length || exporting}>
              {exporting ? 'جارٍ التصدير…' : 'تصدير الكل Excel'}
            </Button>
          </div>
        }
      />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4 mb-5">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={({ dateFrom: f, dateTo: t }) => {
            setDateFrom(f)
            setDateTo(t)
          }}
          fieldLabel="فترة الإحصائيات"
          headerTitle="اختر فترة الإحصائيات"
        />
        {(dateFrom || dateTo) && (
          <button
            type="button"
            className="mt-3 text-xs font-bold text-[#2C8780] hover:underline"
            onClick={() => {
              setDateFrom('')
              setDateTo('')
            }}
          >
            مسح الفترة (عرض الكل)
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-semibold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="عدد المحامين" value={fmtNum(summaries.length)} accent="navy" />
        <StatCard label="مهام منجزة" value={fmtNum(totals.completed)} accent="teal" sub={dateFrom || dateTo ? 'ضمن الفترة' : 'كل الفترات'} />
        <StatCard label="أتعاب الفترة" value={fmtMoney(totals.feesEarned)} accent="green" />
        <StatCard label="صرفيات الفترة" value={fmtMoney(totals.expenses)} accent="orange" />
      </div>

      {loading ? (
        <div className="py-20 text-center text-[#454042] font-semibold">جارٍ التحميل…</div>
      ) : summaries.length === 0 ? (
        <EmptyState title="لا محامين" description="لا يوجد محامون في الفرع المحدد حالياً." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 mb-8">
          {summaries.map(s => {
            const active = selectedId === s.lawyer.id
            const section = caseTypeLabel(s.lawyer.case_type)
            return (
              <button
                key={s.lawyer.id}
                type="button"
                onClick={() => setSelectedId(active ? null : s.lawyer.id)}
                className={[
                  'text-right rounded-2xl border bg-white p-4 sm:p-5 shadow-sm transition-all',
                  active
                    ? 'border-[#2C8780] ring-2 ring-[#2C8780]/25 shadow-md'
                    : 'border-[rgba(118,118,118,0.15)] hover:border-[#2C8780]/40 hover:shadow-md',
                ].join(' ')}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-white font-black text-sm"
                    style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
                  >
                    {lawyerInitials(s.lawyer.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-[#231F20] truncate">{s.lawyer.full_name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <Badge variant="gray">{lawyerTypeLabel(s.lawyer.lawyer_type)}</Badge>
                      {section ? <Badge variant="info">{section}</Badge> : null}
                      {s.lawyer.is_active === false ? <Badge variant="danger">موقوف</Badge> : null}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div className="rounded-xl bg-[#F3F1F2] px-3 py-2">
                    <p className="text-[10px] font-bold text-[#767676]">منجز</p>
                    <p className="text-lg font-black text-[#2C8780] tabular-nums">{fmtNum(s.completedCount)}</p>
                  </div>
                  <div className="rounded-xl bg-[#F3F1F2] px-3 py-2">
                    <p className="text-[10px] font-bold text-[#767676]">أتعاب الفترة</p>
                    <p className="text-sm font-black text-[#231F20] tabular-nums" dir="ltr">{fmtMoney(s.feesEarnedInPeriod)}</p>
                  </div>
                  <div className="rounded-xl bg-[#F3F1F2] px-3 py-2">
                    <p className="text-[10px] font-bold text-[#767676]">صرفيات</p>
                    <p className="text-sm font-black text-amber-700 tabular-nums" dir="ltr">{fmtMoney(s.expensesTotalInPeriod)}</p>
                  </div>
                  <div className="rounded-xl bg-[#F3F1F2] px-3 py-2">
                    <p className="text-[10px] font-bold text-[#767676]">طوابع</p>
                    <p className="text-lg font-black text-violet-700 tabular-nums">{fmtNum(s.stationery.stamps)}</p>
                  </div>
                </div>
                {s.lastCompletedAt && (
                  <p className="text-[11px] text-[#767676] mt-3 font-medium">
                    آخر إنجاز: <span dir="ltr">{fmtDate(s.lastCompletedAt)}</span>
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <div className="space-y-5 border-t border-[rgba(118,118,118,0.12)] pt-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-[#231F20]">{selected.lawyer.full_name}</h2>
              <p className="text-sm text-[#454042] mt-1 font-medium">
                {lawyerTypeLabel(selected.lawyer.lawyer_type)}
                {caseTypeLabel(selected.lawyer.case_type) ? ` · ${caseTypeLabel(selected.lawyer.case_type)}` : ''}
                {selected.lawyer.phone ? ` · ${selected.lawyer.phone}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openExportModal} disabled={exporting}>
                تصدير Excel للمحامي
              </Button>
              <Button variant="outline" onClick={() => setSelectedId(null)}>إغلاق</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard label="مهام منجزة" value={fmtNum(selected.completedCount)} accent="teal" />
            <StatCard label="أتعاب الفترة" value={fmtMoney(selected.feesEarnedInPeriod)} accent="green" />
            <StatCard label="رصيد الأتعاب" value={fmtMoney(selected.feesBalance)} accent="blue" />
            <StatCard label="رصيد الصرفيات/التوفير" value={fmtMoney(selected.savingsBalance)} accent="orange" />
            <StatCard label="صرفيات الفترة" value={fmtMoney(selected.expensesTotalInPeriod)} sub={`${fmtNum(selected.expensesCountInPeriod)} عملية`} accent="red" />
            <StatCard label="رصيد القرطاسية" value={`${fmtNum(selected.stationery.stamps)} طابع`} accent="navy" />
          </div>

          <section className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
              <h3 className="font-bold text-[#231F20] text-sm">المهام المنجزة مع المدين</h3>
            </div>
            {selectedTasks.length === 0 ? (
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
            {selectedExpenses.length === 0 ? (
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

          {detailLoading ? (
            <p className="text-center text-sm text-[#767676] py-6">جارٍ تحميل السجلات…</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LawyerWalletHistory title="سجل محفظة الأتعاب" transactions={feeTxs} />
              <LawyerWalletHistory title="سجل محفظة الصرفيات / التوفير" transactions={savingsTxs} />
            </div>
          )}

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
        </div>
      )}

      {exportOpen && selected && (
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
                <h2 id="lawyer-export-modal-title" className="font-bold text-[#231F20] text-lg">
                  تصدير Excel
                </h2>
                <p className="text-sm text-[#767676] mt-0.5 truncate">{selected.lawyer.full_name}</p>
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
            <p className="text-[11px] text-[#767676] -mt-2">
              اترك الفترة فارغة لتصدير السجل الكامل مع كل التواريخ.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-[#231F20]">ماذا تريد تصديره؟</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-[11px] font-bold text-[#2C8780] hover:underline"
                    disabled={exporting}
                    onClick={() => setExportChoice(DEFAULT_EXPORT_CHOICE)}
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-bold text-[#767676] hover:underline"
                    disabled={exporting}
                    onClick={() =>
                      setExportChoice({ tasks: false, fees: false, expenses: false, stationery: false })
                    }
                  >
                    إلغاء الكل
                  </button>
                </div>
              </div>
              {EXPORT_SECTIONS.map(section => {
                const checked = exportChoice[section.key]
                return (
                  <label
                    key={section.key}
                    className={[
                      'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                      checked
                        ? 'border-[#2C8780] bg-[#2C8780]/5'
                        : 'border-[rgba(118,118,118,0.18)] hover:border-[#2C8780]/40',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 w-4 h-4 accent-[#2C8780]"
                      checked={checked}
                      disabled={exporting}
                      onChange={e => setExportChoice(prev => ({ ...prev, [section.key]: e.target.checked }))}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#231F20]">{section.label}</p>
                      <p className="text-[11px] text-[#767676] mt-0.5">{section.hint}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={exporting}
                onClick={() => setExportOpen(false)}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                className="flex-1"
                loading={exporting}
                disabled={
                  !(
                    exportChoice.tasks ||
                    exportChoice.fees ||
                    exportChoice.expenses ||
                    exportChoice.stationery
                  )
                }
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
