'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import {
  canManualLegalManagerWalletOps,
  canViewLegalManagerWallet,
} from '@/lib/permissions'
import {
  fetchLegalManagerWalletBalance,
  fetchLegalManagerPayoutRequests,
  fetchLegalManagerLedger,
  listActiveLegalManagers,
  type LegalManagerLedgerRow,
} from '@/lib/legal-manager-wallet'
import type { LawyerPayoutRequest } from '@/lib/lawyer-payout-requests'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardHeader } from '@/components/ui/card'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { parseMoneyInput } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { PremiumSelect } from '@/components/ui/premium-select'
import { RECEIPT_STATUS_LABELS } from '@/lib/types'
import PermissionDenied from '@/components/PermissionDenied'

type ManualModal = 'deposit' | 'withdraw' | null

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white'

export default function LegalManagerWalletPage() {
  const role = useAdminRole()
  const canManualOps = canManualLegalManagerWalletOps(role)

  const [managers, setManagers] = useState<{ id: string; full_name: string; branch_id: string | null }[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [balance, setBalance] = useState(0)
  const [payoutRequests, setPayoutRequests] = useState<LawyerPayoutRequest[]>([])
  const [ledger, setLedger] = useState<LegalManagerLedgerRow[]>([])
  const [movementCount, setMovementCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [manualModal, setManualModal] = useState<ManualModal>(null)
  const [manualManagerId, setManualManagerId] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [manualError, setManualError] = useState('')

  const activeManagerId = selectedId

  const loadWallet = useCallback(async (managerId: string) => {
    setLoading(true)
    const supabase = createClient()
    const [bal, reqs, ledgerResult] = await Promise.all([
      fetchLegalManagerWalletBalance(supabase, managerId),
      fetchLegalManagerPayoutRequests(supabase, managerId, 50),
      fetchLegalManagerLedger(supabase, managerId),
    ])
    setBalance(bal)
    setPayoutRequests(reqs)
    setLedger(ledgerResult.rows)
    setMovementCount(ledgerResult.movementCount)
    setLoading(false)
  }, [])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const list = await listActiveLegalManagers(supabase)
      setManagers(list)
      const first = list[0]?.id ?? ''
      setSelectedId(first)
      if (first) await loadWallet(first)
      else setLoading(false)
    }
    init()
  }, [loadWallet])

  useEffect(() => {
    if (selectedId) loadWallet(selectedId)
  }, [selectedId, loadWallet])

  function openManualModal(kind: ManualModal) {
    setManualModal(kind)
    setManualManagerId(selectedId || managers[0]?.id || '')
    setManualAmount('')
    setManualNotes('')
    setManualError('')
  }

  function closeManualModal() {
    setManualModal(null)
    setManualError('')
  }

  async function submitManual() {
    if (!manualModal) return
    const parsed = parseMoneyInput(manualAmount)
    if (!manualManagerId) { setManualError('اختر مسؤول القانونية'); return }
    if (!parsed || parsed <= 0) { setManualError('أدخل مبلغاً صحيحاً'); return }
    if (!manualNotes.trim()) { setManualError('الملاحظة مطلوبة'); return }
    if (manualModal === 'withdraw' && manualManagerId === activeManagerId && parsed > balance) {
      setManualError(`المبلغ يتجاوز الرصيد (${fmtMoney(balance)})`)
      return
    }

    setManualSaving(true)
    setManualError('')
    try {
      const res = await fetch('/api/admin/legal-manager-wallet-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: manualModal,
          legalManagerUserId: manualManagerId,
          amount: parsed,
          notes: manualNotes.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setManualError(data.error ?? 'فشل تنفيذ العملية')
        setManualSaving(false)
        return
      }
      closeManualModal()
      setSelectedId(manualManagerId)
      await loadWallet(manualManagerId)
    } catch {
      setManualError('حدث خطأ في الاتصال')
    }
    setManualSaving(false)
  }

  if (!canViewLegalManagerWallet(role)) {
    return (
      <PermissionDenied message="رصيدك يظهر في لوحة التحكم فقط — لا يمكنك الوصول إلى صفحة المحفظة." />
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="محفظة مسؤول القانونية" subtitle="عرض أرصدة وحركات مسؤولي القانونية" />

      {managers.length > 1 && (
        <div className="max-w-sm">
          <PremiumSelect
            value={selectedId}
            onChange={setSelectedId}
            options={managers.map(m => ({ value: m.id, label: m.full_name }))}
            fieldLabel="مسؤول القانونية"
            headerTitle="اختر مسؤول القانونية"
            searchable={managers.length > 6}
          />
        </div>
      )}

      {managers.length === 0 && !loading && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          لا يوجد مسؤول قانونية نشط في النظام.
        </div>
      )}

      <div className="max-w-sm">
        <StatCard
          label="رصيد المحفظة"
          value={loading ? '—' : fmtMoney(balance)}
          accent="teal"
          valueColor="text-[#2C8780]"
          sub="الرصيد"
        />
      </div>

      {canManualOps && activeManagerId && !loading && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openManualModal('deposit')}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            إيداع
          </button>
          <button
            type="button"
            onClick={() => openManualModal('withdraw')}
            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white"
          >
            سحب
          </button>
        </div>
      )}

      {payoutRequests.length > 0 && (
        <Card>
          <CardHeader title={`طلبات السحب (${payoutRequests.length})`} />
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {payoutRequests.map(req => (
              <div key={req.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[#231F20] tabular-nums" dir="ltr">{fmtMoney(req.amount)}</p>
                  <p className="text-xs text-[#767676] mt-0.5">{req.status ? RECEIPT_STATUS_LABELS[req.status as keyof typeof RECEIPT_STATUS_LABELS] ?? req.status : '—'}</p>
                </div>
                <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(req.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`كشف المحفظة (${movementCount})`} />
        {loading ? (
          <div className="py-12 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
        ) : movementCount === 0 && ledger.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#767676]">
            لا توجد حركات بعد — تُضاف تلقائياً عند اعتماد إنجازات المهام.
          </div>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {ledger.map(row => {
              const isCredit = row.amount > 0
              const isDebit = row.amount < 0
              const isNeutral = row.amount === 0
              return (
                <div key={row.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#231F20]">{row.label}</p>
                      {row.label.includes('مرفوض') && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                          {RECEIPT_STATUS_LABELS.rejected}
                        </span>
                      )}
                      {row.label === 'طلب سحب' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          {RECEIPT_STATUS_LABELS.pending}
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-sm font-black tabular-nums mt-0.5 ${
                        isCredit ? 'text-emerald-700' : isDebit ? 'text-red-600' : 'text-[#767676]'
                      }`}
                      dir="ltr"
                    >
                      {isNeutral ? '—' : `${isCredit ? '+' : ''}${fmtMoney(row.amount)}`}
                    </p>
                    {row.description && (
                      <p className="text-xs text-[#767676] mt-0.5">
                        <span className="font-semibold">الملاحظة:</span> {row.description}
                      </p>
                    )}
                    {row.performedBy && (
                      <p className="text-[11px] text-[#767676] mt-1">
                        المنفّذ: <span className="font-semibold text-[#231F20]">{row.performedBy}</span>
                      </p>
                    )}
                    <p className="text-[11px] text-[#767676] mt-1">
                      الرصيد بعد الحركة:{' '}
                      <span className="font-bold text-[#231F20] tabular-nums" dir="ltr">
                        {fmtMoney(row.balanceAfter)}
                      </span>
                    </p>
                  </div>
                  <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">
                    {fmtDate(row.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {!activeManagerId && !loading && (
        <p className="text-sm text-[#767676]">اختر مسؤول قانونية لعرض المحفظة.</p>
      )}

      {manualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(35,31,32,0.5)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <h3 className="font-bold text-[#231F20]">
              {manualModal === 'deposit' ? 'إيداع يدوي' : 'سحب يدوي'}
            </h3>
            <p className="text-xs text-[#767676]">
              {manualModal === 'deposit'
                ? 'إيداع يدوي من الإدارة إلى محفظة مسؤول القانونية'
                : 'سحب يدوي من الإدارة من محفظة مسؤول القانونية'}
            </p>

            {managers.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-[#767676] mb-1">مسؤول القانونية *</label>
                <PremiumSelect
                  value={manualManagerId}
                  onChange={setManualManagerId}
                  options={managers.map(m => ({ value: m.id, label: m.full_name }))}
                  fieldLabel="مسؤول القانونية"
                  headerTitle="اختر مسؤول القانونية"
                  searchable={managers.length > 6}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#767676] mb-1">المبلغ (د.ع) *</label>
              <MoneyInput
                value={manualAmount}
                onChange={v => setManualAmount(v)}
                className={INP}
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#767676] mb-1">ملاحظة *</label>
              <textarea
                value={manualNotes}
                onChange={e => setManualNotes(e.target.value)}
                rows={3}
                className={`${INP} resize-none`}
                placeholder="سبب الإيداع أو السحب..."
              />
            </div>

            {manualError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{manualError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeManualModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#F3F1F2]"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={submitManual}
                disabled={manualSaving}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 ${
                  manualModal === 'deposit' ? '' : 'bg-red-600 hover:bg-red-700'
                }`}
                style={manualModal === 'deposit' ? { background: 'linear-gradient(135deg, #2C8780, #1D6365)' } : undefined}
              >
                {manualSaving ? 'جارٍ...' : 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
