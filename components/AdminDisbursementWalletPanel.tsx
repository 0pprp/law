'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { fmtMoney } from '@/lib/utils'
import { parseMoneyInput, formatMoney } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import {
  fetchLawyerSavingsBalancesMap,
  fetchLawyerWalletTransactions,
  creditLawyerSavingsWallet,
  withdrawLawyerSavings,
} from '@/lib/lawyer-wallet'
import LawyerWalletHistory from '@/components/LawyerWalletHistory'
import { logActivity } from '@/lib/activity-log'
import { PERMISSION_DENIED_MSG } from '@/lib/permissions'

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

interface Lawyer { id: string; full_name: string }

export default function AdminDisbursementWalletPanel({ readOnly = false }: { readOnly?: boolean }) {
  const branchId = useBranchId()
  const [lawyers, setLawyers] = useState<Lawyer[]>([])
  const [balanceMap, setBalanceMap] = useState<Map<string, number>>(new Map())
  const [selectedId, setSelectedId] = useState('')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositNotes, setDepositNotes] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawNotes, setWithdrawNotes] = useState('')
  const [txs, setTxs] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    let q = supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q
    const list = data ?? []
    setLawyers(list)
    const balances = await fetchLawyerSavingsBalancesMap(supabase, list.map(l => l.id))
    setBalanceMap(balances)
    setSelectedId(prev => (prev && list.some(l => l.id === prev) ? prev : list[0]?.id ?? ''))
  }, [branchId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedId) { setTxs([]); return }
    const supabase = createClient()
    fetchLawyerWalletTransactions(supabase, selectedId, 50, 'savings').then(setTxs)
  }, [selectedId, saving])

  const selected = lawyers.find(l => l.id === selectedId)
  const balance = balanceMap.get(selectedId) ?? 0

  async function handleDeposit() {
    if (readOnly) { setError(PERMISSION_DENIED_MSG); return }
    const amt = parseMoneyInput(depositAmount)
    if (!amt || amt <= 0 || !selectedId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const result = await creditLawyerSavingsWallet(supabase, {
      lawyerId: selectedId,
      amount: amt,
      notes: depositNotes.trim() || 'إيداع يدوي — محفظة الصرفيات',
      createdBy: user.id,
    })
    if (!result.ok) { setError(result.error ?? 'فشل الإيداع'); setSaving(false); return }
    await logActivity({
      action: 'lawyer_wallet_deposit',
      entity_type: 'lawyer',
      entity_id: selectedId,
      description: `إيداع صرفيات ${formatMoney(amt)} — ${selected?.full_name ?? ''}`,
    }, supabase)
    setDepositAmount(''); setDepositNotes('')
    await load(); setSaving(false)
  }

  async function handleWithdraw() {
    if (readOnly) { setError(PERMISSION_DENIED_MSG); return }
    const amt = parseMoneyInput(withdrawAmount)
    if (!amt || amt <= 0 || !selectedId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const result = await withdrawLawyerSavings(supabase, {
      lawyerId: selectedId,
      amount: amt,
      notes: withdrawNotes.trim() || 'سحب يدوي — محفظة الصرفيات',
      createdBy: user.id,
    })
    if (!result.ok) { setError(result.error ?? 'فشل السحب'); setSaving(false); return }
    await logActivity({
      action: 'lawyer_savings_withdraw',
      entity_type: 'lawyer',
      entity_id: selectedId,
      description: `سحب صرفيات ${formatMoney(amt)} — ${selected?.full_name ?? ''}`,
    }, supabase)
    setWithdrawAmount(''); setWithdrawNotes('')
    await load(); setSaving(false)
  }

  return (
    <div className="bg-white rounded-xl border border-sky-200 shadow-sm p-5 space-y-4">
      <div>
        <h2 className="text-sm font-black text-sky-900">محفظة صرفيات المحامين</h2>
        <p className="text-xs text-[#767676] mt-0.5">إيداع وسحب يدوي — تُخصم الصرفيات عند اعتماد الإنجاز</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {lawyers.map(l => (
          <button key={l.id} type="button" onClick={() => setSelectedId(l.id)}
            className={`text-right rounded-xl p-3 border transition-all ${selectedId === l.id ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200' : 'border-slate-200 hover:border-sky-300'}`}>
            <p className="text-xs font-bold text-[#231F20] truncate">{l.full_name}</p>
            <p className="text-sm font-black text-sky-600 tabular-nums mt-1" dir="ltr">{fmtMoney(balanceMap.get(l.id) ?? 0)}</p>
          </button>
        ))}
        {!lawyers.length && <p className="text-sm text-[#767676] col-span-full">لا يوجد محامون</p>}
      </div>

      {selectedId && selected && (
        <>
          <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-sky-900">{selected.full_name}</span>
            <span className="text-lg font-black text-sky-700 tabular-nums" dir="ltr">{fmtMoney(balance)}</span>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          {!readOnly && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-emerald-800">إيداع يدوي</p>
              <MoneyInput value={depositAmount} onChange={v => setDepositAmount(v)} placeholder="المبلغ" className={INP} />
              <input type="text" value={depositNotes} onChange={e => setDepositNotes(e.target.value)} placeholder="ملاحظة" className={INP} />
              <button onClick={handleDeposit} disabled={saving || !depositAmount}
                className="w-full py-2 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
                {saving ? '...' : 'حفظ الإيداع'}
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-orange-800">سحب يدوي</p>
              <MoneyInput value={withdrawAmount} onChange={v => setWithdrawAmount(v)} placeholder="المبلغ" className={INP} />
              <input type="text" value={withdrawNotes} onChange={e => setWithdrawNotes(e.target.value)} placeholder="ملاحظة" className={INP} />
              <button onClick={handleWithdraw} disabled={saving || !withdrawAmount || balance <= 0}
                className="w-full py-2 rounded-lg text-sm font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50">
                {saving ? '...' : 'حفظ السحب'}
              </button>
            </div>
          </div>
          )}

          <LawyerWalletHistory title="سجل حركات محفظة الصرفيات" transactions={txs} />
        </>
      )}
    </div>
  )
}
