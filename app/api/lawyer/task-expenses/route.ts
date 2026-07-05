import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkLawyerTaskAccess } from '@/lib/lawyer-task-access'
import {
  getTaskExpenses,
  fetchExpensesViaDefinitionEmbed,
  resolveTaskDefinitionId,
  normalizeExpenseRows,
} from '@/lib/task-definition-expenses'
import { resolveTaskLabel } from '@/lib/task-display-label'

/** بنود صرفيات مهمة للمحامي — يُستخدم عند «تم الإنجاز» */
export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId')
    if (!taskId) {
      return NextResponse.json({ error: 'taskId مطلوب' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const access = await checkLawyerTaskAccess(supabase, user.id, taskId)
    if (!access.ok) {
      return NextResponse.json({ error: 'المهمة غير متاحة' }, { status: 403 })
    }

    const task = access.task as {
      task_definition_id?: string | null
      task_type?: string | null
      task_label?: string | null
      branch_id?: string | null
    }

    let definitionLabel: string | null = null
    let definitionTaskType: string | null = null
    let embeddedExpenses: ReturnType<typeof normalizeExpenseRows> = []

    const resolvedId = await resolveTaskDefinitionId(supabase, {
      taskDefinitionId: task.task_definition_id,
      taskName: task.task_label,
      branchId: task.branch_id,
      taskType: task.task_type,
    })

    const defId = task.task_definition_id ?? resolvedId

    if (defId) {
      const { data: def } = await supabase
        .from('task_definitions')
        .select('id, label, task_type, task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
        .eq('id', defId)
        .maybeSingle()

      if (def) {
        definitionLabel = def.label ?? null
        definitionTaskType = def.task_type ?? null
        embeddedExpenses = normalizeExpenseRows(
          (def as { task_definition_expenses?: unknown }).task_definition_expenses,
        )
      }
    }

    const taskName = definitionLabel ?? task.task_label ?? null
    const result = await getTaskExpenses(supabase, {
      taskDefinitionId: defId,
      taskName,
      branchId: task.branch_id,
      taskType: definitionTaskType ?? task.task_type,
    })

    let expenses = result.expenses
    if (expenses.length === 0 && embeddedExpenses.length > 0) {
      expenses = embeddedExpenses
    }
    if (expenses.length === 0 && defId) {
      expenses = await fetchExpensesViaDefinitionEmbed(supabase, defId)
    }

    return NextResponse.json({
      expenses,
      taskDefinitionId: result.taskDefinitionId ?? defId,
      taskId,
      taskName: resolveTaskLabel(definitionTaskType ?? task.task_type ?? '', taskName),
    })
  } catch (err) {
    console.error('[api/lawyer/task-expenses]', err)
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 })
  }
}
