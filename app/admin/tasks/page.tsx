'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId, useBranch } from '@/context/branch'
import { TASK_STATUS_LABELS } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import {
  fetchCurrentBranchTaskRowsPaginated,
  assignTasksToLawyer,
  type CurrentBranchTaskRow,
  CURRENT_TASK_PAGE_SIZE,
} from '@/lib/task-assignment'
import { fetchBranchProfiles, filterLawyerProfiles } from '@/lib/branch-profiles'
import { formatErrorMessage } from '@/lib/format-error'
import { scheduleBranchMaintenance } from '@/lib/branch-maintenance'
import { cacheGet, cacheSet, cacheDelete, CACHE_TTL } from '@/lib/query-cache'
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
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, PERMISSION_DENIED_MSG } from '@/lib/permissions'

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
  total: number
  unassignedTotal: number
  assignedTotal: number
}

export default function TasksPage() {
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const role = useAdminRole()
  const canAssign = canAssignTasks(role)
  const [tasks, setTasks] = useState<CurrentBranchTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [unassignedTotal, setUnassignedTotal] = useState(0)
  const [assignedTotal, setAssignedTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [taskDefs, setTaskDefs] = useState<{ id: string; label: string }[]>([])
  const [lawyers, setLawyers] = useState<{ id: string; full_name: string }[]>([])
  const [taskView, setTaskView] = useState<TaskView>('waiting')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterDef, setFilterDef] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLawyerId, setBulkLawyerId] = useState('')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [singleAssignId, setSingleAssignId] = useState<string | null>(null)
  const [singleLawyerId, setSingleLawyerId] = useState('')

  const lawyersRef = useRef(lawyers)
  const taskDefsRef = useRef(taskDefs)
  lawyersRef.current = lawyers
  taskDefsRef.current = taskDefs

  const load = useCallback(async (append = false, offsetOverride?: number) => {
    if (!append) {
      setSelected(new Set())
      setError('')
    }
    const supabase = createClient()

    if (!branchId) {
      setTasks([])
      setLawyers([])
      setTaskDefs([])
      setTotal(0)
      setUnassignedTotal(0)
      setAssignedTotal(0)
      setPageOffset(0)
      setLoading(false)
      return
    }

    const offset = offsetOverride ?? 0
    const cacheKey = `tasks:assign:${branchId}:${taskView}:${filterDef}:${debouncedSearch}:${offset}`

    if (!append) {
      const cacheKey = `tasks:assign:${branchId}:${taskView}:${filterDef}:${debouncedSearch}:${offset}`
      const cached = cacheGet<TasksPageCache>(cacheKey)
      if (cached) {
        setTasks(cached.tasks)
        setLawyers(cached.lawyers)
        setTaskDefs(cached.taskDefs)
        setTotal(cached.total)
        setUnassignedTotal(cached.unassignedTotal)
        setAssignedTotal(cached.assignedTotal)
        setPageOffset(cached.tasks.length)
        setLoading(false)
        return
      }
      setLoading(true)
      setTasks([])
    } else {
      setLoadingMore(true)
    }

    scheduleBranchMaintenance(supabase, branchId)

    try {
      const debtorIds = debouncedSearch.trim()
        ? await resolveDebtorIdsBySearch(supabase, debouncedSearch, branchId)
        : null

      if (debtorIds && !debtorIds.length) {
        setTasks([])
        setTotal(0)
        setUnassignedTotal(0)
        setAssignedTotal(0)
        setPageOffset(0)
        setLoading(false)
        setLoadingMore(false)
        return
      }

      const [defs, page, profilesResult] = await Promise.all([
        append ? Promise.resolve(null) : fetchActiveTaskDefinitions(supabase, branchId, 'id, label'),
        fetchCurrentBranchTaskRowsPaginated(supabase, branchId, {
          assigned: taskView === 'assigned',
          taskDefinitionId: filterDef || null,
          debtorIds,
          offset,
          limit: CURRENT_TASK_PAGE_SIZE,
        }),
        append ? Promise.resolve(null) : fetchBranchProfiles(supabase, branchId),
      ])

      if (profilesResult?.error) {
        setError(formatErrorMessage(profilesResult.error))
      }

      setTasks(prev => {
        const nextTasks = append ? [...prev, ...page.rows] : page.rows
        const lawyerList = profilesResult
          ? filterLawyerProfiles(profilesResult.profiles).map(({ id, full_name }) => ({ id, full_name }))
          : lawyersRef.current
        const defsList = (defs as { id: string; label: string }[] | null) ?? taskDefsRef.current

        cacheSet(cacheKey, {
          tasks: nextTasks,
          lawyers: lawyerList,
          taskDefs: defsList,
          total: page.total,
          unassignedTotal: page.unassignedTotal,
          assignedTotal: page.assignedTotal,
        }, CACHE_TTL.list)

        if (profilesResult) setLawyers(lawyerList)
        if (defs) setTaskDefs(defsList)

        return nextTasks
      })

      setTotal(page.total)
      setUnassignedTotal(page.unassignedTotal)
      setAssignedTotal(page.assignedTotal)
      setPageOffset(offset + page.rows.length)
    } catch (e: unknown) {
      setError(formatErrorMessage(e) || 'فشل تحميل المهام')
      if (!append) {
        setTasks([])
        setLawyers([])
      }
    }
    setLoading(false)
    setLoadingMore(false)
  }, [branchId, taskView, filterDef, debouncedSearch])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    setPageOffset(0)
    load(false, 0)
  }, [branchId, taskView, filterDef, debouncedSearch, load])

  function loadMore() {
    if (loadingMore || tasks.length >= total) return
    load(true, pageOffset)
  }

  const waitingCount = unassignedTotal
  const assignedCount = assignedTotal
  const filtered = tasks
  const hasMore = tasks.length < total

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
    if (!canAssign) { setError(PERMISSION_DENIED_MSG); return }
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
      cacheDelete(`tasks:assign:${branchId}:${taskView}:${filterDef}:${debouncedSearch}:0`)
      cacheDelete(`dashboard:${branchId}`)
    }
    setPageOffset(0)
    await load(false, 0)
  }

  const hasFilters = search || filterDef
  function clearFilters() {
    setSearch('')
    setFilterDef('')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="تكليف المهام"
        subtitle={branchName ? `فرع ${branchName}` : 'اختر فرعاً من القائمة العلوية'}
      />

      {!branchId && (
        <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض مهام القضايا.
        </p>
      )}

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
          <span className="mr-1 opacity-80">({waitingCount})</span>
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
          <span className="mr-1 opacity-80">({assignedCount})</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          type="search"
          placeholder={DEBTOR_SEARCH_PLACEHOLDER}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={SEL}
        />
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
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[#767676]">{filtered.length} من {total} مهمة</span>
          <button type="button" onClick={clearFilters} className="text-[#2C8780] font-bold hover:underline">
            إلغاء التصفية
          </button>
        </div>
      )}

      {canAssign && isWaitingView && (
        <>
          <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl p-4 flex flex-col lg:flex-row lg:items-end gap-3 shadow-sm">
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
              minDate={assignmentMinDate}
              fieldLabel="تاريخ نهاية التكليف"
              headerTitle="تاريخ نهاية التكليف"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => assignTaskIds(Array.from(selected), bulkLawyerId, bulkDueDate)}
              disabled={assigning || selected.size === 0 || !bulkLawyerId || !bulkDueDate || !branchId}
              className="shrink-0 px-5 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
            >
              {assigning ? 'جارٍ التكليف...' : `تكليف المحددين${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
          {assignmentMinDate && (selected.size > 0 || singleAssignId) && (
            <p className="text-[11px] text-[#767676]">
              تاريخ نهاية التكليف يبدأ من {fmtDate(assignmentMinDate)} (تاريخ إنشاء المهمة)
            </p>
          )}
          {branchId && lawyers.length === 0 && (
            <p className="text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              لا يوجد محامون نشطون مرتبطون بهذا الفرع.{' '}
              <Link href="/admin/lawyers" className="font-bold underline">أضف محامياً</Link>
            </p>
          )}
        </>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="bg-white border border-[rgba(118,118,118,0.15)] rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-2 border-[#2C8780] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState
            title={hasFilters ? 'لا نتائج' : isWaitingView ? 'لا مهام بانتظار التكليف' : 'لا مهام مكلفة'}
            description={hasFilters ? 'جرّب تغيير البحث أو التصفية' : 'ستظهر المهام هنا عند توفرها'}
            action={hasFilters ? (
              <button type="button" onClick={clearFilters} className="text-sm font-bold text-[#2C8780] hover:underline">
                إلغاء التصفية
              </button>
            ) : (
              <Link href="/admin/dashboard" className="text-sm font-bold text-[#2C8780] hover:underline">
                العودة للوحة التحكم
              </Link>
            )}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                {canAssign && isWaitingView && (
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="w-4 h-4 accent-[#2C8780]"
                    />
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
                {canAssign && isWaitingView && <TH>تكليف</TH>}
              </TR>
            </THead>
            <TBody>
              {filtered.map(t => (
                <TR key={t.id}>
                  {canAssign && isWaitingView && (
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        className="w-4 h-4 accent-[#2C8780]"
                      />
                    </TD>
                  )}
                  <TD>
                    <Link href={`/admin/debtors/${t.debtor_id}/account`} className="font-bold text-[#231F20] hover:text-[#2C8780]">
                      {t.debtorName}
                    </Link>
                  </TD>
                  <TD><span dir="ltr">{t.debtorPhone ?? '—'}</span></TD>
                  <TD>{t.taskLabel}</TD>
                  {taskView === 'assigned' && (
                    <TD><span className="font-semibold text-[#2C8780]">{t.lawyerName ?? '—'}</span></TD>
                  )}
                  <TD dir="ltr">{fmtDate(t.created_at.split('T')[0])}</TD>
                  {taskView === 'assigned' && (
                    <TD dir="ltr">{t.assigned_at ? fmtDate(t.assigned_at.split('T')[0]) : '—'}</TD>
                  )}
                  <TD dir="ltr">
                    {(() => {
                      const preview = isWaitingView && selected.has(t.id) && bulkDueDate ? bulkDueDate : null
                      const display = t.due_date ?? preview
                      if (!display) return '—'
                      return fmtDate(display)
                    })()}
                  </TD>
                  <TD>
                    <Badge variant={STATUS_BADGE[t.task_status as TaskStatus] ?? 'gray'}>
                      {TASK_STATUS_LABELS[t.task_status as TaskStatus] ?? t.task_status}
                    </Badge>
                  </TD>
                  {canAssign && isWaitingView && (
                    <TD>
                      {singleAssignId === t.id ? (
                        <div className="flex items-center gap-1 min-w-[140px]">
                          <PremiumSelect
                            value={singleLawyerId}
                            onChange={setSingleLawyerId}
                            options={lawyers.map(l => ({ value: l.id, label: l.full_name }))}
                            placeholder="محامي"
                            headerTitle="تكليف سريع"
                            searchable={lawyers.length > 4}
                            className="flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => assignTaskIds([t.id], singleLawyerId, bulkDueDate)}
                            disabled={assigning || !singleLawyerId || !bulkDueDate}
                            className="text-[10px] font-bold text-white px-2 py-1 rounded bg-[#2C8780] disabled:opacity-50"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => { setSingleAssignId(null); setSingleLawyerId('') }}
                            className="text-[10px] text-[#767676] px-1"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setSingleAssignId(t.id); setSingleLawyerId(bulkLawyerId) }}
                          className="text-[11px] font-bold text-white px-2.5 py-1 rounded-lg"
                          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                        >
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
        {!loading && hasMore && (
          <div className="p-4 border-t border-[rgba(118,118,118,0.1)] text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="text-sm font-bold text-[#2C8780] hover:underline disabled:opacity-50"
            >
              {loadingMore ? 'جارٍ التحميل...' : `تحميل المزيد (${tasks.length} / ${total})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
