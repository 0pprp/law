import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS, RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { TaskStatus, TaskType } from '@/lib/types'
import TaskUpdateForm from '@/components/TaskUpdateForm'
import TaskExpenseForm from '@/components/TaskExpenseForm'
import TaskAcceptanceActions from '@/components/TaskAcceptanceActions'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { RECEIPT_TYPE_LABEL, RECEIPT_NUMBER_LABEL, RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  new: 'info', in_progress: 'warning', completed: 'success', failed: 'danger', postponed: 'gray', needs_info: 'purple', closed: 'gray',
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

export default async function LawyerTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: task } = await supabase
    .from('tasks')
    .select('*, task_definition_id')
    .eq('id', id)
    .eq('assigned_to', user.id)
    .single()

  if (!task) notFound()

  const { data: debtor } = await supabase
    .from('debtors')
    .select('full_name, phone, governorate, notes, receipt_type, receipt_number, receipt_amount, remaining_amount, required_amount')
    .eq('id', task.debtor_id)
    .single()

  const taskWithDebtor = { ...task, debtors: debtor }

  const [{ data: rawTaskAtts }, { data: rawDebtorAtts }, { data: expenses }] = await Promise.all([
    supabase.from('task_attachments').select('*').eq('task_id', id).order('created_at', { ascending: false }),
    supabase.from('debtor_attachments').select('*').eq('debtor_id', task.debtor_id).order('created_at', { ascending: false }),
    supabase.from('expenses').select('id, amount, expense_type, description, expense_date, created_at, status, rejection_reason').eq('task_id', id).order('created_at', { ascending: false }),
  ])

  const taskAttachments = await Promise.all(
    (rawTaskAtts ?? []).map(async att => {
      const { data } = await supabase.storage.from('task-files').createSignedUrl(att.file_path, 3600)
      return { ...att, signedUrl: data?.signedUrl ?? null }
    })
  )

  const debtorAttachments = await Promise.all(
    (rawDebtorAtts ?? []).map(async att => {
      const { data } = await supabase.storage.from('debtor-files').createSignedUrl(att.file_path, 3600)
      return { ...att, signedUrl: data?.signedUrl ?? null }
    })
  )

  const d = taskWithDebtor.debtors as any
  const status = taskWithDebtor.task_status as TaskStatus
  const isOverdue = taskWithDebtor.due_date && taskWithDebtor.due_date < new Date().toISOString().split('T')[0] && !['completed', 'closed', 'failed'].includes(status)
  const awaitingAcceptance = status === 'assignment_pending_acceptance'

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24 space-y-3">

      {/* Page header */}
      <div className={`bg-white rounded-2xl border shadow-sm p-4 ${isOverdue ? 'border-red-200' : 'border-slate-200'}`}>
        <div className="flex items-start gap-3">
          <Link href="/lawyer/tasks"
            className="w-9 h-9 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 shrink-0 transition-colors mt-0.5"
            aria-label="العودة">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h1 className="font-bold text-slate-800 text-base leading-tight">
                {TASK_TYPE_LABELS[taskWithDebtor.task_type as TaskType] ?? taskWithDebtor.task_type}
              </h1>
              <Badge variant={STATUS_BADGE[status] ?? 'default'}>{TASK_STATUS_LABELS[status]}</Badge>
            </div>
            {d?.full_name && <p className="text-xs text-slate-500 truncate">{d.full_name}</p>}
            {isOverdue && <p className="text-xs text-red-500 font-semibold mt-0.5">متأخرة عن الموعد</p>}
          </div>
        </div>
      </div>

      {awaitingAcceptance && (
        <TaskAcceptanceActions
          taskId={id}
          expiresAt={(taskWithDebtor as any).assignment_expires_at}
        />
      )}

      {/* Task details */}
      <Card>
        <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
          <h2 className="font-bold text-slate-700 text-sm">بيانات المهمة</h2>
        </div>
        <div className="px-4 py-0.5">
          <InfoRow label="نوع المهمة" value={TASK_TYPE_LABELS[taskWithDebtor.task_type as TaskType] ?? taskWithDebtor.task_type} />
          <InfoRow label="الحالة" value={TASK_STATUS_LABELS[status]} />
          <InfoRow label="المحافظة" value={taskWithDebtor.governorate} />
          <InfoRow label="المحكمة" value={taskWithDebtor.court_name} />
          {taskWithDebtor.due_date && <InfoRow label="تاريخ الاستحقاق" value={fmtDate(taskWithDebtor.due_date)} dir="ltr" />}
        </div>
      </Card>

      {/* Admin notes */}
      {taskWithDebtor.admin_notes && (
        <div className="bg-[#2C8780]/5 border border-[#2C8780]/20 rounded-2xl px-4 py-3.5">
          <p className="text-xs font-bold text-[#2C8780] mb-1.5 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            ملاحظات الإدارة
          </p>
          <p className="text-sm text-slate-800 leading-relaxed">{taskWithDebtor.admin_notes}</p>
        </div>
      )}

      {/* Previous lawyer notes */}
      {(taskWithDebtor.lawyer_notes || taskWithDebtor.legal_result) && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3.5 space-y-2.5">
          {taskWithDebtor.lawyer_notes && (
            <div>
              <p className="text-xs font-bold text-blue-700 mb-1">ملاحظاتك المسجلة</p>
              <p className="text-sm text-slate-800 leading-relaxed">{taskWithDebtor.lawyer_notes}</p>
            </div>
          )}
          {taskWithDebtor.legal_result && (
            <div>
              <p className="text-xs font-bold text-blue-700 mb-1">نتيجة الإجراء القانوني</p>
              <p className="text-sm text-slate-800 leading-relaxed">{taskWithDebtor.legal_result}</p>
            </div>
          )}
        </div>
      )}

      {/* Debtor info */}
      <Card>
        <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
          <h2 className="font-bold text-slate-700 text-sm">بيانات المدين</h2>
        </div>
        <div className="px-4 py-0.5">
          <InfoRow label="الاسم" value={d?.full_name} />
          <InfoRow label="الهاتف" value={d?.phone} href={d?.phone ? `tel:${d.phone}` : undefined} dir="ltr" />
          <InfoRow label="المحافظة" value={d?.governorate} />
          <InfoRow label={RECEIPT_TYPE_LABEL} value={d ? (RECEIPT_TYPE_LABELS[d.receipt_type as keyof typeof RECEIPT_TYPE_LABELS] ?? d.receipt_type) : null} />
          <InfoRow label={RECEIPT_NUMBER_LABEL} value={d?.receipt_number} dir="ltr" />
          {Number(d?.receipt_amount) > 0 && <InfoRow label={RECEIPT_AMOUNT_LABEL} value={fmtMoney(d.receipt_amount)} />}
          {Number(d?.remaining_amount) > 0 && <InfoRow label="المبلغ المتبقي" value={fmtMoney(d.remaining_amount)} />}
          {Number(d?.required_amount) > 0 && <InfoRow label="المطلوب النهائي" value={fmtMoney(d.required_amount)} />}
          {d?.notes && <InfoRow label="ملاحظات" value={d.notes} />}
        </div>
      </Card>

      {/* Debtor files */}
      {debtorAttachments.length > 0 && (
        <Card>
          <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
            <h2 className="font-bold text-slate-700 text-sm">ملف المدين / المستمسكات ({debtorAttachments.length})</h2>
          </div>
          <div className="px-4 py-0.5">
            {debtorAttachments.map(att => (
              <div key={att.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
                <span className="text-lg shrink-0">{att.mime_type === 'application/pdf' ? '📄' : '🖼️'}</span>
                <p className="flex-1 text-sm text-slate-700 font-medium truncate min-w-0">{att.file_name}</p>
                {att.signedUrl ? (
                  <div className="flex gap-1.5 shrink-0">
                    <a href={att.signedUrl} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 px-2.5 py-1 rounded-lg transition-colors">فتح</a>
                    <a href={att.signedUrl} download={att.file_name}
                      className="text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 px-2.5 py-1 rounded-lg transition-colors">تحميل</a>
                  </div>
                ) : <span className="text-xs text-slate-400 shrink-0">غير متاح</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Task update form + completion file uploads */}
      {!awaitingAcceptance && (
        <TaskUpdateForm task={taskWithDebtor} taskAttachments={taskAttachments} />
      )}

      {!awaitingAcceptance && (
        <TaskExpenseForm taskId={id} debtorId={taskWithDebtor.debtor_id} caseId={taskWithDebtor.case_id ?? null} branchId={task.branch_id ?? null} expenses={expenses ?? []} />
      )}
    </div>
  )
}