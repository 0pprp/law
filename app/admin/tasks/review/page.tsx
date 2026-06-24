'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { logActivity } from '@/lib/activity-log'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { useBranchId } from '@/context/branch'

interface TaskDef { id: string; label: string; sort_order: number }

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
function CompletionDataCard({ data, gpsKeys }: { data: Record<string, string>; gpsKeys: string[] }) {
  const entries = Object.entries(data).filter(([, v]) => v)
  if (!entries.length) return null
  return (
    <div className="border border-[rgba(118,118,118,0.15)] rounded-xl overflow-hidden">
      <div className="bg-[#F3F1F2] px-4 py-2.5 text-xs font-bold text-[#767676] uppercase tracking-wide">
        بيانات الإنجاز
      </div>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {entries.map(([key, val]) => {
          const isGps = gpsKeys.includes(key)
          const gpsCoords = isGps ? parseGps(val) : null
          return (
            <div key={key} className="px-4 py-2.5 flex items-start gap-3">
              <span className="text-xs text-[#767676] shrink-0 min-w-[100px]">{key.replace(/_/g, ' ')}</span>
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
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)

  async function confirm() {
    if (!selected) { setError('يجب اختيار المرحلة التالية أو إغلاق القضية'); return }
    setSaving(true); setError('')

    const { error: approveErr } = await supabase
      .from('tasks')
      .update({ task_status: 'approved' } as any)
      .eq('id', task.id)
    if (approveErr) { setError(approveErr.message); setSaving(false); return }

    // GPS auto-save
    const gpsKeys = (task._gpsKeys ?? []) as string[]
    const debtor = task.debtors as any
    if (!debtor?.latitude && task.completion_data && gpsKeys.length > 0) {
      for (const key of gpsKeys) {
        const val = (task.completion_data as Record<string, string>)[key]
        if (val) {
          const parsed = parseGps(val)
          if (parsed) {
            await supabase.from('debtors').update({
              latitude: parsed.lat, longitude: parsed.lng,
              location_captured_at: new Date().toISOString(),
            }).eq('id', task.debtor_id)
            break
          }
        }
      }
    }

    const branchId = typeof window !== 'undefined' ? localStorage.getItem('selected_branch_id') : null

    if (selected === '__close__') {
      await supabase.from('debtors').update({
        case_status: 'closed', closed_at: new Date().toISOString(), current_task_id: null,
      } as any).eq('id', task.debtor_id)
      await logActivity({
        action: 'close_case', entity_type: 'debtor', entity_id: task.debtor_id,
        description: `إغلاق قضية ${debtor?.full_name ?? '—'} — آخر مهمة: ${taskLabel}`,
      }, supabase)
    } else {
      const { data: newTask, error: taskErr } = await supabase.from('tasks').insert({
        debtor_id: task.debtor_id,
        task_definition_id: selected,
        task_status: 'waiting_assignment',
        branch_id: branchId,
      } as any).select('id').single()
      if (taskErr) { setError(taskErr.message); setSaving(false); return }

      await supabase.from('debtors').update({ current_task_id: newTask.id } as any).eq('id', task.debtor_id)

      const nextDef = taskDefs.find(d => d.id === selected)
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
          <h2 className="font-black text-[#231F20] text-base">تحديد المرحلة التالية</h2>
          <p className="text-xs text-[#767676] mt-0.5">
            المهمة الحالية: <span className="font-bold text-[#2C8780]">{taskLabel}</span>
          </p>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {taskDefs.map(def => (
            <label key={def.id}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selected === def.id ? 'border-[#2C8780] bg-[#2C8780]/5' : 'border-[rgba(118,118,118,0.15)] hover:border-[#2C8780]/40'}`}>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected === def.id ? 'border-[#2C8780]' : 'border-[rgba(118,118,118,0.3)]'}`}>
                {selected === def.id && <div className="w-2 h-2 rounded-full bg-[#2C8780]" />}
              </div>
              <input type="radio" name="nextTask" value={def.id} className="sr-only"
                checked={selected === def.id} onChange={() => setSelected(def.id)} />
              <span className="text-sm font-semibold text-[#231F20]">{def.label}</span>
            </label>
          ))}

          <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selected === '__close__' ? 'border-red-500 bg-red-50' : 'border-[rgba(118,118,118,0.15)] hover:border-red-300'}`}>
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${selected === '__close__' ? 'border-red-500' : 'border-[rgba(118,118,118,0.3)]'}`}>
              {selected === '__close__' && <div className="w-2 h-2 rounded-full bg-red-500" />}
            </div>
            <input type="radio" name="nextTask" value="__close__" className="sr-only"
              checked={selected === '__close__'} onChange={() => setSelected('__close__')} />
            <div>
              <span className="text-sm font-bold text-red-600">القضية محسومة — إغلاق الملف</span>
              <p className="text-[10px] text-red-400 mt-0.5">يُنقل المدين لأرشيف القضايا المحسومة</p>
            </div>
          </label>
        </div>

        {error && <p className="px-5 pb-2 text-xs text-red-500">{error}</p>}

        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.08)] flex gap-3">
          <button onClick={confirm} disabled={saving || !selected}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الحفظ...' : 'تأكيد الاعتماد'}
          </button>
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] hover:bg-slate-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Review Modal ────────────────────────────────────────────────────── */
function ReviewModal({ task, taskDefs, onClose, onDone }: {
  task: any; taskDefs: TaskDef[]; onClose: () => void; onDone: () => void
}) {
  const [stage, setStage] = useState<'view' | 'approve' | 'reject'>('view')
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showNextTask, setShowNextTask] = useState(false)

  const completionData = (task.completion_data ?? {}) as Record<string, string>
  const gpsKeys = (task._gpsKeys ?? []) as string[]
  const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)

  async function reject() {
    if (!rejectReason.trim()) { setError('يجب إدخال سبب الرفض'); return }
    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('tasks').update({
      task_status: 'needs_info',
      admin_notes: rejectReason.trim(),
    } as any).eq('id', task.id)
    if (err) { setError(err.message); setSaving(false); return }
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
              <CompletionDataCard data={completionData} gpsKeys={gpsKeys} />
            )}

            <div className="border border-[rgba(118,118,118,0.15)] rounded-xl overflow-hidden">
              <div className="bg-[#F3F1F2] px-4 py-2.5 text-xs font-bold text-[#767676] uppercase tracking-wide">المرفقات</div>
              <div className="px-4 py-3"><AttachmentsCard taskId={task.id} /></div>
            </div>

            {stage === 'view' && (
              <div className="flex gap-3">
                <button onClick={() => setShowNextTask(true)}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  ✓ اعتماد الإنجاز وتحديد المرحلة
                </button>
                <button onClick={() => setStage('reject')}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700">
                  ✗ رفض الإنجاز
                </button>
              </div>
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

      {showNextTask && (
        <NextTaskModal
          task={task}
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
  const [tasks, setTasks] = useState<any[]>([])
  const [taskDefs, setTaskDefs] = useState<TaskDef[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<any | null>(null)
  const [filterLawyer, setFilterLawyer] = useState('')
  const [lawyers, setLawyers] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let q = supabase.from('tasks')
      .select(`
        *,
        debtors(id, full_name, phone, governorate, latitude, longitude),
        lawyer:profiles!tasks_assigned_to_fkey(id, full_name),
        task_definitions(id, label),
        courts(name),
        execution_departments(name)
      `)
      .eq('task_status', 'submitted')
      .order('completed_at', { ascending: true })
    if (branchId) q = (q as any).eq('branch_id', branchId)

    const [{ data: t }, { data: l }] = await Promise.all([
      q,
      supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name'),
    ])

    // Fetch GPS field keys for all task_definitions
    const defIds = [...new Set((t ?? []).map((x: any) => x.task_definition_id).filter(Boolean))]
    let gpsMap: Record<string, string[]> = {}
    if (defIds.length > 0) {
      const { data: rfs } = await supabase
        .from('task_required_fields')
        .select('task_definition_id, field_key')
        .in('task_definition_id', defIds as string[])
        .eq('field_type', 'gps')
      ;(rfs ?? []).forEach((f: any) => {
        if (!gpsMap[f.task_definition_id]) gpsMap[f.task_definition_id] = []
        gpsMap[f.task_definition_id].push(f.field_key)
      })
    }

    // Attach GPS keys to each task
    const enriched = (t ?? []).map((task: any) => ({
      ...task,
      _gpsKeys: gpsMap[task.task_definition_id] ?? [],
    }))

    setTasks(enriched)
    setLawyers(l ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    load()
    // Load task defs for next-task selection
    const loadDefs = async () => {
      const supabase = createClient()
      let q = supabase.from('task_definitions').select('id, label, sort_order').eq('is_active', true).order('sort_order')
      if (branchId) q = (q as any).eq('branch_id', branchId)
      const { data } = await q
      setTaskDefs((data ?? []) as TaskDef[])
    }
    loadDefs()
  }, [load, branchId])

  const filtered = filterLawyer ? tasks.filter(t => t.lawyer?.id === filterLawyer) : tasks

  return (
    <div className="space-y-5">
      <PageHeader
        title="مراجعة الإنجازات"
        subtitle={`${filtered.length} مهمة بانتظار الاعتماد`}
      />

      <div className="flex items-center gap-3">
        <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm px-3 py-2 flex items-center gap-2 w-60">
          <svg className="w-4 h-4 text-[#767676] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <select value={filterLawyer} onChange={e => setFilterLawyer(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[#231F20] focus:outline-none">
            <option value="">كل المحامين</option>
            {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
          </select>
        </div>
        <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-full">
          {filtered.length} بانتظار الاعتماد
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
      ) : !filtered.length ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl mx-auto mb-4">✓</div>
          <p className="text-base font-bold text-[#231F20]">لا توجد إنجازات بانتظار المراجعة</p>
          <p className="text-sm text-[#767676] mt-1">جميع الإنجازات تمت مراجعتها</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(task => {
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
                  <InfoRow label="المحكمة" value={courtName} />
                  <InfoRow label="المحافظة" value={task.debtors?.governorate} />
                  <InfoRow label="أُنجز في" value={task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : undefined} />
                  <InfoRow label="الأتعاب" value={fmtMoney(task.reward_amount)} accent />

                  {hasData && (
                    <div className="mt-2 bg-[#F3F1F2] rounded-lg px-3 py-2">
                      <p className="text-[10px] text-[#767676] font-bold mb-1">بيانات الإنجاز</p>
                      {Object.entries(completionData).slice(0, 2).map(([k, v]) => (
                        <p key={k} className="text-xs text-[#231F20] truncate">
                          <span className="text-[#767676]">{k.replace(/_/g, ' ')}:</span> {v}
                        </p>
                      ))}
                      {Object.keys(completionData).length > 2 && (
                        <p className="text-[10px] text-[#767676] mt-0.5">+{Object.keys(completionData).length - 2} حقول أخرى</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="px-4 py-3 border-t border-[rgba(118,118,118,0.08)] bg-[#F3F1F2]/50">
                  <button onClick={() => setReviewing(task)}
                    className="w-full py-2 rounded-xl text-sm font-bold text-white hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                    مراجعة واتخاذ قرار
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reviewing && (
        <ReviewModal
          task={reviewing}
          taskDefs={taskDefs}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); load() }}
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
