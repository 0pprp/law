'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import {
  fetchBranchClosedDebtors,
  fetchLastTaskLabelsForDebtors,
} from '@/lib/fetch-closed-debtors'
import { fmtMoney, fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'

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
}

export default function ClosedCasesPage() {
  const branchId = useBranchId()
  const [cases, setCases] = useState<ClosedCase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [matchingIds, setMatchingIds] = useState<string[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!branchId) {
      setLoading(false)
      return
    }

    const supabase = createClient()

    async function load() {
      setLoading(true)
      setLoadError('')

      const { rows: debtors, error } = await fetchBranchClosedDebtors(supabase, branchId!)
      if (error) {
        setLoadError(error)
        setCases([])
        setLoading(false)
        return
      }

      if (debtors.length === 0) {
        setCases([])
        setLoading(false)
        return
      }

      const debtorIds = debtors.map(d => d.id)
      const branchIds = [...new Set(debtors.map(d => d.branch_id).filter(Boolean))] as string[]

      const [{ data: branches }, { data: payments }, lastTaskLabels] = await Promise.all([
        branchIds.length > 0
          ? supabase.from('branches').select('id, name').in('id', branchIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        supabase.from('debtor_payments').select('debtor_id, amount').in('debtor_id', debtorIds),
        fetchLastTaskLabelsForDebtors(supabase, debtors),
      ])

      const branchMap = new Map((branches ?? []).map(b => [b.id, b.name]))
      const paidMap = new Map<string, number>()
      ;(payments ?? []).forEach(p => {
        paidMap.set(p.debtor_id, (paidMap.get(p.debtor_id) ?? 0) + Number(p.amount))
      })

      setCases(
        debtors.map(d => ({
          id: d.id,
          full_name: d.full_name,
          phone: d.phone,
          receipt_number: d.receipt_number,
          required_amount: d.required_amount,
          closed_at: d.closed_at,
          branch_name: (d.branch_id && branchMap.get(d.branch_id)) || '—',
          total_paid: paidMap.get(d.id) ?? 0,
          last_task_label: lastTaskLabels.get(d.id) ?? null,
        }))
      )
      setLoading(false)
    }

    load()
  }, [branchId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setMatchingIds(null)
      return
    }
    let cancelled = false
    resolveDebtorIdsBySearch(createClient(), debouncedSearch, branchId).then(ids => {
      if (!cancelled) setMatchingIds(ids ?? [])
    })
    return () => { cancelled = true }
  }, [debouncedSearch, branchId])

  const filtered = cases.filter(c => {
    if (matchingIds !== null) return matchingIds.includes(c.id)
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">القضايا المحسومة</h1>
          <p className="text-sm text-slate-500 mt-1">المدينون الذين أُغلقت قضاياهم بعد اعتماد الإنجاز</p>
        </div>
        <input
          type="search"
          placeholder={DEBTOR_SEARCH_PLACEHOLDER}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-4 py-2 border border-slate-200 rounded-lg text-sm w-full sm:w-64"
        />
      </div>

      {loadError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-100">
          لا توجد قضايا محسومة
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-slate-600">المدين</th>
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
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.full_name}</td>
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
        </div>
      )}
    </div>
  )
}
