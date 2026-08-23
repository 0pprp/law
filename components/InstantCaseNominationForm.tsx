'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PremiumSelect } from '@/components/ui/premium-select'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { fmtDate } from '@/lib/utils'

type BranchListOpt = { value: string; label: string }

type PendingNom = {
  id: string
  debtor_name: string
  sale_price: number
  created_at: string
  branch_list?: { name: string } | null
}

const INP =
  'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

export default function InstantCaseNominationForm({
  branchId,
  governorateLabel,
}: {
  branchId: string
  governorateLabel: string
}) {
  const [lists, setLists] = useState<BranchListOpt[]>([])
  const [debtorName, setDebtorName] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [listId, setListId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pending, setPending] = useState<PendingNom[]>([])

  const loadLists = useCallback(async () => {
    if (!branchId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('branch_lists')
      .select('id, name')
      .eq('branch_id', branchId)
      .order('name')
    setLists((data ?? []).map(r => ({ value: r.id, label: r.name })))
  }, [branchId])

  const loadPending = useCallback(async () => {
    const res = await fetch('/api/nominations')
    if (!res.ok) return
    const data = await res.json()
    setPending((data.nominations ?? []) as PendingNom[])
  }, [])

  useEffect(() => {
    void loadLists()
    void loadPending()
  }, [loadLists, loadPending])

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault()
    setError('')
    setSuccess('')
    const name = debtorName.trim()
    const price = Number(salePrice)
    if (!name) {
      setError('اسم المدين مطلوب')
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError('أدخل سعر بيع صالحاً')
      return
    }
    if (!listId) {
      setError('اختر القائمة')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/nominations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtor_name: name,
          sale_price: price,
          branch_list_id: listId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'فشل الإرسال')
        return
      }
      setSuccess('تم إرسال الترشيح بانتظار موافقة مدير الفرع')
      setDebtorName('')
      setSalePrice('')
      setListId('')
      await loadPending()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-xl">
      <Card>
        <CardHeader title="ترشيح اسم — دعوى فورية" />
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          )}
          {success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              اسم المدين <span className="text-red-500">*</span>
            </label>
            <input
              className={INP}
              value={debtorName}
              onChange={e => setDebtorName(e.target.value)}
              placeholder="الاسم الثلاثي"
              disabled={saving}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              سعر البيع <span className="text-red-500">*</span>
            </label>
            <input
              className={INP}
              type="number"
              min="1"
              step="1"
              value={salePrice}
              onChange={e => setSalePrice(e.target.value)}
              placeholder="المبلغ"
              disabled={saving}
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              القائمة <span className="text-red-500">*</span>
            </label>
            <PremiumSelect
              value={listId}
              onChange={setListId}
              options={lists}
              placeholder={lists.length ? 'اختر القائمة' : 'لا توجد قوائم'}
              disabled={saving || !lists.length}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">المحافظة</label>
            <input className={`${INP} bg-slate-50 text-slate-600`} value={governorateLabel} readOnly />
            <p className="text-xs text-slate-400 mt-1">تُؤخذ تلقائياً من حسابك / فرعك</p>
          </div>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'جاري الإرسال…' : 'إرسال الترشيح'}
          </Button>
        </form>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader title="طلباتي المعلّقة" />
          <ul className="divide-y divide-slate-100">
            {pending.map(n => (
              <li key={n.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-bold text-[#231F20] truncate">{n.debtor_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {(n.branch_list as { name?: string } | null)?.name ?? '—'}
                    {' · '}
                    {fmtDate(n.created_at)}
                  </p>
                </div>
                <span className="tabular-nums font-bold text-[#2C8780] shrink-0" dir="ltr">
                  {Number(n.sale_price).toLocaleString('en-US')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
