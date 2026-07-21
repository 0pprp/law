'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import Link from 'next/link'
import { useAdminRole } from '@/context/admin-role'
import { canAddDebtor, canReviewTasks, canViewLegalManagerWallet, isAccountant, isAdmin, isLegalManager } from '@/lib/permissions'
import { resolveCaseScope, filterBySection } from '@/lib/case-scope'
import { fetchLegalManagerWalletBalance, listActiveLegalManagers } from '@/lib/legal-manager-wallet'
import { fmtMoney } from '@/lib/utils'
import { activityActionLabel } from '@/lib/activity-labels'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'
import { StatCard } from '@/components/ui/stat-card'
import { stageAccent, stageIconBg } from '@/lib/stage-config'
import { scheduleBranchMaintenance } from '@/lib/branch-maintenance'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/query-cache'
import PaymentOpsCards from '@/components/PaymentOpsCards'
import {
  fetchDashboardData,
  fetchPendingReviewCount,
  type UnassignedStageCount,
} from '@/lib/task-assignment'

interface DashboardCache {
  civilStages: UnassignedStageCount[]
  criminalStages: UnassignedStageCount[]
  civilAssignedStages: UnassignedStageCount[]
  criminalAssignedStages: UnassignedStageCount[]
  civilOverdueStages: UnassignedStageCount[]
  criminalOverdueStages: UnassignedStageCount[]
  unassigned: number
  assigned: number
  pendingReview: number
  recentActivity: { action: string; created_at: string }[]
}

const EMPTY_DASH = {
  stages: [] as UnassignedStageCount[],
  assignedStages: [] as UnassignedStageCount[],
  overdueStages: [] as UnassignedStageCount[],
  unassigned: 0,
  assigned: 0,
}

function TaskStageIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
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
  if (stages.length === 0) {
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {stages.map((s, i) => {
        const pct = stageTotal > 0 ? Math.round((s.count / stageTotal) * 100) : 0
        const href = hrefForStage?.(s) ?? `/admin/dashboard/stages/${s.id}`
        return (
          <StatCard
            key={`${s.id}-${countLabel}`}
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
        )
      })}
    </div>
  )
}

