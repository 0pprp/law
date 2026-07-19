'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import {
  canAssignTasks,
  canReviewPaymentNoncomplianceRequest,
  canViewPaymentInProgressCard,
  isAdmin,
  isLegalManager,
} from '@/lib/permissions'
import { countPaymentInProgress } from '@/lib/payment-in-progress'
import { fetchAwaitingAssignmentDebtors } from '@/lib/awaiting-assignment'

function MoneyIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  )
}

function PersonPlusIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
    </svg>
  )
}

/** كارد ملوّن مميز — نفس هيكل كاردات المهام مع خلفية متدرجة تميّزه بالنظر */
function ColorCard({
  label,
  value,
  sub,
  href,
  buttonLabel,
  gradient,
  softBg,
  border,
  icon,
}: {
  label: string
  value: number | string
  sub: string
  href: string
  buttonLabel: string
  gradient: string
  softBg: string
  border: string
  icon: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border p-5 sm:p-6 shadow-sm transition-all hover:shadow-md"
      style={{ background: softBg, borderColor: border }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-bold text-[#231F20] mb-2" dir="rtl">{label}</p>
          <p className="text-2xl sm:text-3xl font-black leading-none tabular-nums text-[#231F20]" dir="ltr">{value}</p>
          <p className="text-sm text-[#454042] mt-2 font-medium" dir="rtl">{sub}</p>
        </div>
        <div
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: gradient }}
        >
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <Link
          href={href}
          className="block w-full py-1.5 text-center text-[11px] font-bold text-white rounded-lg hover:opacity-90 transition-opacity"
          style={{ background: gradient }}
        >
          {buttonLabel}
        </Link>
      </div>
    </div>
  )
}

interface Props {
  branchId: string | null
  viewAllBranches: boolean
}

/**
 * كاردات العمليات في اللوحة — بألوان مميزة للتفريق بالنظر:
 * بنفسجي: الأسماء تحت إسناد مهمة · أخضر مُزرق: جاري التسديد · برتقالي: طلبات عدم الالتزام
 */
export default function PaymentOpsCards({ branchId, viewAllBranches }: Props) {
  const role = useAdminRole()
  const showAwaiting = isAdmin(role) || isLegalManager(role) || canAssignTasks(role)
  const showPayment = canViewPaymentInProgressCard(role)
  const showNoncompliance = canReviewPaymentNoncomplianceRequest(role)
  const [awaitingCount, setAwaitingCount] = useState<number | null>(null)
  const [paymentCount, setPaymentCount] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!branchId && !viewAllBranches) {
      setAwaitingCount(0)
      setPaymentCount(0)
      setPendingCount(0)
      return
    }
    const supabase = createClient()
    const scope = viewAllBranches ? null : branchId

    if (showAwaiting) {
      void fetchAwaitingAssignmentDebtors(supabase, scope, { limit: 1 })
        .then(res => setAwaitingCount(res.error ? 0 : res.total))
    }
    if (showPayment) {
      void countPaymentInProgress(supabase, scope).then(setPaymentCount)
    }
    if (showNoncompliance) {
      let q = supabase
        .from('payment_noncompliance_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (scope) q = q.eq('branch_id', scope)
      void q.then(({ count, error }) => setPendingCount(error ? 0 : count ?? 0))
    }
  }, [branchId, viewAllBranches, showAwaiting, showPayment, showNoncompliance])

  useEffect(() => { void load() }, [load])

  if (!showAwaiting && !showPayment && !showNoncompliance) return null
  if (!branchId && !viewAllBranches) return null

  return (
    <div className="space-y-6">
      {showAwaiting && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">الأسماء التي تحت إسناد مهمة</h2>
            <span className="hidden sm:inline text-sm text-[#454042] font-medium">مدينون بلا مهمة مطلوبة</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <ColorCard
              label="تحت إسناد مهمة"
              value={awaitingCount ?? '—'}
              sub="مدين بانتظار إسناد المهمة"
              href="/admin/dashboard/awaiting-assignment"
              buttonLabel="عرض الأسماء"
              gradient="linear-gradient(135deg,#7c3aed,#6d28d9)"
              softBg="linear-gradient(135deg,rgba(124,58,237,0.08),rgba(255,255,255,0.9))"
              border="rgba(124,58,237,0.3)"
              icon={<PersonPlusIcon />}
            />
          </div>
        </div>
      )}

      {(showPayment || showNoncompliance) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">متابعة التسديد</h2>
            <span className="hidden sm:inline text-sm text-[#454042] font-medium">جاري التسديد وطلبات عدم الالتزام</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {showPayment && (
              <ColorCard
                label="جاري التسديد"
                value={paymentCount ?? '—'}
                sub="مدين قيد تحصيل الأقساط"
                href="/admin/dashboard/payment-in-progress"
                buttonLabel="عرض القائمة"
                gradient="linear-gradient(135deg,#2C8780,#1D6365)"
                softBg="linear-gradient(135deg,rgba(44,135,128,0.10),rgba(255,255,255,0.9))"
                border="rgba(44,135,128,0.35)"
                icon={<MoneyIcon />}
              />
            )}
            {showNoncompliance && (
              <ColorCard
                label="طلبات عدم الالتزام"
                value={pendingCount ?? '—'}
                sub="طلب معلّق بانتظار المراجعة"
                href="/admin/dashboard/noncompliance"
                buttonLabel="عرض الطلبات"
                gradient="linear-gradient(135deg,#d97706,#b45309)"
                softBg="linear-gradient(135deg,rgba(217,119,6,0.10),rgba(255,255,255,0.9))"
                border="rgba(217,119,6,0.35)"
                icon={<AlertIcon />}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
