'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import Link from 'next/link'
import { useAdminRole } from '@/context/admin-role'
import { canAddDebtor, isLegalManager } from '@/lib/permissions'
import { fetchLegalManagerWalletBalance } from '@/lib/legal-manager-wallet'
import { fmtMoney } from '@/lib/utils'
import { activityActionLabel } from '@/lib/activity-labels'
import { StatCard } from '@/components/ui/stat-card'
import { stageAccent, stageIconBg } from '@/lib/stage-config'
import { scheduleBranchMaintenance } from '@/lib/branch-maintenance'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/query-cache'
import {
  fetchDashboardData,
  fetchPendingReviewCount,
  type UnassignedStageCount,
} from '@/lib/task-assignment'

interface DashboardCache {
  stages: UnassignedStageCount[]
  unassigned: number
  assigned: number
  pendingReview: number
  recentActivity: { action: string; created_at: string }[]
}

function TaskStageIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}

export default function DashboardPage() {
  const branchId = useBranchId()
  const role = useAdminRole()
  const allowAddDebtor = canAddDebtor(role)
  const showAddDebtorLink = allowAddDebtor || isLegalManager(role)
  const legalManagerView = isLegalManager(role)
  const [lmWalletBalance, setLmWalletBalance] = useState<number | null>(null)
  const [stages, setStages] = useState<UnassignedStageCount[]>([])
  const [totalPendingReview, setTotalPendingReview] = useState(0)
  const [totalWaiting, setTotalWaiting] = useState(0)
  const [totalAssigned, setTotalAssigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [recentActivity, setRecentActivity] = useState<{ action: string; created_at: string }[]>([])

  const loadData = useCallback(async () => {
    const supabase = createClient()

    if (!branchId) {
      setStages([])
      setTotalWaiting(0)
      setTotalAssigned(0)
      setTotalPendingReview(0)
      setRecentActivity([])
      setLoading(false)
      return
    }

    const cacheKey = `dashboard:${branchId}`
    const cached = cacheGet<DashboardCache>(cacheKey)
    if (cached) {
      setStages(cached.stages)
      setTotalWaiting(cached.unassigned)
      setTotalAssigned(cached.assigned)
      setTotalPendingReview(cached.pendingReview)
      setRecentActivity(cached.recentActivity)
      setLoading(false)
      return
    }

    setLoading(true)
    setStages([])
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
      aq = (aq as any).eq('branch_id', branchId)

      const [dashData, pendingReview, activityRes] = await Promise.all([
        fetchDashboardData(supabase, branchId),
        fetchPendingReviewCount(supabase, branchId),
        aq,
      ])

      const next: DashboardCache = {
        stages: dashData.stages,
        unassigned: dashData.unassigned,
        assigned: dashData.assigned,
        pendingReview,
        recentActivity: activityRes.data ?? [],
      }
      cacheSet(cacheKey, next, CACHE_TTL.dashboard)

      setStages(next.stages)
      setTotalWaiting(next.unassigned)
      setTotalAssigned(next.assigned)
      setTotalPendingReview(next.pendingReview)
      setRecentActivity(next.recentActivity)
    } catch (e: unknown) {
      console.error('[admin/dashboard] load error:', e)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!legalManagerView) return
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      fetchLegalManagerWalletBalance(supabase, user.id).then(setLmWalletBalance)
    })
  }, [legalManagerView])

  const stageTotal = stages.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className="space-y-6 w-full">

      {/* Hero */}
      <div className="rounded-2xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #231F20 0%, #1a1617 100%)' }}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-[#2C8780]/10 rounded-full" />
        </div>
        <div className="relative z-10 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
          <div className="flex-1">
            <p className="text-[#2C8780] text-xs font-bold tracking-[0.25em] uppercase mb-2.5">منصة التحصيل القانوني</p>
            <h1 className="text-white text-2xl sm:text-3xl font-black leading-tight">لوحة مراحل القضايا</h1>
            <p className="text-white/50 text-sm sm:text-base mt-2 font-medium">مهام غير مكلفة حسب نوع المهمة — والمكلفة وبانتظار المراجعة</p>
          </div>
          <div className="flex items-stretch gap-5 sm:gap-6 shrink-0">
            <Link href="/admin/tasks" className="text-center group">
              <p className="text-3xl sm:text-4xl font-black text-yellow-400 tabular-nums group-hover:text-yellow-300 transition-colors">
                {loading ? '—' : totalWaiting}
              </p>
              <p className="text-xs text-white/45 mt-1 font-semibold">غير مكلفة</p>
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

      {!branchId && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض مراحل القضايا.
        </div>
      )}

      {legalManagerView && (
        <Link href="/admin/legal-manager-wallet" className="block">
          <StatCard
            label="محفظة مدير القانونية"
            value={lmWalletBalance === null ? '—' : fmtMoney(lmWalletBalance)}
            accent="teal"
            valueColor="text-[#2C8780]"
            sub="1,000 د.ع لكل إنجاز معتمد — عرض التفاصيل"
          />
        </Link>
      )}

      {/* Stage boxes — unassigned only */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-black text-[#231F20] text-base sm:text-lg">المراحل القانونية (غير مكلفة)</h2>
          <span className="text-sm text-[#454042] font-medium">المهام المكلفة لا تظهر هنا</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-white rounded-xl border animate-pulse" />
            ))}
          </div>
        ) : stages.length === 0 ? (
          <div className="bg-white rounded-2xl border p-12 text-center">
            <p className="text-sm font-semibold text-[#231F20]">لا توجد مهام غير مكلفة حالياً</p>
            {showAddDebtorLink && (
            <Link href="/admin/debtors/new" className="inline-flex mt-4 text-xs font-semibold text-[#2C8780] hover:underline">
              إضافة مدين جديد ←
            </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {stages.map((s, i) => {
              const pct = stageTotal > 0 ? Math.round((s.count / stageTotal) * 100) : 0
              return (
                <StatCard
                  key={s.id}
                  label={s.label}
                  value={s.count}
                  sub={`${s.count} غير مكلفة · ${pct}%`}
                  accent={stageAccent(i)}
                  icon={<TaskStageIcon />}
                  iconBg={stageIconBg(i)}
                  footer={
                    <div className="space-y-2">
                      <div className="h-1.5 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <Link
                        href={`/admin/dashboard/stages/${s.id}`}
                        className="block w-full py-1.5 text-center text-[11px] font-bold text-white rounded-lg hover:opacity-90 transition-opacity"
                        style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                      >
                        عرض غير المكلفة
                      </Link>
                    </div>
                  }
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'مدين جديد', href: '/admin/debtors/new', bg: '#231F20', accent: '#2d2629' },
          { label: 'تكليف المهام', href: '/admin/tasks', bg: '#2C8780', accent: '#1D6365' },
          { label: 'مراجعة الإنجازات', href: '/admin/tasks/review', bg: '#059669', accent: '#047857' },
          { label: 'القضايا المحسومة', href: '/admin/closed-cases', bg: '#475569', accent: '#334155' },
          { label: 'التقارير', href: '/admin/reports', bg: '#7c3aed', accent: '#6d28d9' },
        ].map(a => (
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
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <p className="text-xs text-[#231F20] flex-1">{activityActionLabel(a.action)}</p>
                <span className="text-[10px] text-[#767676] shrink-0 tabular-nums" dir="ltr">
                  {a.created_at ? new Date(a.created_at).toLocaleDateString('ar-IQ') : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
