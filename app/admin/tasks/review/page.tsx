'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, assigneePersonLabel, assigneeNotesLabel } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { logActivity } from '@/lib/activity-log'
import { extractGpsFromCompletion } from '@/lib/task-approval'
import { rejectTaskViaApi, taskTransitionViaApi } from '@/lib/task-operations-api'
import TaskExpensesReviewCard from '@/components/TaskExpensesReviewCard'
import { fetchPendingReviewTasksPaginated, fetchPendingReviewTaskById, fetchBranchLawyers, REVIEW_TASK_PAGE_SIZE } from '@/lib/task-assignment'
import { fetchBranchDelegates } from '@/lib/branch-profiles'
import { cacheGet, cacheSet, cacheDelete, cacheInvalidatePrefix, CACHE_TTL } from '@/lib/query-cache'
import { refreshAdminNotifications } from '@/lib/admin-notifications'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { useBranch, useBranchId } from '@/context/branch'
import { PremiumSelect } from '@/components/ui/premium-select'
import { fetchActiveTaskDefinitions } from '@/lib/task-definitions'
import { buildCompletionFieldLabelMap, resolveCompletionFieldLabel } from '@/lib/completion-field-labels'
import { useAdminRole } from '@/context/admin-role'
import { canMoveToPaymentInProgress, canReadAdminData, canReviewTasks } from '@/lib/permissions'
import { CASE_TYPE_FILTER_OPTIONS, CASE_TYPE_LABELS, normalizeCaseType, type CaseType } from '@/lib/case-type'
import MoveToPaymentInProgressModal from '@/components/MoveToPaymentInProgressModal'
import { appAlert } from '@/lib/app-dialog'

interface TaskDef { id: string; label: string; sort_order: number; fee_amount?: number; branch_id?: string | null; case_type?: string | null }

function parseGps(val: string): { lat: number; lng: number } | null {
  if (!val) return null
  const parts = val.split(',').map(s => parseFloat(s.trim()))
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    if (parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180) {
      return { lat: parts[0], lng: parts[1] }
    }
  }
  return null
}

