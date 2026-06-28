import type { SupabaseClient } from '@supabase/supabase-js'

export interface TaskDefinitionExpense {
  id: string
  task_definition_id: string
  name: string
  max_amount: number
  sort_order: number
}

export async function fetchTaskDefinitionExpenses(
  supabase: SupabaseClient,
  taskDefinitionId: string,
): Promise<TaskDefinitionExpense[]> {
  const { data, error } = await supabase
    .from('task_definition_expenses')
    .select('id, task_definition_id, name, max_amount, sort_order')
    .eq('task_definition_id', taskDefinitionId)
    .gt('max_amount', 0)
    .order('sort_order', { ascending: true })

  if (error) {
    if (!error.message.includes('does not exist')) {
      console.error('[fetchTaskDefinitionExpenses]', error.message)
    }
    return []
  }

  return (data ?? []).map(row => ({
    ...row,
    max_amount: Number(row.max_amount),
  })) as TaskDefinitionExpense[]
}

async function resolveTaskDefinitionId(
  supabase: SupabaseClient,
  task: {
    task_definition_id?: string | null
    task_type?: string | null
    branch_id?: string | null
  },
): Promise<string | null> {
  if (task.task_definition_id) return task.task_definition_id
  if (!task.task_type) return null

  let q = supabase
    .from('task_definitions')
    .select('id')
    .eq('task_type', task.task_type)
    .eq('is_active', true)

  if (task.branch_id) {
    q = q.eq('branch_id', task.branch_id)
  }

  const { data } = await q.limit(1).maybeSingle()
  return data?.id ?? null
}

/** Expense lines for a task — read only from task_definition_expenses (no code defaults). */
export async function fetchTaskDefinitionExpensesForTask(
  supabase: SupabaseClient,
  task: {
    task_definition_id?: string | null
    task_type?: string | null
    branch_id?: string | null
  },
): Promise<TaskDefinitionExpense[]> {
  const defId = await resolveTaskDefinitionId(supabase, task)
  if (!defId) return []
  return fetchTaskDefinitionExpenses(supabase, defId)
}

export function taskHasExpenseDefinitions(expenses: TaskDefinitionExpense[]): boolean {
  return expenses.some(e => Number(e.max_amount) > 0)
}
