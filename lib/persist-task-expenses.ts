import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/activity-log'
import { localTodayYmd } from '@/lib/local-date'
import { parseMoneyInput } from '@/lib/money-input'
import type { TaskDefinitionExpense } from '@/lib/task-definition-expenses'

export interface PendingTaskExpense {
  defId: string
  name: string
  max_amount: number
  amount: number
  note: string
  task_definition_expense_id?: string | null
}

const PENDING_STATUSES = ['pending_review', 'pending_approval', 'pending']

function isDbExpenseId(id: string): boolean {
  return !id.startsWith('catalog:')
}

/** حفظ صرفيات المهمة عند إرسال الإنجاز — status pending حتى الاعتماد */
export async function persistTaskExpenses(
  supabase: SupabaseClient,
  params: {
    taskId: string
    debtorId: string
    caseId?: string | null
    branchId?: string | null
    lawyerId: string
    rows: PendingTaskExpense[]
  },
): Promise<{ ok: boolean; error?: string; count: number; total: number }> {
  const { taskId, debtorId, caseId, branchId, lawyerId, rows } = params

  await supabase
    .from('expenses')
    .delete()
    .eq('task_id', taskId)
    .in('status', PENDING_STATUSES)
    .is('wallet_deducted_at', null)

  const toInsert = rows
  if (!toInsert.length) {
    return { ok: true, count: 0, total: 0 }
  }

  const today = localTodayYmd()
  const inserts = toInsert.map(row => ({
    debtor_id: debtorId,
    task_id: taskId,
    case_id: caseId ?? null,
    branch_id: branchId ?? null,
    lawyer_id: lawyerId,
    amount: row.amount,
    expense_type: row.name,
    description: row.note.trim() || null,
    expense_date: today,
    created_by: lawyerId,
    status: 'pending_review',
    max_allowed_amount: row.max_amount,
    task_definition_expense_id: row.task_definition_expense_id ?? (isDbExpenseId(row.defId) ? row.defId : null),
  }))

  const { error: insertErr } = await supabase.from('expenses').insert(inserts as any)
  if (insertErr) {
    return { ok: false, error: insertErr.message, count: 0, total: 0 }
  }

  const total = inserts.reduce((s, e) => s + Number(e.amount), 0)
  const payableCount = inserts.filter(e => Number(e.amount) > 0).length
  await logActivity({
    action: 'submit_task_expenses',
    entity_type: 'task',
    entity_id: taskId,
    description: `تسجيل صرفيات المهمة (${payableCount} بند بمبلغ > 0) — ${total.toLocaleString('en-US')} د.ع`,
  }, supabase)

  return { ok: true, count: inserts.length, total }
}

export function pendingRowsFromDefs(
  expenseDefs: TaskDefinitionExpense[],
  amounts: { amount: string; note: string }[],
): PendingTaskExpense[] {
  return expenseDefs.map((def, i) => ({
    defId: def.id,
    name: def.name,
    max_amount: def.max_amount,
    amount: parseMoneyInput(amounts[i]?.amount ?? ''),
    note: amounts[i]?.note ?? '',
    task_definition_expense_id: def.id.startsWith('catalog:') ? null : def.id,
  }))
}

/** تحقق من بنود نافذة الصرفيات قبل الإرسال */
export function validateTaskExpenseModalRows(
  expenseDefs: TaskDefinitionExpense[],
  rows: { amount: string; note: string }[],
): string | null {
  for (let i = 0; i < expenseDefs.length; i++) {
    const def = expenseDefs[i]
    const row = rows[i]
    if (!row) return `بيانات ناقصة: ${def.name}`

    const rawAmount = row.amount.trim()
    if (rawAmount === '') {
      return `يجب إدخال المبلغ لـ «${def.name}» — اكتب 0 إذا لم تصرف`
    }

    if (!/^\d+$/.test(rawAmount.replace(/,/g, ''))) {
      return `المبلغ غير صالح لـ «${def.name}» — أدخل رقماً فقط`
    }

    const amt = parseMoneyInput(rawAmount)
    if (amt < 0) return `المبلغ لا يمكن أن يكون سالباً — ${def.name}`
    if (amt > def.max_amount) {
      return `لا يمكن تجاوز الحد الأعلى ${def.max_amount.toLocaleString('en-US')} د.ع — ${def.name}`
    }
    if (amt > 0 && !row.note.trim()) {
      return `يجب إدخال ملاحظة لـ «${def.name}» عند وجود مبلغ`
    }
  }
  return null
}
