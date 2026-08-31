'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import {
  canAssignTasks,
  canReviewPaymentNoncomplianceRequest,
  canViewPaymentInProgressCard,
  canViewInstantCases,
  isAdmin,
  isAnyLegalManager,
} from '@/lib/permissions'
import { countPaymentInProgress } from '@/lib/payment-in-progress'
import { countAwaitingAssignmentDebtors } from '@/lib/awaiting-assignment'
import { countFilePreparationDebtors } from '@/lib/file-preparation'
import { useCaseScope } from '@/hooks/use-case-scope'
import {
  DASHBOARD_COUNTS_CHANGED,
  opsCountsKey,
  peekOpsCardCounts,
  writeOpsCardCounts,
  type OpsCardCounts,
} from '@/lib/dashboard-counts-cache'

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

function FolderPrepIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h4.172a2.25 2.25 0 011.591.659l.828.828A2.25 2.25 0 0014.182 6.75H18a2.25 2.25 0 012.25 2.25v8.25A2.25 2.25 0 0118 19.5H6a2.25 2.25 0 01-2.25-2.25V6.75z" />
    </svg>
  )
}

function InstantCaseIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5V6a1.5 1.5 0 011.5-1.5h15A1.5 1.5 0 0121 6v1.5M3 7.5h18M3 7.5V18A1.5 1.5 0 004.5 19.5h15A1.5 1.5 0 0021 18V7.5M8.25 12h7.5" />
    </svg>
  )
}

function RecentIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
  listId?: string | null
  /** awaiting = إسناد المهام فقط · payment = متابعة التسديد فقط · all = الاثنان */
  section?: 'awaiting' | 'payment' | 'all'
  /** تجاوز فلتر القسم من الدور (تبويب المدير: مدني/جزائي) */
  caseType?: 'civil' | 'criminal' | null
  /** أرقام من طلب اللوحة الواحد — عند وجودها لا نرسل endpoints إضافية */
  parentOps?: OpsCardCounts | null
}

/**
 * كاردات العمليات في اللوحة — بألوان مميزة للتفريق بالنظر:
 * بنفسجي: تحت إسناد مهمة · أخضر: جاري التسديد · برتقالي: عدم الالتزام
 */
