import { createClient } from '@/lib/supabase/server'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import { checkLawyerTaskAccess } from '@/lib/lawyer-task-access'
import { lawyerTaskStatusLabel, isLawyerAchievedTask } from '@/lib/lawyer-task-display'
import { isTaskOverdue, isTaskDueToday } from '@/lib/local-date'
import { resolveTaskLabel, formatRequiredFieldLabel, type TaskRequiredFieldDisplay } from '@/lib/task-display-label'
import {
  getTaskExpenses,
  fetchExpensesViaDefinitionEmbed,
  normalizeExpenseRows,
  type TaskDefinitionExpense,
} from '@/lib/task-definition-expenses'
import TaskUpdateForm from '@/components/TaskUpdateForm'
import TaskAcceptanceActions from '@/components/TaskAcceptanceActions'
import LawyerTaskRequirements from '@/components/LawyerTaskRequirements'
import LawyerAccessDenied from '@/components/LawyerAccessDenied'
import LawyerDebtorGPS from '@/components/LawyerDebtorGPS'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { RECEIPT_TYPE_LABEL, RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  new: 'info',
  in_progress: 'warning',
  completed: 'success',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

function InfoRow({ label, value, dir, href }: { label: string; value?: string | null; dir?: 'ltr'; href?: string }) {
  if (!value) return null
  return (
    <div className="flex justify-between items-start gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-400 shrink-0 min-w-[90px]">{label}</span>
      {href ? (
        <a href={href} className="text-[#2C8780] text-sm font-semibold text-left break-all" dir={dir}>{value}</a>
      ) : (
        <span className="text-sm font-semibold text-slate-800 text-left break-words" dir={dir}>{value}</span>
      )}
    </div>
  )
}

export default async function DelegateTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <LawyerAccessDenied />

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'delegate') {
    redirect(profile?.role === 'lawyer' ? `/lawyer/tasks/${id}` : '/admin/dashboard')
  }

  const access = await checkLawyerTaskAccess(supabase, user.id, id)
  if (!access.ok) return <LawyerAccessDenied />
  if (access.task.assigned_to !== user.id) return <LawyerAccessDenied />

  const task = access.task as {
    id: string
    debtor_id: string
    task_type: string
    task_status: TaskStatus
    due_date?: string | null
    admin_notes?: string | null
    lawyer_notes?: string | null
    legal_result?: string | null
    governorate?: string | null
    court_name?: string | null
    branch_id?: string | null
    assignment_expires_at?: string | null
    task_definition_id?: string | null
    task_label?: string | null
    reward_amount?: number | null
    assigned_to?: string | null
    assignment_rejected_by?: string | null
  }

  const { data: debtor } = await supabase
    .from('debtors')
    .select('full_name, phone, address, governorate, receipt_type, receipt_amount, remaining_amount, latitude, longitude, location_captured_at, branch_list:branch_lists(name)')
    .eq('id', task.debtor_id)
    .single()

  const taskWithDebtor = { ...task, debtors: debtor }

  const [{ data: rawTaskAtts }, { data: rawDebtorAtts }, { data: expenses }, taskDefResult, reqFieldsResult] = await Promise.all([
    supabase.from('task_attachments').select('*').eq('task_id', id).order('created_at', { ascending: false }),
    supabase.from('debtor_attachments').select('*').eq('debtor_id', task.debtor_id).order('created_at', { ascending: false }),
    supabase.from('expenses').select('id, amount, expense_type, description, expense_date, created_at, status, rejection_reason').eq('task_id', id).order('created_at', { ascending: false }),
    task.task_definition_id
      ? supabase.from('task_definitions').select('label, fee_amount, task_type').eq('id', task.task_definition_id).maybeSingle()
      : Promise.resolve({ data: null }),
    task.task_definition_id
      ? supabase.from('task_required_fields').select('field_key, field_type, field_label, is_required, sort_order').eq('task_definition_id', task.task_definition_id).order('sort_order')
      : Promise.resolve({ data: [] as { field_key: string; field_type: string; field_label: string | null; is_required: boolean; sort_order: number }[] }),
  ])

  const taskDefinition = taskDefResult.data
  const requiredFields: TaskRequiredFieldDisplay[] = (reqFieldsResult.data ?? []).map(f => ({
    label: formatRequiredFieldLabel(f),
    isRequired: f.is_required,
    fieldType: f.field_type,
  }))

  let expenseDefs: TaskDefinitionExpense[] = []
  if (task.task_definition_id) {
    const { data: defWithExpenses } = await supabase
      .from('task_definitions')
      .select('id, label, fee_amount, task_type, task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
      .eq('id', task.task_definition_id)
      .maybeSingle()

    if (defWithExpenses) {
      expenseDefs = normalizeExpenseRows(
        (defWithExpenses as { task_definition_expenses?: unknown }).task_definition_expenses,
      )
    }
  }
  if (expenseDefs.length === 0) {
    const { expenses: defs } = await getTaskExpenses(supabase, {
      taskDefinitionId: task.task_definition_id,
      taskName: taskDefinition?.label ?? task.task_label,
      branchId: task.branch_id,
      taskType: taskDefinition?.task_type ?? task.task_type,
    })
    expenseDefs = defs
  }
  if (expenseDefs.length === 0 && task.task_definition_id) {
    expenseDefs = await fetchExpensesViaDefinitionEmbed(supabase, task.task_definition_id)
  }

  const taskAttachments = await Promise.all(
    (rawTaskAtts ?? []).map(async att => {
      const { data } = await supabase.storage.from('task-files').createSignedUrl(att.file_path, 3600)
      return { ...att, signedUrl: data?.signedUrl ?? null }
    }),
  )

  const debtorAttachments = await Promise.all(
    (rawDebtorAtts ?? []).map(async att => {
      const { data } = await supabase.storage.from('debtor-files').createSignedUrl(att.file_path, 3600)
      return { ...att, signedUrl: data?.signedUrl ?? null }
    }),
  )

  const d = debtor as {
    full_name?: string
    phone?: string | null
    address?: string | null
    governorate?: string | null
    receipt_type?: string
    receipt_amount?: number
    remaining_amount?: number
    latitude?: number | null
    longitude?: number | null
    location_captured_at?: string | null
    branch_list?: { name?: string } | { name?: string }[] | null
  } | null

  const debtorListName = (() => {
    const bl = Array.isArray(d?.branch_list) ? d.branch_list[0] : d?.branch_list
    return bl?.name?.trim() || null
  })()

  const primaryDebtorFile =
    debtorAttachments.find(att => att.signedUrl && att.mime_type === 'application/pdf')
    ?? debtorAttachments.find(att => att.signedUrl)
    ?? null

  const status = task.task_status
  const isOverdue = task.due_date && isTaskOverdue(task.due_date) && !['completed', 'closed', 'failed', 'approved'].includes(status)
  const isLastDay = task.due_date && isTaskDueToday(task.due_date) && !isOverdue
  const awaitingAcceptance = status === 'assignment_pending_acceptance'
  const taskLabel = resolveTaskLabel(task.task_type, taskDefinition?.label)
  const taskFee = Number(task.reward_amount ?? taskDefinition?.fee_amount ?? 0)

  return (
    <div className="max-w-lg mx-auto px-0 sm:px-2 pt-2 pb-24 space-y-3">
      <div className={`bg-white rounded-2xl border shadow-sm p-4 ${isOverdue ? 'border-red-200' : isLastDay ? 'border-amber-300' : 'border-slate-200'}`}>
        <div className="flex items-start gap-3">
          <Link
            href="/delegate/tasks"
            className="w-9 h-9 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 shrink-0 transition-colors mt-0.5"
            aria-label="العودة"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h1 className="font-bold text-slate-800 text-base leading-tight">{taskLabel}</h1>
              <Badge variant={isLawyerAchievedTask(status) ? 'success' : (STATUS_BADGE[status] ?? 'default')}>
                {lawyerTaskStatusLabel(status, task, user.id, { assigneeRole: 'delegate' })}
              </Badge>
            </div>
            {d?.full_name && <p className="text-xs text-slate-500 truncate">{d.full_name}</p>}
            {isOverdue && <p className="text-xs text-red-500 font-semibold mt-0.5">متأخرة عن الموعد</p>}
            {isLastDay && !isOverdue && <p className="text-xs text-amber-700 font-semibold mt-0.5">اليوم آخر يوم لإنجاز المهمة</p>}
          </div>
        </div>
      </div>

      <LawyerTaskRequirements
        taskLabel={taskLabel}
        requiredFields={requiredFields}
        feeAmount={taskFee > 0 ? taskFee : null}
      />

      {awaitingAcceptance && (
        <TaskAcceptanceActions
          taskId={id}
          taskLabel={taskLabel}
          expiresAt={task.assignment_expires_at}
        />
      )}

      <Card>
        <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
          <h2 className="font-bold text-slate-700 text-sm">بيانات المدين</h2>
        </div>
        <div className="px-4 py-0.5">
          <InfoRow label="الاسم" value={d?.full_name} />
          {d?.phone && <InfoRow label="الهاتف" value={d.phone} href={`tel:${d.phone}`} dir="ltr" />}
          <InfoRow
            label={RECEIPT_TYPE_LABEL}
            value={d ? (RECEIPT_TYPE_LABELS[d.receipt_type as keyof typeof RECEIPT_TYPE_LABELS] ?? d.receipt_type) : null}
          />
          {Number(d?.receipt_amount) > 0 && <InfoRow label={RECEIPT_AMOUNT_LABEL} value={fmtMoney(d!.receipt_amount!)} />}
          {Number(d?.remaining_amount) > 0 && <InfoRow label="المبلغ المتبقي" value={fmtMoney(d!.remaining_amount!)} />}
          {debtorListName && <InfoRow label="القائمة" value={debtorListName} />}
          {d?.address && <InfoRow label="العنوان" value={d.address} />}
          {d?.governorate && <InfoRow label="المحافظة" value={d.governorate} />}
          <div className="flex justify-between items-center gap-4 py-2.5 border-b border-slate-100 last:border-0">
            <span className="text-sm text-slate-400 shrink-0 min-w-[90px]">ملف المدين</span>
            {primaryDebtorFile?.signedUrl ? (
              <a
                href={primaryDebtorFile.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#2C8780] text-sm font-semibold hover:underline shrink-0"
              >
                فتح ملف المدين
              </a>
            ) : (
              <span className="text-sm text-slate-400">لا يوجد ملف</span>
            )}
          </div>
        </div>
      </Card>

      <LawyerDebtorGPS
        latitude={d?.latitude ?? null}
        longitude={d?.longitude ?? null}
        locationCapturedAt={d?.location_captured_at}
      />

      <Card>
        <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
          <h2 className="font-bold text-slate-700 text-sm">المهمة المطلوبة</h2>
        </div>
        <div className="px-4 py-0.5">
          <InfoRow label="اسم المهمة" value={taskLabel} />
          {task.governorate && <InfoRow label="المحافظة" value={task.governorate} />}
          {task.court_name && <InfoRow label="المحكمة" value={task.court_name} />}
          {task.due_date && <InfoRow label="تاريخ الاستحقاق" value={fmtDate(task.due_date)} dir="ltr" />}
        </div>
        {task.admin_notes && (
          <div className="mx-4 mb-4 mt-2 bg-[#2C8780]/5 border border-[#2C8780]/20 rounded-xl px-3.5 py-3">
            <p className="text-xs font-bold text-[#2C8780] mb-1">ملاحظات الإدارة</p>
            <p className="text-sm text-slate-800 leading-relaxed">{task.admin_notes}</p>
          </div>
        )}
        {(task.lawyer_notes || task.legal_result) && (
          <div className="mx-4 mb-4 bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-3 space-y-2">
            {task.lawyer_notes && (
              <div>
                <p className="text-xs font-bold text-blue-700 mb-1">ملاحظاتك المسجلة</p>
                <p className="text-sm text-slate-800 leading-relaxed">{task.lawyer_notes}</p>
              </div>
            )}
            {task.legal_result && (
              <div>
                <p className="text-xs font-bold text-blue-700 mb-1">نتيجة الإجراء</p>
                <p className="text-sm text-slate-800 leading-relaxed">{task.legal_result}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {!awaitingAcceptance && (
        <TaskUpdateForm
          task={taskWithDebtor as any}
          taskAttachments={taskAttachments}
          expenseDefs={expenseDefs}
          taskExpenses={expenses ?? []}
        />
      )}
    </div>
  )
}
