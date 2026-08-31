import type { SupabaseClient } from '@supabase/supabase-js'
import { countAwaitingAssignmentDebtors } from '@/lib/awaiting-assignment'
import { countExperimentalQueue } from '@/lib/experimental-queues'
import { countFilePreparationDebtors } from '@/lib/file-preparation'
import { fetchReceiptsPrep } from '@/lib/receipts-prep'
import { schedulePromoteStandaloneNotifications } from '@/lib/pleading-notification-twin'
import {
  fetchDashboardData,
  fetchPendingReviewCount,
  fetchPleadingHearingBadgeCounts,
  type PleadingHearingBadgeCounts,
  type UnassignedStageCount,
} from '@/lib/task-assignment'

const EMPTY_DASH = {
  stages: [] as UnassignedStageCount[],
  assignedStages: [] as UnassignedStageCount[],
  overdueStages: [] as UnassignedStageCount[],
  unassigned: 0,
  assigned: 0,
}

export type DashboardOpsCounts = {
  awaiting: number
  prep: number
  receiptsPrep: number
  instant: number
  recentNames: number
  legalArchive: number
}

export type DashboardBootstrapResult = {
  civil: typeof EMPTY_DASH
  criminal: typeof EMPTY_DASH
  ops: DashboardOpsCounts
  pendingReview: number
  recentActivity: { action: string; created_at: string }[]
  pleadingHearingBadges: PleadingHearingBadgeCounts
}

async function countAwaitingAndPrep(
  admin: SupabaseClient,
  branchId: string | null,
  branchListId: string | null,
  caseType: 'civil' | 'criminal' | null,
): Promise<{ awaiting: number; prep: number }> {
  if (!caseType && branchListId) {
    const [civilRes, crimRes, civilPrep, crimPrep] = await Promise.all([
      countAwaitingAssignmentDebtors(admin, branchId, {
        branchListId,
        caseType: 'civil',
        mode: 'awaiting',
      }),
      countAwaitingAssignmentDebtors(admin, branchId, {
        branchListId: null,
        caseType: 'criminal',
        mode: 'awaiting',
      }),
      countFilePreparationDebtors(admin, branchId, {
        branchListId,
        caseType: 'civil',
      }),
      countFilePreparationDebtors(admin, branchId, {
        branchListId: null,
        caseType: 'criminal',
      }),
    ])
    return {
      awaiting: (civilRes.error ? 0 : civilRes.total) + (crimRes.error ? 0 : crimRes.total),
      prep: civilPrep + crimPrep,
    }
  }
  const [res, prep] = await Promise.all([
    countAwaitingAssignmentDebtors(admin, branchId, {
      branchListId,
      caseType,
      mode: 'awaiting',
    }),
    countFilePreparationDebtors(admin, branchId, {
      branchListId,
      caseType,
    }),
  ])
  return { awaiting: res.error ? 0 : res.total, prep }
}

async function countReceiptsPrep(
  admin: SupabaseClient,
  branchId: string | null,
  branchListId: string | null,
  caseType: 'civil' | 'criminal' | null,
): Promise<number> {
  const run = (ct: 'civil' | 'criminal' | null, listId: string | null) =>
    fetchReceiptsPrep(admin as any, {
      branchId,
      branchListId: listId,
      caseType: ct,
      countOnly: true,
    }).then(r => r.total).catch(() => 0)

  if (!caseType && branchListId) {
    const [civil, criminal] = await Promise.all([
      run('civil', branchListId),
      run('criminal', null),
    ])
    return civil + criminal
  }
  return run(caseType, caseType === 'criminal' ? null : branchListId)
}

async function countInstantCases(
  admin: SupabaseClient,
  branchId: string | null,
  branchListId: string | null,
  include: boolean,
): Promise<number> {
  if (!include) return 0
  let cq = admin.from('instant_case_nominations').select('id', { count: 'exact', head: true })
  if (branchId) cq = cq.eq('branch_id', branchId)
  if (branchListId) cq = cq.eq('branch_list_id', branchListId)
  const { count, error } = await cq
  if (error) return 0
  return count ?? 0
}

/**
 * تحميل لوحة التحكم بطلب سيرفر واحد: المراحل + أرقام الكروت + المراجعة + النشاط.
 */
export async function fetchDashboardBootstrap(
  admin: SupabaseClient,
  params: {
    branchId: string | null
    branchListId: string | null
    caseType: 'civil' | 'criminal' | null
    includeCivil: boolean
    includeCriminal: boolean
    includeOps: boolean
    includeInstant: boolean
    includeHearingBadges: boolean
  },
): Promise<DashboardBootstrapResult> {
  const listForCivil = params.caseType === 'criminal' ? null : params.branchListId
  const opsListId = params.caseType === 'criminal' ? null : params.branchListId

  schedulePromoteStandaloneNotifications(admin as any, {
    branchId: params.branchId,
    caseType: params.caseType,
    branchListId: listForCivil,
  })

  const emptyOps: DashboardOpsCounts = {
    awaiting: 0,
    prep: 0,
    receiptsPrep: 0,
    instant: 0,
    recentNames: 0,
    legalArchive: 0,
  }

  const [civil, criminal, ops, pendingReview, activityRes, hearingBadges] = await Promise.all([
    params.includeCivil
      ? fetchDashboardData(admin, params.branchId, {
          caseType: 'civil',
          branchListId: listForCivil,
        })
      : Promise.resolve(EMPTY_DASH),
    params.includeCriminal
      ? fetchDashboardData(admin, params.branchId, {
          caseType: 'criminal',
          branchListId: null,
        })
      : Promise.resolve(EMPTY_DASH),
    params.includeOps
      ? (async () => {
          const [awaitingPrep, receiptsPrep, instant, legalArchive, recentNames] = await Promise.all([
            countAwaitingAndPrep(admin, params.branchId, opsListId, params.caseType),
            countReceiptsPrep(admin, params.branchId, opsListId, params.caseType),
            countInstantCases(admin, params.branchId, opsListId, params.includeInstant),
            countExperimentalQueue(admin, 'archive', {
              branchId: params.branchId,
              branchListId: opsListId,
              caseType: params.caseType,
            }).catch(() => 0),
            countExperimentalQueue(admin, 'recent', {
              branchId: params.branchId,
              branchListId: opsListId,
              caseType: params.caseType,
            }).catch(() => 0),
          ])
          return {
            awaiting: awaitingPrep.awaiting,
            prep: awaitingPrep.prep,
            receiptsPrep,
            instant,
            recentNames,
            legalArchive,
          } satisfies DashboardOpsCounts
        })()
      : Promise.resolve(emptyOps),
    fetchPendingReviewCount(
      admin,
      params.branchId,
      params.caseType === 'criminal' ? null : params.branchListId,
      params.caseType,
    ).catch(() => 0),
    (async () => {
      let aq = admin
        .from('activity_logs')
        .select('action, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
      if (params.branchId) aq = (aq as any).eq('branch_id', params.branchId)
      return aq
    })(),
    params.includeHearingBadges && params.includeCivil
      ? fetchPleadingHearingBadgeCounts(admin, params.branchId, {
          branchListId: listForCivil,
        })
      : Promise.resolve({ yellow: 0, red: 0, gray: 0 } as PleadingHearingBadgeCounts),
  ])

  return {
    civil,
    criminal,
    ops,
    pendingReview,
    recentActivity: activityRes.data ?? [],
    pleadingHearingBadges: hearingBadges,
  }
}
