'use client'

import { useCallback, useEffect, useState } from 'react'
import { fmtDate } from '@/lib/utils'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'

type Nom = {
  id: string
  debtor_name: string
  sale_price: number
  governorate: string | null
  created_at: string
  nominator_role: string
  branch_list?: { name: string } | null
  nominator?: { full_name: string } | null
}

export default function BranchManagerNominationsPage() {
  const [rows, setRows] = useState<Nom[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (search?: string) => {
    const term = search ?? q
    setLoading(true)
    try {
      const url = term.trim()
        ? `/api/branch-manager/nominations?q=${encodeURIComponent(term.trim())}`
        : '/api/branch-manager/nominations'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        await appAlert(data.error ?? 'فشل تحميل الطلبات')
        setRows([])
        return
      }
      setRows((data.nominations ?? []) as Nom[])
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- أولي فقط
  }, [])

  async function approve(id: string) {
    const ok = await appConfirm('الموافقة على الترشيح وإنشاء ملف المدين؟')
    if (!ok) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/branch-manager/nominations/${id}/approve`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        await appAlert(data.error ?? 'فشلت الموافقة')
        return
      }
      setRows(prev => prev.filter(r => r.id !== id))
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    const ok = await appConfirm('رفض الترشيح وحذفه نهائياً؟ لا يمكن التراجع.')
    if (!ok) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/branch-manager/nominations/${id}/reject`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        await appAlert(data.error ?? 'فشل الرفض')
        return
      }
      setRows(prev => prev.filter(r => r.id !== id))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="طلبات الترشيح"
        subtitle="موافقة أو رفض ترشيحات الدعاوى الفورية لفرعك"
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void load(q) }}
          placeholder="بحث بالاسم…"
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
          لا توجد طلبات معلّقة
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <ul className="divide-y divide-slate-100">
            {rows.map(n => (
              <li key={n.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[#231F20] text-base">{n.debtor_name}</p>
                  <p className="text-xs text-slate-500 mt-1 space-x-reverse space-x-2">
                    <span>{(n.branch_list as { name?: string } | null)?.name ?? '—'}</span>
                    <span>·</span>
                    <span>{n.governorate ?? '—'}</span>
                    <span>·</span>
                    <span>
                      {(n.nominator as { full_name?: string } | null)?.full_name
                        ?? (n.nominator_role === 'delegate' ? 'مندوب' : 'محاسب')}
                    </span>
                    <span>·</span>
                    <span>{fmtDate(n.created_at)}</span>
                  </p>
                  <p className="text-sm font-bold text-[#b45309] mt-1 tabular-nums" dir="ltr">
                    {Number(n.sale_price).toLocaleString('en-US')}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === n.id}
                    onClick={() => void approve(n.id)}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                  >
                    موافقة
                  </button>
                  <button
                    type="button"
                    disabled={busyId === n.id}
                    onClick={() => void reject(n.id)}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    رفض
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
