'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import {
  fetchBranchClosedDebtorsPaginated,
  fetchLastTaskLabelsForDebtors,
  fetchPaymentTotalsForDebtors,
  CLOSED_CASES_PAGE_SIZE,
} from '@/lib/fetch-closed-debtors'
import { fmtMoney, fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import { PremiumSelect } from '@/components/ui/premium-select'
import { CASE_TYPE_FILTER_OPTIONS, CASE_TYPE_LABELS, type CaseType } from '@/lib/case-type'

interface ClosedCase {
  id: string
  full_name: string
  phone: string | null
  receipt_number: string | null
  required_amount: number
  closed_at: string | null
  branch_name: string
  total_paid: number
  last_task_label: string | null
  case_type: 'civil' | 'criminal'
}

export default function ClosedCasesPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const [cases, setCases] = useState<ClosedCase[]>([])
  const [total, setTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterCaseType, setFilterCaseType] = useState<'' | CaseType>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadError, setLoadError] = useState('')

  const loadPage = useCallback(async (append = false, offset = 0) => {
    if (!branchId && !viewAllBranches) {
      setLoading(false)
      return
    }

    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setLoadError('')
    }

    const supabase = createClient()
    const debtorIds = debouncedSearch.trim()
      ? await resolveDebtorIdsBySearch(supabase, debouncedSearch, branchId)
      : null

    if (debtorIds && !debtorIds.length) {
      setCases([])
      setTotal(0)
      setPageOffset(0)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    const { rows: debtors, total: count, error } = await fetchBranchClosedDebtorsPaginated(
      supabase,
      branchId,
      { offset, limit: CLOSED_CASES_PAGE_SIZE, debtorIds, caseType: filterCaseType || null },
    )

    if (error) {
      setLoadError(error)
      if (!append) setCases([])
      setLoading(false)
      setLoadingMore(false)
      return
    }

    if (debtors.length === 0) {
      if (!append) setCases([])
      setTotal(count)
      setPageOffset(0)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    const debtorIdsPage = debtors.map(d => d.id)
    const branchIds = [...new Set(debtors.map(d => d.branch_id).filter(Boolean))] as string[]

    const [{ data: branches }, paidMap, lastTaskLabels] = await Promise.all([
      branchIds.length > 0
        ? supabase.from('branches').select('id, name').in('id', branchIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      fetchPaymentTotalsForDebtors(supabase, branchId, debtorIdsPage),
      fetchLastTaskLabelsForDebtors(supabase, debtors),
    ])

    const branchMap = new Map((branches ?? []).map(b => [b.id, b.name]))
    const pageCases: ClosedCase[] = debtors.map(d => ({
      id: d.id,
      full_name: d.full_name,
      phone: d.phone,
      receipt_number: d.receipt_number,
      required_amount: d.required_amount,
      closed_at: d.closed_at,
      branch_name: (d.branch_id && branchMap.get(d.branch_id)) || '—',
      total_paid: paidMap.get(d.id) ?? 0,
      last_task_label: lastTaskLabels.get(d.id) ?? null,
      case_type: d.case_type,
    }))

    setCases(prev => (append ? [...prev, ...pageCases] : pageCases))
    setTotal(count)
    setPageOffset(offset + pageCases.length)
    setLoading(false)
    setLoadingMore(false)
  }, [branchId, viewAllBranches, debouncedSearch, filterCaseType])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    setPageOffset(0)
    loadPage(false, 0)
  }, [loadPage])

  const hasMore = cases.length < total

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">القضايا المحسومة</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total} قضية محسومة — المدينون الذين أُغلقت قضاياهم بعد اعتماد الإنجاز
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <div className="w-full sm:w-52">
            <PremiumSelect
              value={filterCaseType}
              onChange={v => setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')}
              options={CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              placeholder="كل أنواع الدعاوى"
              searchable={false}
            />
          </div>
          <input
            type="search"
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm w-full sm:w-64"
          />
        </div>
      </div>

      {loadError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">جاري التحميل...</div>
      ) : cases.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-100">
          لا توجد قضايا محسومة
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-slate-600">المدين</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">نوع الدعوى</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">الهاتف</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">الفرع</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">آخر مهمة منفذة</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">تاريخ الحسم</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">المبلغ المطلوب</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">مجموع التسديدات</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {cases.map(c => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.full_name}</td>
                  <td className="px-4 py-3 text-slate-600">{CASE_TYPE_LABELS[c.case_type]}</td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs" dir="ltr">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.branch_name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.last_task_label ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.closed_at ? fmtDate(c.closed_at) : '—'}</td>
                  <td className="px-4 py-3 text-slate-900">{fmtMoney(c.required_amount)}</td>
                  <td className="px-4 py-3 text-emerald-600">{fmtMoney(c.total_paid)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/debtors/${c.id}/account`}
                      className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                    >
                      كشف الحساب
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="p-4 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={() => loadPage(true, pageOffset)}
                disabled={loadingMore}
                className="text-sm font-semibold text-[#2C8780] hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'جارٍ التحميل...' : `تحميل المزيد (${cases.length} / ${total})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
