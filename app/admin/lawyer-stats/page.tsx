'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { fmtDate, fmtMoney, fmtNum } from '@/lib/utils'
import {
  buildLawyerStatsSummaries,
  fetchLawyerDetailLogs,
  fetchLawyerExpensesForStats,
  fetchLawyerCompletedTasks,
  type LawyerStatsSummary,
} from '@/lib/admin-lawyer-stats'
import {
  safeExcelName,
  lawyerTypeLabel,
  caseTypeLabel,
  lawyerInitials,
  walletTxRows,
  sheetOrEmpty,
  taskSheetRows,
  expenseSheetRows,
  stationerySheetRows,
} from '@/lib/lawyer-stats-excel'

export default function LawyerStatsPage() {
  const branchId = useBranchId()
  const role = useAdminRole()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summaries, setSummaries] = useState<LawyerStatsSummary[]>([])
  const [exporting, setExporting] = useState(false)

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

  async function exportAllExcel() {
    if (!summaries.length || exporting) return
    setExporting(true)
    setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const from = dateFrom || undefined
      const to = dateTo || undefined
      const dateOpts = { dateFrom: from, dateTo: to, limit: 5000 }
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
            ...taskSheetRows([t], role)[0],
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

      XLSX.utils.book_append_sheet(wb, sheetOrEmpty(XLSX, allFeeRows, 'لا حركات أتعاب ضمن الفترة'), safeExcelName('سجل الأتعاب'))
      XLSX.utils.book_append_sheet(wb, sheetOrEmpty(XLSX, allSavingsRows, 'لا حركات محفظة صرفيات ضمن الفترة'), safeExcelName('محفظة الصرفيات'))
      XLSX.utils.book_append_sheet(wb, sheetOrEmpty(XLSX, allStationeryRows, 'لا حركات قرطاسية ضمن الفترة'), safeExcelName('سجل القرطاسية'))

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
        subtitle="اضغط على المحامي لفتح مهامه المكلّف بها وسجلاته — إنجاز، أتعاب، صرفيات، وقرطاسية"
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
            const section = caseTypeLabel(s.lawyer.case_type)
            return (
              <Link
                key={s.lawyer.id}
                href={`/admin/lawyer-stats/${s.lawyer.id}`}
                className="text-right rounded-2xl border border-[rgba(118,118,118,0.15)] bg-white p-4 sm:p-5 shadow-sm transition-all hover:border-[#2C8780]/40 hover:shadow-md"
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
                <p className="text-[11px] font-bold text-[#2C8780] mt-3">فتح المهام والسجلات ←</p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
