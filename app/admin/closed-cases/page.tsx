'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useBranchId } from '@/context/branch'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'

interface ClosedCase {
  id: string
  full_name: string
  receipt_number: string | null
  branch_name: string | null
  receipt_amount: number
  remaining_amount: number
  required_amount: number
  total_payments: number
  closed_at: string | null
  lastTask: string | null
}

function Spin() {
  return (
    <div className="flex items-center justify-center gap-2 py-16">
      <svg className="w-5 h-5 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-[#767676]">جارٍ التحميل...</span>
    </div>
  )
}

export default function ClosedCasesPage() {
  const branchId = useBranchId()
  const [cases, setCases] = useState<ClosedCase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let q = supabase
      .from('debtors')
      .select(`
        id, full_name, receipt_number, receipt_amount, remaining_amount,
        required_amount, closed_at, lawyer_fees,
        branches(name),
        debtor_payments(amount)
      `)
      .eq('case_status', 'closed')
      .order('closed_at', { ascending: false })

    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q

    // Get last task for each debtor
    const debtorIds = (data ?? []).map((d: any) => d.id)
    let lastTaskMap: Record<string, string> = {}
    if (debtorIds.length > 0) {
      const { data: lastTasks } = await supabase
        .from('tasks')
        .select('debtor_id, task_definitions(label)')
        .in('debtor_id', debtorIds)
        .eq('task_status', 'approved')
        .order('created_at', { ascending: false })
      ;(lastTasks ?? []).forEach((t: any) => {
        if (!lastTaskMap[t.debtor_id]) {
          lastTaskMap[t.debtor_id] = t.task_definitions?.label ?? '—'
        }
      })
    }

    const mapped: ClosedCase[] = (data ?? []).map((d: any) => {
      const payments = (d.debtor_payments ?? []) as { amount: number }[]
      const totalPayments = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
      return {
        id: d.id,
        full_name: d.full_name,
        receipt_number: d.receipt_number,
        branch_name: (d.branches as any)?.name ?? null,
        receipt_amount: Number(d.receipt_amount),
        remaining_amount: Number(d.remaining_amount),
        required_amount: Number(d.required_amount),
        total_payments: totalPayments,
        closed_at: d.closed_at,
        lastTask: lastTaskMap[d.id] ?? null,
      }
    })

    setCases(mapped)
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  const filtered = search
    ? cases.filter(c =>
        c.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.receipt_number ?? '').includes(search)
      )
    : cases

  const totalReceiptAmount = filtered.reduce((s, c) => s + c.receipt_amount, 0)
  const totalPayments = filtered.reduce((s, c) => s + c.total_payments, 0)
  const collectionRate = totalReceiptAmount > 0 ? Math.round((totalPayments / totalReceiptAmount) * 100) : 0

  return (
    <div className="space-y-5 max-w-5xl" dir="rtl">
      <PageHeader
        title="القضايا المحسومة"
        subtitle={`${filtered.length} قضية مؤرشفة`}
        breadcrumb={[{ label: 'لوحة التحكم', href: '/admin/dashboard' }, { label: 'القضايا المحسومة' }]}
      />

      {/* Summary cards */}
      {!loading && cases.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="إجمالي القضايا" value={cases.length} accent="navy" />
          <StatCard label="إجمالي مبالغ الصكوك" value={fmtMoney(totalReceiptAmount)} accent="teal" valueColor="text-[#2C8780]" />
          <StatCard label="إجمالي التسديدات" value={fmtMoney(totalPayments)} accent="green" valueColor="text-emerald-700" />
          <StatCard
            label="نسبة التحصيل"
            value={`${collectionRate}%`}
            footer={
              <div className="h-1.5 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
                <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.min(collectionRate, 100)}%` }} />
              </div>
            }
          />
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm px-4 py-2.5 flex items-center gap-3">
        <svg className="w-4 h-4 text-[#767676] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم المدين أو رقم الصك..."
          className="flex-1 text-sm text-[#231F20] bg-transparent focus:outline-none placeholder:text-[#767676]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-[#767676] hover:text-[#231F20] text-lg leading-none">×</button>
        )}
      </div>

      {/* Table */}
      {loading ? <Spin /> : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] p-16 text-center">
          <div className="w-14 h-14 bg-[#F3F1F2] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#767676]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-[#231F20]">
            {search ? 'لا توجد نتائج مطابقة' : 'لا توجد قضايا محسومة بعد'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">المدين</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">رقم الصك</th>
                  {!branchId && <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">الفرع</th>}
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">مبلغ الصك</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">إجمالي التسديدات</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">نسبة التحصيل</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">آخر مهمة</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-[#767676]">تاريخ الإغلاق</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(118,118,118,0.07)]">
                {filtered.map(c => {
                  const rate = c.receipt_amount > 0 ? Math.round((c.total_payments / c.receipt_amount) * 100) : 0
                  const fullyClosed = rate >= 100
                  return (
                    <tr key={c.id} className="hover:bg-[#F8F7F8] transition-colors">
                      <td className="px-4 py-3.5 font-semibold text-[#231F20]">{c.full_name}</td>
                      <td className="px-4 py-3.5 text-[#767676] font-mono text-xs" dir="ltr">{c.receipt_number ?? '—'}</td>
                      {!branchId && <td className="px-4 py-3.5 text-[#767676] text-xs">{c.branch_name ?? '—'}</td>}
                      <td className="px-4 py-3.5 text-[#231F20] font-semibold tabular-nums" dir="ltr">{fmtMoney(c.receipt_amount)}</td>
                      <td className="px-4 py-3.5 text-emerald-700 font-bold tabular-nums" dir="ltr">{fmtMoney(c.total_payments)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${fullyClosed ? 'bg-emerald-500' : 'bg-amber-400'}`}
                              style={{ width: `${Math.min(rate, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-bold ${fullyClosed ? 'text-emerald-700' : 'text-amber-700'}`}>{rate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-[#767676] text-xs">{c.lastTask ?? '—'}</td>
                      <td className="px-4 py-3.5 text-[#767676] text-xs tabular-nums" dir="ltr">
                        {c.closed_at ? fmtDate(c.closed_at.split('T')[0]) : '—'}
                      </td>
                      <td className="px-4 py-3.5">
                        <Link href={`/admin/debtors/${c.id}`}
                          className="text-xs font-semibold text-[#2C8780] hover:underline whitespace-nowrap">
                          عرض الملف
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
