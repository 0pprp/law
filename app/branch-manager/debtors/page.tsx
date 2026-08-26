'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { appAlert } from '@/lib/app-dialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { CASE_TYPE_LABELS } from '@/lib/case-type'

type DebtorRow = {
  id: string
  full_name: string
  phone: string | null
  required_amount: number | null
  remaining_amount: number | null
  created_at: string
  case_type: 'civil' | 'criminal' | null
  branch_list?: { name: string } | null
}

export default function BranchManagerDebtorsPage() {
  const [rows, setRows] = useState<DebtorRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (search?: string) => {
    const term = search ?? q
    setLoading(true)
    try {
      const url = term.trim()
        ? `/api/branch-manager/debtors?q=${encodeURIComponent(term.trim())}`
        : '/api/branch-manager/debtors'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        await appAlert(data.error ?? 'فشل تحميل المدينين')
        setRows([])
        return
      }
      setRows((data.debtors ?? []) as DebtorRow[])
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- أولي فقط
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="مدينو الفرع"
        subtitle="عرض أسماء فرعك والبحث بالاسم أو الهاتف"
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void load(q) }}
          placeholder="بحث بالاسم أو الهاتف…"
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#b45309]/25"
        />
        <Button type="button" onClick={() => void load(q)} disabled={loading}>
          بحث
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">جاري التحميل…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          لا توجد نتائج
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
          <table className="w-full min-w-max text-sm" dir="rtl">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs">
                <th className="text-right px-4 py-3 font-bold">الاسم</th>
                <th className="text-right px-4 py-3 font-bold">الهاتف</th>
                <th className="text-right px-4 py-3 font-bold">القائمة</th>
                <th className="text-right px-4 py-3 font-bold">النوع</th>
                <th className="text-right px-4 py-3 font-bold">المطلوب</th>
                <th className="text-right px-4 py-3 font-bold">تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(d => (
                <tr key={d.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-semibold text-[#231F20]">
                    <Link
                      href={`/branch-manager/debtors/${d.id}`}
                      className="hover:text-[#b45309] hover:underline"
                    >
                      {d.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums" dir="ltr">{d.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {(d.branch_list as { name?: string } | null)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {d.case_type ? CASE_TYPE_LABELS[d.case_type] : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium" dir="ltr">
                    {Number(d.required_amount ?? 0).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
