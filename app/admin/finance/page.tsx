'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { fmtMoney, fmtDate, fmtDateTime } from '@/lib/utils'
import { RECEIPT_STATUS_LABELS, WALLET_TRANSACTION_LABELS } from '@/lib/types'
import type { ReceiptStatus, WalletTransactionType } from '@/lib/types'

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

interface WalletTx {
  id: string
  type: WalletTransactionType
  amount: number
  notes: string | null
  created_at: string
  creator: { full_name: string } | null
}

const STATUS_COLORS: Record<ReceiptStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-teal-100 text-teal-800',
  rejected: 'bg-red-100 text-red-800',
}

export default function FinancePage() {
  const branchId = useBranchId()
  const [lawyers, setLawyers] = useState<Lawyer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [transferAmount, setTransferAmount] = useState('')
  const [transferNotes, setTransferNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'receipts' | 'wallet'>('receipts')
  const [receiptFilter, setReceiptFilter] = useState<ReceiptStatus | 'all'>('pending')
  const [reviewModalReceipt, setReviewModalReceipt] = useState<Receipt | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  const supabase = createClient()

  useEffect(() => {
    let q = supabase.from('profiles').select('id, full_name, username, phone').eq('role', 'lawyer').eq('is_active', true)
    if (branchId) q = (q as any).eq('branch_id', branchId)
    q.then(({ data }) => {
      setLawyers(data ?? [])
      if (data?.[0]) setSelectedId(data[0].id)
    })
  }, [branchId])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    Promise.all([
      (supabase as any)
        .from('task_payment_receipts')
        .select('*, lawyer:profiles!task_payment_receipts_lawyer_id_fkey(full_name), task:tasks(task_type, debtors(full_name))')
        .eq('lawyer_id', selectedId)
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('lawyer_wallet_transactions')
        .select('*, creator:profiles!lawyer_wallet_transactions_created_by_fkey(full_name)')
        .eq('lawyer_id', selectedId)
        .order('created_at', { ascending: false }),
    ]).then(([{ data: r }, { data: w }]) => {
      setReceipts(r ?? [])
      setWalletTxs(w ?? [])
      const balance = (w ?? []).reduce((s: number, t: WalletTx) => s + Number(t.amount), 0)
      setWalletBalance(balance)
      setLoading(false)
    })
  }, [selectedId])

  const filteredReceipts = useMemo(() => {
    if (receiptFilter === 'all') return receipts
    return receipts.filter(r => r.status === receiptFilter)
  }, [receipts, receiptFilter])

  const pendingTotal = useMemo(() =>
    receipts.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0),
    [receipts])

  async function handleTransfer() {
    const amt = parseFloat(transferAmount)
    if (!amt || amt <= 0 || !selectedId) return
    setSaving(true)
    const { data: me } = await supabase.auth.getUser()
    await (supabase as any).from('lawyer_wallet_transactions').insert({
      lawyer_id: selectedId,
      type: 'accountant_transfer',
      amount: amt,
      notes: transferNotes || null,
      created_by: me.user?.id,
    })
    setTransferAmount('')
    setTransferNotes('')
    setWalletBalance(b => b + amt)
    setWalletTxs(txs => [{
      id: crypto.randomUUID(),
      type: 'accountant_transfer',
      amount: amt,
      notes: transferNotes || null,
      created_at: new Date().toISOString(),
      creator: null,
    }, ...txs])
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
      await (supabase as any).from('lawyer_wallet_transactions').insert({
        lawyer_id: receipt.lawyer_id,
        type: 'approved_task_payment',
        amount: receipt.amount,
        notes: `مهمة معتمدة`,
        reference_id: receipt.task_id,
        created_by: me.user?.id,
      })
      setWalletBalance(b => b + Number(receipt.amount))
    }

    setReceipts(rs => rs.map(r => r.id === receipt.id ? { ...r, status: action, review_notes: reviewNotes || null } : r))
    setReviewModalReceipt(null)
    setReviewNotes('')
    setSaving(false)
  }

  const selectedLawyer = lawyers.find(l => l.id === selectedId)

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#231F20]">المالية</h1>
          <p className="text-sm text-[#767676] mt-0.5">محافظ المحامين وطلبات صرف الأتعاب</p>
        </div>
      </div>

      {/* Lawyer selector */}
      <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl p-4 shadow-sm">
        <label className="block text-xs text-[#767676] mb-2 font-medium">اختر المحامي</label>
        <div className="flex flex-wrap gap-2">
          {lawyers.map(l => (
            <button
              key={l.id}
              onClick={() => setSelectedId(l.id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${selectedId === l.id ? 'text-white shadow-sm' : 'bg-[#F3F1F2] text-[#231F20] hover:bg-[#e8e6e7]'}`}
              style={selectedId === l.id ? { background: 'linear-gradient(135deg,#2C8780,#1D6365)' } : undefined}
            >
              {l.full_name}
            </button>
          ))}
          {!lawyers.length && <p className="text-sm text-[#767676]">لا يوجد محامون</p>}
        </div>
      </div>

      {selectedId && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-white border border-[rgba(44,135,128,0.3)] rounded-xl p-4 shadow-sm">
              <p className="text-[10px] text-[#767676] mb-1">رصيد المحفظة</p>
              <p className="text-xl font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(walletBalance)}</p>
            </div>
            <div className="bg-white border border-yellow-200 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] text-[#767676] mb-1">طلبات بانتظار الموافقة</p>
              <p className="text-xl font-black text-yellow-700 tabular-nums" dir="ltr">{fmtMoney(pendingTotal)}</p>
              <p className="text-[10px] text-[#767676] mt-0.5">{receipts.filter(r => r.status === 'pending').length} طلب</p>
            </div>
            <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-xl p-4 shadow-sm">
              <p className="text-[10px] text-[#767676] mb-1">إجمالي الطلبات</p>
              <p className="text-xl font-black text-[#231F20] tabular-nums">{receipts.length}</p>
            </div>
          </div>

          {/* Wallet transfer */}
          <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#231F20] mb-3">تحويل للمحفظة</h2>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-36">
                <input
                  type="number"
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                  placeholder="المبلغ (دينار)"
                  className="w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]"
                  dir="ltr"
                />
              </div>
              <div className="flex-1 min-w-52">
                <input
                  type="text"
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  placeholder="ملاحظات (اختياري)"
                  className="w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]"
                />
              </div>
              <button
                onClick={handleTransfer}
                disabled={saving || !transferAmount}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-opacity"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
              >
                {saving ? 'جارٍ...' : 'تحويل'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-[#F3F1F2] rounded-xl p-1 w-fit">
            {(['receipts', 'wallet'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t ? 'bg-white text-[#231F20] shadow-sm' : 'text-[#767676] hover:text-[#231F20]'}`}
              >
                {t === 'receipts' ? 'طلبات الأتعاب' : 'المحفظة'}
              </button>
            ))}
          </div>

          {/* Receipts tab */}
          {tab === 'receipts' && (
            <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
              {/* Filter */}
              <div className="flex gap-1.5 px-4 py-3 border-b border-[rgba(118,118,118,0.08)] overflow-x-auto">
                {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setReceiptFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${receiptFilter === f ? 'text-white' : 'bg-[#F3F1F2] text-[#767676] hover:bg-slate-200'}`}
                    style={receiptFilter === f ? { background: 'linear-gradient(135deg,#2C8780,#1D6365)' } : undefined}
                  >
                    {f === 'all' ? 'الكل' : RECEIPT_STATUS_LABELS[f]}
                    <span className="mr-1 opacity-70">({f === 'all' ? receipts.length : receipts.filter(r => r.status === f).length})</span>
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
                </div>
              ) : !filteredReceipts.length ? (
                <div className="text-center py-16 text-[#767676] text-sm">لا توجد طلبات</div>
              ) : (
                <div className="divide-y divide-[rgba(118,118,118,0.08)]">
                  {filteredReceipts.map(r => (
                    <div key={r.id} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="text-sm font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(r.amount)}</p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                            {RECEIPT_STATUS_LABELS[r.status]}
                          </span>
                        </div>
                        <p className="text-xs text-[#767676]">
                          {r.task?.debtors?.full_name ?? '—'} · {r.task?.task_type ?? ''}
                        </p>
                        {r.notes && <p className="text-xs text-[#767676] mt-0.5 italic">{r.notes}</p>}
                        {r.review_notes && <p className="text-xs text-red-600 mt-0.5">ملاحظة المراجعة: {r.review_notes}</p>}
                      </div>
                      <div className="shrink-0 text-left">
                        <p className="text-xs text-[#767676] font-mono" dir="ltr">{fmtDate(r.created_at)}</p>
                        {r.status === 'pending' && (
                          <button
                            onClick={() => { setReviewModalReceipt(r); setReviewNotes('') }}
                            className="mt-1.5 text-xs font-bold text-[#2C8780] hover:underline"
                          >
                            مراجعة
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Wallet tab */}
          {tab === 'wallet' && (
            <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
              {loading ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
                </div>
              ) : !walletTxs.length ? (
                <div className="text-center py-16 text-[#767676] text-sm">لا توجد حركات</div>
              ) : (
                <div className="divide-y divide-[rgba(118,118,118,0.08)]">
                  {walletTxs.map(tx => (
                    <div key={tx.id} className="px-5 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(tx.amount)}</p>
                        <p className="text-xs text-[#767676] mt-0.5">
                          {WALLET_TRANSACTION_LABELS[tx.type]}
                          {tx.creator ? ` · ${tx.creator.full_name}` : ''}
                        </p>
                        {tx.notes && <p className="text-xs text-[#767676] italic mt-0.5">{tx.notes}</p>}
                      </div>
                      <p className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(tx.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Review Modal */}
      {reviewModalReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(35,31,32,0.5)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-[rgba(118,118,118,0.1)]">
              <h3 className="font-bold text-[#231F20]">مراجعة طلب الأتعاب</h3>
              <p className="text-sm text-[#767676] mt-1">
                {fmtMoney(reviewModalReceipt.amount)} · {reviewModalReceipt.task?.debtors?.full_name ?? '—'}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-[#767676] mb-1.5">ملاحظة المراجعة (اختياري)</label>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  rows={3}
                  placeholder="سبب الرفض أو ملاحظة..."
                  className="w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-3 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button
                onClick={() => { setReviewModalReceipt(null); setReviewNotes('') }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleReview(reviewModalReceipt, 'rejected')}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                رفض
              </button>
              <button
                onClick={() => handleReview(reviewModalReceipt, 'approved')}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-opacity"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
              >
                اعتماد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
