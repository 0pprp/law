'use client'

import { Suspense, useState, useEffect, useCallback, useRef, use, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { RECEIPT_TYPE_LABELS, assigneePersonLabel } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import { fetchAssignmentLawyers, fetchBranchDelegates } from '@/lib/branch-profiles'
import { isFindAddressTaskType } from '@/lib/delegate'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DatePicker } from '@/components/ui/date-picker'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, canManageSpecialStatuses, canMoveToPaymentInProgress } from '@/lib/permissions'
import { executeTaskAssignment, executeTaskUnassign, validateTaskAssignmentInput } from '@/lib/client-task-assign'
import { taskLawyerId } from '@/lib/task-assignment'
import { useCaseScope } from '@/hooks/use-case-scope'
import { isTaskOverdue, localTodayYmd, OVERDUE_TERMINAL_STATUSES, taskOverdueDays } from '@/lib/local-date'
import MoveToPaymentInProgressModal from '@/components/MoveToPaymentInProgressModal'
import SpecialStatusBadge from '@/components/SpecialStatusBadge'
import { cacheInvalidatePrefix } from '@/lib/query-cache'
import { preserveScrollDuring } from '@/lib/preserve-scroll'
import { appConfirm } from '@/lib/app-dialog'
import { resolveCourtName, resolveExecutionOffice } from '@/lib/awaiting-assignment'
import { resolveSpecialStatus } from '@/lib/special-statuses'
import { fetchBranchCourtNames } from '@/lib/branch-lists'
import MoveToMonitoringModal from '@/components/MoveToMonitoringModal'
import { getDaysUntilHearing, getHearingDateStatus } from '@/lib/hearing-date-utils'

type StageView = 'waiting' | 'assigned' | 'overdue'

