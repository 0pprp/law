'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import { assignTasksViaApi } from '@/lib/task-operations-api'
import { fetchBranchLawyers, taskLawyerId } from '@/lib/task-assignment'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import { PremiumSelect } from '@/components/ui/premium-select'
import { BranchListFilterSelect } from '@/components/BranchListSelect'
import { useBranchLists } from '@/hooks/use-branch-lists'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, PERMISSION_DENIED_MSG } from '@/lib/permissions'

interface StageDebtor {
  debtorId: string
  debtorName: string
  taskId: string
  taskStatus: string
  lawyerName: string | null
  phone: string | null
  receiptType: ReceiptType | null
  receiptNumber: string | null
  remaining: number
  taskCreatedAt: string | null
  branchListId: string | null
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  waiting_assignment: { label: 'تنتظر تكليف', cls: 'bg-yellow-100 text-yellow-700' },
  assigned:           { label: 'مكلّفة', cls: 'bg-purple-100 text-purple-700' },
  in_progress:        { label: 'جارية', cls: 'bg-[#2C8780]/10 text-[#2C8780]' },
  submitted:          { label: 'تنتظر المراجعة', cls: 'bg-orange-100 text-orange-700' },
  needs_info:         { label: 'تحتاج تصحيح', cls: 'bg-red-100 text-red-700' },
  rejected:           { label: 'مرفوضة', cls: 'bg-red-100 text-red-700' },
  postponed:          { label: 'مؤجّلة', cls: 'bg-slate-100 text-slate-600' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' }
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

interface Lawyer { id: string; full_name: string }

export default function StageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: stageId } = use(params)
  const branchId = useBranchId()
  const { lists: branchLists } = useBranchLists(branchId)
  const role = useAdminRole()
  const canAssign = canAssignTasks(role)
  const [stageLabel, setStageLabel] = useState('')
  const [debtors, setDebtors] = useState<StageDebtor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterListId, setFilterListId] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [matchingIds, setMatchingIds] = useState<string[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [lawyers, setLawyers] = useState<Lawyer[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLawyerId, setBulkLawyerId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    const supabase = createClient()

    const { data: def } = await supabase.from('task_definitions').select('label').eq('id', stageId).single()
    setStageLabel(def?.label ?? '—')

    // Source of truth = debtors whose current_task is in this stage
    let q = supabase
      .from('debtors')
      .select(`
        id, full_name, phone, receipt_type, receipt_number, branch_list_id,
        remaining_amount, case_status, current_task_id,
        current_task:tasks!current_task_id(
          id, task_status, assigned_to, created_at, task_definition_id, branch_id,
          lawyer:profiles!tasks_assigned_to_fkey(full_name)
        )
      `)
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .order('full_name')

    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q

    const mapped: StageDebtor[] = (data ?? [])
      .filter((d: any) => {
        const t = d.current_task
        if (!t || t.task_definition_id !== stageId) return false
        if (d.current_task_id !== t.id) return false
        if (branchId && t.branch_id !== branchId) return false
        return !taskLawyerId(t)
      })
      .map((d: any) => ({
        debtorId: d.id,
        debtorName: d.full_name,
        taskId: d.current_task.id,
        taskStatus: d.current_task.task_status,
        lawyerName: null,
        phone: d.phone ?? null,
        receiptType: d.receipt_type ?? null,
        receiptNumber: d.receipt_number ?? null,
        remaining: Number(d.remaining_amount ?? 0),
        taskCreatedAt: d.current_task.created_at ?? null,
        branchListId: d.branch_list_id ?? null,
      }))

    setDebtors(mapped)
    setLoading(false)
  }, [stageId, branchId])

  useEffect(() => { load() }, [load])

  // Load lawyers for bulk assign — strictly scoped to the active branch
  useEffect(() => {
    if (!branchId) { setLawyers([]); return }
    fetchBranchLawyers(createClient(), branchId).then(setLawyers)
  }, [branchId])

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

  const filtered = debtors.filter(d => {
    if (matchingIds !== null && !matchingIds.includes(d.debtorId)) return false
    if (filterListId && d.branchListId !== filterListId) return false
    return true
  })

  const allSelected = filtered.length > 0 && filtered.every(d => selected.has(d.taskId))

  function toggle(taskId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(d => d.taskId)))
    }
  }

  async function assignTasks(taskIds: string[], lawyerId: string) {
    if (!canAssign) { setError(PERMISSION_DENIED_MSG); return }
    if (!lawyerId) { setError('اختر محامياً'); return }
    if (taskIds.length === 0) { setError('حدد مديناً واحداً على الأقل'); return }
    setAssigning(true); setError('')
    const supabase = createClient()
    const result = await assignTasksViaApi(taskIds, lawyerId)
    if (!result.ok) { setError(result.error ?? 'فشل التكليف'); setAssigning(false); return }
    setAssigning(false)
    setBulkLawyerId('')
    await load()
  }

  const selectedCount = selected.size

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title={stageLabel}
        subtitle={`${debtors.length} مهمة غير مكلفة في هذه المرحلة`}
        breadcrumb={[
          { label: 'لوحة التحكم', href: '/admin/dashboard' },
          { label: stageLabel },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border px-4 py-2.5 flex items-center gap-3">
          <svg className="w-4 h-4 text-[#767676] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            className="flex-1 text-sm bg-transparent focus:outline-none" />
        </div>
        <BranchListFilterSelect
          value={filterListId}
          onChange={setFilterListId}
          lists={branchLists}
        />
      </div>

      {/* Bulk assign bar */}
      {canAssign && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-[#2C8780]/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#231F20] cursor-pointer shrink-0">
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              className="w-4 h-4 accent-[#2C8780]" />
            تحديد الكل ({filtered.length})
          </label>
          <div className="flex-1 flex items-center gap-2">
            <PremiumSelect
              value={bulkLawyerId}
              onChange={v => { setBulkLawyerId(v); setError('') }}
              options={[
                { value: '', label: '— اختر محامياً —' },
                ...lawyers.map(l => ({ value: l.id, label: l.full_name })),
              ]}
              placeholder="— اختر محامياً —"
              headerTitle="اختر المحامي"
              headerSubtitle={`${lawyers.length} محامٍ في الفرع`}
              searchPlaceholder="بحث بالاسم..."
              searchable
              className="flex-1"
            />
            <button
              onClick={() => assignTasks(Array.from(selected), bulkLawyerId)}
              disabled={assigning || selectedCount === 0 || !bulkLawyerId}
              className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
              {assigning ? 'جارٍ التكليف...' : `تكليف المحددين${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
            </button>
          </div>
          {lawyers.length === 0 && (
            <p className="text-[11px] text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg">
              لا يوجد محامون في هذا الفرع — أضف محامياً للفرع أولاً
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <div className="py-16 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border p-12 text-center">
          <p className="text-sm font-semibold text-[#231F20]">{search ? 'لا نتائج' : 'لا يوجد مدينون في هذه المرحلة'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="divide-y divide-[rgba(118,118,118,0.07)]">
            {filtered.map(d => {
              const isWaiting = !d.lawyerName
              return (
                <div key={d.taskId} className="flex items-center gap-3 px-4 py-4 hover:bg-[#F8F7F8] transition-colors">
                  {canAssign && (
                  <input
                    type="checkbox"
                    checked={selected.has(d.taskId)}
                    onChange={() => toggle(d.taskId)}
                    disabled={!isWaiting}
                    className="w-4 h-4 accent-[#2C8780] shrink-0 disabled:opacity-30"
                    title={isWaiting ? 'تحديد للتكليف' : 'مكلّفة بالفعل'}
                  />
                  )}
                  <div className="w-9 h-9 rounded-xl bg-[#2C8780]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#2C8780] font-black text-sm">{d.debtorName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/debtors/${d.debtorId}/account`}
                      className="text-sm font-bold text-[#231F20] hover:text-[#2C8780] transition-colors">
                      {d.debtorName}
                    </Link>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {d.phone && <span className="text-[11px] text-[#767676]" dir="ltr">{d.phone}</span>}
                      {d.receiptType && (
                        <span className="text-[11px] text-[#767676]">
                          {RECEIPT_TYPE_LABELS[d.receiptType] ?? d.receiptType}
                        </span>
                      )}
                      {d.receiptNumber && <span className="text-[11px] text-[#767676]" dir="ltr">{d.receiptNumber}</span>}
                      {d.taskCreatedAt && (
                        <span className="text-[11px] text-[#767676]" dir="ltr">
                          {fmtDate(d.taskCreatedAt.split('T')[0])}
                        </span>
                      )}
                      {d.lawyerName && <span className="text-[11px] text-[#767676]">المحامي: {d.lawyerName}</span>}
                    </div>
                  </div>
                  {d.remaining > 0 && (
                    <span className="text-xs font-bold text-[#2C8780] tabular-nums shrink-0" dir="ltr">
                      {fmtMoney(d.remaining)}
                    </span>
                  )}
                  <StatusBadge status={d.taskStatus} />
                  {canAssign && isWaiting && (
                    <button onClick={() => assignTasks([d.taskId], bulkLawyerId)}
                      disabled={assigning || !bulkLawyerId}
                      title={!bulkLawyerId ? 'اختر محامياً من الأعلى أولاً' : 'تكليف هذا المدين'}
                      className="text-[11px] font-bold text-white px-3 py-1.5 rounded-lg shrink-0 hover:opacity-90 disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                      تكليف
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
