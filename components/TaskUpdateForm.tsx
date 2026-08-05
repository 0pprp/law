'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { RequiredField, Task } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { DatePicker } from '@/components/ui/date-picker'
import { PremiumSelect } from '@/components/ui/premium-select'
import TaskCompletionExpenseModal from '@/components/TaskCompletionExpenseModal'
import HybridTaskSelectionModal, { type HybridSelectionResult } from '@/components/HybridTaskSelectionModal'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import { getTaskExpenses, fetchExpensesViaDefinitionEmbed, normalizeExpenseRows, type TaskDefinitionExpense } from '@/lib/task-definition-expenses'
import { fetchLawyerTaskExpenses, mergeExpenseSources } from '@/lib/fetch-lawyer-task-expenses'
import { resolveTaskLabel } from '@/lib/task-display-label'
import { normalizeTaskLabelKey } from '@/lib/task-label-normalize'
import type { PendingTaskExpense } from '@/lib/persist-task-expenses'
import { persistTaskExpenses } from '@/lib/persist-task-expenses'
import { validateTaskCompletionFields } from '@/lib/task-completion-validation'
import { visibleTaskFeeAmount } from '@/lib/visible-task-fee'
import {
  fetchHybridTaskLinks,
  hybridFieldKey,
  isMissingHybridSchema,
  partitionCompletionDataByDefinition,
  type HybridLinkInfo,
} from '@/lib/hybrid-task-links'
import { invalidateLawyerTasksCache } from '@/lib/task-assignment'
import { buildIncompleteCompletionData, isIncompleteCompletionRequest } from '@/lib/incomplete-completion'

interface Attachment {
  id: string
  file_name: string
  signedUrl: string | null
}

interface ReqField {
  id: string
  field_key: string
  field_type: string
  field_label: string | null
  is_required: boolean
  sort_order: number
}

interface Props {
  task: Task & Record<string, any>
  taskAttachments: Attachment[]
  expenseDefs?: TaskDefinitionExpense[]
  taskExpenses?: { id: string; status?: string | null }[]
}

const INP = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