/* ─── Completion Data viewer ──────────────────────────────────────────── */
function CompletionDataCard({ data, gpsKeys, fieldLabels }: {
  data: Record<string, string>
  gpsKeys: string[]
  fieldLabels?: Record<string, string>
}) {
  const entries = Object.entries(data).filter(([, v]) => v)
  if (!entries.length) return null
  return (
    <div className="border border-[rgba(118,118,118,0.15)] rounded-xl overflow-hidden">
      <div className="bg-[#F3F1F2] px-4 py-2.5 text-sm font-bold text-[#767676]">
        بيانات الإنجاز
      </div>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {entries.map(([key, val]) => {
          const isGps = gpsKeys.includes(key)
          const gpsCoords = isGps ? parseGps(val) : null
          const label = resolveCompletionFieldLabel(key, fieldLabels)
          return (
            <div key={key} className="px-4 py-2.5 flex items-start gap-3">
              <span className="text-sm text-[#767676] shrink-0 min-w-[110px] font-semibold">{label}:</span>
              {isGps && gpsCoords ? (
                <a href={`https://www.google.com/maps?q=${gpsCoords.lat},${gpsCoords.lng}`}
                  target="_blank" rel="noreferrer"
                  className="text-sm font-semibold text-[#2C8780] hover:underline" dir="ltr">
                  {val} 🗺️
                </a>
              ) : (
                <span className="text-sm font-semibold text-[#231F20] break-all">{val}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Attachments viewer ──────────────────────────────────────────────── */
function AttachmentsCard({ taskId }: { taskId: string }) {
  const [atts, setAtts] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at')
      .then(async ({ data }) => {
        const signed = await Promise.all(
          (data ?? []).map(async att => {
            const { data: u } = await supabase.storage.from('task-files').createSignedUrl(att.file_path, 3600)
            return { ...att, url: u?.signedUrl ?? null }
          })
        )
        setAtts(signed); setLoaded(true)
      })
  }, [taskId])

  if (!loaded) return <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
  if (!atts.length) return <p className="text-sm text-[#767676] italic">لا توجد مرفقات</p>
  return (
    <div className="space-y-2">
      {atts.map(att => (
        <div key={att.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-[rgba(118,118,118,0.08)] last:border-0">
          <span className="text-sm text-[#231F20] truncate flex-1">
            <span className="text-[#767676] font-semibold">الملف: </span>
            {att.file_name}
          </span>
          {att.url
            ? <a href={att.url} target="_blank" rel="noreferrer" className="text-sm text-[#2C8780] font-bold shrink-0">فتح ↗</a>
            : <span className="text-sm text-[#767676] shrink-0">غير متاح</span>}
        </div>
      ))}
    </div>
  )
}

/* ─── Next Task Modal (mandatory stage transition) ────────────────────── */
function NextTaskModal({ task, taskDefs, onClose, onDone }: {
  task: any; taskDefs: TaskDef[]; onClose: () => void; onDone: () => void
}) {
  const supabase = createClient()
  const role = useAdminRole()
  const allowPaymentInProgress = canMoveToPaymentInProgress(role)
  const [nextTaskId, setNextTaskId] = useState<string>('')
  const [updateGps, setUpdateGps] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)
  const gpsKeys = (task._gpsKeys ?? []) as string[]
  const debtor = task.debtors as any
  const newGps = extractGpsFromCompletion(task.completion_data as Record<string, string>, gpsKeys)
  const hasExistingGps = debtor?.latitude != null && debtor?.longitude != null
  const showGpsUpdate = hasExistingGps && newGps != null
  // عند «الكل»: اعرض مهام فرع هذه القضية فقط حتى لا تتكرر الأنواع
  const debtorCaseType = normalizeCaseType(debtor?.case_type)
  const scopedDefs = taskDefs.filter(d => {
    if (task.branch_id && d.branch_id && d.branch_id !== task.branch_id) return false
    return normalizeCaseType(d.case_type) === debtorCaseType
  })

  async function proceedWithTransition(action: 'next' | 'close') {
    if (action === 'next' && !nextTaskId) {
      setError('يجب اختيار المهمة اللاحقة')
      return
    }
    setSaving(true); setError('')

    const result = await taskTransitionViaApi({
      taskId: task.id,
      action,
      nextTaskDefId: action === 'next' ? nextTaskId : undefined,
      updateGps: showGpsUpdate ? updateGps : false,
    })

    if (!result.ok) {
      setError(result.error ?? 'فشل تحديث المرحلة')
      setSaving(false)
      return
    }

    const nextDef = taskDefs.find(d => d.id === nextTaskId)
    if (action === 'close') {
      await logActivity({
        action: 'close_case', entity_type: 'debtor', entity_id: task.debtor_id,
        description: `إغلاق قضية ${debtor?.full_name ?? '—'} — آخر مهمة: ${taskLabel}`,
      }, supabase)
    } else {
      await logActivity({
        action: 'approve_task_transition', entity_type: 'task', entity_id: task.id,
        description: `اعتماد "${taskLabel}" للمدين ${debtor?.full_name ?? '—'} والانتقال إلى "${nextDef?.label}"`,
      }, supabase)
    }

    setSaving(false); onDone(); onClose()
  }

  async function handlePaymentSuccess() {
    setShowPaymentModal(false)
    await appAlert({
      title: 'تم التحويل',
      message: `تم نقل «${debtor?.full_name ?? 'المدين'}» إلى جاري التسديد بنجاح.`,
      variant: 'success',
    })
    onDone()
    onClose()
  }

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]" dir="rtl">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)]">
          <h2 className="font-black text-[#231F20] text-base">الإجراء اللاحق للقضية</h2>
          <p className="text-xs text-[#767676] mt-0.5">
            المهمة المعتمدة: <span className="font-bold text-[#2C8780]">{taskLabel}</span>
            {' · '}{debtor?.full_name ?? '—'}
          </p>
          <p className="text-[10px] text-amber-700 font-semibold mt-1">
            تُحتسب أتعاب هذه المهمة مرة واحدة فقط بعد تأكيد الإجراء اللاحق
          </p>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {/* Option A: next task */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-[#767676]">أ) اختيار مهمة لاحقة</p>
            <PremiumSelect
              value={nextTaskId}
              onChange={v => { setNextTaskId(v); setError('') }}
              options={scopedDefs.map(def => ({
                value: def.id,
                label: def.label,
                hint: def.fee_amount ? `${Number(def.fee_amount).toLocaleString('en-US')} د.ع أتعاب` : undefined,
              }))}
              placeholder="— اختر المهمة التالية —"
              headerTitle="المهمة اللاحقة"
              headerSubtitle={`${scopedDefs.length} مهمة متاحة`}
              searchPlaceholder="بحث في المهام..."
            />
            <button
              onClick={() => proceedWithTransition('next')}
              disabled={saving || !nextTaskId}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
            >
              {saving ? 'جارٍ الحفظ...' : 'تأكيد المهمة اللاحقة'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
            <span className="text-[10px] text-[#767676] font-bold">أو</span>
            <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
          </div>

          {/* Option B: close case */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-[#767676]">ب) نقل إلى القضايا المحسومة</p>
            <button
              onClick={() => proceedWithTransition('close')}
              disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'جارٍ الحفظ...' : 'القضية محسومة'}
            </button>
            <p className="text-[10px] text-[#767676] text-center">نقل المدين إلى أرشيف القضايا المحسومة (الإنجاز معتمد مسبقاً)</p>
          </div>

          {allowPaymentInProgress && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
                <span className="text-[10px] text-[#767676] font-bold">أو</span>
                <div className="flex-1 h-px bg-[rgba(118,118,118,0.15)]" />
              </div>

              {/* Option C: payment in progress — يفتح Modal قبل التأكيد */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-[#767676]">ج) التحويل إلى جاري التسديد</p>
                <button
                  type="button"
                  onClick={() => { setError(''); setShowPaymentModal(true) }}
                  disabled={saving}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#0f766e,#115e59)' }}
                >
                  جاري التسديد
                </button>
                <p className="text-[10px] text-[#767676] text-center">يتطلب اختيار نوع التسديد ومكانه قبل التأكيد</p>
              </div>
            </>
          )}

          {showGpsUpdate && (
            <label className="flex items-start gap-3 p-3 rounded-xl border border-[#2C8780]/30 bg-[#2C8780]/5 cursor-pointer">
              <input type="checkbox" checked={updateGps} onChange={e => setUpdateGps(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-[#2C8780] shrink-0" />
              <div>
                <span className="text-sm font-bold text-[#231F20]">تحديث موقع المدين</span>
                <p className="text-[10px] text-[#767676] mt-0.5">
                  الموقع الجديد: <span dir="ltr" className="font-mono">{newGps!.lat.toFixed(6)}, {newGps!.lng.toFixed(6)}</span>
                </p>
              </div>
            </label>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-xs text-red-500">{error}</p>}

        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.08)]">
          <button onClick={onClose} disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] hover:bg-slate-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>

    {showPaymentModal && (
      <MoveToPaymentInProgressModal
        open
        debtorId={task.debtor_id}
        debtorName={debtor?.full_name ?? '—'}
        taskId={task.id}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={() => void handlePaymentSuccess()}
      />
    )}
    </>
  )
}

/* ─── Review Modal ────────────────────────────────────────────────────── */
function ReviewModal({ task, taskDefs, onClose, onDone, canReview = true }: {
  task: any; taskDefs: TaskDef[]; onClose: () => void; onDone: () => void; canReview?: boolean
}) {
  const [stage, setStage] = useState<'view' | 'approve' | 'reject'>('view')
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showNextTask, setShowNextTask] = useState(false)
  const [approvedTask, setApprovedTask] = useState<any | null>(null)
  // اعتماد الإنجاز تم (مرحلة أولى) — الأتعاب تُحتسب فقط بعد إنشاء المهمة التالية
  const [awaitingNextTask, setAwaitingNextTask] = useState(false)

  const completionData = (task.completion_data ?? {}) as Record<string, string>
  const gpsKeys = (task._gpsKeys ?? []) as string[]
  const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)

  async function approve() {
    setSaving(true); setError('')
    const supabase = createClient()

    const res = await fetch('/api/admin/approve-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id }),
    })
    const result = await res.json().catch(() => ({}))

    if (!res.ok || !result.ok) {
      setError(result.error ?? 'فشل اعتماد الإنجاز')
      setSaving(false)
      return
    }

    await logActivity({
      action: 'approve_task', entity_type: 'task', entity_id: task.id,
      description: `اعتماد إنجاز مهمة: ${taskLabel} — بانتظار إنشاء المهمة التالية`,
    }, supabase)

    setApprovedTask({ ...task, task_status: 'approved' })
    setAwaitingNextTask(true)
    setSaving(false)
    setShowNextTask(true)
  }

  async function reject() {
    if (!rejectReason.trim()) { setError('يجب إدخال سبب الرفض'); return }
    setSaving(true)
    const supabase = createClient()
    const result = await rejectTaskViaApi(task.id, rejectReason)
    if (!result.ok) {
      setError(result.error ?? 'فشل رفض المهمة')
      setSaving(false)
      return
    }
    await logActivity({
      action: 'reject_task', entity_type: 'task', entity_id: task.id,
      description: `رفض إنجاز مهمة: ${taskLabel} — السبب: ${rejectReason}`,
    }, supabase)
    setSaving(false); onDone(); onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(35,31,32,0.6)', backdropFilter: 'blur(3px)' }}
        onClick={e => { if (e.target === e.currentTarget && !showNextTask) onClose() }}>
        <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
          <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
            <div>
              <h2 className="font-bold text-[#231F20] text-base">{taskLabel}</h2>
              <p className="text-sm text-[#767676] mt-0.5">
                <span className="font-semibold">المدين:</span> {task.debtors?.full_name ?? '—'}
                {' · '}
                <span className="font-semibold">{assigneePersonLabel(task.lawyer?.role)}:</span> {task.lawyer?.full_name ?? '—'}
              </p>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors">
              ×
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F3F1F2] rounded-xl p-3">
                <p className="text-xs text-[#767676] mb-1 font-semibold">الأتعاب</p>
                <p className="text-base font-black text-[#2C8780]" dir="ltr">{fmtMoney(task.reward_amount)}</p>
              </div>
              <div className="bg-[#F3F1F2] rounded-xl p-3">
                <p className="text-xs text-[#767676] mb-1 font-semibold">تاريخ الإنجاز</p>
                <p className="text-base font-bold text-[#231F20]" dir="ltr">
                  {task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : '—'}
                </p>
              </div>
              {task.court_name && (
                <div className="bg-[#F3F1F2] rounded-xl p-3">
                  <p className="text-xs text-[#767676] mb-1 font-semibold">المحكمة</p>
                  <p className="text-base font-bold text-[#231F20]">{task.courts?.name ?? task.court_name}</p>
                </div>
              )}
              {task.lawyer_notes && (
                <div className="bg-[#F3F1F2] rounded-xl p-3">
                  <p className="text-xs text-[#767676] mb-1 font-semibold">{assigneeNotesLabel(task.lawyer?.role)}</p>
                  <p className="text-sm font-semibold text-[#231F20]">{task.lawyer_notes}</p>
                </div>
              )}
            </div>

            {Object.keys(completionData).length > 0 && (
              <CompletionDataCard
                data={completionData}
                gpsKeys={gpsKeys}
                fieldLabels={(task._fieldLabels ?? {}) as Record<string, string>}
              />
            )}

            <div className="border border-[rgba(118,118,118,0.15)] rounded-xl overflow-hidden">
              <div className="bg-[#F3F1F2] px-4 py-2.5 text-sm font-bold text-[#767676]">المرفقات</div>
              <div className="px-4 py-3"><AttachmentsCard taskId={task.id} /></div>
            </div>

            <TaskExpensesReviewCard taskId={task.id} />

            {stage === 'view' && canReview && awaitingNextTask && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-amber-800">تم اعتماد الإنجاز — بانتظار إنشاء المهمة التالية</p>
                <p className="text-xs text-amber-700">لن تُحتسب الأتعاب ولن تُسجَّل أي حركة مالية قبل إنشاء المهمة التالية.</p>
                <button onClick={() => setShowNextTask(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  إنشاء المهمة التالية
                </button>
              </div>
            )}
            {stage === 'view' && canReview && !awaitingNextTask && (
              <div className="space-y-2">
                {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
                <div className="flex gap-3">
                <button onClick={approve} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  {saving ? 'جارٍ الاعتماد...' : '✓ اعتماد الإنجاز'}
                </button>
                <button onClick={() => setStage('reject')} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">
                  ✗ رفض الإنجاز
                </button>
                </div>
              </div>
            )}
            {stage === 'view' && !canReview && (
              <p className="text-xs text-[#767676] bg-[#F3F1F2] rounded-lg px-3 py-2 text-center">عرض فقط — لا يمكن الاعتماد أو الرفض</p>
            )}

            {stage === 'reject' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-red-800">سبب الرفض (سيظهر للمحامي)</p>
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                  className="w-full px-3 py-2 text-sm bg-white border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                  placeholder="اكتب سبب الرفض بوضوح..." />
                {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setStage('view')}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold bg-white border border-red-200 text-red-700">إلغاء</button>
                  <button onClick={reject} disabled={saving || !rejectReason.trim()}
                    className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">
                    {saving ? 'جارٍ...' : 'تأكيد الرفض'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showNextTask && approvedTask && (
        <NextTaskModal
          task={approvedTask}
          taskDefs={taskDefs}
          onClose={() => setShowNextTask(false)}
          onDone={() => { onDone(); onClose() }}
        />
      )}
    </>
  )
}

/* ─── Page ────────────────────────────────────────────────────────────── */
export default function TaskReviewPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()
  const canReview = canReviewTasks(role)
  const isReadOnlyReview = canReadAdminData(role) && !canReview
  const [tasks, setTasks] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [taskDefs, setTaskDefs] = useState<TaskDef[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<any | null>(null)
  // مهام اعتُمد إنجازها ولم تُنشأ مهمتها التالية بعد (لا أتعاب محتسبة)
  const [awaitingNextTasks, setAwaitingNextTasks] = useState<any[]>([])
  const [resumeNextTask, setResumeNextTask] = useState<any | null>(null)
  const [filterLawyer, setFilterLawyer] = useState('')
  const [filterDelegate, setFilterDelegate] = useState('')
  const [filterCaseType, setFilterCaseType] = useState<'' | CaseType>('')
  const [lawyers, setLawyers] = useState<any[]>([])
  const [delegates, setDelegates] = useState<{ id: string; full_name: string }[]>([])
  const lawyersRef = useRef(lawyers)
  const delegatesRef = useRef(delegates)
  lawyersRef.current = lawyers
  delegatesRef.current = delegates

  const assigneeFilterId = filterDelegate || filterLawyer || null

  const load = useCallback(async (append = false, offset = 0) => {
    const supabase = createClient()

    if (!branchId && !viewAllBranches) {
      setTasks([])
      setLawyers([])
      setDelegates([])
      setTotal(0)
      setLoading(false)
      return
    }

    if (append) setLoadingMore(true)
    else {
      const cacheKey = `tasks:review:v4:${branchId ?? 'all'}:${assigneeFilterId ?? 'all'}:${filterCaseType || 'all'}:${offset}`
      const cached = cacheGet<{ tasks: any[]; lawyers: any[]; delegates: any[]; total: number }>(cacheKey)
      if (cached && !append) {
        setTasks(cached.tasks)
        setLawyers(cached.lawyers)
        setDelegates(cached.delegates ?? [])
        setTotal(cached.total)
        setPageOffset(cached.tasks.length)
        setLoading(false)
        return
      }
      setLoading(true)
      if (!append) setTasks([])
    }

    try {
      const [page, l, dRes] = await Promise.all([
        fetchPendingReviewTasksPaginated(supabase, branchId, {
          offset,
          limit: REVIEW_TASK_PAGE_SIZE,
          lawyerId: assigneeFilterId,
          caseType: filterCaseType || null,
          includeCompletionData: true,
        }),
        append ? Promise.resolve(lawyersRef.current) : fetchBranchLawyers(supabase, branchId),
        append
          ? Promise.resolve({ delegates: delegatesRef.current })
          : fetchBranchDelegates(supabase, branchId),
      ])

      const rawTasks = page.tasks
      const defIds = [...new Set(rawTasks.map(x => x.task_definition_id).filter(Boolean))]
      const gpsMap: Record<string, string[]> = {}
      const labelMapByDef: Record<string, Record<string, string>> = {}
      if (defIds.length > 0) {
        const { data: rfs } = await supabase
          .from('task_required_fields')
          .select('task_definition_id, field_key, field_label, field_type')
          .in('task_definition_id', defIds as string[])
        for (const f of rfs ?? []) {
          if (f.field_type === 'gps') {
            if (!gpsMap[f.task_definition_id]) gpsMap[f.task_definition_id] = []
            gpsMap[f.task_definition_id].push(f.field_key)
          }
        }
        for (const defId of defIds) {
          const fields = (rfs ?? []).filter(r => r.task_definition_id === defId)
          labelMapByDef[defId as string] = buildCompletionFieldLabelMap(fields)
        }
      }

      const nextTasks = rawTasks.map(task => ({
        ...task,
        _gpsKeys: gpsMap[task.task_definition_id ?? ''] ?? [],
        _fieldLabels: labelMapByDef[task.task_definition_id ?? ''] ?? {},
      }))
      const nextDelegates = dRes.delegates ?? []

      setTasks(prev => {
        const merged = append ? [...prev, ...nextTasks] : nextTasks
        cacheSet(`tasks:review:v4:${branchId ?? 'all'}:${assigneeFilterId ?? 'all'}:${filterCaseType || 'all'}:${offset}`, {
          tasks: merged,
          lawyers: l ?? [],
          delegates: nextDelegates,
          total: page.total,
        }, CACHE_TTL.list)
        return merged
      })

      if (!append) {
        setLawyers(l ?? [])
        setDelegates(nextDelegates)
      }
      setTotal(page.total)
      setPageOffset(offset + nextTasks.length)
    } catch (e) {
      console.error('[tasks/review] load error:', e)
      if (!append) {
        setTasks([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [branchId, viewAllBranches, assigneeFilterId, filterCaseType])

  const loadAwaitingNext = useCallback(async () => {
    if (!branchId && !viewAllBranches) {
      setAwaitingNextTasks([])
      return
    }
    const supabase = createClient()
    let q = supabase
      .from('tasks')
      .select(`
        id, debtor_id, branch_id, task_type, task_definition_id, completion_data, reward_amount, completed_at,
        task_definitions(label, fee_amount),
        debtors:debtors!tasks_debtor_id_fkey(id, full_name, case_type, governorate, latitude, longitude)
      `)
      .eq('task_status', 'approved')
      .eq('fee_status', 'approved_pending_next')
      .not('debtor_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(60)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data, error } = await q
    if (error) {
      console.error('[tasks/review] awaiting-next load:', error.message)
      setAwaitingNextTasks([])
      return
    }
    setAwaitingNextTasks(data ?? [])
  }, [branchId, viewAllBranches])

  useEffect(() => {
    setPageOffset(0)
    load(false, 0)
  }, [branchId, viewAllBranches, assigneeFilterId, filterCaseType, load])

  useEffect(() => {
    loadAwaitingNext()
  }, [loadAwaitingNext])

  useEffect(() => {
    const loadDefs = async () => {
      const supabase = createClient()
      const data = await fetchActiveTaskDefinitions(supabase, branchId, 'id, label, sort_order, fee_amount, branch_id, case_type')
      setTaskDefs(data as unknown as TaskDef[])
    }
    loadDefs()
  }, [branchId, viewAllBranches])

  async function openReview(task: any) {
    if (task.completion_data) {
      setReviewing(task)
      return
    }
    if (!branchId && !viewAllBranches) return
    const supabase = createClient()
    const full = await fetchPendingReviewTaskById(supabase, branchId, task.id)
    setReviewing(full ? { ...full, _gpsKeys: task._gpsKeys, _fieldLabels: task._fieldLabels } : task)
  }

  const hasMore = tasks.length < total

  return (
    <div className="space-y-5">
      <PageHeader
        title="مراجعة الإنجازات"
        subtitle={`${total} مهمة بانتظار الاعتماد`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-60">
          <PremiumSelect
            value={filterCaseType}
            onChange={(v) => setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')}
            options={CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            placeholder="كل أنواع الدعاوى"
            headerTitle="تصفية حسب نوع الدعوى"
            searchable={false}
          />
        </div>
        <div className="w-60">
          <PremiumSelect
            value={filterLawyer}
            onChange={(v) => {
              setFilterLawyer(v)
              if (v) setFilterDelegate('')
            }}
            options={[
              { value: '', label: 'كل المحامين' },
              ...lawyers.map(l => ({ value: l.id, label: l.full_name })),
            ]}
            placeholder="كل المحامين"
            headerTitle="تصفية حسب المحامي"
            searchPlaceholder="بحث..."
          />
        </div>
        <div className="w-60">
          <PremiumSelect
            value={filterDelegate}
            onChange={(v) => {
              setFilterDelegate(v)
              if (v) setFilterLawyer('')
            }}
            options={[
              { value: '', label: 'كل المندوبين' },
              ...delegates.map(d => ({ value: d.id, label: d.full_name })),
            ]}
            placeholder="كل المندوبين"
            headerTitle="تصفية حسب المندوب"
            searchPlaceholder="بحث..."
          />
        </div>
        <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-full">
          {total} بانتظار الاعتماد
        </span>
      </div>

      {awaitingNextTasks.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black text-amber-800">بانتظار إنشاء المهمة التالية ({awaitingNextTasks.length})</p>
            <span className="text-[10px] text-amber-700 font-semibold">الأتعاب لا تُحتسب قبل إنشاء المهمة التالية</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {awaitingNextTasks.map(t => {
              const label = t.task_definitions?.label ?? (TASK_TYPE_LABELS[t.task_type as TaskType] ?? t.task_type)
              return (
                <div key={t.id} className="bg-white border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#231F20] truncate">{t.debtors?.full_name ?? '—'}</p>
                    <p className="text-xs text-[#767676] truncate">{label}</p>
                  </div>
                  {canReview ? (
                    <button
                      onClick={() => setResumeNextTask(t)}
                      className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold text-white hover:opacity-90"
                      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                    >
                      إنشاء المهمة التالية
                    </button>
                  ) : (
                    <Badge variant="purple">بانتظار المهمة التالية</Badge>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3">
          <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
        </div>
      ) : !tasks.length ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl mx-auto mb-4">✓</div>
          <p className="text-base font-bold text-[#231F20]">لا توجد إنجازات بانتظار المراجعة</p>
          <p className="text-sm text-[#767676] mt-1">جميع الإنجازات تمت مراجعتها</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tasks.map(task => {
            const completionData = (task.completion_data ?? {}) as Record<string, string>
            const hasData = Object.keys(completionData).length > 0
            const courtName = task.courts?.name ?? task.court_name
            const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)
            return (
              <div key={task.id}
                className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-[rgba(118,118,118,0.08)]" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-white font-bold text-sm leading-tight">{taskLabel}</p>
                      <p className="text-white/70 text-xs mt-0.5 truncate">{task.debtors?.full_name ?? '—'}</p>
                      <p className="text-white/55 text-[11px] mt-0.5">
                        {CASE_TYPE_LABELS[normalizeCaseType(task.debtors?.case_type)]}
                      </p>
                    </div>
                    <Badge variant="purple">بانتظار الاعتماد</Badge>
                  </div>
                </div>

                <div className="px-4 py-3 flex-1 space-y-2">
                  <InfoRow label={assigneePersonLabel(task.lawyer?.role)} value={task.lawyer?.full_name} />
                  <InfoRow label="تاريخ التكليف" value={task.assigned_at ? fmtDate(task.assigned_at.split('T')[0]) : undefined} />
                  <InfoRow label="تاريخ الاستحقاق" value={task.due_date ? fmtDate(task.due_date) : undefined} />
                  <InfoRow label="المحكمة" value={courtName} />
                  <InfoRow label="المحافظة" value={task.debtors?.governorate} />
                  <InfoRow label="أُنجز في" value={task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : undefined} />
                  <InfoRow label="الأتعاب" value={fmtMoney(task.reward_amount)} accent />

                  {hasData && (
                    <div className="mt-2 bg-[#F3F1F2] rounded-lg px-3 py-2">
                      <p className="text-[10px] text-[#767676] font-bold mb-1">بيانات الإنجاز</p>
                      {Object.entries(completionData).slice(0, 2).map(([k, v]) => (
                        <p key={k} className="text-xs text-[#231F20] truncate">
                          <span className="text-[#767676]">
                            {resolveCompletionFieldLabel(k, task._fieldLabels as Record<string, string> | undefined)}:
                          </span>{' '}{v}
                        </p>
                      ))}
                      {Object.keys(completionData).length > 2 && (
                        <p className="text-[10px] text-[#767676] mt-0.5">+{Object.keys(completionData).length - 2} حقول أخرى</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="px-4 py-3 border-t border-[rgba(118,118,118,0.08)] bg-[#F3F1F2]/50">
                  <button onClick={() => openReview(task)}
                    className="w-full py-2 rounded-xl text-sm font-bold text-white hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                    {isReadOnlyReview ? 'عرض التفاصيل' : 'مراجعة واتخاذ قرار'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && hasMore && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => load(true, pageOffset)}
            disabled={loadingMore}
            className="text-sm font-bold text-[#2C8780] hover:underline disabled:opacity-50"
          >
            {loadingMore ? 'جارٍ التحميل...' : `تحميل المزيد (${tasks.length} / ${total})`}
          </button>
        </div>
      )}

      {reviewing && (
        <ReviewModal
          task={reviewing}
          taskDefs={taskDefs}
          canReview={canReview}
          onClose={() => {
            setReviewing(null)
            // قد يكون الإنجاز اعتُمد دون إنشاء المهمة التالية — حدّث قسم الانتظار
            loadAwaitingNext()
          }}
          onDone={() => {
            setReviewing(null)
            cacheInvalidatePrefix('tasks:review:')
            if (branchId) cacheDelete(`dashboard:${branchId}`)
            else cacheInvalidatePrefix('dashboard:')
            setPageOffset(0)
            load(false, 0)
            loadAwaitingNext()
            refreshAdminNotifications()
          }}
        />
      )}

      {resumeNextTask && (
        <NextTaskModal
          task={{ ...resumeNextTask, _gpsKeys: resumeNextTask._gpsKeys ?? [] }}
          taskDefs={taskDefs}
          onClose={() => setResumeNextTask(null)}
          onDone={() => {
            setResumeNextTask(null)
            cacheInvalidatePrefix('tasks:review:')
            if (branchId) cacheDelete(`dashboard:${branchId}`)
            else cacheInvalidatePrefix('dashboard:')
            loadAwaitingNext()
            load(false, 0)
            refreshAdminNotifications()
          }}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-[rgba(118,118,118,0.06)] last:border-0">
      <span className="text-[10px] text-[#767676] shrink-0">{label}</span>
      <span className={`text-xs font-bold truncate ${accent ? 'text-[#2C8780]' : 'text-[#231F20]'}`}>{value}</span>
    </div>
  )
}
