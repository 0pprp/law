import type { TaskStatus } from '@/lib/types'
import { TASK_STATUS_LABELS } from '@/lib/types'

/** Admin-approved tasks count as achieved for the lawyer UI. */
export const LAWYER_ACHIEVED_STATUSES: TaskStatus[] = ['approved', 'completed']

export function isLawyerAchievedTask(status: string): boolean {
  return LAWYER_ACHIEVED_STATUSES.includes(status as TaskStatus)
}

export function lawyerTaskStatusLabel(status: TaskStatus | string): string {
  if (isLawyerAchievedTask(status)) return 'منجزة'
  return TASK_STATUS_LABELS[status as TaskStatus] ?? status
}

export function countLawyerAchievedTasks<T extends { task_status: string }>(tasks: T[]): number {
  return tasks.filter(t => isLawyerAchievedTask(t.task_status)).length
}
