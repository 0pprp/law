'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { logActivity } from '@/lib/activity-log'
import { PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { useCaseScope } from '@/hooks/use-case-scope'
import { PremiumSelect } from '@/components/ui/premium-select'
import { CASE_TYPE_FILTER_OPTIONS, normalizeCaseType } from '@/lib/case-type'
import {
  STATIONERY_WALLET_LABEL,
  STATIONERY_ITEM_LABELS,
  type StationeryItem,
  type StationeryBalances,
  type StationeryTxRow,
  fetchStationeryBalancesMap,
  fetchStationeryTransactions,
  depositStationery,
  withdrawStationery,
  stationeryTxLabel,
} from '@/lib/lawyer-stationery-wallet'

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

interface Lawyer { id: string; full_name: string; case_type?: string | null }

function parseQty(raw: string): number | null {
  const n = Math.floor(Number(String(raw).replace(/[^\d]/g, '')))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export default function AdminStationeryWalletPanel({ readOnly = false }: { readOnly?: boolean }) {
  const branchId = useBranchId()
  const { caseTypeFilter: lockedCaseType } = useCaseScope()
  const [filterCaseType, setFilterCaseType] = useState<'' | 'civil' | 'criminal'>(lockedCaseType ?? '')
  const effectiveCaseType = lockedCaseType ?? (filterCaseType || null)
  const [lawyers, setLawyers] = useState<Lawyer[]>([])
  const [balanceMap, setBalanceMap] = useState<Map<string, StationeryBalances>>(new Map())
  const [selectedId, setSelectedId] = useState('')
  const [item, setItem] = useState<StationeryItem>('files')
  const [depositQty, setDepositQty] = useState('')
  const [depositNotes, setDepositNotes] = useState('')
  const [withdrawQty, setWithdrawQty] = useState('')
  const [withdrawNotes, setWithdrawNotes] = useState('')
  const [txs, setTxs] = useState<StationeryTxRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    let q = supabase
      .from('profiles')
      .select('id, full_name, case_type')
      .eq('role', 'lawyer')
      .eq('is_active', true)
      .order('full_name')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    if (effectiveCaseType) q = (q as any).eq('case_type', effectiveCaseType)
    const { data } = await q
    const list = (data ?? []) as Lawyer[]
    setLawyers(list)
    const balances = await fetchStationeryBalancesMap(supabase, list.map(l => l.id))
    setBalanceMap(balances)
    setSelectedId(prev => (prev && list.some(l => l.id === prev) ? prev : list[0]?.id ?? ''))
  }, [branchId, effectiveCaseType])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedId) { setTxs([]); return }
    const supabase = createClient()
    fetchStationeryTransactions(supabase, selectedId, 50).then(setTxs)
  }, [selectedId, saving])

  const selected = lawyers.find(l => l.id === selectedId)
  const balance = balanceMap.get(selectedId) ?? { files: 0, stamps: 0 }
  const selectedCaseType = normalizeCaseType(selected?.case_type)

  async function handleDeposit() {
    if (readOnly) { setError(PERMISSION_DENIED_MSG); return }
    if (saving) return
    const qty = parseQty(depositQty)
    if (!qty || !selectedId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const result = await depositStationery(supabase, {
      lawyerId: selectedId,
      item,
      amount: qty,
      notes: depositNotes.trim() || `إيداع ${STATIONERY_ITEM_LABELS[item]} — محفظة القرطاسية`,
      createdBy: user.id,
      referenceId: crypto.randomUUID(),
    })
    if (!result.ok) { setError(result.error ?? 'فشل الإيداع'); setSaving(false); return }
    await logActivity({
      action: 'lawyer_stationery_deposit',
      entity_type: 'lawyer',
      entity_id: selectedId,
      description: `إيداع ${qty} ${STATIONERY_ITEM_LABELS[item]} — ${selected?.full_name ?? ''}`,
      case_type: selectedCaseType,
    }, supabase)
    setDepositQty(''); setDepositNotes('')
    await load(); setSaving(false)
  }

  async function handleWithdraw() {
    if (readOnly) { setError(PERMISSION_DENIED_MSG); return }
    if (saving) return
    const qty = parseQty(withdrawQty)
    if (!qty || !selectedId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const result = await withdrawStationery(supabase, {
      lawyerId: selectedId,
      item,
      amount: qty,
      notes: withdrawNotes.trim() || `سحب ${STATIONERY_ITEM_LABELS[item]} — محفظة القرطاسية`,
      createdBy: user.id,
      referenceId: crypto.randomUUID(),
    })
    if (!result.ok) { setError(result.error ?? 'فشل السحب'); setSaving(false); return }
    await logActivity({
      action: 'lawyer_stationery_withdraw',
      entity_type: 'lawyer',
      entity_id: selectedId,
      description: `سحب ${qty} ${STATIONERY_ITEM_LABELS[item]} — ${selected?.full_name ?? ''}`,
      case_type: selectedCaseType,
    }, supabase)
    setWithdrawQty(''); setWithdrawNotes('')
    await load(); setSaving(false)
  }

  return (
    <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 space-y-4">
      <div>
        <h2 className="text-sm font-black text-emerald-900">{STATIONERY_WALLET_LABEL}</h2>
        <p className="text-xs text-[#767676] mt-0.5">
          إيداع وسحب الفايلات والطوابع — يُخصم تلقائياً عند الاعتماد النهائي لإقامة دعوى
        </p>
      </div>

      <PremiumSelect
        value={lockedCaseType ?? filterCaseType}
        onChange={v => {
          if (lockedCaseType) return
          setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')
        }}
        options={
          lockedCaseType
            ? CASE_TYPE_FILTER_OPTIONS.filter(o => o.value === lockedCaseType).map(o => ({ value: o.value, label: o.label }))
            : CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))
        }
        placeholder="كل أنواع الدعاوى"
        fieldLabel="نوع الدعوى"
        headerTitle="تصفية المحامين حسب القسم"
        searchable={false}
        disabled={Boolean(lockedCaseType)}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {lawyers.map(l => {
          const b = balanceMap.get(l.id) ?? { files: 0, stamps: 0 }
          return (
            <button key={l.id} type="button" onClick={() => setSelectedId(l.id)}
              className={`text-right rounded-xl p-3 border transition-all ${selectedId === l.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-emerald-300'}`}>
              <p className="text-xs font-bold text-[#231F20] truncate">{l.full_name}</p>
              <p className="text-[10px] text-emerald-700 mt-1">فايلات: {b.files} · طوابع: {b.stamps}</p>
            </button>
          )
        })}
        {!lawyers.length && (
          <p className="text-xs text-[#767676] col-span-full">لا محامين في هذا النطاق</p>
        )}
      </div>

      {selectedId && (
        <div className="space-y-3 border-t border-emerald-100 pt-4">
          <p className="text-sm font-bold text-[#231F20]">
            {selected?.full_name} — فايلات: <span className="text-emerald-700 tabular-nums">{balance.files}</span>
            {' · '}
            طوابع: <span className="text-emerald-700 tabular-nums">{balance.stamps}</span>
          </p>

          {!readOnly && (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => setItem('files')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${item === 'files' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-800 border-emerald-200'}`}>
                  {STATIONERY_ITEM_LABELS.files}
                </button>
                <button type="button" onClick={() => setItem('stamps')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${item === 'stamps' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-800 border-emerald-200'}`}>
                  {STATIONERY_ITEM_LABELS.stamps}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <input value={depositQty} onChange={e => setDepositQty(e.target.value)} className={INP} placeholder={`كمية إيداع ${STATIONERY_ITEM_LABELS[item]}`} inputMode="numeric" />
                  <input value={depositNotes} onChange={e => setDepositNotes(e.target.value)} className={INP} placeholder="ملاحظة" />
                  <button type="button" onClick={() => void handleDeposit()} disabled={saving}
                    className="w-full py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
                    إيداع {STATIONERY_ITEM_LABELS[item]}
                  </button>
                </div>
                <div className="space-y-2">
                  <input value={withdrawQty} onChange={e => setWithdrawQty(e.target.value)} className={INP} placeholder={`كمية سحب ${STATIONERY_ITEM_LABELS[item]}`} inputMode="numeric" />
                  <input value={withdrawNotes} onChange={e => setWithdrawNotes(e.target.value)} className={INP} placeholder="ملاحظة" />
                  <button type="button" onClick={() => void handleWithdraw()} disabled={saving}
                    className="w-full py-2 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                    سحب {STATIONERY_ITEM_LABELS[item]}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="rounded-xl border border-emerald-100 overflow-hidden">
            <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100">
              <p className="text-xs font-bold text-emerald-900">سجل محفظة القرطاسية</p>
            </div>
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {txs.map(tx => (
                <div key={tx.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#231F20] truncate">{stationeryTxLabel(tx)}</p>
                    <p className="text-[10px] text-slate-400 truncate">{tx.notes}</p>
                    <p className="text-[10px] text-slate-400" dir="ltr">{new Date(tx.created_at).toLocaleString('ar-IQ')}</p>
                  </div>
                  <span className={`font-black tabular-nums shrink-0 ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount}
                  </span>
                </div>
              ))}
              {!txs.length && (
                <p className="px-3 py-4 text-xs text-slate-400 text-center">لا حركات بعد</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
