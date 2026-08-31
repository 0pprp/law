/**
 * كاش ديناميكي لأرقام لوحة التحكم والكروت فقط (ذاكرة الجلسة — بدون sessionStorage).
 * يُعرض فوراً عند الرجوع للصفحة، ويُمسَح ويُعاد الجلب مع كل أكشن يغيّر الأرقام.
 */

export const DASHBOARD_COUNTS_CHANGED = 'dashboard-counts-changed'

export type OpsCardCounts = {
  awaiting: number | null
  prep: number | null
  receiptsPrep: number | null
  payment: number | null
  pending: number | null
  instant: number | null
  recentNames: number | null
  legalArchive: number | null
}

export type DashboardStageSnapshot = {
  civilStages: unknown[]
  criminalStages: unknown[]
  civilAssignedStages: unknown[]
  criminalAssignedStages: unknown[]
  civilOverdueStages: unknown[]
  criminalOverdueStages: unknown[]
  pleadingHearingBadges: { yellow: number; red: number; gray: number }
  unassigned: number
  assigned: number
  pendingReview: number
  recentActivity: { action: string; created_at: string }[]
}

const opsByKey = new Map<string, OpsCardCounts>()
const dashByKey = new Map<string, DashboardStageSnapshot>()

function purgeLegacySessionKeys(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const drop: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (!k?.startsWith('qalat:qc:v1:')) continue
      if (
        k.includes('opsCards:')
        || k.includes('dashboard:v')
      ) {
        drop.push(k)
      }
    }
    drop.forEach(k => sessionStorage.removeItem(k))
  } catch {
    // ignore
  }
}

export function opsCountsKey(
  branchId: string | null,
  listId: string | null | undefined,
  caseType: string | null | undefined,
  section: string,
): string {
  return `ops:${branchId ?? 'all'}:${listId ?? 'all'}:${caseType ?? 'both'}:${section}`
}

export function dashboardCountsKey(
  branchId: string | null,
  listId: string | null | undefined,
  caseType: string | null | undefined,
): string {
  return `dash:${branchId ?? 'all'}:${listId ?? 'all'}:${caseType ?? 'both'}`
}

export function peekOpsCardCounts(key: string): OpsCardCounts | null {
  return opsByKey.get(key) ?? null
}

export function writeOpsCardCounts(key: string, value: OpsCardCounts): void {
  opsByKey.set(key, value)
}

export function peekDashboardStageCounts(key: string): DashboardStageSnapshot | null {
  return dashByKey.get(key) ?? null
}

export function writeDashboardStageCounts(key: string, value: DashboardStageSnapshot): void {
  dashByKey.set(key, value)
}

/**
 * امسح كاش الأرقام وأبلغ كل الشاشات المفتوحة لإعادة الجلب.
 * استدعِها بعد: إضافة/حذف/استيراد مدين، إسناد مهمة، تحويل للمراقبة/التجهيز/التسديد، اعتماد مراجعة…
 */
export function invalidateDashboardCounts(): void {
  opsByKey.clear()
  dashByKey.clear()
  purgeLegacySessionKeys()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DASHBOARD_COUNTS_CHANGED))
  }
}

/** توافق مع الاستدعاءات القديمة */
export const invalidateDashboardAndOpsCaches = invalidateDashboardCounts
export const OPS_COUNTS_REFRESH = DASHBOARD_COUNTS_CHANGED
