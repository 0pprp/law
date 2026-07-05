import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeTaskLabelKey } from '@/lib/task-label-normalize'

export interface TaskDefinitionExpense {
  id: string
  task_definition_id: string
  name: string
  max_amount: number
  sort_order: number
}

export interface GetTaskExpensesInput {
  taskDefinitionId?: string | null
  taskName?: string | null
  branchId?: string | null
  taskType?: string | null
}

export interface GetTaskExpensesResult {
  expenses: TaskDefinitionExpense[]
  taskDefinitionId: string | null
}

export function normalizeExpenseRows(rows: unknown): TaskDefinitionExpense[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map(row => ({
      id: String((row as TaskDefinitionExpense).id),
      task_definition_id: String((row as TaskDefinitionExpense).task_definition_id),
      name: String((row as TaskDefinitionExpense).name),
      max_amount: Number((row as TaskDefinitionExpense).max_amount),
      sort_order: Number((row as TaskDefinitionExpense).sort_order ?? 0),
    }))
    .filter(e => e.max_amount > 0)
    .sort((a, b) => a.sort_order - b.sort_order)
}

async function fetchExpensesDirect(
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
      console.error('[getTaskExpenses:direct]', error.message)
    }
    return []
  }

  return normalizeExpenseRows(data)
}

/** جلب الصرفيات عبر task_definitions — يعمل أحياناً عندما يُحجب الاستعلام المباشر */
export async function fetchExpensesViaDefinitionEmbed(
  supabase: SupabaseClient,
  taskDefinitionId: string,
): Promise<TaskDefinitionExpense[]> {
  const { data, error } = await supabase
    .from('task_definitions')
    .select('id, task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
    .eq('id', taskDefinitionId)
    .maybeSingle()

  if (error) {
    if (!error.message.includes('does not exist')) {
      console.error('[getTaskExpenses:embed]', error.message)
    }
    return []
  }

  const embedded = (data as { task_definition_expenses?: unknown } | null)?.task_definition_expenses
  return normalizeExpenseRows(embedded)
}

async function fetchExpensesByDefinitionId(
  supabase: SupabaseClient,
  taskDefinitionId: string,
): Promise<TaskDefinitionExpense[]> {
  const direct = await fetchExpensesDirect(supabase, taskDefinitionId)
  if (direct.length > 0) return direct
  return fetchExpensesViaDefinitionEmbed(supabase, taskDefinitionId)
}

async function findDefinitionIdByType(
  supabase: SupabaseClient,
  taskType: string,
  branchId?: string | null,
): Promise<string | null> {
  if (branchId) {
    const { data } = await supabase
      .from('task_definitions')
      .select('id')
      .eq('task_type', taskType)
      .eq('is_active', true)
      .eq('branch_id', branchId)
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  const { data } = await supabase
    .from('task_definitions')
    .select('id')
    .eq('task_type', taskType)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function findDefinitionIdByName(
  supabase: SupabaseClient,
  taskName: string,
  branchId?: string | null,
): Promise<string | null> {
  const key = normalizeTaskLabelKey(taskName)

  const matchFromRows = (rows: { id: string; label: string }[] | null) =>
    rows?.find(r => normalizeTaskLabelKey(r.label) === key)?.id ?? null

  if (branchId) {
    const { data: branchRows } = await supabase
      .from('task_definitions')
      .select('id, label')
      .eq('is_active', true)
      .eq('branch_id', branchId)
    const id = matchFromRows(branchRows)
    if (id) return id
  }

  const { data: allRows } = await supabase
    .from('task_definitions')
    .select('id, label')
    .eq('is_active', true)
  return matchFromRows(allRows)
}

export async function resolveTaskDefinitionId(
  supabase: SupabaseClient,
  input: GetTaskExpensesInput,
): Promise<string | null> {
  if (input.taskDefinitionId) return input.taskDefinitionId
  if (input.taskType) {
    const id = await findDefinitionIdByType(supabase, input.taskType, input.branchId)
    if (id) return id
  }
  if (input.taskName?.trim()) {
    return findDefinitionIdByName(supabase, input.taskName, input.branchId)
  }
  return null
}

export async function getTaskExpenses(
  supabase: SupabaseClient,
  input: GetTaskExpensesInput,
): Promise<GetTaskExpensesResult> {
  const taskDefinitionId = await resolveTaskDefinitionId(supabase, input)
  if (!taskDefinitionId) {
    return { expenses: [], taskDefinitionId: null }
  }
  const expenses = await fetchExpensesByDefinitionId(supabase, taskDefinitionId)
  return { expenses, taskDefinitionId }
}

export function taskHasExpenses(expenses: TaskDefinitionExpense[]): boolean {
  return expenses.some(e => Number(e.max_amount) > 0)
}

export async function fetchTaskDefinitionExpensesForTask(
  supabase: SupabaseClient,
  task: {
    task_definition_id?: string | null
    task_type?: string | null
    branch_id?: string | null
    task_label?: string | null
    definition_label?: string | null
  },
): Promise<TaskDefinitionExpense[]> {
  const { expenses } = await getTaskExpenses(supabase, {
    taskDefinitionId: task.task_definition_id,
    taskName: task.definition_label ?? task.task_label,
    branchId: task.branch_id,
    taskType: task.task_type,
  })
  return expenses
}

export function taskHasExpenseDefinitions(expenses: TaskDefinitionExpense[]): boolean {
  return taskHasExpenses(expenses)
}

export function resolveExpenseDefsForTask(expenseDefs: TaskDefinitionExpense[]): TaskDefinitionExpense[] {
  return expenseDefs
}