export default function DashboardPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const scope = resolveCaseScope(role)
  const roleCt = filterBySection(scope)
  /** المدير/الموظف: تبويب مدني | جزائي | الكل — نفس تجربة مسؤول المدنية عند اختيار مدني */
  const canFocusSection = isAdmin(role) || role === 'employee'
  const [sectionFocus, setSectionFocus] = useState<'both' | 'civil' | 'criminal'>('both')
  const ct = canFocusSection
    ? (sectionFocus === 'both' ? null : sectionFocus)
    : roleCt
  const allowAddDebtor = canAddDebtor(role)
  const showAddDebtorLink = allowAddDebtor
  /** محفظة الأتعاب مدنية فقط — مسؤول القانونية المدنية */
  const legalManagerView = isLegalManager(role)
  const adminWalletView = canViewLegalManagerWallet(role)
  const accountantView = isAccountant(role)
  const showReviewCard = !accountantView && canReviewTasks(role)
  const showCivilStages = ct === null || ct === 'civil'
  const showCriminalStages = ct === null || ct === 'criminal'
  const showPaymentOps = ct !== 'criminal'
  const [lmWalletBalance, setLmWalletBalance] = useState<number | null>(null)
  const [civilStages, setCivilStages] = useState<UnassignedStageCount[]>([])
  const [criminalStages, setCriminalStages] = useState<UnassignedStageCount[]>([])
  const [civilAssignedStages, setCivilAssignedStages] = useState<UnassignedStageCount[]>([])
  const [criminalAssignedStages, setCriminalAssignedStages] = useState<UnassignedStageCount[]>([])
  const [civilOverdueStages, setCivilOverdueStages] = useState<UnassignedStageCount[]>([])
  const [criminalOverdueStages, setCriminalOverdueStages] = useState<UnassignedStageCount[]>([])
  const [totalPendingReview, setTotalPendingReview] = useState(0)
  const [totalWaiting, setTotalWaiting] = useState(0)
  const [totalAssigned, setTotalAssigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [recentActivity, setRecentActivity] = useState<{ action: string; created_at: string }[]>([])

  const loadData = useCallback(async () => {
    const supabase = createClient()

    if (!branchId && !viewAllBranches) {
      setCivilStages([])
      setCriminalStages([])
      setCivilAssignedStages([])
      setCriminalAssignedStages([])
      setCivilOverdueStages([])
      setCriminalOverdueStages([])
      setTotalWaiting(0)
      setTotalAssigned(0)
      setTotalPendingReview(0)
      setRecentActivity([])
      setLoading(false)
      return
    }

    const cacheKey = `dashboard:v8:${branchId ?? 'all'}:${listId ?? 'all'}:${ct ?? 'both'}`
    const cached = cacheGet<DashboardCache>(cacheKey)
    if (cached) {
      setCivilStages(cached.civilStages)
      setCriminalStages(cached.criminalStages)
      setCivilAssignedStages(cached.civilAssignedStages)
      setCriminalAssignedStages(cached.criminalAssignedStages)
      setCivilOverdueStages(cached.civilOverdueStages)
      setCriminalOverdueStages(cached.criminalOverdueStages)
      setTotalWaiting(cached.unassigned)
      setTotalAssigned(cached.assigned)
      setTotalPendingReview(cached.pendingReview)
      setRecentActivity(cached.recentActivity)
      setLoading(false)
      return
    }

    setLoading(true)
    setCivilStages([])
    setCriminalStages([])
    setCivilAssignedStages([])
    setCriminalAssignedStages([])
    setCivilOverdueStages([])
    setCriminalOverdueStages([])
    setTotalWaiting(0)
    setTotalAssigned(0)
    setTotalPendingReview(0)
    setRecentActivity([])

    scheduleBranchMaintenance(supabase, branchId)

    try {
      let aq = supabase
        .from('activity_logs')
        .select('action, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
      if (branchId) aq = (aq as any).eq('branch_id', branchId)

      const fetchCivil = showCivilStages
        ? fetchDashboardData(supabase, branchId, {
            caseType: 'civil',
            branchListId: viewAllBranches ? null : listId,
          })
        : Promise.resolve(EMPTY_DASH)
      // الجزائي لا يستخدم قائمة الفرع
      const fetchCriminal = showCriminalStages
        ? fetchDashboardData(supabase, branchId, { caseType: 'criminal', branchListId: null })
        : Promise.resolve(EMPTY_DASH)

      const [civilData, criminalData, pendingReview, activityRes] = await Promise.all([
        fetchCivil,
        fetchCriminal,
        fetchPendingReviewCount(
          supabase,
          branchId,
          ct === 'criminal' || viewAllBranches ? null : listId,
          ct,
        ),
        aq,
      ])

      const next: DashboardCache = {
        civilStages: civilData.stages,
        criminalStages: criminalData.stages,
        civilAssignedStages: civilData.assignedStages,
        criminalAssignedStages: criminalData.assignedStages,
        civilOverdueStages: civilData.overdueStages,
        criminalOverdueStages: criminalData.overdueStages,
        unassigned: civilData.unassigned + criminalData.unassigned,
        assigned: civilData.assigned + criminalData.assigned,
        pendingReview,
        recentActivity: activityRes.data ?? [],
      }
      cacheSet(cacheKey, next, CACHE_TTL.dashboard)

      setCivilStages(next.civilStages)
      setCriminalStages(next.criminalStages)
      setCivilAssignedStages(next.civilAssignedStages)
      setCriminalAssignedStages(next.criminalAssignedStages)
      setCivilOverdueStages(next.civilOverdueStages)
      setCriminalOverdueStages(next.criminalOverdueStages)
      setTotalWaiting(next.unassigned)
      setTotalAssigned(next.assigned)
      setTotalPendingReview(next.pendingReview)
      setRecentActivity(next.recentActivity)
    } catch (e: unknown) {
      console.error('[admin/dashboard] load error:', e)
    }
    setLoading(false)
  }, [branchId, viewAllBranches, listId, ct, showCivilStages, showCriminalStages])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!legalManagerView && !adminWalletView) return
    if (ct === 'criminal') {
      setLmWalletBalance(null)
      return
    }
    const supabase = createClient()
    if (legalManagerView) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return
        fetchLegalManagerWalletBalance(supabase, user.id).then(setLmWalletBalance)
      })
      return
    }
    // المدير: رصيد مسؤول المدنية للفرع الحالي (أو أول مسؤول إن وُجد)
    listActiveLegalManagers(supabase).then(async (managers) => {
      const match = branchId
        ? managers.find(m => m.branch_id === branchId) ?? managers[0]
        : managers[0]
      if (!match) {
        setLmWalletBalance(null)
        return
      }
      setLmWalletBalance(await fetchLegalManagerWalletBalance(supabase, match.id))
    })
  }, [legalManagerView, adminWalletView, branchId, ct])

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

      {legalManagerView && ct !== 'criminal' && (
        <StatCard
          label="رصيد أتعابك"
          value={lmWalletBalance === null ? '—' : fmtMoney(lmWalletBalance)}
          accent="teal"
          valueColor="text-[#2C8780]"
          sub="لك نسبة 5% من أتعاب كل إنجاز معتمد (الدعاوى المدنية فقط)"
        />
      )}

      {adminWalletView && ct !== 'criminal' && (
        <Link href="/admin/legal-manager-wallet" className="block">
          <StatCard
            label="محفظة مسؤول الدعاوى المدنية"
            value={lmWalletBalance === null ? '—' : fmtMoney(lmWalletBalance)}
            accent="teal"
            valueColor="text-[#2C8780]"
            sub="عرض وإدارة المحفظة — نسبة 5% من الإنجازات المعتمدة"
          />
        </Link>
      )}

      <PaymentOpsCards
        branchId={branchId}
        viewAllBranches={viewAllBranches}
        listId={listId}
        section="awaiting"
        caseType={ct}
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
        <div>
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
          />
        </div>
      )}

      {showCivilStages && (
        <div>
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
          />
        </div>
      )}

      {showCivilStages && (
        <div>
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
        <div>
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
        <div>
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
          />
        </div>
      )}

      {showCriminalStages && (
        <div>
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
