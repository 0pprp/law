import { TASK_FEE_MAP } from '@/lib/constants'
import type { TaskType } from '@/lib/types'

/** إنجاز = مهمة اعتمدها الأدمن بعد تسليم المحامي */
export const ACHIEVEMENT_STATUSES = ['approved', 'completed'] as const

export type AchievementTask = {
  id: string
  task_type: string | null
  task_status: string
  assigned_to: string | null
  debtor_id: string
  completed_at: string | null
  created_at: string
  task_definition_id: string | null
  reward_amount?: number | null
  task_definitions?: { label: string } | null
}

export interface AchievementFilters {
  dateFrom?: string
  dateTo?: string
  debtorId?: string
  lawyerId?: string
}

export function isAchievement(task: { task_status: string }): boolean {
  return (ACHIEVEMENT_STATUSES as readonly string[]).includes(task.task_status)
}

export function achievementDate(task: AchievementTask): string {
  return (task.completed_at ?? task.created_at).split('T')[0]
}

export function achievementLabel(task: AchievementTask): string {
  return task.task_definitions?.label ?? task.task_type ?? '—'
}

export function achievementFee(task: AchievementTask): number {
  const reward = Number(task.reward_amount ?? 0)
  if (reward > 0) return reward
  return TASK_FEE_MAP[task.task_type as TaskType] ?? 0
}

export function filterAchievements(
  tasks: AchievementTask[],
  filters: AchievementFilters,
): AchievementTask[] {
  const { dateFrom, dateTo, debtorId, lawyerId } = filters
  return tasks.filter(t => {
    if (!isAchievement(t)) return false
    if (debtorId && t.debtor_id !== debtorId) return false
    if (lawyerId && t.assigned_to !== lawyerId) return false
    const date = achievementDate(t)
    if (dateFrom && date < dateFrom) return false
    if (dateTo && date > dateTo) return false
    return true
  })
}

export interface AchievementByType {
  key: string
  label: string
  count: number
  fees: number
}

export interface AchievementByLawyer {
  id: string
  name: string
  governorate: string | null
  count: number
  fees: number
  topLabel: string
  topCount: number
  lastDate: string | null
}

export function buildAchievementByType(achievements: AchievementTask[]): AchievementByType[] {
  const map = new Map<string, AchievementByType>()
  for (const t of achievements) {
    const key = t.task_definition_id ?? t.task_type ?? t.id
    const label = achievementLabel(t)
    const cur = map.get(key) ?? { key, label, count: 0, fees: 0 }
    cur.count++
    cur.fees += achievementFee(t)
    map.set(key, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.fees - a.fees)
}

export function buildAchievementByLawyer(
  achievements: AchievementTask[],
  lawyers: { id: string; full_name: string; governorate?: string | null }[],
): AchievementByLawyer[] {
  const byLawyer = new Map<string, AchievementTask[]>()
  for (const t of achievements) {
    if (!t.assigned_to) continue
    if (!byLawyer.has(t.assigned_to)) byLawyer.set(t.assigned_to, [])
    byLawyer.get(t.assigned_to)!.push(t)
  }

  const lawyerMap = new Map(lawyers.map(l => [l.id, l]))

  return Array.from(byLawyer.entries())
    .map(([id, list]) => {
      const lawyer = lawyerMap.get(id)
      const byType = buildAchievementByType(list)
      const top = byType[0]
      const fees = list.reduce((s, t) => s + achievementFee(t), 0)
      const last = list
        .map(t => achievementDate(t))
        .sort((a, b) => b.localeCompare(a))[0] ?? null
      return {
        id,
        name: lawyer?.full_name ?? '—',
        governorate: lawyer?.governorate ?? null,
        count: list.length,
        fees,
        topLabel: top?.label ?? '—',
        topCount: top?.count ?? 0,
        lastDate: last,
      }
    })
    .sort((a, b) => b.count - a.count || b.fees - a.fees)
}
