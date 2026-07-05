import type { GetTaskExpensesResult, TaskDefinitionExpense } from '@/lib/task-definition-expenses'

export interface LawyerTaskExpensesResponse extends GetTaskExpensesResult {
  taskId?: string
  taskName?: string | null
}

/** جلب صرفيات المهمة من API — للاستخدام عند «تم الإنجاز» */
export async function fetchLawyerTaskExpenses(taskId: string): Promise<LawyerTaskExpensesResponse> {
  const res = await fetch(`/api/lawyer/task-expenses?taskId=${encodeURIComponent(taskId)}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) {
    return { expenses: [], taskDefinitionId: null }
  }
  return res.json() as Promise<LawyerTaskExpensesResponse>
}

export function mergeExpenseSources(
  ...sources: TaskDefinitionExpense[][]
): TaskDefinitionExpense[] {
  for (const list of sources) {
    if (list.length > 0) return list
  }
  return []
}
