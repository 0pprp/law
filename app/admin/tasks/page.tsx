'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS, TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '@/lib/types'
import type { TaskStatus, TaskType, TaskPriority } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtDate } from '@/lib/utils'

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

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white text-[#231F20] transition-all'
const INP = 'w-full px-3 py-2 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

function AssignModal({ taskId, taskLabel, lawyers, onClose, onDone }: {
  taskId: string
  taskLabel: string
  lawyers: any[]
  onClose: () => void
  onDone: () => void
}) {
  const [lawyerId, setLawyerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function assign() {
    if (!lawyerId) { setError('اختر محامياً'); return }
    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('tasks').update({ assigned_to: lawyerId, task_status: 'assigned' }).eq('id', taskId)
    if (err) { setError(err.message); setSaving(false); return }
    await logActivity({ action: 'assign_task', entity_type: 'task', entity_id: taskId, description: `تكليف مهمة: ${taskLabel}` }, supabase)
    onDone()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(118,118,118,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, color: '#231F20' }}>تكليف: {taskLabel}</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#F3F1F2', cursor: 'pointer', fontSize: 18, color: '#767676' }}>×</button>
        </div>
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اختر المحامي <span className="text-red-500">*</span></label>
            <select value={lawyerId} onChange={e => setLawyerId(e.target.value)} className={INP}>
              <option value="">— اختر محامياً —</option>
              {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(118,118,118,0.12)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-[#F3F1F2] transition-colors">إلغاء</button>
          <button onClick={assign} disabled={saving || !lawyerId} className="text-sm px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-60 transition-colors" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ التكليف...' : 'تكليف المحامي'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TasksPage() {
  const branchId = useBranchId()
  const [tasks, setTasks] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterLawyer, setFilterLawyer] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [assigning, setAssigning] = useState<{ id: string; label: string } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    let tq = supabase.from('tasks').select('*, debtors(full_name, governorate), profiles!tasks_assigned_to_fkey(id, full_name)').order('created_at', { ascending: false })
    let lq = supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) {
      tq = (tq as any).eq('branch_id', branchId)
      lq = (lq as any).eq('branch_id', branchId)
    }
    const [{ data: t }, { data: l }] = await Promise.all([tq, lq])
    setTasks(t ?? [])
    setLawyers(l ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  async function deleteTask(id: string, name: string) {
    if (!confirm(`هل أنت متأكد من حذف هذه المهمة الخاصة بـ "${name}"؟`)) return
    setDeletingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) { alert(`فشل الحذف: ${error.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_task', entity_type: 'task', entity_id: id, description: `حذف مهمة: ${name}` }, supabase)
    setDeletingId(null)
    load()
  }

  const filtered = useMemo(() => tasks.filter(t => {
    if (search && !t.debtors?.full_name?.includes(search)) return false
    if (filterLawyer === '__unassigned__' && t.assigned_to) return false
    if (filterLawyer && filterLawyer !== '__unassigned__' && t.assigned_to !== filterLawyer) return false
    if (filterStatus && t.task_status !== filterStatus) return false
    if (filterType && t.task_type !== filterType) return false
    return true
  }), [tasks, search, filterLawyer, filterStatus, filterType])

  const hasFilters = search || filterLawyer || filterStatus || filterType
  function clearFilters() { setSearch(''); setFilterLawyer(''); setFilterStatus(''); setFilterType('') }

  const statusOptions: [TaskStatus, string][] = [
    ['draft', 'بانتظار التكليف'],
    ['assigned', 'مكلفة'],
    ['in_progress', 'قيد التنفيذ'],
    ['submitted', 'بانتظار الاعتماد'],
    ['approved', 'معتمدة'],
    ['rejected', 'مرفوضة'],
    ['completed', 'منجزة نهائياً'],
    ['failed', 'تعذر الإنجاز'],
    ['postponed', 'مؤجلة'],
    ['closed', 'مغلقة'],
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="تكليف المهام" subtitle={`${filtered.length} مهمة`} />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input type="text" placeholder="بحث باسم المدين..." value={search} onChange={e => setSearch(e.target.value)} className={SEL + ' col-span-2 md:col-span-1'} />
          <select value={filterLawyer} onChange={e => setFilterLawyer(e.target.value)} className={SEL}>
            <option value="">كل المحامين</option>
            <option value="__unassigned__">غير مكلفة</option>
            {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SEL}>
            <option value="">كل الحالات</option>
            {statusOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className={SEL}>
            <option value="">كل الأنواع</option>
            {(Object.entries(TASK_TYPE_LABELS) as [TaskType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-[#767676]">تصفية نشطة — {filtered.length} من {tasks.length}</p>
            <button onClick={clearFilters} className="text-xs text-[#2C8780] hover:underline">إلغاء التصفية</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState
            title={hasFilters ? 'لا نتائج للتصفية' : 'لا توجد مهام بعد'}
            description={hasFilters ? 'جرّب تغيير معايير التصفية' : 'أضف مهاماً من ملف المدين'}
            action={hasFilters ? <button onClick={clearFilters} className="text-xs text-[#2C8780] hover:underline font-semibold">إلغاء التصفية</button> : undefined}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>المدين</TH>
                    <TH>نوع المهمة</TH>
                    <TH>الحالة</TH>
                    <TH>الأولوية</TH>
                    <TH>المحامي</TH>
                    <TH>الاستحقاق</TH>
                    <TH className="text-center">الإجراءات</TH>
                  </tr>
                </THead>
                <TBody>
                  {filtered.map((task: any) => {
                    const isDraft = task.task_status === 'draft'
                    const isOverdue = task.due_date && !['completed', 'closed', 'failed', 'approved'].includes(task.task_status) && new Date(task.due_date) < new Date()
                    const label = TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type
                    return (
                      <TR key={task.id}>
                        <TD className="font-semibold text-[#231F20]">{task.debtors?.full_name ?? '—'}</TD>
                        <TD className="text-xs text-[#767676]">{label}</TD>
                        <TD>
                          <Badge variant={STATUS_BADGE[task.task_status as TaskStatus] ?? 'default'}>
                            {TASK_STATUS_LABELS[task.task_status as TaskStatus] ?? task.task_status}
                          </Badge>
                        </TD>
                        <TD>
                          {task.priority && task.priority !== 'normal' ? (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TASK_PRIORITY_COLORS[task.priority as TaskPriority]}`}>
                              {TASK_PRIORITY_LABELS[task.priority as TaskPriority]}
                            </span>
                          ) : <span className="text-[#767676] text-xs">—</span>}
                        </TD>
                        <TD>
                          {task.profiles?.full_name
                            ? <span className="text-[#231F20] text-sm">{task.profiles.full_name}</span>
                            : <span className="text-[#767676] text-xs italic">غير مكلف</span>}
                        </TD>
                        <TD>
                          <div className="space-y-0.5">
                            <span className={`text-xs font-mono block ${isOverdue ? 'text-red-600 font-semibold' : 'text-[#767676]'}`} dir="ltr">
                              {fmtDate(task.due_date)}
                            </span>
                            {task.completion_deadline && (
                              <span className="text-[10px] text-[#767676] block" dir="ltr">
                                إنجاز: {fmtDate(task.completion_deadline)}
                              </span>
                            )}
                          </div>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-center gap-2">
                            {isDraft && (
                              <button onClick={() => setAssigning({ id: task.id, label })}
                                className="text-xs font-semibold text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                                تكليف
                              </button>
                            )}
                            <button onClick={() => deleteTask(task.id, task.debtors?.full_name ?? '')} disabled={deletingId === task.id}
                              className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {deletingId === task.id ? '...' : 'حذف'}
                            </button>
                          </div>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </div>

            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {filtered.map((task: any) => {
                const isDraft = task.task_status === 'draft'
                const label = TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type
                return (
                  <div key={task.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[#231F20] text-sm">{task.debtors?.full_name ?? '—'}</p>
                        <p className="text-xs text-[#767676]">{label}</p>
                      </div>
                      <Badge variant={STATUS_BADGE[task.task_status as TaskStatus] ?? 'default'}>
                        {TASK_STATUS_LABELS[task.task_status as TaskStatus] ?? task.task_status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-[#767676]">{task.profiles?.full_name ?? 'غير مكلف'}</p>
                      {task.priority && task.priority !== 'normal' && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TASK_PRIORITY_COLORS[task.priority as TaskPriority]}`}>
                          {TASK_PRIORITY_LABELS[task.priority as TaskPriority]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {isDraft && (
                        <button onClick={() => setAssigning({ id: task.id, label })}
                          className="flex-1 text-center text-xs text-white font-semibold py-1.5 rounded-lg"
                          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                          تكليف
                        </button>
                      )}
                      <button onClick={() => deleteTask(task.id, task.debtors?.full_name ?? '')} disabled={deletingId === task.id}
                        className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50">
                        {deletingId === task.id ? '...' : 'حذف'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {assigning && (
        <AssignModal
          taskId={assigning.id}
          taskLabel={assigning.label}
          lawyers={lawyers}
          onClose={() => setAssigning(null)}
          onDone={load}
        />
      )}
    </div>
  )
}