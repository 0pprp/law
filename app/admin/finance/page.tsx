'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { RECEIPT_STATUS_LABELS, WALLET_TRANSACTION_LABELS } from '@/lib/types'
import type { ReceiptStatus, WalletTransactionType } from '@/lib/types'
import {
  fetchLawyerBalancesMap,
  fetchLawyerWalletBalance,
  fetchLawyerWalletTransactions,
  payoutLawyerFees,
  creditLawyerWallet,
  type LawyerWalletRow,
} from '@/lib/lawyer-wallet'
import {
  fetchBranchPayoutRequests,
  type LawyerPayoutRequest,
} from '@/lib/lawyer-payout-requests'
import { logActivity } from '@/lib/activity-log'
import { refreshAdminNotifications } from '@/lib/admin-notifications'
import { PageHeader } from '@/components/ui/page-header'

interface Lawyer {
  id: string
  full_name: string
  username: string | null
  phone: string | null
}

interface Receipt {
  id: string
  task_id: string
  lawyer_id: string
  amount: number
  status: ReceiptStatus
  notes: string | null
  review_notes: string | null
  reviewed_at: string | null
  created_at: string
  lawyer: { full_name: string } | null
  task: { task_type: string; debtors: { full_name: string } | null } | null
}

type UnifiedRequest =
  | { kind: 'payout'; data: LawyerPayoutRequest }
  | { kind: 'task'; data: Receipt }

const STATUS_COLORS: Record<ReceiptStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-teal-100 text-teal-800',
  rejected: 'bg-red-100 text-red-800',
}

const INP = 'w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]'

function unifiedStatus(item: UnifiedRequest): ReceiptStatus {
  return item.kind === 'payout' ? item.data.status : item.data.status
}

function unifiedAmount(item: UnifiedRequest): number {
  return Number(item.kind === 'payout' ? item.data.amount : item.data.amount)
}

function unifiedDate(item: UnifiedRequest): string {
  return item.kind === 'payout' ? item.data.created_at : item.data.created_at
}

