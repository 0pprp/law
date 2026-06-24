'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────
interface StageItem {
  id: string; label: string; sort_order: number
  debtorCount: number; pendingReview: number; rejected: number
}

interface WaitingGroup {
  definitionId: string; label: string; count: number
}

interface WaitingDebtor {
  taskId: string; debtorId: string; branchId: string | null
  name: string; phone: string | null; receiptNumber: string | null
  remaining: number; governorate: string | null
}

interface Lawyer { id: string; full_name: string }

interface StageDebtor {
  debtorName: string; debtorId: string; taskStatus: string
  taskId: string; lawyerName: string | null
}

// ── Helpers ────────────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft:              { label: 'جديدة',                    cls: 'bg-blue-100 text-blue-700' },
  waiting_assignment: { label: 'تنتظر تكليف',             cls: 'bg-yellow-100 text-yellow-700' },
  assigned:           { label: 'مكلّفة',                   cls: 'bg-purple-100 text-purple-700' },
  in_progress:        { label: 'جارية',                    cls: 'bg-[#2C8780]/10 text-[#2C8780]' },
  submitted:          { label: 'تنتظر المراجعة',          cls: 'bg-orange-100 text-orange-700' },
  rejected:           { label: 'مرفوضة - تحتاج تصحيح',   cls: 'bg-red-100 text-red-700' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' }
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

function Spin() {
  return (
    <div className="flex items-center justify-center gap-2 py-10">
      <svg className="w-4 h-4 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-[#767676]">جارٍ التحميل...</span>
    </div>
  )
}

// ── Assign Lawyer Modal ────────────────────────────────────────
interface LawyerOption extends Lawyer { branch_name: string | null; inBranch: boolean }

function AssignModal({
  task, branchId, onClose, onDone
}: {
  task: WaitingDebtor; branchId: string | null
  onClose: () => void; onDone: () => void
}) {
  const [lawyers, setLawyers] = useState<LawyerOption[]>([])
  const [lawyerId, setLawyerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = createClient()
    sb.from('profiles')
      .select('id, full_name, branch_id, branches(name)')
      .eq('role', 'lawyer')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        const list = (data ?? []) as any[]
        const mapped: LawyerOption[] = list.map(l => ({
          id: l.id,
          full_name: l.full_name,
          branch_name: l.branches?.name ?? null,
          inBranch: branchId ? l.branch_id === branchId : true,
        }))
        // Sort: same-branch first
        mapped.sort((a, b) => (b.inBranch ? 1 : 0) - (a.inBranch ? 1 : 0))
        setLawyers(mapped)
        setLoading(false)
      })
  }, [branchId])

  async function assign() {
    if (!lawyerId) { setErr('اختر محامياً'); return }
    setSaving(true)
    const { error } = await createClient().from('tasks').update({
      assigned_to: lawyerId,
      task_status: 'assigned',
    }).eq('id', task.taskId)
    if (error) { setErr(error.message); setSaving(false); return }
    onDone()
  }

  const sameBranch = lawyers.filter(l => l.inBranch)
  const otherBranch = lawyers.filter(l => !l.inBranch)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.65)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between">
          <div>
            <h2 className="font-bold text-[#231F20] text-sm">تكليف محامٍ</h2>
            <p className="text-xs text-[#767676] mt-0.5 truncate max-w-[200px]">{task.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 flex items-center justify-center text-xl leading-none shrink-0">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-2">اختر المحامي</label>
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-[#767676]">
                <svg className="w-4 h-4 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                جارٍ تحميل المحامين...
              </div>
            ) : (
              <select
                value={lawyerId}
                onChange={e => setLawyerId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all"
              >
                <option value="">— اختر محامياً —</option>
                {sameBranch.length > 0 && (
                  <optgroup label="محامو الفرع">
                    {sameBranch.map(l => (
                      <option key={l.id} value={l.id}>{l.full_name}</option>
                    ))}
                  </optgroup>
                )}
                {otherBranch.length > 0 && (
                  <optgroup label={sameBranch.length > 0 ? "فروع أخرى" : "جميع المحامين"}>
                    {otherBranch.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.full_name}{l.branch_name ? ` (${l.branch_name})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
            {!loading && sameBranch.length === 0 && branchId && (
              <p className="text-[11px] text-orange-600 mt-1.5 bg-orange-50 px-3 py-1.5 rounded-lg">
                لا يوجد محامون مسجّلون في هذا الفرع — يمكنك الاختيار من فروع أخرى
              </p>
            )}
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">
            إلغاء
          </button>
          <button onClick={assign} disabled={saving || !lawyerId}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ التكليف...' : 'تكليف المحامي'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Waiting Debtors Modal ──────────────────────────────────────
function WaitingDebtorsModal({
  group, onClose, onAssigned
}: {
  group: WaitingGroup; onClose: () => void; onAssigned: () => void
}) {
  const [debtors, setDebtors] = useState<WaitingDebtor[]>([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<WaitingDebtor | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const sb = createClient()
    const { data } = await sb
      .from('tasks')
      .select('id, branch_id, debtor_id, debtors!inner(full_name, phone, receipt_number, remaining_amount, governorate, branch_id)')
      .eq('task_status', 'waiting_assignment')
      .eq('task_definition_id', group.definitionId)
      .order('created_at', { ascending: false })

    setDebtors((data as any[] ?? []).map(t => ({
      taskId: t.id,
      debtorId: t.debtor_id,
      branchId: t.branch_id ?? t.debtors?.branch_id ?? null,
      name: t.debtors?.full_name ?? '—',
      phone: t.debtors?.phone ?? null,
      receiptNumber: t.debtors?.receipt_number ?? null,
      remaining: t.debtors?.remaining_amount ?? 0,
      governorate: t.debtors?.governorate ?? null,
    })))
    setLoading(false)
  }, [group.definitionId])

  useEffect(() => { load() }, [load])

  function handleAssigned() {
    setAssigning(null)
    load()
    onAssigned()
  }

  const filtered = search.trim()
    ? debtors.filter(d =>
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.phone?.includes(search) ||
        d.receiptNumber?.toLowerCase().includes(search.toLowerCase())
      )
    : debtors

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[#F8F7F8] rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="bg-white rounded-t-2xl px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-[#231F20] text-sm truncate">{group.label}</h2>
            <p className="text-[11px] text-[#767676] mt-0.5">{debtors.length} مدين بانتظار التكليف</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 flex items-center justify-center text-lg leading-none shrink-0 transition-colors">×</button>
        </div>

        {/* Search */}
        {!loading && debtors.length > 3 && (
          <div className="bg-white px-4 py-3 border-b border-[rgba(118,118,118,0.08)] shrink-0">
            <div className="relative">
              <svg className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-[#767676]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو الهاتف..."
                className="w-full pr-9 pl-4 py-2 text-sm bg-[#F8F7F8] border border-[rgba(118,118,118,0.15)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] transition-all" />
            </div>
          </div>
        )}

        {/* List */}
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {loading ? <Spin /> : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-[#F3F1F2] flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-[#767676]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-[#231F20]">{search ? 'لا نتائج' : 'لا توجد مهام بانتظار التكليف'}</p>
            </div>
          ) : (
            filtered.map(d => (
              <div key={d.taskId}
                className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] p-4 hover:border-[#2C8780]/20 hover:shadow-sm transition-all">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl bg-[#2C8780]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#2C8780] font-black text-sm">{d.name.charAt(0)}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/debtors/${d.debtorId}`} onClick={onClose}
                      className="font-bold text-[#231F20] text-sm hover:text-[#2C8780] transition-colors leading-tight">
                      {d.name}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {d.phone && (
                        <span className="text-[11px] text-[#767676] flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <span dir="ltr">{d.phone}</span>
                        </span>
                      )}
                      {d.receiptNumber && (
                        <span className="text-[11px] text-[#767676] flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                          </svg>
                          <span dir="ltr">{d.receiptNumber}</span>
                        </span>
                      )}
                      {d.governorate && (
                        <span className="text-[11px] text-[#767676] flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {d.governorate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount + Action */}
                  <div className="shrink-0 text-left flex flex-col items-end gap-2">
                    {d.remaining > 0 && (
                      <div className="text-left">
                        <p className="text-xs font-black text-[#2C8780] tabular-nums" dir="ltr">
                          {Number(d.remaining).toLocaleString('en-US')}
                        </p>
                        <p className="text-[10px] text-[#767676]">د.ع متبقي</p>
                      </div>
                    )}
                    <button
                      onClick={() => setAssigning(d)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
                      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      تكليف
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {assigning && (
        <AssignModal
          task={assigning}
          branchId={assigning.branchId}
          onClose={() => setAssigning(null)}
          onDone={handleAssigned}
        />
      )}
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────
export default function DashboardPage() {
  const branchId = useBranchId()
  const [stages, setStages] = useState<StageItem[]>([])
  const [waitingGroups, setWaitingGroups] = useState<WaitingGroup[]>([])
  const [totalDebtors, setTotalDebtors] = useState(0)
  const [totalPendingReview, setTotalPendingReview] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedStage, setSelectedStage] = useState<{ id: string; label: string } | null>(null)
  const [stageDebtors, setStageDebtors] = useState<StageDebtor[]>([])
  const [loadingStage, setLoadingStage] = useState(false)
  const [selectedWaiting, setSelectedWaiting] = useState<WaitingGroup | null>(null)
  const [recentActivity, setRecentActivity] = useState<{ action: string; new_data: any; created_at: string }[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let tq = supabase
      .from('tasks')
      .select('debtor_id, task_definition_id, task_status, task_definitions!inner(id, label, sort_order, is_active)')
      .not('task_status', 'in', '(waiting_assignment,completed,approved,cancelled)')
    let wq = supabase
      .from('tasks')
      .select('task_definition_id, task_definitions(id, label)')
      .eq('task_status', 'waiting_assignment')
    let dq = supabase.from('debtors').select('id', { count: 'exact', head: true })
    let aq = supabase.from('activity_logs').select('action, new_data, created_at').order('created_at', { ascending: false }).limit(5)

    if (branchId) {
      tq = (tq as any).eq('branch_id', branchId)
      wq = (wq as any).eq('branch_id', branchId)
      dq = (dq as any).eq('branch_id', branchId)
      aq = (aq as any).eq('branch_id', branchId)
    }

    const [tasksRes, waitingRes, debtorsRes, activityRes] = await Promise.all([tq, wq, dq, aq])

    // Build stage map (excludes waiting_assignment)
    const stageMap = new Map<string, {
      id: string; label: string; sort_order: number
      debtorIds: Set<string>; pendingReview: number; rejected: number
    }>()
    let globalPending = 0

    for (const t of (tasksRes.data ?? []) as any[]) {
      const td = t.task_definitions
      if (!td?.is_active) continue
      if (!stageMap.has(td.id)) {
        stageMap.set(td.id, { id: td.id, label: td.label, sort_order: td.sort_order, debtorIds: new Set(), pendingReview: 0, rejected: 0 })
      }
      const s = stageMap.get(td.id)!
      s.debtorIds.add(t.debtor_id)
      if (t.task_status === 'submitted') { s.pendingReview++; globalPending++ }
      if (t.task_status === 'rejected') s.rejected++
    }

    setStages(
      Array.from(stageMap.values())
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(s => ({ id: s.id, label: s.label, sort_order: s.sort_order, debtorCount: s.debtorIds.size, pendingReview: s.pendingReview, rejected: s.rejected }))
    )

    // Build waiting groups
    const waitingMap = new Map<string, { label: string; count: number }>()
    for (const t of (waitingRes.data ?? []) as any[]) {
      if (!t.task_definition_id) continue
      const label = t.task_definitions?.label ?? '—'
      const existing = waitingMap.get(t.task_definition_id)
      if (existing) existing.count++
      else waitingMap.set(t.task_definition_id, { label, count: 1 })
    }
    setWaitingGroups(Array.from(waitingMap.entries()).map(([id, { label, count }]) => ({ definitionId: id, label, count })))

    setTotalDebtors(debtorsRes.count ?? 0)
    setTotalPendingReview(globalPending)
    setRecentActivity(activityRes.data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { loadData() }, [loadData])

  async function openStage(id: string, label: string) {
    setSelectedStage({ id, label })
    setLoadingStage(true)
    setStageDebtors([])
    let q = createClient()
      .from('tasks')
      .select('id, task_status, debtor_id, debtors!inner(full_name), profiles!assigned_to(full_name)')
      .eq('task_definition_id', id)
      .not('task_status', 'in', '(waiting_assignment,completed,approved,cancelled)')
      .order('created_at', { ascending: false })
    if (branchId) q = (q as any).eq('branch_id', branchId)
    const { data } = await q

    setStageDebtors((data as any[] ?? []).map(t => ({
      debtorName: t.debtors?.full_name ?? '—',
      debtorId: t.debtor_id,
      taskStatus: t.task_status,
      taskId: t.id,
      lawyerName: t.profiles?.full_name ?? null,
    })))
    setLoadingStage(false)
  }

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Hero */}
      <div className="rounded-2xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #231F20 0%, #1a1617 100%)' }}>
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-[#2C8780]/10 rounded-full" />
          <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-white/[0.02] rounded-full" />
        </div>
        <div className="relative z-10 p-6 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1">
            <p className="text-[#2C8780] text-[10px] font-bold tracking-[0.25em] uppercase mb-2">منصة التحصيل القانوني</p>
            <h1 className="text-white text-2xl font-black leading-tight">لوحة التحكم</h1>
            <p className="text-white/40 text-sm mt-1">توزيع المدينين حسب المراحل القانونية</p>
          </div>
          <div className="flex items-stretch gap-4 shrink-0">
            <div className="text-center">
              <p className="text-3xl font-black text-white tabular-nums">{totalDebtors}</p>
              <p className="text-[10px] text-white/35 mt-0.5">إجمالي المدينين</p>
            </div>
            {waitingGroups.length > 0 && (
              <>
                <div className="w-px bg-white/10 self-stretch" />
                <div className="text-center">
                  <p className="text-3xl font-black text-yellow-400 tabular-nums">
                    {waitingGroups.reduce((s, g) => s + g.count, 0)}
                  </p>
                  <p className="text-[10px] text-white/35 mt-0.5">تنتظر تكليف</p>
                </div>
              </>
            )}
            {totalPendingReview > 0 && (
              <>
                <div className="w-px bg-white/10 self-stretch" />
                <Link href="/admin/tasks/review" className="text-center group">
                  <p className="text-3xl font-black text-orange-400 tabular-nums group-hover:text-orange-300 transition-colors">{totalPendingReview}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">تنتظر المراجعة</p>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Waiting Assignment Section */}
      {(loading || waitingGroups.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <h2 className="font-bold text-[#231F20] text-sm">المهام بانتظار التكليف</h2>
            </div>
            {!loading && (
              <span className="text-[11px] text-[#767676]">
                {waitingGroups.reduce((s, g) => s + g.count, 0)} مدين ينتظر
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-[90px] bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {waitingGroups.map(g => (
                <div key={g.definitionId} className="bg-white border border-yellow-200 rounded-2xl p-4 text-right">
                  <p className="text-[11px] text-[#767676] font-semibold leading-snug line-clamp-2 mb-2">{g.label}</p>
                  <p className="text-3xl font-black text-yellow-600 tabular-nums">{g.count}</p>
                  <p className="text-[10px] text-[#767676] mt-0.5 mb-3">مدين ينتظر</p>
                  <button
                    onClick={() => setSelectedWaiting(g)}
                    className="w-full py-1.5 text-[11px] font-bold text-white rounded-lg transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                  >
                    عرض وتكليف
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stage Cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-[#231F20] text-sm">المراحل القانونية النشطة</h2>
          <span className="text-[11px] text-[#767676]">اضغط لعرض المدينين</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-[100px] bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] animate-pulse" />
            ))}
          </div>
        ) : stages.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] p-12 text-center">
            <p className="text-sm font-semibold text-[#231F20]">لا توجد مهام نشطة حالياً</p>
            <Link href="/admin/debtors" className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-[#2C8780] hover:underline">
              عرض المدينين ←
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {stages.map(s => (
              <button key={s.id} onClick={() => openStage(s.id, s.label)}
                className="bg-white border border-[rgba(118,118,118,0.1)] rounded-2xl p-4 text-right hover:border-[#2C8780]/40 hover:shadow-md transition-all group cursor-pointer">
                <p className="text-[11px] text-[#767676] font-semibold leading-snug line-clamp-2 mb-2">{s.label}</p>
                <p className="text-3xl font-black text-[#231F20] tabular-nums group-hover:text-[#2C8780] transition-colors">{s.debtorCount}</p>
                <p className="text-[10px] text-[#767676] mt-0.5">مدين</p>
                <div className="mt-2 flex flex-col gap-1">
                  {s.pendingReview > 0 && (
                    <span className="text-[9px] font-bold text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">⏳ {s.pendingReview} تنتظر مراجعة</span>
                  )}
                  {s.rejected > 0 && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 rounded px-1.5 py-0.5">✕ {s.rejected} مرفوضة</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'مدين جديد',        href: '/admin/debtors/new',   bg: '#231F20', accent: '#2d2629' },
          { label: 'كل المهام',         href: '/admin/tasks',          bg: '#2C8780', accent: '#1D6365' },
          { label: 'مراجعة الإنجازات', href: '/admin/tasks/review',  bg: '#059669', accent: '#047857' },
          { label: 'المحامون',          href: '/admin/lawyers',        bg: '#475569', accent: '#334155' },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className="rounded-2xl px-4 py-3.5 flex items-center gap-2.5 text-white hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${a.bg}, ${a.accent})` }}>
            <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(118,118,118,0.08)]">
            <h3 className="font-bold text-[#231F20] text-sm">آخر النشاطات</h3>
            <Link href="/admin/activity" className="text-xs text-[#2C8780] font-semibold hover:underline">السجل الكامل ←</Link>
          </div>
          <div className="divide-y divide-[rgba(118,118,118,0.06)]">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <div className="w-6 h-6 rounded-full bg-[#2C8780]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[#2C8780] text-[10px] font-bold">؟</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#231F20] leading-snug">{a.action}</p>
                </div>
                <span className="text-[10px] text-[#767676] shrink-0 tabular-nums" dir="ltr">
                  {a.created_at ? new Date(a.created_at).toLocaleDateString('en-CA') : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting Debtors Modal */}
      {selectedWaiting && (
        <WaitingDebtorsModal
          group={selectedWaiting}
          onClose={() => setSelectedWaiting(null)}
          onAssigned={loadData}
        />
      )}

      {/* Stage Debtors Modal */}
      {selectedStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedStage(null) }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-bold text-[#231F20] text-sm">{selectedStage.label}</h2>
                <p className="text-xs text-[#767676] mt-0.5">المدينون في هذه المرحلة</p>
              </div>
              <button onClick={() => setSelectedStage(null)} className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 flex items-center justify-center text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1">
              {loadingStage ? <Spin /> : stageDebtors.length === 0 ? (
                <div className="py-14 text-center text-sm text-[#767676]">لا توجد نتائج</div>
              ) : (
                <div className="divide-y divide-[rgba(118,118,118,0.07)]">
                  {stageDebtors.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#F8F7F8] transition-colors">
                      <div className="w-8 h-8 rounded-full bg-[#2C8780]/10 flex items-center justify-center shrink-0 text-[#2C8780] text-xs font-bold">
                        {d.debtorName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/admin/debtors/${d.debtorId}`} onClick={() => setSelectedStage(null)}
                          className="text-sm font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors">
                          {d.debtorName}
                        </Link>
                        {d.lawyerName && <p className="text-[11px] text-[#767676] mt-0.5">المحامي: {d.lawyerName}</p>}
                      </div>
                      <StatusBadge status={d.taskStatus} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[rgba(118,118,118,0.07)] flex items-center justify-between shrink-0">
              <span className="text-xs text-[#767676]">{stageDebtors.length} مدين</span>
              <Link href="/admin/tasks" onClick={() => setSelectedStage(null)}
                className="text-xs font-semibold text-[#2C8780] hover:underline">
                عرض كل المهام ←
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
