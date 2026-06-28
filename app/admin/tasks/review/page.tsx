'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { logActivity } from '@/lib/activity-log'
import { extractGpsFromCompletion } from '@/lib/task-approval'
import { rejectTaskExpenses } from '@/lib/expense-wallet'
import TaskExpensesReviewCard from '@/components/TaskExpensesReviewCard'
import { fetchPendingReviewTasksPaginated, fetchPendingReviewTaskById, fetchBranchLawyers, REVIEW_TASK_PAGE_SIZE } from '@/lib/task-assignment'
import { cacheGet, cacheSet, cacheDelete, CACHE_TTL } from '@/lib/query-cache'
import { refreshAdminNotifications } from '@/lib/admin-notifications'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { useBranchId } from '@/context/branch'
import { PremiumSelect } from '@/components/ui/premium-select'
import { fetchActiveTaskDefinitions } from '@/lib/task-definitions'
import { buildCompletionFieldLabelMap, resolveCompletionFieldLabel } from '@/lib/completion-field-labels'
import { useAdminRole } from '@/context/admin-role'
import { canReadAdminData, canReviewTasks } from '@/lib/permissions'

interface TaskDef { id: string; label: string; sort_order: number; fee_amount?: number }

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
      <div className="bg-[#F3F1F2] px-4 py-2.5 text-xs font-bold text-[#767676]">
        بيانات الإنجاز
      </div>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {entries.map(([key, val]) => {
          const isGps = gpsKeys.includes(key)
          const gpsCoords = isGps ? parseGps(val) : null
          const label = resolveCompletionFieldLabel(key, fieldLabels)
          return (
            <div key={key} className="px-4 py-2.5 flex items-start gap-3">
              <span className="text-xs text-[#767676] shrink-0 min-w-[100px]">{label}</span>
              {isGps && gpsCoords ? (
                <a href={`https://www.google.com/maps?q=${gpsCoords.lat},${gpsCoords.lng}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs font-semibold text-[#2C8780] hover:underline" dir="ltr">
                  {val} 🗺️
                </a>
              ) : (
                <span className="text-xs font-semibold text-[#231F20] break-all">{val}</span>
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

  if (!loaded) return <p className="text-xs text-[#767676]">جارٍ التحميل...</p>
  if (!atts.length) return <p className="text-xs text-[#767676] italic">لا توجد مرفقات</p>
  return (
    <div className="space-y-1.5">
      {atts.map(att => (
        <div key={att.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-[rgba(118,118,118,0.08)] last:border-0">
          <span className="text-xs text-[#231F20] truncate flex-1">{att.file_name}</span>
          {att.url
            ? <a href={att.url} target="_blank" rel="noreferrer" className="text-xs text-[#2C8780] font-bold shrink-0">فتح ↗</a>
            : <span className="text-xs text-[#767676] shrink-0">غير متاح</span>}
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
  const [nextTaskId, setNextTaskId] = useState<string>('')
  const [updateGps, setUpdateGps] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)
  const gpsKeys = (task._gpsKeys ?? []) as string[]
  const debtor = task.debtors as any
  const newGps = extractGpsFromCompletion(task.completion_data as Record<string, string>, gpsKeys)
  const hasExistingGps = debtor?.latitude != null && debtor?.longitude != null
  const showGpsUpdate = hasExistingGps && newGps != null

  async function proceedWithTransition(action: 'next' | 'close') {
    if (action === 'next' && !nextTaskId) {
      setError('يجب اختيار المهمة اللاحقة')
      return
    }
    setSaving(true); setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يجب تسجيل الدخول'); setSaving(false); return }

    const branchId = task.branch_id ?? debtor?.branch_id ?? null

    if (newGps && (!hasExistingGps || updateGps)) {
      await supabase.from('debtors').update({
        latitude: newGps.lat,
        longitude: newGps.lng,
        location_captured_at: new Date().toISOString(),
      }).eq('id', task.debtor_id)
    }

    if (action === 'close') {
      const closedAt = new Date().toISOString()
      const closePayloads: Record<string, unknown>[] = [
        { case_status: 'closed', closed_at: closedAt, current_task_id: null, last_task_id: task.id },
        { case_status: 'closed', closed_at: closedAt, current_task_id: null },
        { status: 'closed', closed_at: closedAt, current_task_id: null, last_task_id: task.id },
        { status: 'closed', closed_at: closedAt, current_task_id: null },
      ]
      let closeErr: { message?: string } | null = null
      for (const payload of closePayloads) {
        const { error: err } = await supabase.from('debtors').update(payload as any).eq('id', task.debtor_id)
        if (!err) { closeErr = null; break }
        closeErr = err
      }
      if (closeErr) {
        setError(closeErr.message ?? 'خطأ في إغلاق القضية')
        setSaving(false)
        return
      }
      await logActivity({
        action: 'close_case', entity_type: 'debtor', entity_id: task.debtor_id,
        description: `إغلاق قضية ${debtor?.full_name ?? '—'} — آخر مهمة: ${taskLabel}`,
      }, supabase)
    } else {
      const nextDef = taskDefs.find(d => d.id === nextTaskId)
      const { data: newTask, error: taskErr } = await supabase.from('tasks').insert({
        debtor_id: task.debtor_id,
        task_definition_id: nextTaskId,
        task_status: 'waiting_assignment',
        assigned_to: null,
        reward_amount: nextDef?.fee_amount ?? 0,
        branch_id: branchId,
        created_by: user.id,
      } as any).select('id').single()
      if (taskErr) {
        setError(taskErr.message)
        setSaving(false)
        return
      }

      const { error: linkErr } = await supabase
        .from('debtors')
        .update({ current_task_id: newTask.id, last_task_id: task.id, case_status: 'active' } as any)
        .eq('id', task.debtor_id)
      if (linkErr) {
        setError(linkErr.message)
        setSaving(false)
        return
      }

      await logActivity({
        action: 'approve_task_transition', entity_type: 'task', entity_id: task.id,
        description: `اعتماد "${taskLabel}" للمدين ${debtor?.full_name ?? '—'} والانتقال إلى "${nextDef?.label}"`,
      }, supabase)
    }

    setSaving(false); onDone(); onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]" dir="rtl">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)]">
          <h2 className="font-black text-[#231F20] text-base">الإجراء اللاحق للقضية</h2>
          <p className="text-xs text-[#767676] mt-0.5">
            المهمة المعتمدة: <span className="font-bold text-[#2C8780]">{taskLabel}</span>
            {' · '}{debtor?.full_name ?? '—'}
          </p>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {/* Option A: next task */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-[#767676]">أ) اختيار مهمة لاحقة</p>
            <PremiumSelect
              value={nextTaskId}
              onChange={v => { setNextTaskId(v); setError('') }}
              options={taskDefs.map(def => ({
                value: def.id,
                label: def.label,
                hint: def.fee_amount ? `${Number(def.fee_amount).toLocaleString('en-US')} د.ع أتعاب` : undefined,
              }))}
              placeholder="— اختر المهمة التالية —"
              headerTitle="المهمة اللاحقة"
              headerSubtitle={`${taskDefs.length} مهمة متاحة`}
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
      description: `اعتماد إنجاز مهمة: ${taskLabel}`,
    }, supabase)

    setApprovedTask({ ...task, task_status: 'approved' })
    setSaving(false)
    setShowNextTask(true)
  }

  async function reject() {
    if (!rejectReason.trim()) { setError('يجب إدخال سبب الرفض'); return }
    setSaving(true)
    const supabase = createClient()
    const payloads = [
      { task_status: 'needs_revision', admin_notes: rejectReason.trim() },
      { task_status: 'rejected', admin_notes: rejectReason.trim() },
    ]
    let lastErr: { message?: string } | null = null
    for (const payload of payloads) {
      const { error: err } = await supabase.from('tasks').update(payload as any).eq('id', task.id)
      if (!err) {
        await rejectTaskExpenses(supabase, task.id)
        await logActivity({
          action: 'reject_task', entity_type: 'task', entity_id: task.id,
          description: `رفض إنجاز مهمة: ${taskLabel} — السبب: ${rejectReason}`,
        }, supabase)
        setSaving(false); onDone(); onClose()
        return
      }
      lastErr = err
    }
    setError(lastErr?.message ?? 'فشل رفض المهمة'); setSaving(false)
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
              <p className="text-xs text-[#767676] mt-0.5">
                {task.debtors?.full_name ?? '—'} · {task.lawyer?.full_name ?? '—'}
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
                <p className="text-[10px] text-[#767676] mb-1">الأتعاب</p>
                <p className="text-sm font-black text-[#2C8780]" dir="ltr">{fmtMoney(task.reward_amount)}</p>
              </div>
              <div className="bg-[#F3F1F2] rounded-xl p-3">
                <p className="text-[10px] text-[#767676] mb-1">تاريخ الإنجاز</p>
                <p className="text-sm font-bold text-[#231F20]" dir="ltr">
                  {task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : '—'}
                </p>
              </div>
              {task.court_name && (
                <div className="bg-[#F3F1F2] rounded-xl p-3">
                  <p className="text-[10px] text-[#767676] mb-1">المحكمة</p>
                  <p className="text-sm font-bold text-[#231F20]">{task.courts?.name ?? task.court_name}</p>
                </div>
              )}
              {task.lawyer_notes && (
                <div className="bg-[#F3F1F2] rounded-xl p-3">
                  <p className="text-[10px] text-[#767676] mb-1">ملاحظات المحامي</p>
                  <p className="text-xs font-semibold text-[#231F20]">{task.lawyer_notes}</p>
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
              <div className="bg-[#F3F1F2] px-4 py-2.5 text-xs font-bold text-[#767676] uppercase tracking-wide">المرفقات</div>
              <div className="px-4 py-3"><AttachmentsCard taskId={task.id} /></div>
            </div>

            <TaskExpensesReviewCard taskId={task.id} />

            {stage === 'view' && canReview && (
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
  const [filterLawyer, setFilterLawyer] = useState('')
  const [lawyers, setLawyers] = useState<any[]>([])
  const lawyersRef = useRef(lawyers)
  lawyersRef.current = lawyers

  const load = useCallback(async (append = false, offset = 0) => {
    const supabase = createClient()

    if (!branchId) {
      setTasks([])
      setLawyers([])
      setTotal(0)
      setLoading(false)
      return
    }

    if (append) setLoadingMore(true)
    else {
      const cacheKey = `tasks:review:${branchId}:${filterLawyer}:${offset}`
      const cached = cacheGet<{ tasks: any[]; lawyers: any[]; total: number }>(cacheKey)
      if (cached && !append) {
        setTasks(cached.tasks)
        setLawyers(cached.lawyers)
        setTotal(cached.total)
        setPageOffset(cached.tasks.length)
        setLoading(false)
        return
      }
      setLoading(true)
      if (!append) setTasks([])
    }

    const [page, l] = await Promise.all([
      fetchPendingReviewTasksPaginated(supabase, branchId, {
        offset,
        limit: REVIEW_TASK_PAGE_SIZE,
        lawyerId: filterLawyer || null,
        includeCompletionData: true,
      }),
      append ? Promise.resolve(lawyersRef.current) : fetchBranchLawyers(supabase, branchId),
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

    setTasks(prev => {
      const merged = append ? [...prev, ...nextTasks] : nextTasks
      cacheSet(`tasks:review:${branchId}:${filterLawyer}:${offset}`, {
        tasks: merged,
        lawyers: l ?? [],
        total: page.total,
      }, CACHE_TTL.list)
      return merged
    })

    if (!append) setLawyers(l ?? [])
    setTotal(page.total)
    setPageOffset(offset + nextTasks.length)
    setLoading(false)
    setLoadingMore(false)
  }, [branchId, filterLawyer])

  useEffect(() => {
    setPageOffset(0)
    load(false, 0)
  }, [branchId, filterLawyer])

  useEffect(() => {
    const loadDefs = async () => {
      const supabase = createClient()
      const data = await fetchActiveTaskDefinitions(supabase, branchId, 'id, label, sort_order, fee_amount')
      setTaskDefs(data as unknown as TaskDef[])
    }
    loadDefs()
  }, [branchId])

  async function openReview(task: any) {
    if (task.completion_data) {
      setReviewing(task)
      return
    }
    const supabase = createClient()
    if (!branchId) return
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

      <div className="flex items-center gap-3">
        <div className="w-60">
          <PremiumSelect
            value={filterLawyer}
            onChange={setFilterLawyer}
            options={[
              { value: '', label: 'كل المحامين' },
              ...lawyers.map(l => ({ value: l.id, label: l.full_name })),
            ]}
            placeholder="كل المحامين"
            headerTitle="تصفية حسب المحامي"
            searchPlaceholder="بحث..."
          />
        </div>
        <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-full">
          {total} بانتظار الاعتماد
        </span>
      </div>

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
                    </div>
                    <Badge variant="purple">بانتظار الاعتماد</Badge>
                  </div>
                </div>

                <div className="px-4 py-3 flex-1 space-y-2">
                  <InfoRow label="المحامي" value={task.lawyer?.full_name} />
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
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null)
            if (branchId) {
              cacheDelete(`tasks:review:${branchId}:${filterLawyer}:0`)
              cacheDelete(`dashboard:${branchId}`)
            }
            setPageOffset(0)
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
