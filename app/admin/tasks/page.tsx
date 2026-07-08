'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId, useBranch } from '@/context/branch'
import { TASK_STATUS_LABELS, assigneePersonLabel } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import {
  fetchCurrentBranchTaskRowsPaginated,
  type CurrentBranchTaskRow,
  CURRENT_TASK_PAGE_SIZE,
} from '@/lib/task-assignment'
import { executeTaskAssignment, validateTaskAssignmentInput } from '@/lib/client-task-assign'
import { taskOverdueDays } from '@/lib/local-date'
import { fetchAssignmentLawyers, fetchBranchDelegates } from '@/lib/branch-profiles'
import { isFindAddressTaskType } from '@/lib/delegate'
import { formatErrorMessage } from '@/lib/format-error'
import { scheduleBranchMaintenance } from '@/lib/branch-maintenance'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/query-cache'
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
import { canAssignTasks } from '@/lib/permissions'
import { BranchListFilterSelect } from '@/components/BranchListSelect'
import { useBranchLists } from '@/hooks/use-branch-lists'

type TaskView = 'waiting' | 'assigned' | 'overdue'

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
  delegates: { id: string; full_name: string }[]
  taskDefs: { id: string; label: string }[]
  total: number
  unassignedTotal: number
  assignedTotal: number
  overdueTotal: number
}

