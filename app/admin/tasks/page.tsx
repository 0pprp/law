'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId, useBranch } from '@/context/branch'
import { TASK_STATUS_LABELS } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import {
  fetchUnassignedCurrentTasks,
  assignTasksToLawyer,
  autoAcceptExpiredAssignments,
  type CurrentBranchTaskRow,
} from '@/lib/task-assignment'
import { fetchBranchProfiles, filterLawyerProfiles } from '@/lib/branch-profiles'
import { formatErrorMessage } from '@/lib/format-error'
import { backfillDebtorCurrentTask } from '@/lib/debtor-current-task'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtDate } from '@/lib/utils'
import Link from 'next/link'

const STATUS_BADGE: Partial<Record<TaskStatus, 'default' | 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  waiting_assignment: 'warning',
  pending_assignment: 'warning',
  draft: 'gray',
  new: 'info',
}

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white text-[#231F20] transition-all w-full'

export default function TasksPage() {
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const [tasks, setTasks] = useState<CurrentBranchTaskRow[]>([])
  const [taskDefs, setTaskDefs] = useState<{ id: string; label: string }[]>([])
  const [lawyers, setLawyers] = useState<{ id: string; full_name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [filterDef, setFilterDef] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLawyerId, setBulkLawyerId] = useState('')
  const [bulkDueDate, setBulkDueDate] = useState('')
  const [singleAssignId, setSingleAssignId] = useState<string | null>(null)
  const [singleLawyerId, setSingleLawyerId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
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

    try {
      let staleQ = supabase
        .from('debtors')
        .select('id')
        .not('case_status', 'eq', 'closed')
        .is('current_task_id', null)
        .limit(50)
      if (branchId) staleQ = (staleQ as any).eq('branch_id', branchId)
      const { data: staleDebtors } = await staleQ
      await Promise.all((staleDebtors ?? []).map(d => backfillDebtorCurrentTask(supabase, d.id)))
      await autoAcceptExpiredAssignments(supabase, { branchId })

      const [{ data: defs }, raw, profilesResult] = await Promise.all([
        supabase.from('task_definitions').select('id, label').eq('is_active', true).order('sort_order'),
        fetchUnassignedCurrentTasks(supabase, branchId),
        fetchBranchProfiles(supabase, branchId),
      ])

      const branchProfiles = profilesResult.profiles
      const lawyerList = filterLawyerProfiles(branchProfiles).map(({ id, full_name }) => ({ id, full_name }))

      if (process.env.NODE_ENV !== 'production') {
        console.log('[admin/tasks] currentBranchId:', branchId)
        console.log('[admin/tasks] profiles in branch:', branchProfiles.length)
        console.log('[admin/tasks] lawyers after filter:', lawyerList.length)
        console.log('[admin/tasks] sample profiles:', branchProfiles.slice(0, 3).map(p => ({
          id: p.id,
          full_name: p.full_name,
          role: p.role,
          branch_id: p.branch_id,
          is_active: p.is_active,
        })))
      }

      if (profilesResult.error) {
        console.error('[admin/tasks] profiles query error:', profilesResult.error)
        setError(formatErrorMessage(profilesResult.error))
      }

      setTasks(raw)
      setLawyers(lawyerList)
      setTaskDefs(defs ?? [])
    } catch (e: unknown) {
      console.error('[admin/tasks] load error:', e)
      setError(formatErrorMessage(e) || 'فشل تحميل المهام')
      setTasks([])
      setLawyers([])
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => tasks.filter(t => {
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!t.debtorName.toLowerCase().includes(q) && !(t.debtorPhone ?? '').includes(q)) return false
    }
    if (filterDef && t.task_definition_id !== filterDef) return false
    if (dateFrom && t.created_at.split('T')[0] < dateFrom) return false
    if (dateTo && t.created_at.split('T')[0] > dateTo) return false
    return true
  }), [tasks, search, filterDef, dateFrom, dateTo])

  const allSelected = filtered.length > 0 && filtered.every(t => selected.has(t.id))

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

  async function assignTaskIds(ids: string[], lawyerId: string, dueDate?: string) {
    if (!lawyerId) { setError('اختر محامياً'); return }
    if (ids.length === 0) { setError('حدد مهمة واحدة على الأقل'); return }
    setAssigning(true); setError('')
    const supabase = createClient()
    const result = await assignTasksToLawyer(supabase, ids, lawyerId, dueDate)
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
    await load()
  }

  const hasFilters = search || filterDef || dateFrom || dateTo
  function clearFilters() {
    setSearch(''); setFilterDef('')
    setDateFrom(''); setDateTo('')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="تكليف المهام"
        subtitle={`${filtered.length} مهمة غير مكلفة${branchName ? ` · ${branchName}` : ''}`}
      />

      {!branchId && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض المهام والمحامين.
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <input type="text" placeholder="بحث باسم المدين..." value={search}
            onChange={e => setSearch(e.target.value)} className={SEL + ' col-span-2 lg:col-span-1'} />
          <select value={filterDef} onChange={e => setFilterDef(e.target.value)} className={SEL}>
            <option value="">كل أنواع المهام</option>
            {taskDefs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className={SEL} dir="ltr" title="من تاريخ" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className={SEL} dir="ltr" title="إلى تاريخ" />
        </div>

        {hasFilters && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#767676]">{filtered.length} من {tasks.length} مهمة</p>
            <button onClick={clearFilters} className="text-xs text-[#2C8780] hover:underline">إلغاء التصفية</button>
          </div>
        )}

        <div className="border-t border-[rgba(118,118,118,0.1)] pt-4 flex flex-col sm:flex-row gap-2">
          <select value={bulkLawyerId} onChange={e => { setBulkLawyerId(e.target.value); setError('') }}
            className={SEL + ' flex-1'} disabled={!branchId}>
            <option value="">— اختر محامياً من هذا الفرع —</option>
            {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
          </select>
          <input type="date" value={bulkDueDate} onChange={e => setBulkDueDate(e.target.value)}
            className={SEL + ' sm:w-44'} dir="ltr" title="تاريخ نهاية التكليف" required />
          <button onClick={() => assignTaskIds(Array.from(selected), bulkLawyerId, bulkDueDate || undefined)}
            disabled={assigning || selected.size === 0 || !bulkLawyerId || !bulkDueDate || !branchId}
            className="shrink-0 px-5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {assigning ? 'جارٍ التكليف...' : `تكليف المحددين${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>
        </div>
        {branchId && lawyers.length === 0 && (
          <p className="text-[11px] text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg">
            لا يوجد محامون نشطون مرتبطون بهذا الفرع.{' '}
            <Link href="/admin/lawyers/new" className="font-bold underline">أضف محامياً</Link>
            {' '}من صفحة المستخدمين.
          </p>
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
            title={hasFilters ? 'لا نتائج للتصفية' : 'لا توجد مهام بانتظار التكليف'}
            description={hasFilters ? 'جرّب تغيير معايير التصفية' : 'جميع المهام الحالية مكلّفة في هذا الفرع'}
            action={hasFilters
              ? <button onClick={clearFilters} className="text-xs text-[#2C8780] hover:underline font-semibold">إلغاء التصفية</button>
              : <Link href="/admin/dashboard" className="text-xs text-[#2C8780] hover:underline font-semibold">العودة للوحة التحكم</Link>}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-4 h-4 accent-[#2C8780]" />
                </TH>
                <TH>المدين</TH>
                <TH>الهاتف</TH>
                <TH>نوع المهمة</TH>
                <TH>تاريخ إنشاء المهمة</TH>
                <TH>تاريخ نهاية التكليف</TH>
                <TH>الحالة</TH>
                <TH className="text-center">تكليف</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map(t => (
                <TR key={t.id}>
                  <TD>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)}
                      className="w-4 h-4 accent-[#2C8780]" />
                  </TD>
                  <TD>
                    <Link href={`/admin/debtors/${t.debtor_id}/account`}
                      className="font-semibold text-[#231F20] hover:text-[#2C8780] text-sm">
                      {t.debtorName}
                    </Link>
                  </TD>
                  <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{t.debtorPhone ?? '—'}</span></TD>
                  <TD><span className="text-xs text-[#231F20]">{t.taskLabel}</span></TD>
                  <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{fmtDate(t.created_at.split('T')[0])}</span></TD>
                  <TD>
                    <span className="text-xs font-mono text-[#767676]" dir="ltr">
                      {t.due_date ? fmtDate(t.due_date) : '—'}
                    </span>
                  </TD>
                  <TD>
                    <Badge variant={STATUS_BADGE[t.task_status as TaskStatus] ?? 'warning'}>
                      {TASK_STATUS_LABELS[t.task_status as TaskStatus] ?? t.task_status}
                    </Badge>
                  </TD>
                  <TD>
                    {singleAssignId === t.id ? (
                      <div className="flex items-center gap-1 min-w-[180px]">
                        <select value={singleLawyerId} onChange={e => setSingleLawyerId(e.target.value)}
                          className="text-[10px] border rounded px-1 py-1 flex-1">
                          <option value="">محامي</option>
                          {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
                        </select>
                        <button onClick={() => assignTaskIds([t.id], singleLawyerId, bulkDueDate || undefined)}
                          disabled={assigning || !singleLawyerId}
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
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}
