'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canManageDelegates, isAdmin } from '@/lib/permissions'
import { fetchDelegateWallet } from '@/lib/delegate-wallet'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PremiumSelect } from '@/components/ui/premium-select'
import MoneyInput from '@/components/ui/money-input'
import { parseMoneyInput } from '@/lib/money-input'
import { fmtMoney } from '@/lib/utils'

interface DelegateWalletRow {
  id: string
  full_name: string
  username: string | null
  pending_balance: number
  available_balance: number
  total_withdrawn: number
}

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]'

export default function DelegateWalletsPage() {
  const router = useRouter()
  const branchId = useBranchId()
  const role = useAdminRole()
  const canView = canManageDelegates(role)
  const canWithdraw = isAdmin(role)

  const [rows, setRows] = useState<DelegateWalletRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    const supabase = createClient()
    let q = supabase
      .from('profiles')
      .select('id, full_name, username, branch_id')
      .eq('role', 'delegate')
      .order('full_name')
    if (branchId) q = q.eq('branch_id', branchId)

    const { data } = await q
    const list = await Promise.all(
      (data ?? []).map(async d => {
        const w = await fetchDelegateWallet(supabase, d.id)
        return {
          id: d.id,
          full_name: d.full_name,
          username: d.username,
          pending_balance: w.pending_balance,
          available_balance: w.available_balance,
          total_withdrawn: w.total_withdrawn,
        }
      }),
    )
    setRows(list)
    setLoading(false)
  }, [branchId, canView])

  useEffect(() => {
    if (!canView) {
      router.replace('/admin/dashboard')
      return
    }
    load()
  }, [canView, load, router])

  const selected = rows.find(r => r.id === selectedId)

  async function handleWithdraw(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!canWithdraw) return
    setError('')
    setSuccess('')
    if (!selectedId) {
      setError('اختر مندوباً')
      return
    }
    const value = parseMoneyInput(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('أدخل مبلغاً صالحاً')
      return
    }
    setSaving(true)
    const res = await fetch('/api/admin/delegate-withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegateId: selectedId,
        amount: value,
        notes: notes.trim() || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'فشل السحب')
      setSaving(false)
      return
    }
    setSuccess('تم السحب بنجاح')
    setAmount('')
    setNotes('')
    setSaving(false)
    await load()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="محافظ المندوبين"
        subtitle={`${rows.length} مندوب`}
        breadcrumb={[
          { label: 'المندوبون', href: '/admin/delegates' },
          { label: 'المحافظ' },
        ]}
        actions={
          <Link href="/admin/delegates/report">
            <Button variant="outline" size="sm">تقرير الأتعاب</Button>
          </Link>
        }
      />

      {canWithdraw && (
        <form
          onSubmit={handleWithdraw}
          className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] p-4 space-y-3 shadow-sm"
        >
          <h2 className="font-bold text-[#231F20] text-sm">سحب من الرصيد القابل للصرف</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <PremiumSelect
              value={selectedId}
              onChange={v => { setSelectedId(v); setError(''); setSuccess('') }}
              options={[
                { value: '', label: '— اختر مندوباً —' },
                ...rows.map(r => ({
                  value: r.id,
                  label: r.full_name,
                  hint: fmtMoney(r.available_balance),
                })),
              ]}
              placeholder="— اختر مندوباً —"
              fieldLabel="المندوب"
              headerTitle="اختر المندوب"
              searchPlaceholder="بحث..."
            />
            <MoneyInput
              value={amount}
              onChange={v => setAmount(v)}
              placeholder="المبلغ"
              className={INP}
            />
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="ملاحظات (اختياري)"
              className={INP}
            />
            <Button type="submit" variant="primary" loading={saving} disabled={!selectedId}>
              سحب
            </Button>
          </div>
          {selected && (
            <p className="text-xs text-[#767676]">
              الرصيد القابل للصرف:{' '}
              <span className="font-bold text-[#2C8780]" dir="ltr">{fmtMoney(selected.available_balance)}</span>
            </p>
          )}
        </form>
      )}

      {!canWithdraw && (
        <p className="text-xs text-[#767676] bg-[#F3F1F2] rounded-lg px-3 py-2">
          عرض المحافظ فقط — السحب متاح للمدير.
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">{success}</div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
        ) : !rows.length ? (
          <EmptyState title="لا توجد محافظ" description="أضف مندوباً أولاً" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المندوب</TH>
                <TH>معلق</TH>
                <TH>قابل للصرف</TH>
                <TH>مصروف</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map(r => (
                <TR key={r.id}>
                  <TD>
                    <div>
                      <p className="font-semibold text-[#231F20]">{r.full_name}</p>
                      {r.username && (
                        <p className="text-[11px] text-[#767676] font-mono" dir="ltr">{r.username}</p>
                      )}
                    </div>
                  </TD>
                  <TD><span className="text-xs font-bold tabular-nums" dir="ltr">{fmtMoney(r.pending_balance)}</span></TD>
                  <TD><span className="text-xs font-bold text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(r.available_balance)}</span></TD>
                  <TD><span className="text-xs font-bold text-[#767676] tabular-nums" dir="ltr">{fmtMoney(r.total_withdrawn)}</span></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}