export default function PaymentOpsCards({
  branchId,
  viewAllBranches,
  listId = null,
  section = 'all',
  caseType,
  parentOps,
}: Props) {
  const role = useAdminRole()
  const { caseTypeFilter: roleCaseType } = useCaseScope()
  const caseTypeFilter = caseType !== undefined ? caseType : roleCaseType
  const showAwaitingSection = section === 'all' || section === 'awaiting'
  const showPaymentSection = section === 'all' || section === 'payment'
  const showAwaiting = showAwaitingSection && (isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role))
  const showInstant = showAwaitingSection && canViewInstantCases(role) && caseTypeFilter !== 'criminal'
  const showPayment = showPaymentSection && canViewPaymentInProgressCard(role)
  const showNoncompliance = showPaymentSection && canReviewPaymentNoncomplianceRequest(role)
  const showExperimentalQueues =
    showAwaitingSection
    && (isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role))
  const cacheKey = opsCountsKey(branchId, listId, caseTypeFilter, section)
  const initial = peekOpsCardCounts(cacheKey)
  const [awaitingCount, setAwaitingCount] = useState<number | null>(initial?.awaiting ?? null)
  const [prepCount, setPrepCount] = useState<number | null>(initial?.prep ?? null)
  const [receiptsPrepCount, setReceiptsPrepCount] = useState<number | null>(initial?.receiptsPrep ?? null)
  const [paymentCount, setPaymentCount] = useState<number | null>(initial?.payment ?? null)
  const [pendingCount, setPendingCount] = useState<number | null>(initial?.pending ?? null)
  const [instantCount, setInstantCount] = useState<number | null>(initial?.instant ?? null)
  const [recentNamesCount, setRecentNamesCount] = useState<number | null>(initial?.recentNames ?? null)
  const [legalArchiveCount, setLegalArchiveCount] = useState<number | null>(initial?.legalArchive ?? null)

  const applyCounts = useCallback((next: OpsCardCounts) => {
    setAwaitingCount(next.awaiting)
    setPrepCount(next.prep)
    setReceiptsPrepCount(next.receiptsPrep ?? null)
    setPaymentCount(next.payment)
    setPendingCount(next.pending)
    setInstantCount(next.instant)
    setRecentNamesCount(next.recentNames ?? next.awaiting ?? null)
    setLegalArchiveCount(next.legalArchive ?? null)
    writeOpsCardCounts(cacheKey, next)
  }, [cacheKey])

  useEffect(() => {
    if (!parentOps) return
    setAwaitingCount(parentOps.awaiting)
    setPrepCount(parentOps.prep)
    setReceiptsPrepCount(parentOps.receiptsPrep ?? null)
    setInstantCount(parentOps.instant)
    setRecentNamesCount(parentOps.recentNames ?? parentOps.awaiting ?? null)
    setLegalArchiveCount(parentOps.legalArchive ?? null)
    if (parentOps.payment != null) setPaymentCount(parentOps.payment)
    if (parentOps.pending != null) setPendingCount(parentOps.pending)
  }, [parentOps])

  const load = useCallback(async () => {
    if (!branchId && !viewAllBranches) {
      applyCounts({
        awaiting: 0,
        prep: 0,
        receiptsPrep: 0,
        payment: 0,
        pending: 0,
        instant: 0,
        recentNames: 0,
        legalArchive: 0,
      })
      return
    }

    // اعرض المخزّن فوراً إن وُجد (بعد تنقّل) ثم اجلب الطازج
    const cached = peekOpsCardCounts(cacheKey)
    if (cached) {
      setAwaitingCount(cached.awaiting)
      setPrepCount(cached.prep)
      setReceiptsPrepCount(cached.receiptsPrep ?? null)
      setPaymentCount(cached.payment)
      setPendingCount(cached.pending)
      setInstantCount(cached.instant ?? null)
      setRecentNamesCount(cached.awaiting ?? cached.recentNames ?? null)
      setLegalArchiveCount(cached.legalArchive ?? null)
    }

    const supabase = createClient()
    const scope = viewAllBranches ? null : branchId
    const listScope =
      viewAllBranches || caseTypeFilter === 'criminal' ? null : listId

    let nextAwaiting: number | null = showAwaiting ? (cached?.awaiting ?? null) : null
    let nextPrep: number | null = showAwaiting ? (cached?.prep ?? null) : null
    let nextReceiptsPrep: number | null = showAwaiting ? (cached?.receiptsPrep ?? null) : null
    let nextPayment: number | null = showPayment ? (cached?.payment ?? null) : null
    let nextPending: number | null = showNoncompliance ? (cached?.pending ?? null) : null
    let nextInstant: number | null = showInstant ? (cached?.instant ?? null) : null
    let nextRecent: number | null = showExperimentalQueues ? (cached?.awaiting ?? cached?.recentNames ?? null) : null
    let nextArchive: number | null = showExperimentalQueues ? (cached?.legalArchive ?? null) : null

    const skipRemoteCounts = parentOps !== undefined
    const tasks: Promise<void>[] = []

    if (showAwaiting && !skipRemoteCounts) {
      tasks.push((async () => {
        const receiptsParams = new URLSearchParams({ countOnly: '1' })
        if (viewAllBranches) receiptsParams.set('viewAll', '1')
        else if (branchId) receiptsParams.set('branchId', branchId)
        if (listScope) receiptsParams.set('listId', listScope)
        if (caseTypeFilter) receiptsParams.set('caseType', caseTypeFilter)

        const receiptsPromise = fetch(`/api/admin/receipts-prep?${receiptsParams}`)
          .then(async res => {
            const data = await res.json().catch(() => ({}))
            return res.ok ? Number(data.total ?? 0) || 0 : 0
          })
          .catch(() => 0)

        if (caseTypeFilter === null && listScope) {
          const [civilRes, crimRes, civilPrep, crimPrep, receiptsN] = await Promise.all([
            countAwaitingAssignmentDebtors(supabase, scope, {
              branchListId: listScope,
              caseType: 'civil',
              mode: 'awaiting',
            }),
            countAwaitingAssignmentDebtors(supabase, scope, {
              branchListId: null,
              caseType: 'criminal',
              mode: 'awaiting',
            }),
            countFilePreparationDebtors(supabase, scope, {
              branchListId: listScope,
              caseType: 'civil',
            }),
            countFilePreparationDebtors(supabase, scope, {
              branchListId: null,
              caseType: 'criminal',
            }),
            receiptsPromise,
          ])
          nextAwaiting =
            (civilRes.error ? 0 : civilRes.total) + (crimRes.error ? 0 : crimRes.total)
          nextPrep = civilPrep + crimPrep
          nextReceiptsPrep = receiptsN
        } else {
          const [res, prep, receiptsN] = await Promise.all([
            countAwaitingAssignmentDebtors(supabase, scope, {
              branchListId: listScope,
              caseType: caseTypeFilter,
              mode: 'awaiting',
            }),
            countFilePreparationDebtors(supabase, scope, {
              branchListId: listScope,
              caseType: caseTypeFilter,
            }),
            receiptsPromise,
          ])
          nextAwaiting = res.error ? 0 : res.total
          nextPrep = prep
          nextReceiptsPrep = receiptsN
        }
        setAwaitingCount(nextAwaiting)
        setPrepCount(nextPrep)
        setReceiptsPrepCount(nextReceiptsPrep)
        nextRecent = nextAwaiting
        setRecentNamesCount(nextAwaiting)
      })())
    }
    if (showInstant && !skipRemoteCounts) {
      tasks.push((async () => {
        const params = new URLSearchParams({ countOnly: '1' })
        if (viewAllBranches) params.set('viewAll', '1')
        else if (branchId) params.set('branchId', branchId)
        if (listScope) params.set('listId', listScope)
        const res = await fetch(`/api/admin/instant-cases?${params}`)
        if (!res.ok) {
          nextInstant = 0
        } else {
          const data = await res.json()
          nextInstant = Number(data.total ?? 0) || 0
        }
        setInstantCount(nextInstant)
      })())
    }
    if (showPayment) {
      tasks.push((async () => {
        if (caseTypeFilter === null && listScope) {
          const [civilN, crimN] = await Promise.all([
            countPaymentInProgress(supabase, scope, listScope, 'civil'),
            countPaymentInProgress(supabase, scope, null, 'criminal'),
          ])
          nextPayment = civilN + crimN
        } else {
          nextPayment = await countPaymentInProgress(supabase, scope, listScope, caseTypeFilter)
        }
        setPaymentCount(nextPayment)
      })())
    }
    if (showNoncompliance) {
      tasks.push((async () => {
        let listDebtorIds: string[] | null = null
        {
          let dq = supabase.from('debtors').select('id')
          if (scope) dq = dq.eq('branch_id', scope)
          if (listScope) dq = dq.eq('branch_list_id', listScope)
          if (caseTypeFilter) dq = dq.eq('case_type', caseTypeFilter)
          if (listScope || caseTypeFilter) {
            const { data: listDebtors, error: listErr } = await dq
            if (listErr) {
              nextPending = 0
              setPendingCount(0)
              return
            }
            listDebtorIds = (listDebtors ?? []).map(d => d.id)
            if (!listDebtorIds.length) {
              nextPending = 0
              setPendingCount(0)
              return
            }
          }
        }
        let q = supabase
          .from('payment_noncompliance_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
        if (scope) q = q.eq('branch_id', scope)
        if (listDebtorIds) q = q.in('debtor_id', listDebtorIds)
        const { count, error } = await q
        nextPending = error ? 0 : count ?? 0
        setPendingCount(nextPending)
      })())
    }

    if (showExperimentalQueues && !skipRemoteCounts) {
      tasks.push((async () => {
        const archiveParams = new URLSearchParams({ queue: 'archive', countOnly: '1' })
        if (viewAllBranches) archiveParams.set('viewAll', '1')
        else if (branchId) archiveParams.set('branchId', branchId)
        if (listScope) archiveParams.set('listId', listScope)
        if (caseTypeFilter) archiveParams.set('caseType', caseTypeFilter)
        const archiveRes = await fetch(`/api/admin/experimental-queues?${archiveParams}`)
        const archiveJson = await archiveRes.json().catch(() => ({}))
        nextArchive = archiveRes.ok ? Number(archiveJson.total ?? 0) : 0
        setLegalArchiveCount(nextArchive)
      })())
    }

    await Promise.all(tasks)
    if (skipRemoteCounts && !showPayment && !showNoncompliance) return
    const prev = skipRemoteCounts
      ? (parentOps ?? peekOpsCardCounts(cacheKey) ?? cached)
      : null
    writeOpsCardCounts(cacheKey, {
      awaiting: prev?.awaiting ?? nextAwaiting,
      prep: prev?.prep ?? nextPrep,
      receiptsPrep: prev?.receiptsPrep ?? nextReceiptsPrep,
      payment: nextPayment,
      pending: nextPending,
      instant: prev?.instant ?? nextInstant,
      recentNames: prev?.recentNames ?? nextRecent,
      legalArchive: prev?.legalArchive ?? nextArchive,
    })
  }, [
    branchId,
    viewAllBranches,
    listId,
    caseTypeFilter,
    showAwaiting,
    showInstant,
    showPayment,
    showNoncompliance,
    showExperimentalQueues,
    cacheKey,
    applyCounts,
    parentOps,
  ])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onRefresh = () => { void load() }
    window.addEventListener(DASHBOARD_COUNTS_CHANGED, onRefresh)
    return () => window.removeEventListener(DASHBOARD_COUNTS_CHANGED, onRefresh)
  }, [load])

  if (!showAwaiting && !showInstant && !showPayment && !showNoncompliance && !showExperimentalQueues) return null
  if (!branchId && !viewAllBranches) return null

  return (
    <div className="space-y-6">
      {(showInstant || showExperimentalQueues) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">الآلية الجديدة</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {showExperimentalQueues && (
              <ColorCard
                label="الأسماء المضافة مؤخراً"
                value={recentNamesCount ?? awaitingCount ?? '—'}
                sub="أرشيف · دعاوى فورية"
                href={
                  caseTypeFilter === 'civil'
                    ? '/admin/dashboard/recent-names?ct=civil'
                    : caseTypeFilter === 'criminal'
                      ? '/admin/dashboard/recent-names?ct=criminal'
                      : '/admin/dashboard/recent-names'
                }
                buttonLabel="عرض الأسماء"
                gradient="linear-gradient(135deg,#0f766e,#115e59)"
                softBg="linear-gradient(135deg,rgba(15,118,110,0.08),rgba(255,255,255,0.9))"
                border="rgba(15,118,110,0.35)"
                icon={<RecentIcon />}
              />
            )}
            {showExperimentalQueues && (
              <ColorCard
                label="أرشيف القانونية"
                value={legalArchiveCount ?? '—'}
                sub="إسناد مهمة · ملاحظة"
                href="/admin/dashboard/legal-archive"
                buttonLabel="فتح الأرشيف"
                gradient="linear-gradient(135deg,#1d4ed8,#1e3a8a)"
                softBg="linear-gradient(135deg,rgba(29,78,216,0.08),rgba(255,255,255,0.9))"
                border="rgba(29,78,216,0.35)"
                icon={<ArchiveIcon />}
              />
            )}
            {showInstant && (
              <ColorCard
                label="الدعاوى الفورية"
                value={instantCount ?? '—'}
                sub="ترشيحات معلّقة أو معتمدة"
                href="/admin/dashboard/instant-cases"
                buttonLabel="عرض الترشيحات"
                gradient="linear-gradient(135deg,#c2410c,#9a3412)"
                softBg="linear-gradient(135deg,rgba(194,65,12,0.08),rgba(255,255,255,0.9))"
                border="rgba(194,65,12,0.35)"
                icon={<InstantCaseIcon />}
              />
            )}
          </div>
        </div>
      )}

      {showAwaiting && (
        <>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-black text-[#231F20] text-base sm:text-lg">الأسماء التي تحت إسناد مهمة</h2>
              <span className="hidden sm:inline text-sm text-[#454042] font-medium">مدينون بانتظار إسناد المهمة</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <ColorCard
                  label="تحت إسناد مهمة"
                  value={awaitingCount ?? '—'}
                  sub="مدين بانتظار إسناد المهمة"
                  href={
                    caseTypeFilter === 'civil'
                      ? '/admin/dashboard/awaiting-assignment?ct=civil'
                      : caseTypeFilter === 'criminal'
                        ? '/admin/dashboard/awaiting-assignment?ct=criminal'
                        : '/admin/dashboard/awaiting-assignment'
                  }
                  buttonLabel="عرض الأسماء"
                  gradient="linear-gradient(135deg,#7c3aed,#6d28d9)"
                  softBg="linear-gradient(135deg,rgba(124,58,237,0.08),rgba(255,255,255,0.9))"
                  border="rgba(124,58,237,0.3)"
                  icon={<PersonPlusIcon />}
                />
              <ColorCard
                  label="تجهيز الملفات"
                  value={prepCount ?? '—'}
                  sub="مدين قيد تجهيز الملف لدى المحاسب الرئيسي"
                  href={
                    caseTypeFilter === 'civil'
                      ? '/admin/dashboard/awaiting-assignment?prep=1&ct=civil'
                      : caseTypeFilter === 'criminal'
                        ? '/admin/dashboard/awaiting-assignment?prep=1&ct=criminal'
                        : '/admin/dashboard/awaiting-assignment?prep=1'
                  }
                  buttonLabel="عرض الأسماء"
                  gradient="linear-gradient(135deg,#0369a1,#0c4a6e)"
                  softBg="linear-gradient(135deg,rgba(3,105,161,0.08),rgba(255,255,255,0.9))"
                  border="rgba(3,105,161,0.35)"
                  icon={<FolderPrepIcon />}
                />
            </div>
          </div>
        </>
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
