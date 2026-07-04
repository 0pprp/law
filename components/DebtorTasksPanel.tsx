'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '@/lib/types'
import type { TaskStatus, TaskType, Court, ExecutionDepartment } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { logActivity } from '@/lib/activity-log'
import { useBranchId } from '@/context/branch'
import { buildAssignPayload } from '@/lib/task-assignment'
import { ACTIVE_CASE_BLOCK_MSG, hasActiveCurrentTask } from '@/lib/debtor-current-task'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DatePicker } from '@/components/ui/date-picker'
import { useCanWrite } from '@/hooks/use-can-write'

const STATUS_BADGE: Partial<Record<TaskStatus, 'default' | 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  draft: 'gray',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
  new: 'info',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

const INP = 'w-full px-3 py-2 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'
const SEL = INP

interface TaskDef {
  id: string
  task_type: TaskType
  label: string
  fee_amount: number
  required_fields: string[]
  is_active: boolean
}

// ─── Create Task Modal ─────────────────────────────────────────────────────────
function CreateTaskModal({ debtorId, defs, courts, execDepts, onClose, onCreated }: {
  debtorId: string
  defs: TaskDef[]
  courts: Court[]
  execDepts: ExecutionDepartment[]
  onClose: () => void
  onCreated: () => void
}) {
  const branchId = useBranchId()
  const [taskType, setTaskType] = useState<TaskType | ''>('')
  const [dueDate, setDueDate] = useState('')
  const [courtId, setCourtId] = useState('')
  const [execDeptId, setExecDeptId] = useState('')
  const [adminNotes, setAdminNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedDef = defs.find(d => d.task_type === taskType)
  const selectedCourt = courts.find(c => c.id === courtId)
  // Filter execution departments to those linked to the selected court (or all if no court)
  const filteredExecDepts = courtId
    ? execDepts.filter(d => d.court_id === courtId)
    : execDepts

  async function save() {
    if (!taskType) { setError('اختر نوع المهمة'); return }
    setSaving(true)
    setError('')
    const supabase = createClient()

    const { data: debtor } = await supabase
      .from('debtors')
      .select('case_status, current_task_id')
      .eq('id', debtorId)
      .single()

    if (hasActiveCurrentTask(debtor ?? {})) {
      setError(ACTIVE_CASE_BLOCK_MSG)
      setSaving(false)
      return
    }

    const { data: newTask, error: err } = await supabase.from('tasks').insert({
      debtor_id: debtorId,
      task_type: taskType,
      task_status: 'draft',
      due_date: dueDate || null,
      court_id: courtId || null,
      court_name: selectedCourt?.name || null,
      execution_dept_id: execDeptId || null,
      admin_notes: adminNotes || null,
      branch_id: branchId,
    } as any).select('id').single()
    if (err || !newTask) { setError(err?.message ?? 'فشل إنشاء المهمة'); setSaving(false); return }

    await supabase.from('debtors').update({ current_task_id: newTask.id }).eq('id', debtorId)
    await logActivity({
      action: 'create_task',
      entity_type: 'task',
      entity_id: debtorId,
      description: `إنشاء مهمة: ${TASK_TYPE_LABELS[taskType as TaskType]}`,
    }, supabase)
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <h2 className="font-bold text-[#231F20] text-base">إضافة مهمة جديدة</h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Task type */}
          <div>
            <PremiumSelect
              value={taskType}
              onChange={v => setTaskType(v as TaskType)}
              options={[
                { value: '', label: '— اختر نوع المهمة —' },
                ...defs.filter(d => d.is_active).map(d => ({ value: d.task_type, label: d.label })),
              ]}
              fieldLabel="نوع المهمة"
              placeholder="— اختر نوع المهمة —"
              headerTitle="نوع المهمة"
              searchPlaceholder="بحث في أنواع المهام..."
              searchable={defs.filter(d => d.is_active).length > 4}
            />
          </div>

          {/* Fee preview */}
          {selectedDef && (
            <div className="bg-[#2C8780]/6 border border-[#2C8780]/20 rounded-xl px-3 py-2.5 text-xs text-[#231F20]">
              <span className="font-bold">الأتعاب:</span>{' '}
              <span className="text-[#2C8780] font-black">{Number(selectedDef.fee_amount).toLocaleString('en-US')} د.ع</span>
            </div>
          )}

          {/* Court */}
          <div>
            <PremiumSelect
              value={courtId}
              onChange={v => { setCourtId(v); setExecDeptId('') }}
              options={[
                { value: '', label: '— اختر المحكمة —' },
                ...courts.filter(c => c.is_active).map(c => ({ value: c.id, label: c.name })),
              ]}
              fieldLabel="المحكمة"
              placeholder="— اختر المحكمة —"
              headerTitle="اختر المحكمة"
              searchPlaceholder="بحث في المحاكم..."
              searchable={courts.filter(c => c.is_active).length > 4}
            />
          </div>

          {/* Execution department (filtered by court) */}
          <div>
            <PremiumSelect
              value={execDeptId}
              onChange={setExecDeptId}
              disabled={filteredExecDepts.length === 0}
              options={[
                { value: '', label: '— اختر دائرة التنفيذ —' },
                ...filteredExecDepts.filter(d => d.is_active).map(d => ({ value: d.id, label: d.name })),
              ]}
              fieldLabel="دائرة التنفيذ"
              placeholder="— اختر دائرة التنفيذ —"
              headerTitle="اختر دائرة التنفيذ"
              searchPlaceholder="بحث في الدوائر..."
              searchable={filteredExecDepts.filter(d => d.is_active).length > 4}
            />
          </div>

          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            fieldLabel="تاريخ نهاية التكليف"
            headerTitle="تاريخ نهاية التكليف"
            placeholder="اختر التاريخ"
            minDate={new Date().toISOString().split('T')[0]}
          />

          {/* Admin notes */}
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">ملاحظات للمحامي</label>
            <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)}
              rows={3} className={INP + ' resize-none'} placeholder="تعليمات أو ملاحظات..." />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3 shrink-0 bg-[#F3F1F2]/50">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">
            إلغاء
          </button>
          <button onClick={save} disabled={saving || !taskType}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الحفظ...' : 'إضافة المهمة'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assign Lawyer Modal ───────────────────────────────────────────────────────
function AssignModal({ taskId, taskLabel, onClose, onAssigned }: {
  taskId: string
  taskLabel: string
  onClose: () => void
  onAssigned: () => void
}) {
  const branchId = useBranchId()
  const [lawyers, setLawyers] = useState<any[]>([])
  const [lawyerId, setLawyerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    let q = supabase.from('profiles').select('id, full_name, governorate')
      .eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    q.then(({ data }) => setLawyers(data ?? []))
  }, [branchId])

  async function assign() {
    if (!lawyerId) { setError('اختر محامياً'); return }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('tasks').update(
      buildAssignPayload(lawyerId) as any
    ).eq('id', taskId)
    if (err) { setError(err.message); setSaving(false); return }
    await logActivity({
      action: 'assign_task',
      entity_type: 'task',
      entity_id: taskId,
      description: `تكليف مهمة: ${taskLabel}`,
    }, supabase)
    onAssigned()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">

        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between">
          <h2 className="font-bold text-[#231F20] text-sm">تكليف: {taskLabel}</h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <PremiumSelect
              value={lawyerId}
              onChange={setLawyerId}
              options={[
                { value: '', label: '— اختر محامياً —' },
                ...lawyers.map(l => ({
                  value: l.id,
                  label: l.full_name,
                  hint: l.governorate || undefined,
                })),
              ]}
              fieldLabel="اختر المحامي"
              placeholder="— اختر محامياً —"
              headerTitle="اختر المحامي"
              searchPlaceholder="بحث بالاسم..."
              searchable
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 transition-colors">
            إلغاء
          </button>
          <button onClick={assign} disabled={saving || !lawyerId}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ التكليف...' : 'تكليف المحامي'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Panel ────────────────────────────────────────────────────────────────
export default function DebtorTasksPanel({ debtorId }: { debtorId: string }) {
  const branchId = useBranchId()
  const canWrite = useCanWrite()
  const [tasks, setTasks] = useState<any[]>([])
  const [debtorMeta, setDebtorMeta] = useState<{ current_task_id: string | null; case_status: string | null } | null>(null)
  const [defs, setDefs] = useState<TaskDef[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [execDepts, setExecDepts] = useState<ExecutionDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [assigning, setAssigning] = useState<{ id: string; label: string } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [
      { data: t },
      { data: debtor },
      { data: d },
      { data: c },
      { data: e },
    ] = await Promise.all([
      supabase.from('tasks')
        .select('*, lawyer:profiles!tasks_assigned_to_fkey(full_name), courts(name), execution_departments(name), task_definitions(label)')
        .eq('debtor_id', debtorId)
        .order('created_at', { ascending: false }),
      supabase.from('debtors').select('current_task_id, case_status').eq('id', debtorId).single(),
      (() => {
        let q = (supabase as any).from('task_definitions').select('*').eq('is_active', true).order('sort_order')
        if (branchId) q = q.eq('branch_id', branchId)
        return q
      })(),
      (supabase as any).from('courts').select('*').eq('is_active', true).order('name'),
      (supabase as any).from('execution_departments').select('*').eq('is_active', true).order('name'),
    ])
    setTasks(t ?? [])
    setDebtorMeta(debtor ?? null)
    setDefs(d ?? [])
    setCourts(c ?? [])
    setExecDepts(e ?? [])
    setLoading(false)
  }, [debtorId, branchId])

  useEffect(() => { load() }, [load])

  const canAddTask = canWrite && !hasActiveCurrentTask(debtorMeta ?? {})
  const currentTaskId = debtorMeta?.current_task_id ?? null
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.id === currentTaskId) return -1
    if (b.id === currentTaskId) return 1
    return 0
  })

  if (loading) return (
    <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-8 flex items-center justify-center gap-3">
      <svg className="w-5 h-5 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
    </div>
  )

  return (
    <>
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-[rgba(118,118,118,0.08)] bg-[#F3F1F2]">
          <h3 className="font-bold text-[#231F20] text-sm">المهام ({tasks.length})</h3>
          {canAddTask ? (
            <button onClick={() => setShowCreate(true)}
              className="text-xs font-bold text-white px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
              + إضافة مهمة
            </button>
          ) : (
            <span className="text-[10px] text-[#767676] max-w-[200px] text-left leading-tight">
              {ACTIVE_CASE_BLOCK_MSG}
            </span>
          )}
        </div>

        {/* Tasks list */}
        {sortedTasks.length === 0 ? (
          <div className="py-10 text-center text-[#767676] text-sm">لا توجد مهام لهذا المدين</div>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {sortedTasks.map(t => {
              const label = t.task_definitions?.label ?? TASK_TYPE_LABELS[t.task_type as TaskType] ?? t.task_type
              const isCurrent = t.id === currentTaskId
              const isDraft = t.task_status === 'draft'
              const isOverdue = t.due_date
                && t.due_date < new Date().toISOString().split('T')[0]
                && !['completed', 'closed', 'failed', 'approved'].includes(t.task_status)
              const courtName = (t.courts as any)?.name ?? t.court_name
              return (
                <div key={t.id} className={`px-5 py-3.5 flex items-start justify-between gap-3 ${isCurrent ? 'bg-[#2C8780]/5' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#231F20]">{label}</p>
                      {isCurrent ? (
                        <span className="text-[9px] font-bold text-white bg-[#2C8780] rounded px-1.5 py-0.5">المهمة الحالية</span>
                      ) : (
                        <span className="text-[9px] font-bold text-[#767676] bg-slate-100 rounded px-1.5 py-0.5">مهمة سابقة</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <p className="text-xs text-[#767676]">
                        {isDraft ? 'لم يُكلَّف بعد' : (t.lawyer?.full_name ?? '—')}
                      </p>
                      {courtName && (
                        <span className="text-[10px] text-[#767676]">· {courtName}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {t.due_date && (
                      <span className={`text-[11px] font-mono ${isOverdue ? 'text-red-500 font-bold' : 'text-[#767676]'}`} dir="ltr">
                        {fmtDate(t.due_date)}
                      </span>
                    )}
                    <Badge variant={STATUS_BADGE[t.task_status as TaskStatus] ?? 'default'}>
                      {TASK_STATUS_LABELS[t.task_status as TaskStatus] ?? t.task_status}
                    </Badge>
                    {isDraft && (
                      <button onClick={() => setAssigning({ id: t.id, label })}
                        className="text-xs font-bold text-white px-2.5 py-1 rounded-lg transition-colors"
                        style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                        تكليف
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTaskModal
          debtorId={debtorId}
          defs={defs}
          courts={courts}
          execDepts={execDepts}
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}

      {assigning && (
        <AssignModal
          taskId={assigning.id}
          taskLabel={assigning.label}
          onClose={() => setAssigning(null)}
          onAssigned={load}
        />
      )}
    </>
  )
}