export default function TasksPage() {
  const branchId = useBranchId()
  const { branchName, viewAllBranches } = useBranch()
  const role = useAdminRole()
  const canAssign = canAssignTasks(role)
  const [tasks, setTasks] = useState<CurrentBranchTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [unassignedTotal, setUnassignedTotal] = useState(0)
  const [assignedTotal, setAssignedTotal] = useState(0)
  const [overdueTotal, setOverdueTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [taskDefs, setTaskDefs] = useState<{ id: string; label: string }[]>([])
  const [lawyers, setLawyers] = useState<{ id: string; full_name: string }[]>([])
  const [delegates, setDelegates] = useState<{ id: string; full_name: string }[]>([])
  const [taskView, setTaskView] = useState<TaskView>('waiting')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterDef, setFilterDef] = useState('')
  const [filterListId, setFilterListId] = useState('')
  const { lists: branchLists } = useBranchLists(branchId)

  useEffect(() => {
    setFilterListId('')
    setSearch('')
    setDebouncedSearch('')
  }, [branchId])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLawyerId, setBulkLawyerId] = useState('')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [singleAssignId, setSingleAssignId] = useState<string | null>(null)
  const [singleLawyerId, setSingleLawyerId] = useState('')

  const lawyersRef = useRef(lawyers)
  const delegatesRef = useRef(delegates)
  const taskDefsRef = useRef(taskDefs)
  lawyersRef.current = lawyers
  delegatesRef.current = delegates
  taskDefsRef.current = taskDefs

  const load = useCallback(async (append = false, offsetOverride?: number) => {
    if (!append) {
      setSelected(new Set())
      setError('')
    }
    const supabase = createClient()

    if (!branchId && !viewAllBranches) {
      setTasks([])
      setLawyers([])
      setDelegates([])
      setTaskDefs([])
      setTotal(0)
      setUnassignedTotal(0)
      setAssignedTotal(0)
      setOverdueTotal(0)
      setPageOffset(0)
      setLoading(false)
      return
    }

    const offset = offsetOverride ?? 0
    const cacheKey = `tasks:assign:${branchId ?? 'all'}:${taskView}:${filterDef}:${filterListId}:${debouncedSearch}:${offset}`

    if (!append) {
      const cached = cacheGet<TasksPageCache>(cacheKey)
      if (cached) {
        setTasks(cached.tasks)
        setLawyers(cached.lawyers)
        setDelegates(cached.delegates ?? [])
        setTaskDefs(cached.taskDefs)
        setTotal(cached.total)
        setUnassignedTotal(cached.unassignedTotal)
        setAssignedTotal(cached.assignedTotal)
        setOverdueTotal(cached.overdueTotal ?? 0)
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
      setOverdueTotal(0)
        setPageOffset(0)
        setLoading(false)
        setLoadingMore(false)
        return
      }

      const [defs, page, lawyersResult, delegatesResult] = await Promise.all([
        append ? Promise.resolve(null) : fetchActiveTaskDefinitions(supabase, branchId, 'id, label'),
        fetchCurrentBranchTaskRowsPaginated(supabase, branchId, {
          assigned: taskView === 'assigned' ? true : taskView === 'waiting' ? false : undefined,
          overdue: taskView === 'overdue',
          taskDefinitionId: filterDef || null,
          branchListId: filterListId || null,
          debtorIds,
          offset,
          limit: CURRENT_TASK_PAGE_SIZE,
        }),
        append ? Promise.resolve(null) : fetchAssignmentLawyers(supabase, branchId),
        append ? Promise.resolve(null) : fetchBranchDelegates(supabase, branchId),
      ])

      if (lawyersResult?.error) {
        setError(formatErrorMessage(lawyersResult.error))
      } else if (delegatesResult?.error) {
        setError(formatErrorMessage(delegatesResult.error))
      }

      setTasks(prev => {
        const nextTasks = append ? [...prev, ...page.rows] : page.rows
        const lawyerList = lawyersResult
          ? lawyersResult.lawyers
          : lawyersRef.current
        const delegateList = delegatesResult
          ? delegatesResult.delegates
          : delegatesRef.current
        const defsList = (defs as { id: string; label: string }[] | null) ?? taskDefsRef.current

        cacheSet(cacheKey, {
          tasks: nextTasks,
          lawyers: lawyerList,
          delegates: delegateList,
          taskDefs: defsList,
          total: page.total,
          unassignedTotal: page.unassignedTotal,
          assignedTotal: page.assignedTotal,
          overdueTotal: page.overdueTotal,
        }, CACHE_TTL.list)

        if (lawyersResult) setLawyers(lawyerList)
        if (delegatesResult) setDelegates(delegateList)
        if (defs) setTaskDefs(defsList)

        return nextTasks
      })

      setTotal(page.total)
      setUnassignedTotal(page.unassignedTotal)
      setAssignedTotal(page.assignedTotal)
      setOverdueTotal(page.overdueTotal)
      setPageOffset(offset + page.rows.length)
    } catch (e: unknown) {
      setError(formatErrorMessage(e) || 'فشل تحميل المهام')
      if (!append) {
        setTasks([])
        setLawyers([])
        setDelegates([])
      }
    }
    setLoading(false)
    setLoadingMore(false)
  }, [branchId, viewAllBranches, taskView, filterDef, filterListId, debouncedSearch])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    setPageOffset(0)
    load(false, 0)
  }, [branchId, viewAllBranches, taskView, filterDef, filterListId, debouncedSearch, load])

  function loadMore() {
    if (loadingMore || tasks.length >= total) return
    load(true, pageOffset)
  }

  const waitingCount = unassignedTotal
  const assignedCount = assignedTotal
  const overdueCount = overdueTotal
  const filtered = tasks
  const hasMore = tasks.length < total

  const isWaitingView = taskView === 'waiting'
  const isOverdueView = taskView === 'overdue'
  const allSelected = isWaitingView && filtered.length > 0 && filtered.every(t => selected.has(t.id))

  const assignmentTargetIds = useMemo(() => {
    if (selected.size > 0) return Array.from(selected)
    if (singleAssignId) return [singleAssignId]
    return []
  }, [selected, singleAssignId])

  const selectedAllFindAddress = useMemo(() => {
    if (!assignmentTargetIds.length) return false
    return assignmentTargetIds.every(id => {
      const t = tasks.find(x => x.id === id)
      return t && isFindAddressTaskType(t.task_type)
    })
  }, [assignmentTargetIds, tasks])

  const assigneeOptions = useMemo(() => {
    if (selectedAllFindAddress) {
      return [...lawyers, ...delegates]
    }
    return lawyers
  }, [selectedAllFindAddress, lawyers, delegates])

  const assignmentMinDate = useMemo(() => {
    const ids = assignmentTargetIds
    if (!ids.length) return undefined
    const dates = ids
      .map(id => tasks.find(t => t.id === id)?.created_at)
      .filter(Boolean)
      .map(d => d!.split('T')[0])
    return dates.length ? dates.sort().reverse()[0] : undefined
  }, [assignmentTargetIds, tasks])

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
    const validationError = validateTaskAssignmentInput(
      canAssign,
      ids,
      lawyerId,
      dueDate,
      tasks.map(t => ({ id: t.id, created_at: t.created_at })),
    )
    if (validationError) { setError(validationError); return }

    setAssigning(true); setError('')
    const result = await executeTaskAssignment({
      taskIds: ids,
      lawyerId,
      dueDate,
      assigneeOptions,
      lawyers,
      delegates,
      branchId,
      taskView,
      filterDef,
      filterListId,
      debouncedSearch,
    })
    if (!result.ok) {
      setError(result.error ?? 'فشل تكليف المهمة')
      setAssigning(false)
      return
    }

    setAssigning(false)
    setBulkLawyerId('')
    setBulkDueDate('')
    setSingleAssignId(null)
    setSingleLawyerId('')
    setSelected(new Set())
    setPageOffset(0)
    await load(false, 0)
  }

  const hasFilters = search || filterDef || filterListId
  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setFilterDef('')
    setFilterListId('')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="تكليف المهام"
        subtitle={
          viewAllBranches
            ? 'كل الفروع'
            : branchName
              ? `فرع ${branchName}`
              : 'اختر فرعاً من القائمة العلوية'
        }
      />

      {!branchId && !viewAllBranches && (
        <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض مهام القضايا.
        </p>
      )}

      {viewAllBranches && (
        <p className="text-sm text-[#1D6365] bg-[#2C8780]/8 border border-[#2C8780]/20 rounded-xl px-4 py-3">
          عرض كل الفروع — للتكليف بمحامٍ فرعي اختر فرعاً محدداً من القائمة العلوية.
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
        <button
          type="button"
          onClick={() => setTaskView('overdue')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors border ${
            taskView === 'overdue'
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-white text-[#767676] border-[rgba(118,118,118,0.2)] hover:border-orange-400/50'
          }`}
        >
          المهام المتأخرة
          <span className="mr-1 opacity-80">({overdueCount})</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <BranchListFilterSelect
          value={filterListId}
          onChange={setFilterListId}
          lists={branchLists}
        />
        <PremiumSelect
          value={filterDef}
          onChange={setFilterDef}
          options={[
            { value: '', label: 'كل أنواع المهام' },
            ...taskDefs.map(d => ({ value: d.id, label: d.label })),
          ]}
          placeholder="كل أنواع المهام"
          fieldLabel="نوع المهمة"
          headerTitle="تصفية حسب نوع المهمة"
          searchPlaceholder="بحث..."
        />
        <input
          type="search"
          placeholder={DEBTOR_SEARCH_PLACEHOLDER}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={SEL}
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
                { value: '', label: selectedAllFindAddress ? '— اختر محامياً أو مندوباً —' : '— اختر محامياً من هذا الفرع —' },
                ...assigneeOptions.map(l => ({ value: l.id, label: l.full_name })),
              ]}
              placeholder={selectedAllFindAddress ? '— اختر محامياً أو مندوباً —' : '— اختر محامياً —'}
              headerTitle={selectedAllFindAddress ? 'اختر المحامي أو المندوب' : 'اختر المحامي'}
              headerSubtitle={
                selectedAllFindAddress
                  ? `${lawyers.length} محامٍ • ${delegates.length} مندوب`
                  : `${lawyers.length} محامٍ في الفرع`
              }
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
          {branchId && lawyers.length === 0 && delegates.length === 0 && (
            <p className="text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              لا يوجد محامون أو مندوبون نشطون مرتبطون بهذا الفرع.{' '}
              <Link href="/admin/lawyers" className="font-bold underline">أضف محامياً</Link>
              {' · '}
              <Link href="/admin/delegates/new" className="font-bold underline">أضف مندوباً</Link>
            </p>
          )}
          {selected.size > 0 && selectedAllFindAddress && delegates.length > 0 && (
            <p className="text-[11px] text-[#2C8780] bg-[#2C8780]/8 border border-[#2C8780]/20 rounded-lg px-3 py-2">
              المهام المحددة من نوع إيجاد عنوان — يمكن تكليف مندوب أيضاً.
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
            title={hasFilters ? 'لا نتائج' : isWaitingView ? 'لا مهام بانتظار التكليف' : isOverdueView ? 'لا مهام متأخرة' : 'لا مهام مكلفة'}
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
                {!isOverdueView && <TH>الهاتف</TH>}
                <TH>نوع المهمة</TH>
                {isOverdueView && <TH>الفرع</TH>}
                {isOverdueView && <TH>القائمة</TH>}
                {(taskView === 'assigned' || isOverdueView) && <TH>المكلّف</TH>}
                {!isOverdueView && <TH>تاريخ إنشاء المهمة</TH>}
                {(taskView === 'assigned' || isOverdueView) && <TH>تاريخ التكليف</TH>}
                <TH>{isOverdueView ? 'تاريخ الاستحقاق' : 'تاريخ نهاية التكليف'}</TH>
                {isOverdueView && <TH>أيام التأخير</TH>}
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
                  {!isOverdueView && <TD><span dir="ltr">{t.debtorPhone ?? '—'}</span></TD>}
                  <TD>{t.taskLabel}</TD>
                  {isOverdueView && (
                    <TD>{t.branchName ?? '—'}</TD>
                  )}
                  {isOverdueView && (
                    <TD>{t.branchListName ?? '—'}</TD>
                  )}
                  {(taskView === 'assigned' || isOverdueView) && (
                    <TD>
                      <span className="font-semibold text-[#2C8780]">
                        {t.lawyerName
                          ? `${assigneePersonLabel(t.lawyerRole)}: ${t.lawyerName}`
                          : '—'}
                      </span>
                    </TD>
                  )}
                  {!isOverdueView && <TD dir="ltr">{fmtDate(t.created_at.split('T')[0])}</TD>}
                  {(taskView === 'assigned' || isOverdueView) && (
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
                  {isOverdueView && (
                    <TD>
                      <span className="font-bold text-orange-600 tabular-nums" dir="ltr">
                        {t.due_date ? taskOverdueDays(t.due_date) : '—'}
                      </span>
                    </TD>
                  )}
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={STATUS_BADGE[t.task_status as TaskStatus] ?? 'gray'}>
                        {TASK_STATUS_LABELS[t.task_status as TaskStatus] ?? t.task_status}
                      </Badge>
                      {isOverdueView && (
                        <Badge variant="warning">متأخرة</Badge>
                      )}
                    </div>
                  </TD>
                  {canAssign && isWaitingView && (
                    <TD>
                      {singleAssignId === t.id ? (
                        <div className="flex items-center gap-1 min-w-[140px]">
                          <PremiumSelect
                            value={singleLawyerId}
                            onChange={setSingleLawyerId}
                            options={(isFindAddressTaskType(t.task_type)
                              ? [...lawyers, ...delegates]
                              : lawyers
                            ).map(l => ({ value: l.id, label: l.full_name }))}
                            placeholder={isFindAddressTaskType(t.task_type) ? 'محامي/مندوب' : 'محامي'}
                            headerTitle="تكليف سريع"
                            searchable={lawyers.length + (isFindAddressTaskType(t.task_type) ? delegates.length : 0) > 4}
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
