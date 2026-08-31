'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useBranch, useBranchId } from '@/context/branch'
import Link from 'next/link'
import { useAdminRole } from '@/context/admin-role'
import { useCaseScope } from '@/hooks/use-case-scope'
import { canAddDebtor, canReviewTasks, isAccountant, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { activityActionLabel } from '@/lib/activity-labels'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'
import { StatCard } from '@/components/ui/stat-card'
import { stageAccent, stageIconBg } from '@/lib/stage-config'
import { scheduleBranchMaintenance } from '@/lib/branch-maintenance'
import {
  DASHBOARD_COUNTS_CHANGED,
  dashboardCountsKey,
  isDashboardStageCountsFresh,
  opsCountsKey,
  peekDashboardStageCounts,
  peekOpsCardCounts,
  writeDashboardStageCounts,
  writeOpsCardCounts,
  type DashboardStageSnapshot,
  type OpsCardCounts,
} from '@/lib/dashboard-counts-cache'
import PaymentOpsCards from '@/components/PaymentOpsCards'
import { fetchDeduped } from '@/lib/inflight-fetch'
import { createClient } from '@/lib/supabase/client'
import type { UnassignedStageCount, PleadingHearingBadgeCounts } from '@/lib/task-assignment'

const EMPTY_HEARING_BADGES: PleadingHearingBadgeCounts = { yellow: 0, red: 0, gray: 0 }

const EMPTY_OPS: OpsCardCounts = {
  awaiting: null,
  prep: null,
  receiptsPrep: null,
  payment: null,
  pending: null,
  instant: null,
  recentNames: null,
  legalArchive: null,
}

function TaskStageIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}

function assignedFileLawsuitCount(stages: UnassignedStageCount[]): number {
  return stages
    .filter(s => s.taskType === 'file_lawsuit' || (s.label ?? '').includes('إقامة دعوى'))
    .reduce((n, s) => n + s.count, 0)
}

function ReceiptsPrepStageCard({
  count,
  href,
  loading,
}: {
  count: number
  href: string
  loading: boolean
}) {
  return (
    <StatCard
      label="تجهيز الوصولات"
      value={loading ? '—' : count}
      sub="إقامة دعوى مكلفة"
      accent="green"
      icon={<TaskStageIcon />}
      iconBg="bg-gradient-to-br from-emerald-600 to-emerald-800"
      footer={
        <Link
          href={href}
          className="block w-full py-1.5 text-center text-[11px] font-bold text-white rounded-lg hover:opacity-90 transition-opacity"
          style={{ background: 'linear-gradient(135deg,#047857,#065f46)' }}
        >
          عرض الأسماء
        </Link>
      }
    />
  )
}

function ReviewCheckIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function StageGrid({
  stages,
  loading,
  emptyHref,
  showAddLink,
  emptyMessage = 'لا توجد مهام غير مكلفة حالياً',
  countLabel = 'غير مكلفة',
  linkLabel = 'عرض غير المكلفة',
  hrefForStage,
  barClassName = 'bg-yellow-400',
  hearingBadges = null,
  extra = null,
}: {
  stages: UnassignedStageCount[]
  loading: boolean
  emptyHref: string
  showAddLink: boolean
  emptyMessage?: string
  countLabel?: string
  linkLabel?: string
  hrefForStage?: (s: UnassignedStageCount) => string
  barClassName?: string
  hearingBadges?: PleadingHearingBadgeCounts | null
  extra?: ReactNode
}) {
  const stageTotal = stages.reduce((sum, s) => sum + s.count, 0)
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 bg-white rounded-xl border animate-pulse" />
        ))}
      </div>
    )
  }
  if (stages.length === 0 && !extra) {
    return (
      <div className="bg-white rounded-2xl border p-10 text-center">
        <p className="text-sm font-semibold text-[#231F20]">{emptyMessage}</p>
        {showAddLink && (
          <Link href={emptyHref} className="inline-flex mt-4 text-xs font-semibold text-[#2C8780] hover:underline">
            إضافة مدين جديد ←
          </Link>
        )}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
      {extra}
      {stages.map((s, i) => {
        const pct = stageTotal > 0 ? Math.round((s.count / stageTotal) * 100) : 0
        const href = hrefForStage?.(s) ?? `/admin/dashboard/stages/${s.id}`
        const showHearingBadges = Boolean(hearingBadges && s.taskType === 'pleading')
        return (
          <div key={`${s.id}-${countLabel}`} className={showHearingBadges ? 'relative' : undefined}>
            {showHearingBadges && hearingBadges && (
              <div className="absolute -top-2 left-2 z-10 flex items-center gap-1" dir="ltr">
                <span
                  title="مرافعات خلال 3 أيام"
                  aria-label={`مرافعات خلال 3 أيام: ${hearingBadges.yellow}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-white shadow-sm ring-2 ring-white"
                >
                  {hearingBadges.yellow}
                </span>
                <span
                  title="مرافعات خلال يومين"
                  aria-label={`مرافعات خلال يومين: ${hearingBadges.red}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow-sm ring-2 ring-white"
                >
                  {hearingBadges.red}
                </span>
                <span
                  title="مرافعات منتهية"
                  aria-label={`مرافعات منتهية: ${hearingBadges.gray}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-400 text-xs font-bold text-white shadow-sm ring-2 ring-white"
                >
                  {hearingBadges.gray}
                </span>
              </div>
            )}
            <StatCard
              label={s.label}
              value={s.count}
              sub={`${s.count} ${countLabel} · ${pct}%`}
              accent={stageAccent(i)}
              icon={<TaskStageIcon />}
              iconBg={stageIconBg(i)}
              footer={
                <div className="space-y-2">
                  <div className="h-1.5 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barClassName}`} style={{ width: `${pct}%` }} />
                  </div>
                  <Link
                    href={href}
                    className="block w-full py-1.5 text-center text-[11px] font-bold text-white rounded-lg hover:opacity-90 transition-opacity"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                  >
                    {linkLabel}
                  </Link>
                </div>
              }
            />
          </div>
        )
      })}
    </div>
  )
}

export default function DashboardPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const { caseTypeFilter: roleCt, section: roleSection } = useCaseScope()
  /**
   * فلتر الكل | مدني | جزائي:
   * - المدير/الموظف دائماً
   * - مسؤول القانونية عند صلاحية القسمين معاً
   * صلاحية واحدة فقط → عرض قسمه بدون فلتر
   */
  const canFocusSection =
    isAdmin(role) || role === 'employee' || (isAnyLegalManager(role) && roleSection === 'both')
  const [sectionFocus, setSectionFocus] = useState<'both' | 'civil' | 'criminal'>('both')
  const ct = canFocusSection
    ? (sectionFocus === 'both' ? null : sectionFocus)
    : roleCt
  const allowAddDebtor = canAddDebtor(role)
  const showAddDebtorLink = allowAddDebtor
  /** محفظة الأتعاب مخفية عن مسؤول القانونية — لا يراها في اللوحة */
  const accountantView = isAccountant(role)
  /** كارد مراجعة الإنجازات — مسؤولو الأقسام فقط؛ المدير يستخدم القائمة/الأزرار السريعة */
  const showReviewCard = !accountantView && !isAdmin(role) && canReviewTasks(role)
  const showCivilStages = ct === null || ct === 'civil'
  const showCriminalStages = ct === null || ct === 'criminal'
  const showPaymentOps = ct !== 'criminal'
  const [civilStages, setCivilStages] = useState<UnassignedStageCount[]>([])
  const [criminalStages, setCriminalStages] = useState<UnassignedStageCount[]>([])
  const [civilAssignedStages, setCivilAssignedStages] = useState<UnassignedStageCount[]>([])
  const [criminalAssignedStages, setCriminalAssignedStages] = useState<UnassignedStageCount[]>([])
  const [civilOverdueStages, setCivilOverdueStages] = useState<UnassignedStageCount[]>([])
  const [criminalOverdueStages, setCriminalOverdueStages] = useState<UnassignedStageCount[]>([])
  const [pleadingHearingBadges, setPleadingHearingBadges] = useState<PleadingHearingBadgeCounts>(EMPTY_HEARING_BADGES)
  const [totalPendingReview, setTotalPendingReview] = useState(0)
  const [totalWaiting, setTotalWaiting] = useState(0)
  const [totalAssigned, setTotalAssigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [recentActivity, setRecentActivity] = useState<{ action: string; created_at: string }[]>([])
  const [opsRemote, setOpsRemote] = useState<OpsCardCounts | null>(null)
  const loadGenRef = useRef(0)

  const applyDashboardSnapshot = useCallback((snap: DashboardStageSnapshot) => {
    setCivilStages(snap.civilStages as UnassignedStageCount[])
    setCriminalStages(snap.criminalStages as UnassignedStageCount[])
    setCivilAssignedStages(snap.civilAssignedStages as UnassignedStageCount[])
    setCriminalAssignedStages(snap.criminalAssignedStages as UnassignedStageCount[])
    setCivilOverdueStages(snap.civilOverdueStages as UnassignedStageCount[])
    setCriminalOverdueStages(snap.criminalOverdueStages as UnassignedStageCount[])
    setPleadingHearingBadges(snap.pleadingHearingBadges ?? EMPTY_HEARING_BADGES)
    setTotalWaiting(snap.unassigned)
    setTotalAssigned(snap.assigned)
    setTotalPendingReview(snap.pendingReview)
    setRecentActivity(snap.recentActivity)
  }, [])

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    const gen = ++loadGenRef.current
    const isStale = () => gen !== loadGenRef.current

    if (!branchId && !viewAllBranches) {
      setCivilStages([])
      setCriminalStages([])
      setCivilAssignedStages([])
      setCriminalAssignedStages([])
      setCivilOverdueStages([])
      setCriminalOverdueStages([])
      setPleadingHearingBadges(EMPTY_HEARING_BADGES)
      setTotalWaiting(0)
      setTotalAssigned(0)
      setTotalPendingReview(0)
      setRecentActivity([])
      setOpsRemote({ ...EMPTY_OPS, awaiting: 0, prep: 0, receiptsPrep: 0, instant: 0, recentNames: 0, legalArchive: 0 })
      setLoading(false)
      return
    }

    const cacheKey = dashboardCountsKey(branchId, listId, ct)
    const cached = peekDashboardStageCounts(cacheKey)
    if (cached) {
      applyDashboardSnapshot(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const awaitingOpsKey = opsCountsKey(branchId, listId, ct, 'awaiting')
    const cachedOps = peekOpsCardCounts(awaitingOpsKey)
    if (cachedOps) setOpsRemote(cachedOps)

    if (!opts?.force && cached && isDashboardStageCountsFresh(cacheKey)) {
      return
    }

    scheduleBranchMaintenance(createClient(), branchId)

    try {
      const p = new URLSearchParams()
      if (viewAllBranches) p.set('viewAll', '1')
      else if (branchId) p.set('branchId', branchId)
      if (ct === 'civil' && !viewAllBranches && listId) p.set('branchListId', listId)
      if (ct === 'civil' || ct === 'criminal') p.set('caseType', ct)

      const res = await fetchDeduped(`/api/admin/dashboard-bootstrap?${p}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'فشل تحميل اللوحة')
      if (isStale()) return

      const next: DashboardStageSnapshot = {
        civilStages: showCivilStages ? (data.civil?.stages ?? []) : [],
        criminalStages: showCriminalStages ? (data.criminal?.stages ?? []) : [],
        civilAssignedStages: showCivilStages ? (data.civil?.assignedStages ?? []) : [],
        criminalAssignedStages: showCriminalStages ? (data.criminal?.assignedStages ?? []) : [],
        civilOverdueStages: showCivilStages ? (data.civil?.overdueStages ?? []) : [],
        criminalOverdueStages: showCriminalStages ? (data.criminal?.overdueStages ?? []) : [],
        pleadingHearingBadges: showCivilStages ? (data.pleadingHearingBadges ?? EMPTY_HEARING_BADGES) : EMPTY_HEARING_BADGES,
        unassigned: (showCivilStages ? Number(data.civil?.unassigned ?? 0) : 0)
          + (showCriminalStages ? Number(data.criminal?.unassigned ?? 0) : 0),
        assigned: (showCivilStages ? Number(data.civil?.assigned ?? 0) : 0)
          + (showCriminalStages ? Number(data.criminal?.assigned ?? 0) : 0),
        pendingReview: Number(data.pendingReview ?? 0) || 0,
        recentActivity: Array.isArray(data.recentActivity) ? data.recentActivity : [],
      }
      writeDashboardStageCounts(cacheKey, next)
      applyDashboardSnapshot(next)

      const ops: OpsCardCounts = {
        awaiting: Number(data.ops?.awaiting ?? 0) || 0,
        prep: Number(data.ops?.prep ?? 0) || 0,
        receiptsPrep: Number(data.ops?.receiptsPrep ?? 0) || 0,
        payment: cachedOps?.payment ?? null,
        pending: cachedOps?.pending ?? null,
        instant: Number(data.ops?.instant ?? 0) || 0,
        recentNames: Number(data.ops?.recentNames ?? data.ops?.awaiting ?? 0) || 0,
        legalArchive: Number(data.ops?.legalArchive ?? 0) || 0,
      }
      writeOpsCardCounts(awaitingOpsKey, ops)
      setOpsRemote(ops)
    } catch (e: unknown) {
      console.error('[admin/dashboard] load error:', e)
    }
    if (!isStale()) setLoading(false)
  }, [branchId, viewAllBranches, listId, ct, showCivilStages, showCriminalStages, applyDashboardSnapshot])

  useEffect(() => { void loadData() }, [loadData])

  useEffect(() => {
    const onRefresh = () => { void loadData({ force: true }) }
    window.addEventListener(DASHBOARD_COUNTS_CHANGED, onRefresh)
    return () => window.removeEventListener(DASHBOARD_COUNTS_CHANGED, onRefresh)
  }, [loadData])

  const {
    visibleItems: visibleActivity,
    expanded: activityExpanded,
    toggle: toggleActivity,
    hasMore: activityHasMore,
    total: activityTotal,
  } = useShowMore(recentActivity, LOG_PREVIEW_LIMIT)

  return (
    <div className="space-y-6 w-full">
      <div className="rounded-2xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #231F20 0%, #1a1617 100%)' }}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-[#2C8780]/10 rounded-full" />
        </div>
        <div className="relative z-10 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
          <div className="flex-1">
            <p className="text-[#2C8780] text-xs font-bold tracking-[0.25em] uppercase mb-2.5">منصة التحصيل القانوني</p>
            <h1 className="text-white text-2xl sm:text-3xl font-black leading-tight">
              {viewAllBranches ? 'لوحة مراحل القضايا — كل الفروع' : 'لوحة مراحل القضايا'}
            </h1>
            <p className="text-white/50 text-sm sm:text-base mt-2 font-medium">
              {viewAllBranches
                ? (ct === 'civil'
                  ? 'إحصائيات مجمّعة لجميع الفروع — الدعاوى المدنية'
                  : ct === 'criminal'
                    ? 'إحصائيات مجمّعة لجميع الفروع — الدعاوى الجزائية'
                    : 'إحصائيات مجمّعة لجميع الفروع — مدنية وجزائية')
                : (ct === 'civil'
                  ? 'مهام غير مكلفة حسب نوع المهمة — الدعاوى المدنية'
                  : ct === 'criminal'
                    ? 'مهام غير مكلفة حسب نوع المهمة — الدعاوى الجزائية'
                    : 'مهام غير مكلفة حسب نوع المهمة — والمدنية والجزائية')}
            </p>
            {canFocusSection && (
              <div className="flex flex-wrap gap-2 mt-4">
                {([
                  { id: 'both' as const, label: 'الكل' },
                  { id: 'civil' as const, label: 'مدني' },
                  { id: 'criminal' as const, label: 'جزائي' },
                ]).map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSectionFocus(tab.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      sectionFocus === tab.id
                        ? 'bg-[#2C8780] text-white'
                        : 'bg-white/10 text-white/70 hover:bg-white/15'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-stretch gap-5 sm:gap-6 shrink-0">
            <Link href="/admin/tasks" className="text-center group">
              <p className="text-3xl sm:text-4xl font-black text-yellow-400 tabular-nums group-hover:text-yellow-300 transition-colors">
                {loading ? '—' : totalWaiting}
              </p>
              <p className="text-xs text-white/45 mt-1 font-semibold">غير مكلفة</p>
              {showCivilStages && showCriminalStages && !loading && (
                <p className="text-[10px] text-white/35 mt-0.5 font-medium tabular-nums">
                  مدني {civilStages.reduce((s, x) => s + x.count, 0)}
                  {' · '}
                  جزائي {criminalStages.reduce((s, x) => s + x.count, 0)}
                </p>
              )}
            </Link>
            <div className="w-px bg-white/10 self-stretch" />
            <div className="text-center">
              <p className="text-3xl sm:text-4xl font-black text-white tabular-nums">{loading ? '—' : totalAssigned}</p>
              <p className="text-xs text-white/45 mt-1 font-semibold">مكلفة</p>
            </div>
            <div className="w-px bg-white/10 self-stretch" />
            <Link href="/admin/tasks/review" className="text-center group">
              <p className="text-3xl sm:text-4xl font-black text-orange-400 tabular-nums group-hover:text-orange-300 transition-colors">
                {loading ? '—' : totalPendingReview}
              </p>
              <p className="text-xs text-white/45 mt-1 font-semibold">بانتظار المراجعة</p>
            </Link>
          </div>
        </div>
      </div>

      {!branchId && !viewAllBranches && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض مراحل القضايا.
        </div>
      )}

      <PaymentOpsCards
        branchId={branchId}
        viewAllBranches={viewAllBranches}
        listId={listId}
        section="awaiting"
        caseType={ct}
        parentOps={opsRemote}
      />

      {showReviewCard && (branchId || viewAllBranches) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">مراجعة الإنجازات</h2>
            <span className="text-sm text-[#454042] font-medium">مهام بانتظار الاعتماد</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div
              className="rounded-xl border p-5 sm:p-6 shadow-sm transition-all hover:shadow-md"
              style={{
                background: 'linear-gradient(135deg,rgba(5,150,105,0.10),rgba(255,255,255,0.9))',
                borderColor: 'rgba(5,150,105,0.35)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-bold text-[#231F20] mb-2" dir="rtl">بانتظار الاعتماد</p>
                  <p className="text-2xl sm:text-3xl font-black leading-none tabular-nums text-[#231F20]" dir="ltr">
                    {loading ? '—' : totalPendingReview}
                  </p>
                  <p className="text-sm text-[#454042] mt-2 font-medium" dir="rtl">إنجازات بحاجة لمراجعتك</p>
                </div>
                <div
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}
                >
                  <ReviewCheckIcon />
                </div>
              </div>
              <div className="mt-4">
                <Link
                  href="/admin/tasks/review"
                  className="block w-full py-1.5 text-center text-[11px] font-bold text-white rounded-lg hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}
                >
                  فتح مراجعة الإنجازات
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCivilStages && (
        <div className="bg-yellow-100 border border-yellow-300 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">القضايا المدنية غير المكلفة</h2>
            <span className="text-sm text-[#454042] font-medium">المهام المكلفة لا تظهر هنا</span>
          </div>
          <StageGrid
            stages={civilStages}
            loading={loading}
            emptyHref="/admin/debtors/new"
            showAddLink={showAddDebtorLink}
            hrefForStage={(s) => `/admin/dashboard/stages/${encodeURIComponent(s.id)}?view=waiting`}
            hearingBadges={(role === 'admin' || role === 'viewer') ? pleadingHearingBadges : null}
          />
        </div>
      )}

      {showCivilStages && isAdmin(role) && (
        <div className="bg-green-100 border border-green-300 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">القضايا المدنية المكلفة</h2>
            <span className="text-sm text-[#454042] font-medium">حسب نوع المهمة</span>
          </div>
          <StageGrid
            stages={civilAssignedStages}
            loading={loading}
            emptyHref="/admin/tasks"
            showAddLink={false}
            emptyMessage="لا توجد مهام مدنية مكلفة حالياً"
            countLabel="مكلفة"
            linkLabel="عرض المكلفة"
            barClassName="bg-[#2C8780]"
            hrefForStage={(s) => `/admin/dashboard/stages/${encodeURIComponent(s.id)}?view=assigned`}
            extra={
              <ReceiptsPrepStageCard
                count={assignedFileLawsuitCount(civilAssignedStages)}
                href="/admin/dashboard/receipts-prep?ct=civil"
                loading={loading}
              />
            }
          />
        </div>
      )}

      {showCivilStages && (
        <div className="bg-red-100 border border-red-300 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">القضايا المدنية المكلفة المتأخرة</h2>
            <span className="text-sm text-[#454042] font-medium">تجاوزت تاريخ الاستحقاق</span>
          </div>
          <StageGrid
            stages={civilOverdueStages}
            loading={loading}
            emptyHref="/admin/tasks"
            showAddLink={false}
            emptyMessage="لا توجد مهام مدنية متأخرة حالياً"
            countLabel="متأخرة"
            linkLabel="عرض المتأخرة"
            barClassName="bg-orange-500"
            hrefForStage={(s) => `/admin/dashboard/stages/${encodeURIComponent(s.id)}?view=overdue`}
          />
        </div>
      )}

      {showCriminalStages && (
        <div className="bg-yellow-100 border border-yellow-300 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">القضايا الجزائية غير المكلفة</h2>
            <span className="text-sm text-[#454042] font-medium">نفس سير التكليف الحالي</span>
          </div>
          <StageGrid
            stages={criminalStages}
            loading={loading}
            emptyHref="/admin/debtors/new"
            showAddLink={showAddDebtorLink}
            hrefForStage={(s) => `/admin/dashboard/stages/${encodeURIComponent(s.id)}?view=waiting`}
          />
        </div>
      )}

      {showCriminalStages && (
        <div className="bg-green-100 border border-green-300 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">القضايا الجزائية المكلفة</h2>
            <span className="text-sm text-[#454042] font-medium">حسب نوع المهمة</span>
          </div>
          <StageGrid
            stages={criminalAssignedStages}
            loading={loading}
            emptyHref="/admin/tasks"
            showAddLink={false}
            emptyMessage="لا توجد مهام جزائية مكلفة حالياً"
            countLabel="مكلفة"
            linkLabel="عرض المكلفة"
            barClassName="bg-[#2C8780]"
            hrefForStage={(s) => `/admin/dashboard/stages/${encodeURIComponent(s.id)}?view=assigned`}
            extra={
              <ReceiptsPrepStageCard
                count={assignedFileLawsuitCount(criminalAssignedStages)}
                href="/admin/dashboard/receipts-prep?ct=criminal"
                loading={loading}
              />
            }
          />
        </div>
      )}

      {showCriminalStages && (
        <div className="bg-red-100 border border-red-300 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">القضايا الجزائية المكلفة المتأخرة</h2>
            <span className="text-sm text-[#454042] font-medium">تجاوزت تاريخ الاستحقاق</span>
          </div>
          <StageGrid
            stages={criminalOverdueStages}
            loading={loading}
            emptyHref="/admin/tasks"
            showAddLink={false}
            emptyMessage="لا توجد مهام جزائية متأخرة حالياً"
            countLabel="متأخرة"
            linkLabel="عرض المتأخرة"
            barClassName="bg-orange-500"
            hrefForStage={(s) => `/admin/dashboard/stages/${encodeURIComponent(s.id)}?view=overdue`}
          />
        </div>
      )}

      {showPaymentOps && (
        <PaymentOpsCards
          branchId={branchId}
          viewAllBranches={viewAllBranches}
          listId={listId}
          section="payment"
          caseType={ct === 'civil' ? 'civil' : ct === 'criminal' ? 'criminal' : null}
          parentOps={opsRemote}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(accountantView
          ? [
              { label: 'مدين جديد', href: '/admin/debtors/new', bg: '#231F20', accent: '#2d2629' },
              { label: 'التسديدات', href: '/admin/payments', bg: '#2C8780', accent: '#1D6365' },
              { label: 'أتعاب المحامين', href: '/admin/finance', bg: '#059669', accent: '#047857' },
              { label: 'الصرفيات', href: '/admin/expenses', bg: '#475569', accent: '#334155' },
              { label: 'التقارير', href: '/admin/reports', bg: '#7c3aed', accent: '#6d28d9' },
            ]
          : [
              ...(allowAddDebtor
                ? [{ label: 'مدين جديد', href: '/admin/debtors/new', bg: '#231F20', accent: '#2d2629' }]
                : []),
              { label: 'تكليف المهام', href: '/admin/tasks', bg: '#2C8780', accent: '#1D6365' },
              { label: 'مراجعة الإنجازات', href: '/admin/tasks/review', bg: '#059669', accent: '#047857' },
              { label: 'القضايا المحسومة', href: '/admin/closed-cases', bg: '#475569', accent: '#334155' },
              { label: 'التقارير', href: '/admin/reports', bg: '#7c3aed', accent: '#6d28d9' },
            ]
        ).map(a => (
          <Link key={a.href} href={a.href}
            className="rounded-2xl px-4 py-3.5 flex items-center gap-2.5 text-white hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${a.bg}, ${a.accent})` }}>
            <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>

      {recentActivity.length > 0 && (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(118,118,118,0.08)]">
            <h3 className="font-bold text-[#231F20] text-sm">آخر النشاطات</h3>
            <Link href="/admin/activity" className="text-xs text-[#2C8780] font-semibold hover:underline">السجل الكامل ←</Link>
          </div>
          <div className="divide-y divide-[rgba(118,118,118,0.06)]">
            {visibleActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <p className="text-xs text-[#231F20] flex-1">{activityActionLabel(a.action)}</p>
                <span className="text-[10px] text-[#767676] shrink-0 tabular-nums" dir="ltr">
                  {a.created_at ? new Date(a.created_at).toLocaleDateString('ar-IQ') : '—'}
                </span>
              </div>
            ))}
          </div>
          <ShowMoreFooter
            hasMore={activityHasMore}
            expanded={activityExpanded}
            onToggle={toggleActivity}
            total={activityTotal}
          />
        </div>
      )}
    </div>
  )
}
