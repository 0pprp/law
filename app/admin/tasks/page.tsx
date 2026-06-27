'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId, useBranch } from '@/context/branch'
import { TASK_STATUS_LABELS } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import {
  fetchCurrentBranchTaskRows,
  assignTasksToLawyer,
  type CurrentBranchTaskRow,
} from '@/lib/task-assignment'
import { fetchBranchProfiles, filterLawyerProfiles } from '@/lib/branch-profiles'
import { formatErrorMessage } from '@/lib/format-error'
import { scheduleBranchMaintenance } from '@/lib/branch-maintenance'
import { cacheGet, cacheSet, cacheDelete } from '@/lib/query-cache'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import { fetchActiveTaskDefinitions } from '@/lib/task-definitions'
import { DatePicker } from '@/components/ui/date-picker'

type TaskView = 'waiting' | 'assigned'

const STATUS_BADGE: Partial<Record<TaskStatus, 'default' | 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  waiting_assignment: 'warning',
  pending_assignment: 'warning',
  draft: 'gray',
  new: 'info',
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  pending_review: 'purple',
}

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white text-[#231F20] transition-all w-full'

interface TasksPageCache {
  tasks: CurrentBranchTaskRow[]
  lawyers: { id: string; full_name: string }[]
  taskDefs: { id: string; label: string }[]
}

export default function TasksPage() {
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const [tasks, setTasks] = useState<CurrentBranchTaskRow[]>([])
  const [taskDefs, setTaskDefs] = useState<{ id: string; label: string }[]>([])
  const [lawyers, setLawyers] = useState<{ id: string; full_name: string }[]>([])
  const [taskView, setTaskView] = useState<TaskView>('waiting')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [matchingDebtorIds, setMatchingDebtorIds] = useState<string[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterDef, setFilterDef] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLawyerId, setBulkLawyerId] = useState('')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [singleAssignId, setSingleAssignId] = useState<string | null>(null)
  const [singleLawyerId, setSingleLawyerId] = useState('')

  const load = useCallback(async () => {
    setSelected(new Set())
    setError('')
    const supabase = createClient()

    if (!branchId) {
      setTasks([])
      setLawyers([])
      setTaskDefs([])
      setLoading(false)
      return
    }

    const cacheKey = `tasks:assign:${branchId}`
    const cached = cacheGet<TasksPageCache>(cacheKey)
    if (cached) {
      setTasks(cached.tasks)
      setLawyers(cached.lawyers)
      setTaskDefs(cached.taskDefs)
      setLoading(false)
    } else {
      setLoading(true)
      setTasks([])
      setLawyers([])
      setTaskDefs([])
    }

    scheduleBranchMaintenance(supabase, branchId)

    try {
      const [defs, raw, profilesResult] = await Promise.all([
        fetchActiveTaskDefinitions(supabase, branchId, 'id, label'),
        fetchCurrentBranchTaskRows(supabase, branchId),
        fetchBranchProfiles(supabase, branchId),
      ])

      const lawyerList = filterLawyerProfiles(profilesResult.profiles).map(({ id, full_name }) => ({ id, full_name }))

      if (profilesResult.error) {
        setError(formatErrorMessage(profilesResult.error))
      }

      const next: TasksPageCache = {
        tasks: raw,
        lawyers: lawyerList,
        taskDefs: defs as { id: string; label: string }[],
      }
      cacheSet(cacheKey, next)

      setTasks(next.tasks)
      setLawyers(next.lawyers)
      setTaskDefs(next.taskDefs)
    } catch (e: unknown) {
      setError(formatErrorMessage(e) || 'فشل تحميل المهام')
      setTasks([])
      setLawyers([])
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setMatchingDebtorIds(null)
      return
    }
    let cancelled = false
    resolveDebtorIdsBySearch(createClient(), debouncedSearch, branchId).then(ids => {
      if (!cancelled) setMatchingDebtorIds(ids ?? [])
    })
    return () => { cancelled = true }
  }, [debouncedSearch, branchId])

  useEffect(() => { load() }, [load])

  const waitingCount = useMemo(() => tasks.filter(t => !t.lawyerId).length, [tasks])
  const assignedCount = useMemo(() => tasks.filter(t => !!t.lawyerId).length, [tasks])

  const viewTasks = useMemo(() => {
    return taskView === 'waiting'
      ? tasks.filter(t => !t.lawyerId)
      : tasks.filter(t => !!t.lawyerId)
  }, [tasks, taskView])

  const filtered = useMemo(() => viewTasks.filter(t => {
    if (matchingDebtorIds !== null) {
      if (!matchingDebtorIds.includes(t.debtor_id)) return false
    }
    if (filterDef && t.task_definition_id !== filterDef) return false
    return true
  }), [viewTasks, matchingDebtorIds, filterDef])

  const isWaitingView = taskView === 'waiting'
  const allSelected = isWaitingView && filtered.length > 0 && filtered.every(t => selected.has(t.id))

  const assignmentMinDate = useMemo(() => {
    const ids = selected.size > 0
      ? Array.from(selected)
      : singleAssignId
        ? [singleAssignId]
        : []
    if (!ids.length) return undefined
    const dates = ids
      .map(id => tasks.find(t => t.id === id)?.created_at)
      .filter(Boolean)
      .map(d => d!.split('T')[0])
    return dates.length ? dates.sort().reverse()[0] : undefined
  }, [selected, singleAssignId, tasks])

  useEffect(() => {
    if (assignmentMinDate && bulkDueDate && bulkDueDate < assignmentMinDate) {
      setBulkDueDate('')
    }
  }, [assignmentMinDate, bulkDueDate])

  useEffect(() => {
    setSelected(new Set())
    setSingleAssignId(null)
    setSingleLawyerId('')
  }, [taskView])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(t => t.id)))
  }

  async function assignTaskIds(ids: string[], lawyerId: string, dueDate: string) {
    if (!lawyerId) { setError('اختر محامياً'); return }
    if (!dueDate) { setError('حدد تاريخ نهاية التكليف'); return }
    if (ids.length === 0) { setError('حدد مهمة واحدة على الأقل'); return }
    for (const id of ids) {
      const task = tasks.find(t => t.id === id)
      if (!task) continue
      const min = task.created_at.split('T')[0]
      if (dueDate < min) {
        setError(`تاريخ نهاية التكليف يجب أن يكون من ${fmtDate(min)} فما بعد (تاريخ إنشاء المهمة)`)
        return
      }
    }
    setAssigning(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const result = await assignTasksToLawyer(supabase, ids, lawyerId, dueDate, user?.id)
    if (!result.ok) {
      setError(result.error ?? 'فشل تكليف المهمة')
      setAssigning(false)
      return
    }

    const lawyerName = lawyers.find(l => l.id === lawyerId)?.full_name ?? '—'
    await logActivity({
      action: 'bulk_assign_tasks',
      entity_type: 'task',
      entity_id: ids[0],
      description: `تكليف ${ids.length} مهمة للمحامي ${lawyerName}`,
    }, supabase)

    setAssigning(false)
    setBulkLawyerId('')
    setBulkDueDate('')
    setSingleAssignId(null)
    setSingleLawyerId('')
    setSelected(new Set())
    if (branchId) {
      cacheDelete(`tasks:assign:${branchId}`)
      cacheDelete(`dashboard:${branchId}`)
    }
    await load()
  }

  const hasFilters = search || filterDef
  function clearFilters() {
    setSearch('')
    setFilterDef('')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="جدول المهام"
        subtitle={`${filtered.length} مهمة${taskView === 'waiting' ? ' بانتظار التكليف' : ' مكلفة'}${branchName ? ` · ${branchName}` : ''}`}
      />

      {!branchId && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض مهام القضايا.
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTaskView('waiting')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors border ${
              taskView === 'waiting'
                ? 'bg-[#2C8780] text-white border-[#2C8780]'
                : 'bg-white text-[#767676] border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40'
            }`}
          >
            بانتظار التكليف
            <span className={`mr-1.5 tabular-nums ${taskView === 'waiting' ? 'text-white/80' : 'text-[#2C8780]'}`}>
              ({waitingCount})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTaskView('assigned')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors border ${
              taskView === 'assigned'
                ? 'bg-[#2C8780] text-white border-[#2C8780]'
                : 'bg-white text-[#767676] border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40'
            }`}
          >
            مهام مكلفة
            <span className={`mr-1.5 tabular-nums ${taskView === 'assigned' ? 'text-white/80' : 'text-[#2C8780]'}`}>
              ({assignedCount})
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input type="search" placeholder={DEBTOR_SEARCH_PLACEHOLDER} value={search}
            onChange={e => setSearch(e.target.value)} className={SEL} />
          <PremiumSelect
            value={filterDef}
            onChange={setFilterDef}
            options={[
              { value: '', label: 'كل أنواع المهام' },
              ...taskDefs.map(d => ({ value: d.id, label: d.label })),
            ]}
            placeholder="كل أنواع المهام"
            headerTitle="تصفية حسب نوع المهمة"
            searchPlaceholder="بحث..."
          />
        </div>

        {hasFilters && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#767676]">{filtered.length} من {viewTasks.length} مهمة</p>
            <button onClick={clearFilters} className="text-xs text-[#2C8780] hover:underline">إلغاء التصفية</button>
          </div>
        )}

        {isWaitingView && (
          <>
            <div className="border-t border-[rgba(118,118,118,0.1)] pt-4 flex flex-col sm:flex-row sm:items-end gap-3">
              <PremiumSelect
                value={bulkLawyerId}
                onChange={v => { setBulkLawyerId(v); setError('') }}
                options={[
                  { value: '', label: '— اختر محامياً من هذا الفرع —' },
                  ...lawyers.map(l => ({ value: l.id, label: l.full_name })),
                ]}
                placeholder="— اختر محامياً —"
                headerTitle="اختر المحامي"
                headerSubtitle={`${lawyers.length} محامٍ في الفرع`}
                searchPlaceholder="بحث بالاسم..."
                disabled={!branchId}
                className="flex-1"
              />
              <DatePicker
                value={bulkDueDate}
                onChange={setBulkDueDate}
                fieldLabel="تاريخ نهاية التكليف"
                headerTitle="تاريخ نهاية التكليف"
                placeholder={assignmentMinDate ? `من ${fmtDate(assignmentMinDate)} فما بعد` : 'اختر تاريخ النهاية'}
                minDate={assignmentMinDate}
                disabled={!branchId}
                className="sm:w-52 shrink-0"
              />
              <button onClick={() => assignTaskIds(Array.from(selected), bulkLawyerId, bulkDueDate)}
                disabled={assigning || selected.size === 0 || !bulkLawyerId || !bulkDueDate || !branchId}
                className="shrink-0 px-5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                {assigning ? 'جارٍ التكليف...' : `تكليف المحددين${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
            </div>
            {assignmentMinDate && (selected.size > 0 || singleAssignId) && (
              <p className="text-[11px] text-[#767676]">
                تاريخ نهاية التكليف يبدأ من <span className="font-bold text-[#2C8780]" dir="ltr">{fmtDate(assignmentMinDate)}</span>
                {' '}(تاريخ إنشاء المهمة)
              </p>
            )}
            {branchId && lawyers.length === 0 && (
              <p className="text-[11px] text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg">
                لا يوجد محامون نشطون مرتبطون بهذا الفرع.{' '}
                <Link href="/admin/lawyers/new" className="font-bold underline">أضف محامياً</Link>
              </p>
            )}
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

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
            title={hasFilters ? 'لا نتائج للتصفية' : taskView === 'waiting' ? 'لا توجد مهام بانتظار التكليف' : 'لا توجد مهام مكلفة'}
            description={hasFilters ? 'جرّب تغيير معايير التصفية' : taskView === 'waiting' ? 'جميع المهام الحالية مكلّفة' : 'لا توجد مهام مكلفة حالياً في هذا الفرع'}
            action={hasFilters
              ? <button onClick={clearFilters} className="text-xs text-[#2C8780] hover:underline font-semibold">إلغاء التصفية</button>
              : <Link href="/admin/dashboard" className="text-xs text-[#2C8780] hover:underline font-semibold">العودة للوحة التحكم</Link>}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                {isWaitingView && (
                  <TH className="w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 accent-[#2C8780]" />
                  </TH>
                )}
                <TH>المدين</TH>
                <TH>الهاتف</TH>
                <TH>نوع المهمة</TH>
                {taskView === 'assigned' && <TH>المحامي المكلف</TH>}
                <TH>تاريخ إنشاء المهمة</TH>
                {taskView === 'assigned' && <TH>تاريخ التكليف</TH>}
                <TH>تاريخ نهاية التكليف</TH>
                <TH>الحالة</TH>
                {isWaitingView && <TH className="text-center">تكليف</TH>}
              </tr>
            </THead>
            <TBody>
              {filtered.map(t => (
                <TR key={t.id}>
                  {isWaitingView && (
                    <TD>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)}
                        className="w-4 h-4 accent-[#2C8780]" />
                    </TD>
                  )}
                  <TD>
                    <Link href={`/admin/debtors/${t.debtor_id}/account`}
                      className="font-semibold text-[#231F20] hover:text-[#2C8780] text-sm">
                      {t.debtorName}
                    </Link>
                  </TD>
                  <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{t.debtorPhone ?? '—'}</span></TD>
                  <TD><span className="text-xs text-[#231F20]">{t.taskLabel}</span></TD>
                  {taskView === 'assigned' && (
                    <TD>
                      <span className="text-xs font-semibold text-[#2C8780]">{t.lawyerName ?? '—'}</span>
                    </TD>
                  )}
                  <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{fmtDate(t.created_at.split('T')[0])}</span></TD>
                  {taskView === 'assigned' && (
                    <TD>
                      <span className="text-xs font-mono text-[#767676]" dir="ltr">
                        {t.assigned_at ? fmtDate(t.assigned_at.split('T')[0]) : '—'}
                      </span>
                    </TD>
                  )}
                  <TD>
                    {(() => {
                      const preview = isWaitingView && selected.has(t.id) && bulkDueDate ? bulkDueDate : null
                      const display = t.due_date ?? preview
                      if (!display) return <span className="text-xs text-[#767676]">—</span>
                      return (
                        <span
                          className={`text-xs font-mono ${preview && !t.due_date ? 'text-[#2C8780] font-semibold' : 'text-[#767676]'}`}
                          dir="ltr"
                          title={preview && !t.due_date ? 'سيُحفظ عند التكليف' : undefined}
                        >
                          {fmtDate(display)}
                        </span>
                      )
                    })()}
                  </TD>
                  <TD>
                    <Badge variant={STATUS_BADGE[t.task_status as TaskStatus] ?? 'warning'}>
                      {TASK_STATUS_LABELS[t.task_status as TaskStatus] ?? t.task_status}
                    </Badge>
                  </TD>
                  {isWaitingView && (
                    <TD>
                      {singleAssignId === t.id ? (
                        <div className="flex items-center gap-1 min-w-[200px]">
                          <PremiumSelect
                            value={singleLawyerId}
                            onChange={setSingleLawyerId}
                            options={lawyers.map(l => ({ value: l.id, label: l.full_name }))}
                            placeholder="محامي"
                            headerTitle="تكليف سريع"
                            searchable={lawyers.length > 4}
                            className="flex-1"
                          />
                          <button onClick={() => assignTaskIds([t.id], singleLawyerId, bulkDueDate)}
                            disabled={assigning || !singleLawyerId || !bulkDueDate}
                            className="text-[10px] font-bold text-white px-2 py-1 rounded bg-[#2C8780] disabled:opacity-50">
                            ✓
                          </button>
                          <button onClick={() => { setSingleAssignId(null); setSingleLawyerId('') }}
                            className="text-[10px] text-[#767676] px-1">×</button>
                        </div>
                      ) : (
                        <button onClick={() => { setSingleAssignId(t.id); setSingleLawyerId(bulkLawyerId) }}
                          className="text-[11px] font-bold text-white px-2.5 py-1 rounded-lg"
                          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                          تكليف
                        </button>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}