// ─── Completion Modal (dynamic) ────────────────────────────────────────────────
export function LawyerTaskCompletionModal({
  task,
  reqFields,
  fee: _fee,
  onClose,
  onSubmitted,
  skipRouterRefresh,
  taskLabel,
  pendingExpenses = [],
  expenseStepDone = false,
  hybridParentDefinitionId = null,
  hybridSelectedLinked = [],
}: {
  task: Task & Record<string, any>
  reqFields: ReqField[]
  fee: number
  onClose: () => void
  onSubmitted: () => void
  skipRouterRefresh?: boolean
  taskLabel?: string
  pendingExpenses?: PendingTaskExpense[]
  expenseStepDone?: boolean
  /** إن وُجدت مهام مرتبطة محددة — وضع هجين */
  hybridParentDefinitionId?: string | null
  hybridSelectedLinked?: HybridLinkInfo[]
}) {
  const router = useRouter()
  const isHybridSubmit = Boolean(hybridParentDefinitionId && hybridSelectedLinked.length > 0)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const existing = task.completion_data
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return {}
    return Object.fromEntries(
      Object.entries(existing).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  })
  const [files, setFiles] = useState<Record<string, File>>({})
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [generalNotes, setGeneralNotes] = useState('')
  const [teamOptions, setTeamOptions] = useState<{ value: string; label: string }[]>([])
  const [gpsLoading, setGpsLoading] = useState(false)

  useEffect(() => {
    const branchId = (task as { branch_id?: string | null }).branch_id
    if (!branchId) return
    const supabase = createClient()
    Promise.all([
      supabase.from('execution_departments').select('name').eq('branch_id', branchId).eq('is_active', true).order('name'),
      supabase.from('courts').select('name').eq('branch_id', branchId).eq('is_active', true).order('name'),
    ]).then(([depts, courts]) => {
      const names = [...new Set([
        ...(depts.data ?? []).map((d: { name: string }) => d.name),
        ...(courts.data ?? []).map((c: { name: string }) => c.name),
      ])].filter(Boolean)
      setTeamOptions(names.map(n => ({ value: n, label: n })))
    })
  }, [task])

  function set(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  function validate(): string | null {
    return validateTaskCompletionFields(reqFields, values, new Set(Object.keys(files)))
  }

  async function uploadFile(file: File, key: string): Promise<void> {
    const body = new FormData()
    body.append('file', file)
    body.append('taskId', task.id)
    body.append('description', key)
    body.append('kind', 'attachment')
    const res = await fetch('/api/worker/upload-task-file', { method: 'POST', body })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'فشل رفع الملف')
    }
  }

  async function insertLinkedHybridTasks(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    rawCompletion: Record<string, string>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!hybridParentDefinitionId || !hybridSelectedLinked.length) return { ok: true }

    const defIds = [
      hybridParentDefinitionId,
      ...hybridSelectedLinked.map(l => l.linked_definition_id),
    ]
    const partitioned = partitionCompletionDataByDefinition(rawCompletion, defIds)
    const nowIso = new Date().toISOString()
    const assignedTo = (task as { assigned_to?: string | null }).assigned_to ?? userId

    for (const link of hybridSelectedLinked) {
      const childCompletion = partitioned[link.linked_definition_id] ?? {}
      const basePayload: Record<string, unknown> = {
        debtor_id: task.debtor_id,
        branch_id: (task as any).branch_id ?? null,
        task_definition_id: link.linked_definition_id,
        task_type: link.task_type ?? task.task_type ?? null,
        assigned_to: assignedTo,
        task_status: 'pending_review',
        reward_amount: Number(link.fee_amount) || 0,
        completion_data: childCompletion,
        completed_at: nowIso,
        created_by: userId,
        lawyer_notes: childCompletion.note || null,
        legal_result: childCompletion.legal_result || null,
      }

      const withParent = { ...basePayload, hybrid_parent_task_id: task.id }

      let { error: insErr } = await supabase.from('tasks').insert(withParent as any)

      if (insErr && isMissingHybridSchema(insErr.message)) {
        // العمود غير موجود بعد — أعد المحاولة بدونه
        ;({ error: insErr } = await supabase.from('tasks').insert(basePayload as any))
      }

      if (insErr) {
        // fallback حالة submitted إن لم تُقبل pending_review
        const msg = String(insErr.message ?? '')
        if (msg.toLowerCase().includes('pending_review') || msg.toLowerCase().includes('invalid input value for enum')) {
          const retryPayload = { ...withParent, task_status: 'submitted' }
          let { error: retryErr } = await supabase.from('tasks').insert(retryPayload as any)
          if (retryErr && isMissingHybridSchema(retryErr.message)) {
            ;({ error: retryErr } = await supabase
              .from('tasks')
              .insert({ ...basePayload, task_status: 'submitted' } as any))
          }
          if (retryErr) {
            return { ok: false, error: `فشل إنشاء المهمة المرتبطة «${link.label}»: ${retryErr.message}` }
          }
          continue
        }
        return { ok: false, error: `فشل إنشاء المهمة المرتبطة «${link.label}»: ${insErr.message}` }
      }
    }

    return { ok: true }
  }

  async function submit() {
    const err = validate()
    if (err) { setError(err); return }

    setSaving(true)
    setError('')

    // Upload files
    setUploading(true)
    try {
      for (const [key, file] of Object.entries(files)) {
        await uploadFile(file, key)
      }
    } catch (e) {
      setUploading(false)
      setSaving(false)
      setError(e instanceof Error ? e.message : 'فشل رفع الملف')
      return
    }
    setUploading(false)

    // Build completion_data
    const completionData: Record<string, string> = { ...values }
    for (const [key, file] of Object.entries(files)) {
      completionData[key] = file.name
    }
    if (generalNotes.trim()) completionData['general_notes'] = generalNotes.trim()

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يرجى تسجيل الدخول'); setSaving(false); return }

    if (expenseStepDone) {
      const expenseResult = await persistTaskExpenses(supabase, {
        taskId: task.id,
        debtorId: task.debtor_id,
        caseId: (task as any).case_id,
        branchId: (task as any).branch_id,
        lawyerId: user.id,
        rows: pendingExpenses,
      })
      if (!expenseResult.ok) {
        setError(expenseResult.error ?? 'فشل حفظ الصرفيات')
        setSaving(false)
        return
      }
    }

    // للوضع الهجين: completion_data للأساسية = حقولها فقط
    let parentCompletion = completionData
    if (isHybridSubmit && hybridParentDefinitionId) {
      const defIds = [
        hybridParentDefinitionId,
        ...hybridSelectedLinked.map(l => l.linked_definition_id),
      ]
      const partitioned = partitionCompletionDataByDefinition(completionData, defIds)
      parentCompletion = partitioned[hybridParentDefinitionId] ?? {}
      if (generalNotes.trim()) parentCompletion.general_notes = generalNotes.trim()
    }

    const submitPayloads = [
      { task_status: 'submitted' as const },
      { task_status: 'pending_review' as const },
    ]
    let updateErr: { message?: string } | null = null
    const baseUpdate = {
      lawyer_notes: parentCompletion['note'] || values['note'] || task.lawyer_notes || null,
      legal_result: parentCompletion['legal_result'] || values['legal_result'] || null,
      completion_data: parentCompletion,
      completed_at: new Date().toISOString(),
    }
    for (const statusPart of submitPayloads) {
      const { error } = await supabase.from('tasks').update({
        ...baseUpdate,
        ...statusPart,
      } as any).eq('id', task.id)
      if (!error) {
        updateErr = null
        break
      }
      updateErr = error
    }

    if (updateErr) { setError(updateErr.message ?? 'خطأ في التحديث'); setSaving(false); return }

    if (isHybridSubmit) {
      const linkedResult = await insertLinkedHybridTasks(supabase, user.id, completionData)
      if (!linkedResult.ok) {
        setError(linkedResult.error ?? 'فشل إنشاء المهام المرتبطة')
        setSaving(false)
        return
      }
    }

    await logActivity({
      action: 'submit_task',
      entity_type: 'task',
      entity_id: task.id,
      description: isHybridSubmit
        ? `إرسال مهمة هجينة للاعتماد (+${hybridSelectedLinked.length} مرتبطة)`
        : 'إرسال المهمة للاعتماد',
    }, supabase)

    invalidateLawyerTasksCache()
    onSubmitted()
    onClose()
    if (!skipRouterRefresh) router.refresh()
  }

  function getGPS(key: string) {
    if (!navigator.geolocation) { setError('المتصفح لا يدعم تحديد الموقع'); return }
    setError('')
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        set(key, `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
        setGpsLoading(false)
      },
      (err) => {
        const messages: Record<number, string> = {
          1: 'تم رفض إذن الموقع — فعّل الموقع من إعدادات المتصفح وحاول مرة أخرى',
          2: 'تعذر تحديد الموقع — تحقق من تشغيل خدمة GPS وحاول مرة أخرى',
          3: 'انتهت مهلة تحديد الموقع — حاول مرة أخرى',
        }
        setError(messages[err.code] ?? 'تعذر تحديد الموقع — حاول مرة أخرى')
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  function renderField(f: ReqField) {
    const label = f.field_label ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField] ?? f.field_type
    const req = f.is_required

    switch (f.field_type) {
      case 'note':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <textarea rows={3} value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP + ' resize-none'} placeholder="اكتب ملاحظاتك..." />
          </div>
        )

      case 'legal_result':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <textarea rows={2} value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP + ' resize-none'} placeholder="النتيجة القانونية للمهمة..." />
          </div>
        )

      case 'court_decision':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <textarea rows={3} value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP + ' resize-none'} placeholder="اكتب قرار المحكمة..." />
          </div>
        )

      case 'team':
        return (
          <div key={f.id}>
            <PremiumSelect
              value={values[f.field_key] ?? ''}
              onChange={v => set(f.field_key, v)}
              options={[
                { value: '', label: '— اختر الفريق —' },
                ...teamOptions,
              ]}
              fieldLabel={label + (req ? ' *' : '')}
              placeholder="— اختر من القائمة —"
              headerTitle="الفريق"
              searchPlaceholder="بحث..."
              searchable={teamOptions.length > 6}
            />
          </div>
        )

      case 'decision_number':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="أدخل رقم القرار..." dir="ltr" />
          </div>
        )

      case 'case_number':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="أدخل رقم الدعوى..." dir="ltr" />
          </div>
        )

      case 'court_name':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="أدخل اسم المحكمة..." />
          </div>
        )

      case 'date':
        return (
          <div key={f.id}>
            <DatePicker
              value={values[f.field_key] ?? ''}
              onChange={v => set(f.field_key, v)}
              fieldLabel={label + (req ? ' *' : '')}
              headerTitle={label}
            />
          </div>
        )

      case 'gps': {
        const confirmed = !!values[f.field_key]
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-2">
              {label} {req && <span className="text-red-500">*</span>}
            </label>
            <button
              type="button"
              onClick={() => getGPS(f.field_key)}
              disabled={gpsLoading}
              className="w-full py-3.5 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-70"
              style={{
                background: confirmed
                  ? 'linear-gradient(135deg,#16a34a,#15803d)'
                  : 'linear-gradient(135deg,#2C8780,#1D6365)',
                color: '#fff',
              }}
            >
              {gpsLoading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  جارٍ تحديد الموقع...
                </>
              ) : confirmed ? (
                <>✓ تم التحديد — اضغط لتحديث الموقع</>
              ) : (
                <>📍 تحديد الموقع</>
              )}
            </button>
            {confirmed && (
              <p className="text-[10px] text-[#767676] mt-1.5 text-center font-mono" dir="ltr">
                {values[f.field_key]}
              </p>
            )}
          </div>
        )
      }

      case 'image':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="file" accept="image/*"
              onChange={e => { const file = e.target.files?.[0]; if (file) setFiles(p => ({ ...p, [f.field_key]: file })) }}
              className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer"
              style={{ '--file-bg': 'linear-gradient(135deg,#2C8780,#1D6365)' } as any} />
            {files[f.field_key] && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {files[f.field_key].name}</p>}
          </div>
        )

      case 'pdf':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="file" accept=".pdf"
              onChange={e => { const file = e.target.files?.[0]; if (file) setFiles(p => ({ ...p, [f.field_key]: file })) }}
              className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer" />
            {files[f.field_key] && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {files[f.field_key].name}</p>}
          </div>
        )

      case 'receipt':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="file" accept="image/*,.pdf"
              onChange={e => { const file = e.target.files?.[0]; if (file) setFiles(p => ({ ...p, [f.field_key]: file })) }}
              className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer" />
            {files[f.field_key] && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {files[f.field_key].name}</p>}
          </div>
        )

      case 'text':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder={`أدخل ${label}...`} />
          </div>
        )

      case 'number':
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="number" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder="0" dir="ltr" />
          </div>
        )

      default:
        // Fallback for unknown types: render as text input
        return (
          <div key={f.id}>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">{label} {req && <span className="text-red-500">*</span>}</label>
            <input type="text" value={values[f.field_key] ?? ''} onChange={e => set(f.field_key, e.target.value)}
              className={INP} placeholder={`أدخل ${label}...`} />
          </div>
        )
    }
  }

  const sortedFields = [...reqFields].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <CenteredModalPortal onBackdropClick={onClose} zIndex={56} ariaLabelledBy="task-completion-modal-title">
      <div className="bg-white w-full max-w-lg rounded-2xl max-h-[min(85vh,720px)] flex flex-col shadow-2xl border border-slate-200/80">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-start justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <h2 id="task-completion-modal-title" className="font-black text-[#231F20] text-base">تأكيد الإنجاز{taskLabel ? `: ${taskLabel}` : ''}</h2>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors shrink-0"
            aria-label="إغلاق">
            ×
          </button>
        </div>

        {/* Fields */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 min-h-0">
          {/* Always-visible general notes */}
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">
              ملاحظات عامة <span className="text-[#767676] font-normal text-[11px]">(اختياري)</span>
            </label>
            <textarea rows={2} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)}
              className={INP + ' resize-none'} placeholder="أضف أي ملاحظات إضافية..." />
          </div>

          {sortedFields.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800 font-semibold">
              الحقول الإلزامية قبل الإرسال:
              {' '}{sortedFields.filter(f => f.is_required).map(f => f.field_label ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField]).join(' — ')}
            </div>
          )}

          {sortedFields.map(f => renderField(f))}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-bold">
              {error}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] shrink-0 bg-white rounded-b-2xl space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={submit} disabled={saving}
              className="flex-1 py-3.5 rounded-xl text-white font-black text-sm disabled:opacity-60 transition-opacity"
              style={{ background: saving ? '#767676' : 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
              {uploading ? 'جارٍ رفع الملفات...' : saving ? 'جارٍ الإرسال...' : 'إرسال للاعتماد'}
            </button>
          </div>
          <p className="text-center text-[10px] text-[#767676]">
            ستظهر المهمة بحالة &quot;بانتظار الاعتماد&quot; حتى تراجعها الإدارة
          </p>
        </div>
      </div>
    </CenteredModalPortal>
  )
}

/** نافذة «إرسال بدون إنجاز» — سبب فقط */
export function IncompleteWithoutCompletionModal({
  task,
  taskLabel,
  onClose,
  onSubmitted,
  skipRouterRefresh,
}: {
  task: Task & Record<string, any>
  taskLabel?: string
  onClose: () => void
  onSubmitted: () => void
  skipRouterRefresh?: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('يجب إدخال السبب')
      return
    }
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('يرجى تسجيل الدخول')
      setSaving(false)
      return
    }

    const completionData = buildIncompleteCompletionData(trimmed)
    const baseUpdate = {
      lawyer_notes: trimmed,
      completion_data: completionData,
      completed_at: new Date().toISOString(),
      incomplete_request: true,
      incomplete_reason: trimmed,
    }

    const submitPayloads = [
      { task_status: 'pending_review' as const },
      { task_status: 'submitted' as const },
    ]

    let updateErr: { message?: string } | null = null
    for (const statusPart of submitPayloads) {
      const { error: err } = await supabase.from('tasks').update({
        ...baseUpdate,
        ...statusPart,
      } as any).eq('id', task.id)
      if (!err) {
        updateErr = null
        break
      }
      updateErr = err
      // أعمدة incomplete_* قد لا تكون مطبّقة بعد — أعد بالمعرّف داخل completion_data فقط
      if (/incomplete_request|incomplete_reason/i.test(err.message ?? '')) {
        const { error: err2 } = await supabase.from('tasks').update({
          lawyer_notes: trimmed,
          completion_data: completionData,
          completed_at: new Date().toISOString(),
          ...statusPart,
        } as any).eq('id', task.id)
        if (!err2) {
          updateErr = null
          break
        }
        updateErr = err2
      }
    }

    if (updateErr) {
      setError(updateErr.message ?? 'خطأ في التحديث')
      setSaving(false)
      return
    }

    await logActivity({
      action: 'submit_incomplete_task',
      entity_type: 'task',
      entity_id: task.id,
      description: `إرسال بدون إنجاز — السبب: ${trimmed}`,
    }, supabase)

    invalidateLawyerTasksCache()
    onSubmitted()
    onClose()
    if (!skipRouterRefresh) router.refresh()
  }

  return (
    <CenteredModalPortal onBackdropClick={onClose} zIndex={56} ariaLabelledBy="incomplete-submit-modal-title">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-start justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <h2 id="incomplete-submit-modal-title" className="font-black text-[#231F20] text-base">
              إرسال بدون إنجاز{taskLabel ? `: ${taskLabel}` : ''}
            </h2>
            <p className="text-[11px] text-[#767676] mt-1">
              سيُراجع الطلب في تبويب «غير منجزة» — لن تُحسب أتعاب ولن يُعتبر إنجازاً
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors shrink-0"
            aria-label="إغلاق">
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 min-h-0">
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">
              السبب <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={reason}
              onChange={e => setReason(e.target.value)}
              className={INP + ' resize-none'}
              placeholder="اكتب سبب الإرسال بدون إنجاز..."
              autoFocus
            />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-bold">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] shrink-0 bg-white rounded-b-2xl">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="w-full py-3.5 rounded-xl text-white font-black text-sm disabled:opacity-60 transition-opacity bg-amber-600 hover:bg-amber-700"
          >
            {saving ? 'جارٍ الإرسال...' : 'إرسال بدون إنجاز'}
          </button>
        </div>
      </div>
    </CenteredModalPortal>
  )
}

// ─── Main Form ─────────────────────────────────────────────────────────────────
export default function TaskUpdateForm({ task, taskAttachments, expenseDefs: expenseDefsProp = [], taskExpenses = [] }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [lawyerNotes, setLawyerNotes] = useState(task.lawyer_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showCompletion, setShowCompletion] = useState(false)
  const [showIncomplete, setShowIncomplete] = useState(false)
  const [showHybridSelect, setShowHybridSelect] = useState(false)
  const [pendingExpenses, setPendingExpenses] = useState<PendingTaskExpense[]>([])
  const [expenseStepDone, setExpenseStepDone] = useState(false)
  const [expenseModalMode, setExpenseModalMode] = useState<'draft' | 'immediate'>('draft')
  const [reqFields, setReqFields] = useState<ReqField[]>([])
  const [completionReqFields, setCompletionReqFields] = useState<ReqField[]>([])
  const [expenseDefs, setExpenseDefs] = useState<TaskDefinitionExpense[]>(expenseDefsProp)
  const [modalExpenseDefs, setModalExpenseDefs] = useState<TaskDefinitionExpense[]>([])
  const [expenseDefsReady, setExpenseDefsReady] = useState(true)
  const [completingTask, setCompletingTask] = useState(false)
  const [resolvedDefinitionId, setResolvedDefinitionId] = useState<string | null>(
    (task as any).task_definition_id ?? null,
  )
  const [fee, setFee] = useState(0)
  const [definitionLabel, setDefinitionLabel] = useState<string | null>(
    (task as any).task_definitions?.label ?? task.task_label ?? null,
  )
  const [displayTaskType, setDisplayTaskType] = useState<string | null>(task.task_type ?? null)
  const [hybridLinks, setHybridLinks] = useState<HybridLinkInfo[]>([])
  const [isHybrid, setIsHybrid] = useState(false)
  const [hybridReady, setHybridReady] = useState(false)
  const [hybridSelectedLinked, setHybridSelectedLinked] = useState<HybridLinkInfo[]>([])

  const canSubmit = ['assigned', 'in_progress', 'new', 'rejected', 'needs_info', 'needs_revision'].includes(task.task_status)
  const isSubmitted = task.task_status === 'submitted' || task.task_status === 'pending_review'
  const isApproved = ['approved', 'completed'].includes(task.task_status)
  const isRejected = ['rejected', 'needs_info', 'needs_revision'].includes(task.task_status)
  const missingExpenses = expenseDefs.length > 0 && taskExpenses.length === 0
  const canAddExpensesAfterSubmit = isSubmitted && missingExpenses

  useEffect(() => {
    if (expenseDefsProp.length > 0) {
      setExpenseDefs(expenseDefsProp)
    }
  }, [expenseDefsProp, task.id])

  useEffect(() => {
    let cancelled = false

    async function loadDefinition() {
      const supabase = createClient()
      const baseSelect = 'id, fee_amount, task_type, label, task_required_fields(*), task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)'

      if (!(task as any).task_definition_id && !task.task_type && !task.task_label) {
        if (!cancelled) setExpenseDefsReady(true)
        return
      }

      if ((task as any).task_definition_id) {
        const { data } = await supabase
          .from('task_definitions')
          .select(baseSelect)
          .eq('id', (task as any).task_definition_id)
          .maybeSingle()
        if (cancelled) return
        if (data) applyDefinition(data)
      } else if (task.task_type) {
        let data: Parameters<typeof applyDefinition>[0] | null = null

        if ((task as any).branch_id) {
          const { data: branchDef } = await supabase
            .from('task_definitions')
            .select(baseSelect)
            .eq('task_type', task.task_type)
            .eq('is_active', true)
            .eq('branch_id', (task as any).branch_id)
            .maybeSingle()
          data = branchDef
        }

        if (!data) {
          const { data: anyDef } = await supabase
            .from('task_definitions')
            .select(baseSelect)
            .eq('task_type', task.task_type)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()
          data = anyDef
        }

        if (cancelled) return
        if (data) applyDefinition(data)
      } else if (task.task_label) {
        const { data: rows } = await supabase
          .from('task_definitions')
          .select(baseSelect)
          .eq('is_active', true)
        if (cancelled) return
        const key = normalizeTaskLabelKey(task.task_label)
        const data = (rows ?? []).find(r => normalizeTaskLabelKey(r.label) === key)
        if (data) applyDefinition(data)
      }

      if (!cancelled) setExpenseDefsReady(true)
    }

    function applyDefinition(data: {
      id: string
      fee_amount?: number | null
      task_type?: string | null
      label?: string | null
      task_required_fields?: ReqField[]
      task_definition_expenses?: unknown
    }) {
      setResolvedDefinitionId(data.id)
      setDefinitionLabel(data.label ?? task.task_label ?? null)
      setDisplayTaskType(data.task_type ?? task.task_type ?? null)
      setFee(visibleTaskFeeAmount(
        Number((task as { reward_amount?: number | null }).reward_amount ?? data.fee_amount ?? 0),
        (task as { debtors?: { case_type?: string | null } }).debtors?.case_type,
        'lawyer',
      ))
      const fields = (data.task_required_fields ?? []).sort((a, b) => a.sort_order - b.sort_order)
      setReqFields(fields)
      setCompletionReqFields(fields)
      const embedded = normalizeExpenseRows(data.task_definition_expenses)
      if (embedded.length > 0) {
        setExpenseDefs(embedded)
      }
    }

    void loadDefinition()
    return () => { cancelled = true }
  }, [(task as any).task_definition_id, (task as any).branch_id, task.task_type, task.task_label, task.id])

  // جلب حالة الهجين بعد معرفة التعريف
  useEffect(() => {
    let cancelled = false
    const defId = resolvedDefinitionId ?? (task as any).task_definition_id as string | null
    setHybridReady(false)
    if (!defId) {
      setIsHybrid(false)
      setHybridLinks([])
      setHybridReady(true)
      return
    }

    void (async () => {
      const result = await fetchHybridTaskLinks(defId)
      if (cancelled) return
      setIsHybrid(result.isHybrid)
      setHybridLinks(result.links)
      setHybridReady(true)
    })()

    return () => { cancelled = true }
  }, [resolvedDefinitionId, (task as any).task_definition_id])

  const taskLabel = resolveTaskLabel(displayTaskType ?? task.task_type, definitionLabel)

  async function resolveExpensesForComplete(): Promise<TaskDefinitionExpense[]> {
    // إن وُجدت صرفيات محمّلة مسبقاً استخدمها فوراً (من صفحة المهمة / embed)
    const already = mergeExpenseSources(expenseDefs, expenseDefsProp)
    if (already.length > 0) return already

    const supabase = createClient()
    const taskDefId = resolvedDefinitionId ?? (task as any).task_definition_id as string | null
    const taskName = definitionLabel ?? task.task_label ?? null

    const [apiResult, embedded] = await Promise.all([
      fetchLawyerTaskExpenses(task.id),
      taskDefId
        ? fetchExpensesViaDefinitionEmbed(supabase, taskDefId)
        : Promise.resolve([] as TaskDefinitionExpense[]),
    ])
    const fromFast = mergeExpenseSources(apiResult.expenses, embedded)
    if (fromFast.length > 0) return fromFast

    const localResult = await getTaskExpenses(supabase, {
      taskDefinitionId: taskDefId,
      taskName,
      branchId: (task as any).branch_id,
      taskType: displayTaskType ?? task.task_type,
    })
    if (localResult.expenses.length > 0) return localResult.expenses

    return []
  }

  type DefBundle = {
    id: string
    label: string
    fee_amount: number
    task_type: string | null
    fields: ReqField[]
    expenses: TaskDefinitionExpense[]
  }

  async function loadDefinitionBundles(definitionIds: string[]): Promise<DefBundle[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('task_definitions')
      .select('id, label, fee_amount, task_type, task_required_fields(*), task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
      .in('id', definitionIds)

    if (error || !data?.length) return []

    const byId = new Map(data.map(d => [String(d.id), d]))
    return definitionIds.map(id => {
      const row = byId.get(id) as {
        id: string
        label?: string | null
        fee_amount?: number | null
        task_type?: string | null
        task_required_fields?: ReqField[]
        task_definition_expenses?: unknown
      } | undefined
      if (!row) {
        return {
          id,
          label: 'مهمة',
          fee_amount: 0,
          task_type: null,
          fields: [],
          expenses: [],
        }
      }
      return {
        id: String(row.id),
        label: String(row.label ?? 'مهمة'),
        fee_amount: Number(row.fee_amount ?? 0),
        task_type: row.task_type ?? null,
        fields: (row.task_required_fields ?? []).sort((a, b) => a.sort_order - b.sort_order),
        expenses: normalizeExpenseRows(row.task_definition_expenses),
      }
    })
  }

  function buildAggregatedFields(bundles: DefBundle[], multi: boolean): ReqField[] {
    const out: ReqField[] = []
    for (const bundle of bundles) {
      for (const f of bundle.fields) {
        const key = multi ? hybridFieldKey(bundle.id, f.field_key) : f.field_key
        const baseLabel = f.field_label
          ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField]
          ?? f.field_type
        out.push({
          ...f,
          id: multi ? `${bundle.id}:${f.id}` : f.id,
          field_key: key,
          field_label: multi ? `${bundle.label} — ${baseLabel}` : f.field_label,
        })
      }
    }
    return out
  }

  function buildAggregatedExpenses(bundles: DefBundle[], multi: boolean): TaskDefinitionExpense[] {
    const out: TaskDefinitionExpense[] = []
    for (const bundle of bundles) {
      for (const exp of bundle.expenses) {
        out.push({
          ...exp,
          // الإبقاء على id الحقيقي لـ persistTaskExpenses (FK)
          name: multi ? `${bundle.label}: ${exp.name}` : exp.name,
        })
      }
    }
    return out
  }

  async function continueAfterHybridSelection(selection: HybridSelectionResult | null) {
    const parentId = resolvedDefinitionId ?? (task as any).task_definition_id as string | null
    const selectedLinked = selection?.selectedLinked ?? []
    const selectedIds = selection?.selectedDefinitionIds
      ?? (parentId ? [parentId] : [])

    setShowHybridSelect(false)

    try {
      if (selectedLinked.length > 0 && parentId) {
        const bundles = await loadDefinitionBundles(selectedIds)
        const linkedUpdated: HybridLinkInfo[] = selectedLinked.map(l => {
          const b = bundles.find(x => x.id === l.linked_definition_id)
          return b
            ? {
                ...l,
                task_type: b.task_type,
                fee_amount: b.fee_amount || l.fee_amount,
                label: b.label || l.label,
              }
            : l
        })
        setHybridSelectedLinked(linkedUpdated)

        const fields = buildAggregatedFields(bundles, true)
        const expenses = buildAggregatedExpenses(bundles, true)
        setCompletionReqFields(fields)
        setModalExpenseDefs(expenses)
        setExpenseDefs(expenses)

        if (expenses.length > 0) {
          setShowExpenseModal(true)
        } else {
          setShowCompletion(true)
        }
        return
      }

      // سلوك عادي (غير هجين أو لم تُختر مرتبطة)
      setHybridSelectedLinked([])
      setCompletionReqFields(reqFields)
      const expenses = await resolveExpensesForComplete()
      setExpenseDefs(expenses)
      setModalExpenseDefs(expenses)
      if (expenses.length > 0) {
        setShowExpenseModal(true)
      } else {
        setShowCompletion(true)
      }
    } finally {
      setCompletingTask(false)
    }
  }

  async function handleCompleteClick() {
    setCompletingTask(true)
    setExpenseModalMode('draft')
    setPendingExpenses([])
    setExpenseStepDone(false)
    setShowCompletion(false)
    setShowExpenseModal(false)
    setShowHybridSelect(false)
    setModalExpenseDefs([])
    setHybridSelectedLinked([])
    setCompletionReqFields(reqFields)

    const taskDefId = resolvedDefinitionId ?? (task as any).task_definition_id as string | null

    try {
      let hybridNow = isHybrid
      let linksNow = hybridLinks
      if (!hybridReady && taskDefId) {
        const result = await fetchHybridTaskLinks(taskDefId)
        hybridNow = result.isHybrid
        linksNow = result.links
        setIsHybrid(hybridNow)
        setHybridLinks(linksNow)
        setHybridReady(true)
      }

      if (hybridNow && linksNow.length > 0 && taskDefId) {
        setShowHybridSelect(true)
        setCompletingTask(false)
        return
      }

      const expenses = await resolveExpensesForComplete()

      setExpenseDefs(expenses)
      setModalExpenseDefs(expenses)
      setCompletionReqFields(reqFields)

      if (expenses.length > 0) {
        setShowExpenseModal(true)
      } else {
        setShowCompletion(true)
      }
    } finally {
      setCompletingTask(false)
    }
  }

  async function handleSaveNotes(e: { preventDefault(): void }) {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    await supabase.from('tasks').update({
      lawyer_notes: lawyerNotes || null,
      task_status: task.task_status === 'assigned' ? 'in_progress' : task.task_status,
    } as any).eq('id', task.id)
    await logActivity({ action: 'update_task', entity_type: 'task', entity_id: task.id, description: 'تحديث ملاحظات المحامي' }, supabase)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    router.refresh()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    const body = new FormData()
    body.append('file', file)
    body.append('taskId', task.id)
    body.append('description', 'مرفق من المحامي')
    body.append('kind', 'attachment')
    const res = await fetch('/api/worker/upload-task-file', { method: 'POST', body })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setUploadError(data.error || 'فشل رفع الملف')
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    router.refresh()
  }

  return (
    <div className="space-y-4">

      {/* Status banners */}
      {isSubmitted && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3.5 text-sm text-purple-800 font-bold text-center">
          {isIncompleteCompletionRequest(task)
            ? '⏳ طلب إرسال بدون إنجاز بانتظار قرار الإدارة'
            : '⏳ المهمة بانتظار اعتماد الإدارة'}
        </div>
      )}
      {canAddExpensesAfterSubmit && (
        <div className="bg-sky-50 border border-sky-200 rounded-2xl px-4 py-3.5 space-y-3">
          <p className="text-sm text-sky-900 font-bold text-center">لم تُسجّل صرفيات هذه المهمة بعد</p>
          <button type="button" onClick={() => { setExpenseModalMode('immediate'); setShowExpenseModal(true) }}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700">
            تسجيل صرفيات المهمة
          </button>
        </div>
      )}
      {isApproved && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3.5 text-sm text-green-800 font-bold text-center">
          ✓ تمت الموافقة على المهمة
        </div>
      )}
      {isRejected && task.admin_notes && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 space-y-1">
          <p className="text-sm text-red-800 font-bold">✗ تم رفض الطلب</p>
          <p className="text-xs text-red-700 whitespace-pre-wrap">{task.admin_notes}</p>
        </div>
      )}
      {isRejected && !task.admin_notes && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 text-sm text-red-800 font-bold text-center">
          ✗ تم رفض الطلب — يرجى المراجعة وإعادة الإرسال
        </div>
      )}

      {typeof task.completion_data?.mukhtar_name === 'string' && task.completion_data.mukhtar_name.trim() && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
          <p className="text-xs text-slate-400 font-semibold mb-1">اسم المختار</p>
          <p className="text-sm text-slate-800 font-bold">{task.completion_data.mukhtar_name}</p>
        </div>
      )}

      {/* File attachments */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700 text-sm">مرفقات المهمة</h2>
          <label className="cursor-pointer">
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx"
              onChange={handleFileChange} disabled={uploading} className="hidden" />
            <span className={`inline-flex text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
              uploading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'text-white cursor-pointer'
            }`} style={uploading ? undefined : { background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
              {uploading ? 'جارٍ الرفع...' : '+ رفع ملف'}
            </span>
          </label>
        </div>
        {uploadError && <p className="text-red-600 text-xs mb-2">{uploadError}</p>}
        {taskAttachments.length === 0 ? (
          <p className="text-slate-400 text-xs text-center py-3">لا توجد مرفقات بعد</p>
        ) : (
          <div className="space-y-2">
            {taskAttachments.map(att => (
              <div key={att.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-sm text-slate-700 truncate flex-1 min-w-0">{att.file_name}</span>
                {att.signedUrl
                  ? <a href={att.signedUrl} target="_blank" rel="noreferrer" className="text-xs text-[#2C8780] font-bold shrink-0">فتح</a>
                  : <span className="text-xs text-slate-400 shrink-0">غير متاح</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      {!isApproved && (
        <form onSubmit={handleSaveNotes} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="font-semibold text-slate-700 text-sm">ملاحظاتي</h2>
          <textarea value={lawyerNotes} onChange={e => setLawyerNotes(e.target.value)}
            rows={3} className={INP + ' resize-none'} placeholder="أضف ملاحظاتك هنا..." />
          <button type="submit" disabled={saving}
            className={`w-full font-bold py-2.5 rounded-lg transition-colors text-sm ${
              saved ? 'bg-green-600 text-white' : 'text-white disabled:opacity-60'
            }`}
            style={saved ? undefined : { background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الحفظ...' : saved ? '✓ تم الحفظ' : 'حفظ الملاحظات'}
          </button>
        </form>
      )}

      {/* Complete / incomplete buttons */}
      {canSubmit && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => void handleCompleteClick()}
            disabled={!expenseDefsReady || completingTask}
            className="flex-1 py-4 rounded-2xl text-white font-black text-base shadow-lg active:scale-[0.99] transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {completingTask ? 'جارٍ التحقق...' : !expenseDefsReady ? 'جارٍ التحميل...' : 'تم الإنجاز — إرسال للاعتماد'}
          </button>
          <button
            type="button"
            onClick={() => setShowIncomplete(true)}
            disabled={completingTask}
            className="flex-1 sm:flex-none sm:min-w-[10.5rem] py-4 rounded-2xl text-white font-black text-sm shadow-lg active:scale-[0.99] transition-all disabled:opacity-60 bg-amber-600 hover:bg-amber-700"
          >
            إرسال بدون إنجاز
          </button>
        </div>
      )}

      {showHybridSelect && (resolvedDefinitionId || (task as any).task_definition_id) && (
        <HybridTaskSelectionModal
          parentLabel={taskLabel}
          parentFee={fee}
          parentDefinitionId={String(resolvedDefinitionId ?? (task as any).task_definition_id)}
          links={hybridLinks}
          onClose={() => {
            setShowHybridSelect(false)
            setCompletingTask(false)
          }}
          onContinue={(result) => { void continueAfterHybridSelection(result) }}
        />
      )}

      {showExpenseModal && modalExpenseDefs.length > 0 && (
        <TaskCompletionExpenseModal
          task={{
            id: task.id,
            debtor_id: task.debtor_id,
            case_id: (task as any).case_id,
            branch_id: (task as any).branch_id,
          }}
          taskLabel={hybridSelectedLinked.length > 0 ? `${taskLabel} + مرتبطة` : taskLabel}
          expenseDefs={modalExpenseDefs}
          mode={expenseModalMode}
          onClose={() => setShowExpenseModal(false)}
          onConfirmed={(rows) => {
            if (expenseModalMode === 'draft') {
              setPendingExpenses(rows)
              setExpenseStepDone(true)
              setShowExpenseModal(false)
              setModalExpenseDefs([])
              setShowCompletion(true)
            } else {
              router.refresh()
            }
          }}
        />
      )}

      {showCompletion && !showExpenseModal && !showHybridSelect && (
        <LawyerTaskCompletionModal
          task={task}
          reqFields={completionReqFields.length ? completionReqFields : reqFields}
          fee={fee}
          taskLabel={taskLabel}
          pendingExpenses={pendingExpenses}
          expenseStepDone={expenseStepDone}
          hybridParentDefinitionId={
            hybridSelectedLinked.length > 0
              ? (resolvedDefinitionId ?? (task as any).task_definition_id ?? null)
              : null
          }
          hybridSelectedLinked={hybridSelectedLinked}
          onClose={() => setShowCompletion(false)}
          onSubmitted={() => router.refresh()}
        />
      )}

      {showIncomplete && (
        <IncompleteWithoutCompletionModal
          task={task}
          taskLabel={taskLabel}
          onClose={() => setShowIncomplete(false)}
          onSubmitted={() => router.refresh()}
        />
      )}
    </div>
  )
}
