import type { TaskStatus } from '@/lib/types'
import { TASK_STATUS_LABELS } from '@/lib/types'

/** Admin-approved tasks count as achieved for the lawyer UI. */
export const LAWYER_ACHIEVED_STATUSES: TaskStatus[] = ['approved', 'completed']

export function isLawyerAchievedTask(status: string): boolean {
  return LAWYER_ACHIEVED_STATUSES.includes(status as TaskStatus)
}

export function isLawyerAssignmentRejected(
  task: { assigned_to?: string | null; assignment_rejected_by?: string | null },
  lawyerId?: string | null,
): boolean {
  if (!lawyerId || !task.assignment_rejected_by) return false
  return task.assignment_rejected_by === lawyerId && task.assigned_to !== lawyerId
}

export function lawyerTaskStatusLabel(
  status: TaskStatus | string,
  task?: { assigned_to?: string | null; assignment_rejected_by?: string | null },
  lawyerId?: string | null,
): string {
  if (task && isLawyerAssignmentRejected(task, lawyerId)) return 'مرفوضة'
  if (isLawyerAchievedTask(status)) return 'منجزة'
  return TASK_STATUS_LABELS[status as TaskStatus] ?? status
}

export function countLawyerAchievedTasks<T extends { task_status: string }>(tasks: T[]): number {
  return tasks.filter(t => isLawyerAchievedTask(t.task_status)).length
}