interface StageDebtor {
  debtorId: string
  debtorName: string
  taskId: string
  taskStatus: string
  lawyerName: string | null
  lawyerRole: string | null
  phone: string | null
  receiptType: ReceiptType | null
  receiptNumber: string | null
  remaining: number
  taskCreatedAt: string | null
  dueDate: string | null
  branchId: string | null
  branchName: string | null
  branchListId: string | null
  branchListName: string | null
  courtName: string | null
  executionOffice: string | null
  specialStatusName: string | null
  specialStatusColor: string | null
  firstHearingDate: string | null
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  waiting_assignment: { label: 'تنتظر تكليف', cls: 'bg-yellow-100 text-yellow-700' },
  assignment_pending_acceptance: { label: 'بانتظار القبول', cls: 'bg-amber-100 text-amber-700' },
  assigned: { label: 'مكلّفة', cls: 'bg-purple-100 text-purple-700' },
  in_progress: { label: 'جارية', cls: 'bg-[#2C8780]/10 text-[#2C8780]' },
  submitted: { label: 'تنتظر المراجعة', cls: 'bg-orange-100 text-orange-700' },
  pending_review: { label: 'بانتظار المراجعة', cls: 'bg-orange-100 text-orange-700' },
  needs_info: { label: 'تحتاج تصحيح', cls: 'bg-red-100 text-red-700' },
  needs_revision: { label: 'تحتاج مراجعة', cls: 'bg-red-100 text-red-700' },
  rejected: { label: 'مرفوضة', cls: 'bg-red-100 text-red-700' },
  postponed: { label: 'مؤجّلة', cls: 'bg-slate-100 text-slate-600' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' }
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

function viewTitle(view: StageView, stageLabel: string) {
  if (view === 'assigned') return `${stageLabel} — المكلفة`
  if (view === 'overdue') return `${stageLabel} — المتأخرة`
  return `${stageLabel} — غير المكلفة`
}

function viewSubtitle(view: StageView, count: number) {
  if (view === 'assigned') return `${count} مهمة مكلفة في هذه المرحلة`
  if (view === 'overdue') return `${count} مهمة مكلفة متأخرة`
  return `${count} مهمة غير مكلفة في هذه المرحلة`
}

interface Lawyer { id: string; full_name: string }

const NO_COURT_KEY = '__none__'
const NO_COURT_LABEL = 'بدون محكمة'

function DebtorStageRow({
  d,
  view,
  canAssign,
  canMonitor,
  selected,
  onToggle,
  onAssignOne,
  onUnassignOne,
  assigning,
  bulkLawyerId,
  bulkDueDate,
  showHearingDate,
}: {
  d: StageDebtor
  view: StageView
  canAssign: boolean
  canMonitor: boolean
  selected: Set<string>
  onToggle: (taskId: string) => void
  onAssignOne: (taskId: string) => void
  onUnassignOne: (taskId: string) => void
  assigning: boolean
  bulkLawyerId: string
  bulkDueDate: string
  showHearingDate: boolean
}) {
  const isWaiting = view === 'waiting'
  const canSelect = canMonitor || (canAssign && isWaiting)
  const hearingStatus = showHearingDate ? getHearingDateStatus(d.firstHearingDate) : null
  const hearingDays = showHearingDate ? getDaysUntilHearing(d.firstHearingDate) : null
  const rowBackground =
    hearingStatus === 'red' ? 'bg-red-50 hover:bg-red-100/70'
      : hearingStatus === 'yellow' ? 'bg-yellow-50 hover:bg-yellow-100/70'
        : hearingStatus === 'gray' ? 'bg-gray-100 hover:bg-gray-200/70'
          : 'hover:bg-[#F8F7F8]'
  const grayText = hearingStatus === 'gray' ? ' text-gray-500' : ''
  return (
    <div className={`flex items-center gap-3 px-4 py-4 transition-colors ${rowBackground}${grayText}`}>
      {canSelect && (
        <input
          type="checkbox"
          checked={selected.has(d.taskId)}
          onChange={() => onToggle(d.taskId)}
          className="w-4 h-4 accent-[#2C8780] shrink-0"
        />
      )}
      <div className="w-9 h-9 rounded-xl bg-[#2C8780]/10 flex items-center justify-center shrink-0">
        <span className="text-[#2C8780] font-black text-sm">{d.debtorName.charAt(0)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/admin/debtors/${d.debtorId}/account`}
          className="text-sm font-bold text-[#231F20] hover:text-[#2C8780] transition-colors"
        >
          {d.debtorName}
        </Link>
        {d.specialStatusName && (
          <SpecialStatusBadge name={d.specialStatusName} color={d.specialStatusColor} className="mt-1" />
        )}
        {(d.courtName || d.executionOffice) && (
          <div className="mt-1 text-sm font-semibold text-[#1D6365]">
            {[
              d.courtName ? `🏛 المحكمة: ${d.courtName}` : null,
              d.executionOffice ? `⚖️ التنفيذ: ${d.executionOffice}` : null,
            ]
              .filter(Boolean)
              .join('   |   ')}
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {d.phone && <span className="text-[11px] text-[#767676]" dir="ltr">{d.phone}</span>}
          {d.branchListName && (
            <span className="text-[11px] text-[#767676]">القائمة: {d.branchListName}</span>
          )}
          {d.receiptType && (
            <span className="text-[11px] text-[#767676]">
              {RECEIPT_TYPE_LABELS[d.receiptType] ?? d.receiptType}
            </span>
          )}
          {d.receiptNumber && <span className="text-[11px] text-[#767676]" dir="ltr">{d.receiptNumber}</span>}
          {d.taskCreatedAt && (
            <span className="text-[11px] text-[#767676]" dir="ltr">
              أنشئت: {fmtDate(d.taskCreatedAt.split('T')[0])}
            </span>
          )}
          {d.dueDate && (
            <span className="text-[11px] text-[#767676]" dir="ltr">
              الاستحقاق: {fmtDate(d.dueDate)}
            </span>
          )}
          {view === 'overdue' && d.dueDate && (
            <span className="text-[11px] font-bold text-orange-600" dir="ltr">
              تأخير {taskOverdueDays(d.dueDate)} يوم
            </span>
          )}
          {d.lawyerName && (
            <span className="text-[11px] text-[#2C8780] font-semibold">
              {assigneePersonLabel(d.lawyerRole)}: {d.lawyerName}
            </span>
          )}
        </div>
      </div>
      {d.remaining > 0 && (
        <span className="text-xs font-bold text-[#2C8780] tabular-nums shrink-0" dir="ltr">
          {fmtMoney(d.remaining)}
        </span>
      )}
      {showHearingDate && (
        <div className="min-w-[7.5rem] shrink-0 text-center">
          <p className="text-[10px] font-bold text-[#767676]">تاريخ المرافعة</p>
          {d.firstHearingDate ? (
            <>
              <p className={`text-xs font-bold ${hearingStatus === 'gray' ? 'text-gray-500' : 'text-[#231F20]'}`} dir="ltr">
                {fmtDate(d.firstHearingDate)}
              </p>
              <p className={`text-[10px] font-bold ${
                hearingStatus === 'red' ? 'text-red-700'
                  : hearingStatus === 'yellow' ? 'text-yellow-700'
                    : hearingStatus === 'gray' ? 'text-gray-500'
                      : 'text-[#2C8780]'
              }`}>
                {hearingDays == null
                  ? '—'
                  : hearingDays < 0
                    ? `مضى منذ ${Math.abs(hearingDays)} يوم`
                    : hearingDays === 0
                      ? 'اليوم'
                      : `متبقٍ ${hearingDays} يوم`}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#767676]">—</p>
          )}
        </div>
      )}
      <StatusBadge status={d.taskStatus} />
      {canAssign && isWaiting && (
        <button
          type="button"
          onClick={() => onAssignOne(d.taskId)}
          disabled={assigning || !bulkLawyerId || !bulkDueDate}
          title={!bulkLawyerId ? 'اختر محامياً من الأعلى أولاً' : !bulkDueDate ? 'حدد تاريخ نهاية التكليف' : 'تكليف'}
          className="text-[11px] font-bold text-white px-3 py-1.5 rounded-lg shrink-0 hover:opacity-90 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
        >
          تكليف
        </button>
      )}
      {canAssign && (view === 'assigned' || view === 'overdue') && (
        <button
          type="button"
          onClick={() => onUnassignOne(d.taskId)}
          disabled={assigning}
          className="text-[11px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-lg shrink-0 disabled:opacity-50"
        >
          إلغاء التكليف
        </button>
      )}
    </div>
  )
}

function BranchStageBox({
  branchId,
  branchName,
  rows,
  view,
  canAssign,
  canMonitor,
  selected,
  onToggle,
  onAssignOne,
  onUnassignOne,
  assigning,
  bulkLawyerId,
  bulkDueDate,
  matchingIds,
  showHearingDate,
}: {
  branchId: string
  branchName: string
  rows: StageDebtor[]
  view: StageView
  canAssign: boolean
  canMonitor: boolean
  selected: Set<string>
  onToggle: (taskId: string) => void
  onAssignOne: (taskId: string) => void
  onUnassignOne: (taskId: string) => void
  assigning: boolean
  bulkLawyerId: string
  bulkDueDate: string
  matchingIds: string[] | null
  showHearingDate: boolean
}) {
  const [courtFilter, setCourtFilter] = useState('')
  const [branchCourts, setBranchCourts] = useState<string[]>([])
  const [courtsLoading, setCourtsLoading] = useState(true)

  useEffect(() => {
    setCourtFilter('')
    if (!branchId) {
      setBranchCourts([])
      setCourtsLoading(false)
      return
    }
    let cancelled = false
    setCourtsLoading(true)
    fetchBranchCourtNames(createClient(), branchId).then(names => {
      if (!cancelled) {
        setBranchCourts(names)
        setCourtsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [branchId])

  const filtered = useMemo(() => {
    return rows.filter(d => {
      if (matchingIds !== null && !matchingIds.includes(d.debtorId)) return false
      if (courtFilter && (d.courtName ?? '') !== courtFilter) return false
      return true
    })
  }, [rows, matchingIds, courtFilter])

  const courtSections = useMemo(() => {
    const map = new Map<string, { key: string; title: string; rows: StageDebtor[] }>()
    for (const d of filtered) {
      const name = d.courtName?.trim() || ''
      const key = name || NO_COURT_KEY
      const title = name || NO_COURT_LABEL
      const prev = map.get(key)
      if (prev) prev.rows.push(d)
      else map.set(key, { key, title, rows: [d] })
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === NO_COURT_KEY) return 1
      if (b.key === NO_COURT_KEY) return -1
      return a.title.localeCompare(b.title, 'ar')
    })
  }, [filtered])

  const courtOptions = useMemo(() => {
    const fromRows = new Set(branchCourts)
    for (const d of rows) {
      const name = d.courtName?.trim()
      if (name) fromRows.add(name)
    }
    return [...fromRows].sort((a, b) => a.localeCompare(b, 'ar'))
  }, [branchCourts, rows])

  if (filtered.length === 0 && !courtFilter) return null

  return (
    <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-visible">
      <div className="px-4 py-3.5 border-b border-[rgba(118,118,118,0.1)] flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <h3 className="font-black text-[#231F20] text-base truncate">{branchName}</h3>
          <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-[#2C8780]/12 text-[#1D6365] text-sm font-black tabular-nums shrink-0">
            {filtered.length}
          </span>
        </div>
        <div className="w-full sm:w-64 shrink-0">
          <PremiumSelect
            value={courtFilter}
            onChange={setCourtFilter}
            options={[
              { value: '', label: 'كل المحاكم' },
              ...courtOptions.map(c => ({ value: c, label: c })),
            ]}
            placeholder="كل المحاكم"
            fieldLabel={`محاكم ${branchName}`}
            headerTitle={`محاكم ${branchName}`}
            searchPlaceholder="بحث بالمحكمة..."
            searchable
            disabled={courtsLoading}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[#767676]">لا أسماء في هذه المحكمة</div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.12)]">
          {courtSections.map(section => (
            <div key={section.key}>
              <div className="px-4 py-2.5 bg-[#F8F7F8] border-b border-[rgba(118,118,118,0.08)] flex items-center gap-2">
                <h4 className="text-sm font-black text-[#1D6365] truncate">
                  🏛 {section.title}
                </h4>
                <span className="text-[11px] font-bold text-[#767676] tabular-nums shrink-0">
                  ({section.rows.length})
                </span>
              </div>
              <div className="divide-y divide-[rgba(118,118,118,0.07)]">
                {section.rows.map(d => (
                  <DebtorStageRow
                    key={d.taskId}
                    d={d}
                    view={view}
                    canAssign={canAssign}
                    canMonitor={canMonitor}
                    selected={selected}
                    onToggle={onToggle}
                    onAssignOne={onAssignOne}
                    onUnassignOne={onUnassignOne}
                    assigning={assigning}
                    bulkLawyerId={bulkLawyerId}
                    bulkDueDate={bulkDueDate}
                    showHearingDate={showHearingDate}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-[#767676]">جارٍ التحميل...</div>}>
      <StageDetailInner params={params} />
    </Suspense>
  )
}

function StageDetailInner({ params }: { params: Promise<{ id: string }> }) {
  const { id: stageId } = use(params)
  const searchParams = useSearchParams()
  const rawView = searchParams.get('view')
  const view: StageView =
    rawView === 'assigned' || rawView === 'overdue' ? rawView : 'waiting'

  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()
  const canAssign = canAssignTasks(role)
  const canMonitor = canManageSpecialStatuses(role)
  const allowPaymentInProgress = canMoveToPaymentInProgress(role)
  const { caseTypeFilter } = useCaseScope()
  const [stageLabel, setStageLabel] = useState('')
  const [stageTaskType, setStageTaskType] = useState<string | null>(null)
  const [stageCaseType, setStageCaseType] = useState<'civil' | 'criminal' | null>(null)
  const [debtors, setDebtors] = useState<StageDebtor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [matchingIds, setMatchingIds] = useState<string[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [lawyers, setLawyers] = useState<Lawyer[]>([])
  const [delegates, setDelegates] = useState<Lawyer[]>([])
  const [stageIsFindAddress, setStageIsFindAddress] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLawyerId, setBulkLawyerId] = useState('')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [monitorModalOpen, setMonitorModalOpen] = useState(false)

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (!branchId && !viewAllBranches) {
      setDebtors([])
      setLoading(false)
      return
    }

    const soft = Boolean(opts?.soft)
    if (!soft) {
      setLoading(true)
      setSelected(new Set())
    }
    const supabase = createClient()

    const { data: def } = await supabase
      .from('task_definitions')
      .select('id, label, task_type, case_type')
      .eq('id', stageId)
      .single()
    setStageLabel(def?.label ?? '—')
    setStageTaskType(def?.task_type ?? null)
    setStageIsFindAddress(isFindAddressTaskType(def?.task_type))
    const stageCt = def?.case_type === 'criminal' ? 'criminal' : 'civil'
    setStageCaseType(stageCt)
    if (caseTypeFilter && caseTypeFilter !== stageCt) {
      setDebtors([])
      setLoading(false)
      return
    }

    const matchingDefIds = new Set<string>([stageId])
    if (viewAllBranches && def?.label) {
      const { data: sameLabel } = await supabase
        .from('task_definitions')
        .select('id')
        .eq('is_active', true)
        .eq('label', def.label)
      for (const row of sameLabel ?? []) matchingDefIds.add(row.id)
    }
    const defIds = [...matchingDefIds]
    const terminalFilter = `(${OVERDUE_TERMINAL_STATUSES.join(',')})`
    const PAGE = 500
    const rawRows: any[] = []
    let offset = 0

    // فلترة المرحلة على السيرفر + صفحات — لا نعتمد على جلب كل المدينين ثم الفلترة محلياً
    // (حد Supabase الافتراضي ~1000 صف كان يخفي مراحل مثل «ابطال»)
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase
        .from('debtors')
        .select(`
          id, full_name, phone, receipt_type, receipt_number, first_hearing_date, branch_id, branch_list_id,
          remaining_amount, case_status, case_type, current_task_id,
          branch_list:branch_lists(name, court_name, execution_office),
          special_status:special_statuses(id, name, color),
          current_task:tasks!current_task_id!inner(
            id, task_status, assigned_to, created_at, due_date, task_definition_id, branch_id,
            lawyer:profiles!tasks_assigned_to_fkey(full_name, role)
          )
        `)
        .not('case_status', 'eq', 'closed')
        .not('current_task_id', 'is', null)
        .is('special_status_id', null)
        .eq('case_type', stageCt)
        .in('current_task.task_definition_id', defIds)
        .not('current_task.task_status', 'in', terminalFilter)
        .order('full_name')
        .range(offset, offset + PAGE - 1)

      if (branchId) q = q.eq('branch_id', branchId)

      if (view === 'waiting') {
        q = q.is('current_task.assigned_to', null)
      } else if (view === 'assigned') {
        q = q.not('current_task.assigned_to', 'is', null)
      } else if (view === 'overdue') {
        q = q
          .not('current_task.assigned_to', 'is', null)
          .not('current_task.due_date', 'is', null)
          .lt('current_task.due_date', localTodayYmd())
      }

      const { data, error } = await q
      if (error) {
        console.error('[stage-detail:load]', error.message ?? error)
        break
      }
      const chunk = data ?? []
      rawRows.push(...chunk)
      if (chunk.length < PAGE) break
      offset += PAGE
    }

    const branchIds = [...new Set(rawRows.map(d => d.branch_id).filter(Boolean))] as string[]
    const branchNames = new Map<string, string>()
    if (branchIds.length) {
      const { data: branches } = await supabase.from('branches').select('id, name').in('id', branchIds)
      for (const b of branches ?? []) branchNames.set(b.id, b.name)
    }

    const mapped: StageDebtor[] = rawRows
      .filter((d: any) => {
        const t = d.current_task
        if (!t || d.current_task_id !== t.id) return false
        if (branchId && (t.branch_id ?? d.branch_id) !== branchId) return false
        // دفاع إضافي لو وُجد lawyer_id بدون assigned_to
        const assigned = Boolean(taskLawyerId(t))
        if (view === 'waiting') return !assigned
        if (view === 'assigned') return assigned
        if (view === 'overdue') {
          const due = t.due_date ? String(t.due_date).slice(0, 10) : null
          return assigned && isTaskOverdue(due)
        }
        return false
      })
      .map((d: any) => {
        const t = d.current_task
        const bl = Array.isArray(d.branch_list) ? d.branch_list[0] : d.branch_list
        const lawyer = Array.isArray(t.lawyer) ? t.lawyer[0] : t.lawyer
        const bId = (d.branch_id ?? t.branch_id ?? null) as string | null
        const ss = resolveSpecialStatus(d.special_status)
        return {
          debtorId: d.id,
          debtorName: d.full_name,
          taskId: t.id,
          taskStatus: t.task_status,
          lawyerName: lawyer?.full_name ?? null,
          lawyerRole: lawyer?.role ?? null,
          phone: d.phone ?? null,
          receiptType: d.receipt_type ?? null,
          receiptNumber: d.receipt_number ?? null,
          remaining: Number(d.remaining_amount ?? 0),
          taskCreatedAt: t.created_at ?? null,
          dueDate: t.due_date ? String(t.due_date).slice(0, 10) : null,
          branchId: bId,
          branchName: bId ? branchNames.get(bId) ?? 'فرع' : 'بدون فرع',
          branchListId: d.branch_list_id ?? null,
          branchListName: bl?.name?.trim() ?? null,
          courtName: resolveCourtName(d.branch_list),
          executionOffice: resolveExecutionOffice(d.branch_list),
          specialStatusName: ss.name,
          specialStatusColor: ss.color,
          firstHearingDate: d.first_hearing_date ? String(d.first_hearing_date).slice(0, 10) : null,
        }
      })

    setDebtors(mapped)
    setLoading(false)
  }, [stageId, branchId, viewAllBranches, caseTypeFilter, view])

  useEffect(() => { void load() }, [load])

  // تاريخ المرافعة يُلتقط من «إقامة دعوى» لكنه يُعرَض على كارد «مرافعات»
  const showHearingDate = (role === 'admin' || role === 'viewer') && stageTaskType === 'pleading'

  useEffect(() => {
    if (!branchId && !viewAllBranches) {
      setLawyers([])
      setDelegates([])
      return
    }
    if (view !== 'waiting') {
      setLawyers([])
      setDelegates([])
      return
    }
    const supabase = createClient()
    const lawyerCase = stageCaseType ?? caseTypeFilter
    fetchAssignmentLawyers(supabase, branchId, {
      caseType: lawyerCase === 'criminal' || lawyerCase === 'civil' ? lawyerCase : null,
    }).then(({ lawyers: list }) => setLawyers(list))
    if (stageIsFindAddress && branchId && lawyerCase !== 'criminal') {
      fetchBranchDelegates(supabase, branchId).then(({ delegates: list }) => setDelegates(list))
    } else {
      setDelegates([])
    }
  }, [branchId, viewAllBranches, stageIsFindAddress, stageCaseType, caseTypeFilter, view])

  const assigneeOptions = stageIsFindAddress ? [...lawyers, ...delegates] : lawyers

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setMatchingIds(null)
      return
    }
    let cancelled = false
    resolveDebtorIdsBySearch(createClient(), debouncedSearch, branchId).then(ids => {
      if (!cancelled) setMatchingIds(ids ?? [])
    })
    return () => { cancelled = true }
  }, [debouncedSearch, branchId])

  const branchGroups = useMemo(() => {
    const map = new Map<string, { branchId: string; branchName: string; rows: StageDebtor[] }>()
    for (const d of debtors) {
      if (matchingIds !== null && !matchingIds.includes(d.debtorId)) continue
      const id = d.branchId ?? '__none__'
      const name = d.branchName ?? 'بدون فرع'
      const prev = map.get(id)
      if (prev) prev.rows.push(d)
      else map.set(id, { branchId: id === '__none__' ? '' : id, branchName: name, rows: [d] })
    }
    return [...map.values()]
      .filter(g => g.rows.length > 0 && g.branchId)
      .sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'))
  }, [debtors, matchingIds])

  const visibleCount = useMemo(() => {
    if (matchingIds === null) return debtors.length
    return debtors.filter(d => matchingIds.includes(d.debtorId)).length
  }, [debtors, matchingIds])

  const assignmentMinDate = useMemo(() => {
    const ids = selected.size > 0 ? Array.from(selected) : []
    if (!ids.length) return undefined
    const dates = ids
      .map(id => debtors.find(d => d.taskId === id)?.taskCreatedAt)
      .filter(Boolean)
      .map(d => d!.split('T')[0])
    return dates.length ? dates.sort().reverse()[0] : undefined
  }, [selected, debtors])

  useEffect(() => {
    if (assignmentMinDate && bulkDueDate && bulkDueDate < assignmentMinDate) {
      setBulkDueDate('')
    }
  }, [assignmentMinDate, bulkDueDate])

  function toggle(taskId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function toggleAllVisible() {
    const ids = debtors
      .filter(d => matchingIds === null || matchingIds.includes(d.debtorId))
      .map(d => d.taskId)
    const allOn = ids.length > 0 && ids.every(id => selected.has(id))
    setSelected(allOn ? new Set() : new Set(ids))
  }

  async function assignTasks(taskIds: string[], lawyerId: string) {
    const taskRefs = taskIds.map(id => {
      const d = debtors.find(x => x.taskId === id)
      return { id, created_at: d?.taskCreatedAt ?? new Date().toISOString() }
    })
    const validationError = validateTaskAssignmentInput(canAssign, taskIds, lawyerId, bulkDueDate, taskRefs)
    if (validationError) { setError(validationError); return }

    setAssigning(true); setError(''); setSuccessMsg('')
    const result = await executeTaskAssignment({
      taskIds,
      lawyerId,
      dueDate: bulkDueDate,
      assigneeOptions,
      lawyers,
      delegates,
      branchId,
      caseType: stageCaseType,
    })
    if (!result.ok) {
      setError(result.error ?? 'فشل التكليف')
      setAssigning(false)
      return
    }

    preserveScrollDuring(() => {
      setDebtors(prev => prev.filter(d => !taskIds.includes(d.taskId)))
      setSelected(prev => {
        const next = new Set(prev)
        taskIds.forEach(id => next.delete(id))
        return next
      })
      setAssigning(false)
      setSuccessMsg(`تم تكليف ${taskIds.length} مهمة بنجاح`)
      cacheInvalidatePrefix('dashboard:v10:')
    })
  }

  async function unassignOne(taskId: string) {
    const ok = await appConfirm({
      title: 'إلغاء التكليف',
      message: 'ستُعاد المهمة إلى غير المكلفة وتُزال من قائمة المكلَّف. هل تريد المتابعة؟',
      confirmLabel: 'إلغاء التكليف',
      danger: true,
    })
    if (!ok) return
    setAssigning(true)
    setError('')
    const result = await executeTaskUnassign({
      taskIds: [taskId],
      branchId,
      canAssign,
      caseType: stageCaseType,
    })
    setAssigning(false)
    if (!result.ok) {
      setError(result.error ?? 'فشل إلغاء التكليف')
      return
    }
    preserveScrollDuring(() => {
      setDebtors(prev => prev.filter(d => d.taskId !== taskId))
      setSuccessMsg('تم إلغاء التكليف — عادت المهمة لغير المكلفة')
      cacheInvalidatePrefix('dashboard:v10:')
    })
  }

  const selectedCount = selected.size
  const selectedDebtorIds = useMemo(
    () => debtors.filter(d => selected.has(d.taskId)).map(d => d.debtorId),
    [debtors, selected],
  )
  const showMoveToPayment =
    allowPaymentInProgress && view === 'waiting' && stageCaseType !== 'criminal'
  const allVisibleSelected =
    visibleCount > 0
    && debtors
      .filter(d => matchingIds === null || matchingIds.includes(d.debtorId))
      .every(d => selected.has(d.taskId))

  function handleMoveSuccess(summary?: { moved: number; failed: number }) {
    setMoveModalOpen(false)
    const movedTaskIds = new Set(selected)
    setSelected(new Set())
    cacheInvalidatePrefix('dashboard:v10:')
    if (summary) {
      const parts = [`تم تحويل ${summary.moved} مدين إلى جاري التسديد`]
      if (summary.failed > 0) parts.push(`تعذّر تحويل ${summary.failed}`)
      setSuccessMsg(parts.join(' · '))
      setError(summary.failed > 0 ? `تعذّر تحويل ${summary.failed} من المحددين` : '')
    } else {
      setSuccessMsg('تم التحويل إلى جاري التسديد')
      setError('')
    }
    // حدّث القائمة محلياً دون إعادة تحميل كاملة (تحافظ على موضع التمرير)
    preserveScrollDuring(() => {
      if (summary && summary.failed > 0) {
        void load({ soft: true })
        return
      }
      setDebtors(prev => prev.filter(d => !movedTaskIds.has(d.taskId)))
    })
  }

  function handleMovedToMonitoring(taskIds: string[], debtorIds: string[], statusName: string) {
    const taskIdSet = new Set(taskIds)
    preserveScrollDuring(() => {
      setDebtors(prev => prev.filter(row => !taskIdSet.has(row.taskId)))
      setSelected(prev => {
        const next = new Set(prev)
        for (const taskId of taskIds) next.delete(taskId)
        return next
      })
      setError('')
      setSuccessMsg(`تم تحويل ${debtorIds.length} اسم إلى «${statusName}» في تبويب الأسماء التي تحتاج مراقبة`)
      cacheInvalidatePrefix('dashboard:v10:')
    })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={viewTitle(view, stageLabel || '…')}
        subtitle={loading ? 'جارٍ التحميل...' : viewSubtitle(view, visibleCount)}
        actions={<BackButton fallback="/admin/dashboard" />}
        breadcrumb={[
          { label: 'لوحة التحكم', href: '/admin/dashboard' },
          { label: stageLabel || 'مرحلة' },
        ]}
      />

      {successMsg && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 font-semibold">
          {successMsg}
        </p>
      )}

      <div className="bg-white rounded-xl border px-4 py-2.5 flex items-center gap-3 max-w-md">
        <svg className="w-4 h-4 text-[#767676] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={DEBTOR_SEARCH_PLACEHOLDER}
          className="flex-1 text-sm bg-transparent focus:outline-none"
        />
      </div>

      {canAssign && view === 'waiting' && visibleCount > 0 && (
        <div className="bg-white rounded-xl border border-[#2C8780]/30 p-4 space-y-3">
          <p className="text-xs font-bold text-[#231F20]">
            المهمة: <span className="text-[#2C8780]">{stageLabel}</span>
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#231F20] cursor-pointer shrink-0">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="w-4 h-4 accent-[#2C8780]" />
              تحديد الكل ({visibleCount})
            </label>
            <PremiumSelect
              value={bulkLawyerId}
              onChange={v => { setBulkLawyerId(v); setError('') }}
              options={[
                { value: '', label: stageIsFindAddress ? '— اختر محامياً أو مندوباً —' : '— اختر محامياً —' },
                ...assigneeOptions.map(l => ({ value: l.id, label: l.full_name })),
              ]}
              placeholder={stageIsFindAddress ? '— اختر محامياً أو مندوباً —' : '— اختر محامياً —'}
              headerTitle={stageIsFindAddress ? 'اختر المحامي أو المندوب' : 'اختر المحامي'}
              searchPlaceholder="بحث بالاسم..."
              searchable
              className="flex-1"
              disabled={!branchId}
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
              onClick={() => void assignTasks(Array.from(selected), bulkLawyerId)}
              disabled={assigning || selectedCount === 0 || !bulkLawyerId || !bulkDueDate || !branchId}
              className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
            >
              {assigning ? 'جارٍ التكليف...' : `تكليف المحددين${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
            </button>
            {canMonitor && (
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setSuccessMsg('')
                  setMonitorModalOpen(true)
                }}
                disabled={assigning || selectedCount === 0}
                className="shrink-0 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
              >
                تحويل إلى تبويب الأسماء التي تحتاج مراقبة
                {selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
            )}
            {showMoveToPayment && (
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setSuccessMsg('')
                  setMoveModalOpen(true)
                }}
                disabled={assigning || selectedCount === 0}
                className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#0f766e,#115e59)' }}
              >
                جاري التسديد{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
            )}
          </div>
          {!branchId && viewAllBranches && (
            <p className="text-[11px] text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg">
              للتكليف اختر فرعاً محدداً من القائمة العلوية
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-40 bg-white rounded-2xl border animate-pulse" />
          ))}
        </div>
      ) : branchGroups.length === 0 ? (
        <div className="bg-white rounded-2xl border p-12 text-center">
          <p className="text-sm font-semibold text-[#231F20]">
            {debouncedSearch ? 'لا نتائج' : view === 'overdue' ? 'لا مهام متأخرة' : view === 'assigned' ? 'لا مهام مكلفة' : 'لا يوجد مدينون في هذه المرحلة'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {branchGroups.map(g => (
            <BranchStageBox
              key={g.branchId}
              branchId={g.branchId}
              branchName={g.branchName}
              rows={g.rows}
              view={view}
              canAssign={canAssign}
              canMonitor={canMonitor}
              selected={selected}
              onToggle={toggle}
              onAssignOne={id => void assignTasks([id], bulkLawyerId)}
              onUnassignOne={id => void unassignOne(id)}
              assigning={assigning}
              bulkLawyerId={bulkLawyerId}
              bulkDueDate={bulkDueDate}
              matchingIds={matchingIds}
              showHearingDate={showHearingDate}
            />
          ))}
        </div>
      )}

      {showMoveToPayment && (
        <MoveToPaymentInProgressModal
          open={moveModalOpen}
          debtorIds={selectedDebtorIds}
          onClose={() => setMoveModalOpen(false)}
          onSuccess={handleMoveSuccess}
        />
      )}
      {canMonitor && (
        <MoveToMonitoringModal
          open={monitorModalOpen}
          branchId={branchId}
          viewAll={viewAllBranches}
          debtorIds={selectedDebtorIds}
          onClose={() => setMonitorModalOpen(false)}
          onSuccess={(debtorIds, statusName) => {
            handleMovedToMonitoring(Array.from(selected), debtorIds, statusName)
          }}
        />
      )}
    </div>
  )
}