export default function FinancePage() {
  const branchId = useBranchId()
  const [lawyers, setLawyers] = useState<Lawyer[]>([])
  const [balanceMap, setBalanceMap] = useState<Map<string, number>>(new Map())
  const [selectedId, setSelectedId] = useState('')
  const [branchReceipts, setBranchReceipts] = useState<Receipt[]>([])
  const [walletTxs, setWalletTxs] = useState<LawyerWalletRow[]>([])
  const [loading, setLoading] = useState(true)
  const [transferAmount, setTransferAmount] = useState('')
  const [transferNotes, setTransferNotes] = useState('')
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutNotes, setPayoutNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'requests' | 'wallet'>('requests')
  const [requestsFilter, setRequestsFilter] = useState<ReceiptStatus | 'all'>('pending')
  const [reviewModalReceipt, setReviewModalReceipt] = useState<Receipt | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [allPayoutRequests, setAllPayoutRequests] = useState<LawyerPayoutRequest[]>([])
  const [reviewPayoutRequest, setReviewPayoutRequest] = useState<LawyerPayoutRequest | null>(null)
  const [payoutReviewNotes, setPayoutReviewNotes] = useState('')

  const supabase = createClient()

  const loadLawyers = useCallback(async () => {
    let q = supabase.from('profiles').select('id, full_name, username, phone').eq('role', 'lawyer').eq('is_active', true)
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q.order('full_name')
    const list = data ?? []
    setLawyers(list)
    const balances = await fetchLawyerBalancesMap(supabase, list.map(l => l.id))
    setBalanceMap(balances)
    setSelectedId(prev => (prev && list.some(l => l.id === prev) ? prev : list[0]?.id ?? ''))
    return list
  }, [branchId, supabase])

  const loadBranchRequests = useCallback(async (lawyerList: Lawyer[]) => {
    try {
      const res = await fetch('/api/admin/finance-requests', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) {
        setAllPayoutRequests(data.payouts ?? [])
        setBranchReceipts(data.receipts ?? [])
        return
      }
    } catch {
      /* fallback below */
    }

    const ids = lawyerList.map(l => l.id)
    const lawyerNameMap = new Map(lawyerList.map(l => [l.id, l.full_name]))
    const rawPayouts = await fetchBranchPayoutRequests(supabase, ids, 'all')
    setAllPayoutRequests(
      rawPayouts.map(r => ({
        ...r,
        lawyer: { full_name: lawyerNameMap.get(r.lawyer_id) ?? 'محامٍ', username: null },
      })),
    )

    if (!ids.length) {
      setBranchReceipts([])
      return
    }
    const { data: receiptData } = await (supabase as any)
      .from('task_payment_receipts')
      .select('*, lawyer:profiles!task_payment_receipts_lawyer_id_fkey(full_name), task:tasks(task_type, debtors(full_name))')
      .in('lawyer_id', ids)
      .order('created_at', { ascending: false })
      .limit(200)
    setBranchReceipts(
      (receiptData ?? []).map((r: Receipt) => ({
        ...r,
        lawyer: r.lawyer ?? { full_name: lawyerNameMap.get(r.lawyer_id) ?? 'محامٍ' },
      })),
    )
  }, [supabase])

  const loadLawyerWallet = useCallback(async (lawyerId: string) => {
    if (!lawyerId) return
    setLoading(true)
    setError('')
    const txs = await fetchLawyerWalletTransactions(supabase, lawyerId)
    setWalletTxs(txs)
    const balance = await fetchLawyerWalletBalance(supabase, lawyerId)
    setBalanceMap(prev => new Map(prev).set(lawyerId, balance))
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void (async () => {
      const list = await loadLawyers()
      await loadBranchRequests(list)
    })()
  }, [loadLawyers, loadBranchRequests])

  useEffect(() => {
    if (selectedId) void loadLawyerWallet(selectedId)
  }, [selectedId, loadLawyerWallet])

  const walletBalance = balanceMap.get(selectedId) ?? 0
  const selectedLawyer = lawyers.find(l => l.id === selectedId)

  const unifiedRequests = useMemo((): UnifiedRequest[] => {
    const payoutItems: UnifiedRequest[] = allPayoutRequests.map(data => ({ kind: 'payout', data }))
    const taskItems: UnifiedRequest[] = branchReceipts.map(data => ({ kind: 'task', data }))
    return [...payoutItems, ...taskItems].sort(
      (a, b) => new Date(unifiedDate(b)).getTime() - new Date(unifiedDate(a)).getTime(),
    )
  }, [allPayoutRequests, branchReceipts])

  const filteredRequests = useMemo(() => {
    if (requestsFilter === 'all') return unifiedRequests
    return unifiedRequests.filter(r => unifiedStatus(r) === requestsFilter)
  }, [unifiedRequests, requestsFilter])

  const pendingPayoutRequests = useMemo(
    () => allPayoutRequests.filter(r => r.status === 'pending'),
    [allPayoutRequests],
  )
  const pendingTaskReceipts = useMemo(
    () => branchReceipts.filter(r => r.status === 'pending'),
    [branchReceipts],
  )
  const pendingPayoutTotal = useMemo(
    () => pendingPayoutRequests.reduce((s, r) => s + Number(r.amount), 0),
    [pendingPayoutRequests],
  )
  const pendingTaskTotal = useMemo(
    () => pendingTaskReceipts.reduce((s, r) => s + Number(r.amount), 0),
    [pendingTaskReceipts],
  )
  const pendingTotalAll = pendingPayoutTotal + pendingTaskTotal
  const pendingCountAll = pendingPayoutRequests.length + pendingTaskReceipts.length

  const selectedPendingTotal = useMemo(() => {
    if (!selectedId) return 0
    const p = allPayoutRequests.filter(r => r.lawyer_id === selectedId && r.status === 'pending')
      .reduce((s, r) => s + Number(r.amount), 0)
    const t = branchReceipts.filter(r => r.lawyer_id === selectedId && r.status === 'pending')
      .reduce((s, r) => s + Number(r.amount), 0)
    return p + t
  }, [selectedId, allPayoutRequests, branchReceipts])

  async function refreshAll() {
    const list = await loadLawyers()
    await Promise.all([
      loadBranchRequests(list),
      selectedId ? loadLawyerWallet(selectedId) : Promise.resolve(),
    ])
  }

  async function handlePayoutRequestReview(action: 'approved' | 'rejected') {
    if (!reviewPayoutRequest) return
    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/payout-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: reviewPayoutRequest.id,
        action,
        reviewNotes: payoutReviewNotes || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'فشل معالجة الطلب')
      setSaving(false)
      return
    }
    setReviewPayoutRequest(null)
    setPayoutReviewNotes('')
    await refreshAll()
    refreshAdminNotifications()
    setSaving(false)
  }

  async function handleTransfer() {
    const amt = parseFloat(transferAmount)
    if (!amt || amt <= 0 || !selectedId) return
    setSaving(true)
    setError('')
    const { data: me } = await supabase.auth.getUser()
    if (!me.user) { setSaving(false); return }

    const result = await creditLawyerWallet(supabase, {
      lawyerId: selectedId,
      amount: amt,
      type: 'accountant_transfer',
      notes: transferNotes || null,
      createdBy: me.user.id,
    })
    if (!result.ok) {
      setError(result.error ?? 'فشل الإيداع')
      setSaving(false)
      return
    }

    await logActivity({
      action: 'lawyer_wallet_credit',
      entity_type: 'lawyer',
      entity_id: selectedId,
      description: `إيداع ${amt.toLocaleString('en-US')} د.ع في محفظة ${selectedLawyer?.full_name ?? 'محامٍ'}`,
    }, supabase)

    setTransferAmount('')
    setTransferNotes('')
    await refreshAll()
    setSaving(false)
  }

  async function handlePayout() {
    const amt = parseFloat(payoutAmount)
    if (!amt || amt <= 0 || !selectedId) return
    setSaving(true)
    setError('')
    const { data: me } = await supabase.auth.getUser()
    if (!me.user) { setSaving(false); return }

    const result = await payoutLawyerFees(supabase, {
      lawyerId: selectedId,
      amount: amt,
      notes: payoutNotes || null,
      createdBy: me.user.id,
    })
    if (!result.ok) {
      setError(result.error ?? 'فشل صرف الأتعاب')
      setSaving(false)
      return
    }

    await logActivity({
      action: 'lawyer_fee_payout',
      entity_type: 'lawyer',
      entity_id: selectedId,
      description: `صرف ${amt.toLocaleString('en-US')} د.ع من أتعاب ${selectedLawyer?.full_name ?? 'محامٍ'}`,
    }, supabase)

    setPayoutAmount('')
    setPayoutNotes('')
    await refreshAll()
    setSaving(false)
  }

  async function handleReview(receipt: Receipt, action: 'approved' | 'rejected') {
    setSaving(true)
    const { data: me } = await supabase.auth.getUser()
    await (supabase as any).from('task_payment_receipts').update({
      status: action,
      review_notes: reviewNotes || null,
      reviewed_by: me.user?.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', receipt.id)

    if (action === 'approved') {
      await creditLawyerWallet(supabase, {
        lawyerId: receipt.lawyer_id,
        amount: Number(receipt.amount),
        type: 'approved_task_payment',
        notes: 'مهمة معتمدة',
        createdBy: me.user!.id,
        referenceId: receipt.task_id,
      })
    }

    setReviewModalReceipt(null)
    setReviewNotes('')
    await refreshAll()
    refreshAdminNotifications()
    setSaving(false)
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="أتعاب المحامين"
        subtitle="رصيد المحامين — طلبات الصرف — سجل الحركات"
      />

      {/* Lawyers grid */}
      <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl p-4 shadow-sm">
        <p className="text-xs text-[#767676] mb-3 font-semibold">المحامون ورصيد الأتعاب</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lawyers.map(l => {
            const bal = balanceMap.get(l.id) ?? 0
            const active = selectedId === l.id
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setSelectedId(l.id)}
                className={`text-right rounded-2xl p-4 border transition-all ${active ? 'border-[#2C8780] bg-[#2C8780]/5 shadow-md ring-2 ring-[#2C8780]/20' : 'border-[rgba(118,118,118,0.12)] bg-[#F3F1F2]/50 hover:border-[#2C8780]/30 hover:bg-white'}`}
              >
                <p className="font-bold text-[#231F20] text-sm truncate">{l.full_name}</p>
                {l.username && (
                  <p className="text-[10px] text-[#767676] font-mono mt-0.5" dir="ltr">{l.username}</p>
                )}
                <p className={`text-lg font-black tabular-nums mt-2 ${bal > 0 ? 'text-[#2C8780]' : 'text-[#767676]'}`} dir="ltr">
                  {fmtMoney(bal)}
                </p>
                <p className="text-[10px] text-[#767676] mt-0.5">رصيد الأتعاب</p>
              </button>
            )
          })}
          {!lawyers.length && <p className="text-sm text-[#767676] col-span-full py-4 text-center">لا يوجد محامون في هذا الفرع</p>}
        </div>
      </div>

      {selectedId && selectedLawyer && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-white border border-[#2C8780]/30 rounded-2xl p-4 shadow-sm col-span-2 md:col-span-1">
              <p className="text-[10px] text-[#767676] mb-1">رصيد {selectedLawyer.full_name}</p>
              <p className="text-2xl font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(walletBalance)}</p>
            </div>
            <div className="bg-white border border-yellow-200 rounded-2xl p-4 shadow-sm">
              <p className="text-[10px] text-[#767676] mb-1">طلباته بانتظار الموافقة</p>
              <p className="text-xl font-black text-yellow-700 tabular-nums" dir="ltr">{fmtMoney(selectedPendingTotal)}</p>
            </div>
            <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl p-4 shadow-sm">
              <p className="text-[10px] text-[#767676] mb-1">حركات المحفظة</p>
              <p className="text-xl font-black text-[#231F20] tabular-nums">{walletTxs.length}</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-bold text-emerald-800 mb-1">إيداع في المحفظة</h2>
              <p className="text-xs text-[#767676] mb-3">يزيد رصيد الأتعاب</p>
              <div className="space-y-3">
                <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="المبلغ (دينار)" className={INP} dir="ltr" min="0" />
                <input type="text" value={transferNotes} onChange={e => setTransferNotes(e.target.value)} placeholder="ملاحظات (اختياري)" className={INP} />
                <button onClick={handleTransfer} disabled={saving || !transferAmount}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  {saving ? 'جارٍ...' : 'إيداع'}
                </button>
              </div>
            </div>
            <div className="bg-white border border-red-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-bold text-red-800 mb-1">صرف أتعاب للمحامي</h2>
              <p className="text-xs text-[#767676] mb-3">يُخصم من الرصيد عند الدفع النقدي</p>
              <div className="space-y-3">
                <input type="number" value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)} placeholder="المبلغ (دينار)" className={INP} dir="ltr" min="0" max={walletBalance || undefined} />
                <input type="text" value={payoutNotes} onChange={e => setPayoutNotes(e.target.value)} placeholder="ملاحظات (اختياري)" className={INP} />
                <button onClick={handlePayout} disabled={saving || !payoutAmount || walletBalance <= 0}
                  className="w-full py-2.5 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
                  {saving ? 'جارٍ...' : 'صرف وخصم من الرصيد'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Unified requests + wallet — branch-wide */}
      <div className="flex gap-1 bg-[#F3F1F2] rounded-xl p-1 w-fit">
        {(['requests', 'wallet'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t ? 'bg-white text-[#231F20] shadow-sm' : 'text-[#767676]'}`}>
            {t === 'requests' ? `طلبات الصرف (${pendingCountAll})` : 'سجل الحركات'}
          </button>
        ))}
      </div>

      {tab === 'requests' && (
        <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.08)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-[#231F20]">جميع طلبات الصرف</h2>
              <p className="text-xs text-[#767676] mt-0.5">
                طلبات المحامين + طلبات المهام · {pendingCountAll} بانتظار الموافقة · {fmtMoney(pendingTotalAll)}
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['pending', 'all', 'approved', 'rejected'] as const).map(f => (
                <button key={f} onClick={() => setRequestsFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${requestsFilter === f ? 'text-white' : 'bg-[#F3F1F2] text-[#767676]'}`}
                  style={requestsFilter === f ? { background: 'linear-gradient(135deg,#2C8780,#1D6365)' } : undefined}>
                  {f === 'all' ? 'الكل' : RECEIPT_STATUS_LABELS[f]}
                  <span className="mr-1 opacity-70">
                    ({f === 'all' ? unifiedRequests.length : unifiedRequests.filter(r => unifiedStatus(r) === f).length})
                  </span>
                </button>
              ))}
            </div>
          </div>
          {!filteredRequests.length ? (
            <div className="text-center py-16 text-[#767676] text-sm">لا توجد طلبات في هذا الفلتر</div>
          ) : (
            <div className="divide-y divide-[rgba(118,118,118,0.08)]">
              {filteredRequests.map(item => {
                const status = unifiedStatus(item)
                const amount = unifiedAmount(item)
                const isPayout = item.kind === 'payout'
                const key = `${item.kind}-${isPayout ? item.data.id : item.data.id}`

                if (isPayout) {
                  const req = item.data
                  return (
                    <div key={key} className="px-5 py-4 flex items-center gap-4">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">صرف محامٍ</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-bold text-[#231F20]">{req.title}</p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
                            {RECEIPT_STATUS_LABELS[status]}
                          </span>
                        </div>
                        <p className="text-xs text-[#767676]">
                          {req.lawyer?.full_name ?? 'محامٍ'}
                          {req.notes ? ` · ${req.notes}` : ''}
                        </p>
                        {req.review_notes && <p className="text-xs text-red-600 mt-1">ملاحظة: {req.review_notes}</p>}
                      </div>
                      <p className="text-sm font-black text-[#2C8780] tabular-nums shrink-0" dir="ltr">{fmtMoney(amount)}</p>
                      <p className="text-xs text-[#767676] font-mono shrink-0 hidden sm:block" dir="ltr">{fmtDate(req.created_at)}</p>
                      {status === 'pending' && (
                        <button onClick={() => { setReviewPayoutRequest(req); setPayoutReviewNotes('') }}
                          className="text-xs font-bold text-[#2C8780] hover:underline shrink-0">مراجعة</button>
                      )}
                    </div>
                  )
                }

                const r = item.data
                return (
                  <div key={key} className="px-5 py-4 flex items-center gap-4">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 shrink-0">مهمة</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-bold text-[#231F20]">{r.task?.debtors?.full_name ?? '—'}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
                          {RECEIPT_STATUS_LABELS[status]}
                        </span>
                      </div>
                      <p className="text-xs text-[#767676]">
                        {r.lawyer?.full_name ?? 'محامٍ'} · {r.task?.task_type ?? ''}
                        {r.notes ? ` · ${r.notes}` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-black text-[#2C8780] tabular-nums shrink-0" dir="ltr">{fmtMoney(amount)}</p>
                    <p className="text-xs text-[#767676] font-mono shrink-0 hidden sm:block" dir="ltr">{fmtDate(r.created_at)}</p>
                    {status === 'pending' && (
                      <button onClick={() => { setReviewModalReceipt(r); setReviewNotes('') }}
                        className="text-xs font-bold text-[#2C8780] hover:underline shrink-0">مراجعة</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'wallet' && (
        <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
          {!selectedId ? (
            <div className="text-center py-16 text-[#767676] text-sm">اختر محامياً لعرض سجل الحركات</div>
          ) : loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
            </div>
          ) : !walletTxs.length ? (
            <div className="text-center py-16 text-[#767676] text-sm">لا توجد حركات بعد</div>
          ) : (
            <div className="divide-y divide-[rgba(118,118,118,0.08)]">
              <div className="px-5 py-3 bg-[#F3F1F2]/50 text-xs text-[#767676]">
                حركات محفظة: <span className="font-bold text-[#231F20]">{selectedLawyer?.full_name}</span>
              </div>
              {walletTxs.map(tx => {
                const amt = Number(tx.amount)
                const isCredit = amt > 0
                return (
                  <div key={tx.id} className="px-5 py-4 flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg ${isCredit ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      {isCredit ? '↑' : '↓'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-black tabular-nums ${isCredit ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
                        {isCredit ? '+' : ''}{fmtMoney(amt)}
                      </p>
                      <p className="text-xs text-[#767676] mt-0.5">
                        {WALLET_TRANSACTION_LABELS[tx.type as WalletTransactionType] ?? tx.type}
                        {tx.creator?.full_name ? ` · ${tx.creator.full_name}` : ''}
                      </p>
                      {tx.notes && <p className="text-xs text-[#767676] italic mt-0.5">{tx.notes}</p>}
                    </div>
                    <p className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(tx.created_at)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {reviewPayoutRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(35,31,32,0.5)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <h3 className="font-bold text-[#231F20]">مراجعة طلب صرف أتعاب</h3>
            <p className="text-sm text-[#231F20] font-semibold">{reviewPayoutRequest.title}</p>
            <p className="text-sm text-[#767676]">{reviewPayoutRequest.lawyer?.full_name}</p>
            <p className="text-lg font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(Number(reviewPayoutRequest.amount))}</p>
            <textarea value={payoutReviewNotes} onChange={e => setPayoutReviewNotes(e.target.value)} rows={3} placeholder="ملاحظة المراجعة (اختياري)..." className={`${INP} resize-none`} />
            <div className="flex gap-3">
              <button onClick={() => setReviewPayoutRequest(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#F3F1F2]">إلغاء</button>
              <button onClick={() => handlePayoutRequestReview('rejected')} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-50 text-red-700">رفض</button>
              <button onClick={() => handlePayoutRequestReview('approved')} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>اعتماد وصرف</button>
            </div>
          </div>
        </div>
      )}

      {reviewModalReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(35,31,32,0.5)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <h3 className="font-bold text-[#231F20]">مراجعة طلب أتعاب مهمة</h3>
            <p className="text-sm text-[#767676]">{fmtMoney(reviewModalReceipt.amount)} · {reviewModalReceipt.lawyer?.full_name}</p>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3} placeholder="ملاحظة..." className={`${INP} resize-none`} />
            <div className="flex gap-3">
              <button onClick={() => setReviewModalReceipt(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#F3F1F2]">إلغاء</button>
              <button onClick={() => handleReview(reviewModalReceipt, 'rejected')} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-50 text-red-700">رفض</button>
              <button onClick={() => handleReview(reviewModalReceipt, 'approved')} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>اعتماد</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
