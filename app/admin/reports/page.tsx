'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { TASK_FEE_MAP } from '@/lib/constants'
import type { TaskType } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtNum, fmtDate } from '@/lib/utils'
import { STALLED_STATUSES } from '@/lib/stage-config'

interface Filters { dateFrom: string; dateTo: string; debtorId: string; lawyerId: string }
const EMPTY: Filters = { dateFrom: '', dateTo: '', debtorId: '', lawyerId: '' }
const OPEN_STATUSES = ['new', 'in_progress', 'postponed', 'needs_info']

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

function IconMoney() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function IconExpense() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg> }
function IconFee() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg> }
function IconTask() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }

export default function ReportsPage() {
  const branchId = useBranchId()
  const [lawyers, setLawyers] = useState<any[]>([])
  const [debtors, setDebtors] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [taskDefs, setTaskDefs] = useState<any[]>([])
  const [activeDebtors, setActiveDebtors] = useState<any[]>([])
  const [closedCount, setClosedCount] = useState(0)
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)

  useEffect(() => {
    const supabase = createClient()
    let lq = supabase.from('profiles').select('id, full_name, governorate').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    let dq = supabase.from('debtors').select('id, full_name, required_amount').order('full_name')
    let tq = supabase.from('tasks').select('id, task_type, task_status, assigned_to, debtor_id, completed_at, due_date, created_at, task_definition_id, task_definitions(label)')
    let tdq = supabase.from('task_definitions').select('id, label, sort_order').eq('is_active', true).order('sort_order')
    let adq = supabase.from('debtors').select(`
      id, case_status, current_task_id,
      current_task:tasks!current_task_id(id, task_status, task_definition_id)
    `).or('case_status.is.null,case_status.neq.closed')
    let ccq = supabase.from('debtors').select('id', { count: 'exact', head: true }).eq('case_status', 'closed')
    let eq = supabase.from('expenses').select('id, debtor_id, amount, expense_date')
    let pq = supabase.from('debtor_payments').select('id, debtor_id, lawyer_id, amount, payment_date').order('payment_date', { ascending: false })
    if (branchId) {
      lq = (lq as any).eq('branch_id', branchId)
      dq = (dq as any).eq('branch_id', branchId)
      tq = (tq as any).eq('branch_id', branchId)
      tdq = (tdq as any).eq('branch_id', branchId)
      adq = (adq as any).eq('branch_id', branchId)
      ccq = (ccq as any).eq('branch_id', branchId)
      eq = (eq as any).eq('branch_id', branchId)
      pq = (pq as any).eq('branch_id', branchId)
    }
    Promise.all([lq, dq, tq, eq, pq, tdq, adq, ccq]).then(([
      { data: l }, { data: d }, { data: t }, { data: e }, { data: p },
      { data: td }, { data: ad }, { count: cc },
    ]) => {
      setLawyers(l ?? []); setDebtors(d ?? []); setTasks(t ?? [])
      setExpenses(e ?? []); setPayments(p ?? [])
      setTaskDefs(td ?? []); setActiveDebtors(ad ?? []); setClosedCount(cc ?? 0)
      setLoading(false)
    })
  }, [branchId])

  const summary = useMemo(() => {
    const { dateFrom, dateTo, debtorId, lawyerId } = applied
    const fp = payments.filter(p => {
      if (dateFrom && p.payment_date < dateFrom) return false
      if (dateTo && p.payment_date > dateTo) return false
      if (debtorId && p.debtor_id !== debtorId) return false
      if (lawyerId && p.lawyer_id !== lawyerId) return false
      return true
    })
    const fe = expenses.filter(e => {
      if (dateFrom && e.expense_date < dateFrom) return false
      if (dateTo && e.expense_date > dateTo) return false
      if (debtorId && e.debtor_id !== debtorId) return false
      return true
    })
    const ft = tasks.filter(t => {
      if (debtorId && t.debtor_id !== debtorId) return false
      if (lawyerId && t.assigned_to !== lawyerId) return false
      return true
    })
    const completed = ft.filter(t => t.task_status === 'completed')
    const open = ft.filter(t => OPEN_STATUSES.includes(t.task_status))
    const totalRequired = (debtorId ? debtors.filter(d => d.id === debtorId) : debtors)
      .reduce((s, d) => s + Number(d.required_amount ?? 0), 0)
    return {
      totalPayments: fp.reduce((s, p) => s + Number(p.amount), 0),
      totalExpenses: fe.reduce((s, e) => s + Number(e.amount), 0),
      lawyerFees: completed.reduce((s, t) => s + (TASK_FEE_MAP[t.task_type as TaskType] ?? 0), 0),
      totalRequired,
      completedCount: completed.length,
      openCount: open.length,
    }
  }, [applied, payments, expenses, tasks, debtors])

  const lawyerStats = useMemo(() => {
    const { lawyerId } = applied
    const list = lawyerId ? lawyers.filter(l => l.id === lawyerId) : lawyers
    return list.map(lawyer => {
      const lt = tasks.filter(t => t.assigned_to === lawyer.id && t.task_status === 'completed')
      const feeBalance = lt.reduce((s, t) => s + (TASK_FEE_MAP[t.task_type as TaskType] ?? 0), 0)
      const lp = payments.filter(p => p.lawyer_id === lawyer.id)
      const collections = lp.reduce((s, p) => s + Number(p.amount), 0)
      const lastPayment = lp[0]?.payment_date ?? null
      const lastDone = lt.sort((a, b) => (b.completed_at ?? b.updated_at ?? '').localeCompare(a.completed_at ?? a.updated_at ?? ''))[0]?.completed_at ?? null
      return { ...lawyer, completedCount: lt.length, feeBalance, collections, lastPayment, lastDone }
    }).sort((a, b) => b.completedCount - a.completedCount)
  }, [applied, lawyers, tasks, payments])

  const stageReports = useMemo(() => {
    const stageCounts = new Map<string, { id: string; label: string; active: number; stalled: number }>()
    for (const def of taskDefs) {
      stageCounts.set(def.id, { id: def.id, label: def.label, active: 0, stalled: 0 })
    }
    for (const d of activeDebtors) {
      const task = d.current_task
      if (!task?.task_definition_id) continue
      const entry = stageCounts.get(task.task_definition_id)
      if (!entry) continue
      entry.active++
      if (STALLED_STATUSES.includes(task.task_status)) entry.stalled++
    }

    const approvedTasks = tasks.filter(t => t.task_status === 'approved' && t.completed_at)
    const taskExecCount = new Map<string, { label: string; count: number }>()
    for (const t of approvedTasks) {
      const defId = t.task_definition_id ?? t.task_type
      const label = t.task_definitions?.label ?? t.task_type ?? '—'
      const cur = taskExecCount.get(defId) ?? { label, count: 0 }
      cur.count++
      taskExecCount.set(defId, cur)
    }
    const topTasks = Array.from(taskExecCount.values()).sort((a, b) => b.count - a.count).slice(0, 8)

    // Average transition time: gap between consecutive approved tasks per debtor
    const byDebtor = new Map<string, any[]>()
    for (const t of approvedTasks) {
      if (!byDebtor.has(t.debtor_id)) byDebtor.set(t.debtor_id, [])
      byDebtor.get(t.debtor_id)!.push(t)
    }
    const gaps: number[] = []
    for (const list of byDebtor.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      for (let i = 1; i < list.length; i++) {
        const days = (new Date(list[i].created_at).getTime() - new Date(list[i - 1].completed_at).getTime()) / 86400000
        if (days >= 0 && days < 365) gaps.push(days)
      }
    }
    const avgTransitionDays = gaps.length > 0 ? Math.round(gaps.reduce((s, d) => s + d, 0) / gaps.length) : null

    const lawyerTaskStats = lawyers.map(lawyer => {
      const approved = tasks.filter(t => t.assigned_to === lawyer.id && t.task_status === 'approved')
      return { id: lawyer.id, name: lawyer.full_name, approvedCount: approved.length }
    }).filter(l => l.approvedCount > 0).sort((a, b) => b.approvedCount - a.approvedCount)

    return {
      stageCounts: Array.from(stageCounts.values()),
      closedCount,
      avgTransitionDays,
      topTasks,
      lawyerTaskStats,
      totalActive: activeDebtors.filter(d => d.current_task_id).length,
    }
  }, [taskDefs, activeDebtors, tasks, lawyers, closedCount])

  function d(k: keyof Filters, v: string) { setDraft(prev => ({ ...prev, [k]: v })) }
  const hasApplied = Object.values(applied).some(Boolean)

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير" subtitle="تحليل شامل للأداء والمالية" />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-5">
        <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">معايير التقرير</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-[10px] text-[#767676] mb-1">من تاريخ</label>
            <input type="date" value={draft.dateFrom} onChange={e => d('dateFrom', e.target.value)} className={SEL} dir="ltr" />
          </div>
          <div>
            <label className="block text-[10px] text-[#767676] mb-1">إلى تاريخ</label>
            <input type="date" value={draft.dateTo} onChange={e => d('dateTo', e.target.value)} className={SEL} dir="ltr" />
          </div>
          <div>
            <label className="block text-[10px] text-[#767676] mb-1">المدين</label>
            <select value={draft.debtorId} onChange={e => d('debtorId', e.target.value)} className={SEL}>
              <option value="">كل المدينين</option>
              {debtors.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-[#767676] mb-1">المحامي</label>
            <select value={draft.lawyerId} onChange={e => d('lawyerId', e.target.value)} className={SEL}>
              <option value="">كل المحامين</option>
              {lawyers.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="primary" size="sm" onClick={() => setApplied({ ...draft })}>تطبيق الفلترة</Button>
          {hasApplied && <Button variant="outline" size="sm" onClick={() => { setDraft(EMPTY); setApplied(EMPTY) }}>تصفير</Button>}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div>
            <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">ملخص المالي</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard label="إجمالي التسديدات" value={fmtMoney(summary.totalPayments)} icon={<IconMoney />} iconBg="bg-green-600" accent="green" />
              <StatCard label="إجمالي الصرفيات" value={fmtMoney(summary.totalExpenses)} icon={<IconExpense />} iconBg="bg-red-500" accent="red" />
              <StatCard label="أتعاب المحامين" value={fmtMoney(summary.lawyerFees)} icon={<IconFee />} accent="teal" />
              <StatCard label="إجمالي المطلوب" value={fmtMoney(summary.totalRequired)} icon={<IconMoney />} iconBg="bg-blue-600" accent="blue" />
              <StatCard label="المهام المنجزة" value={fmtNum(summary.completedCount)} icon={<IconTask />} iconBg="bg-green-600" accent="green" />
              <StatCard label="المهام المفتوحة" value={fmtNum(summary.openCount)} icon={<IconTask />} iconBg="bg-[#767676]" />
            </div>
          </div>

          {/* Net */}
          <div className={`rounded-xl p-5 border-2 ${summary.totalPayments - summary.totalExpenses >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <p className="text-sm font-medium text-[#767676] mb-1">الصافي (تسديدات − صرفيات)</p>
            <p className={`text-3xl font-black tabular-nums ${summary.totalPayments - summary.totalExpenses >= 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
              {fmtMoney(summary.totalPayments - summary.totalExpenses)}
            </p>
          </div>

          {/* Stage reports */}
          <div>
            <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">تقارير مراحل القضايا</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatCard label="قضايا نشطة" value={fmtNum(stageReports.totalActive)} accent="teal" />
              <StatCard label="قضايا محسومة" value={fmtNum(stageReports.closedCount)} accent="navy" />
              <StatCard
                label="متوسط زمن الانتقال"
                value={stageReports.avgTransitionDays != null ? `${stageReports.avgTransitionDays} يوم` : '—'}
                sub="بين المراحل المتتالية"
                accent="blue"
              />
              <StatCard
                label="أكثر مهمة تنفيذاً"
                value={stageReports.topTasks[0]?.count ?? 0}
                sub={stageReports.topTasks[0]?.label ?? '—'}
                accent="orange"
              />
            </div>

            {stageReports.stageCounts.length > 0 && (
              <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden mb-4">
                <Table>
                  <THead>
                    <tr>
                      <TH>المرحلة</TH>
                      <TH>قضايا نشطة</TH>
                      <TH>متوقفة</TH>
                      <TH>النسبة</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {stageReports.stageCounts.map(s => {
                      const pct = stageReports.totalActive > 0 ? Math.round((s.active / stageReports.totalActive) * 100) : 0
                      return (
                        <TR key={s.id}>
                          <TD className="font-semibold text-[#231F20]">{s.label}</TD>
                          <TD><span className="font-bold tabular-nums">{fmtNum(s.active)}</span></TD>
                          <TD><span className={`font-bold tabular-nums ${s.stalled > 0 ? 'text-red-600' : 'text-[#767676]'}`}>{fmtNum(s.stalled)}</span></TD>
                          <TD>
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden">
                                <div className="h-full bg-[#2C8780] rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs font-bold text-[#767676]">{pct}%</span>
                            </div>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </div>
            )}

            {stageReports.lawyerTaskStats.length > 0 && (
              <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
                <p className="text-xs font-bold text-[#767676] uppercase tracking-wider px-5 pt-4 pb-2">أداء المحامين حسب المهام المعتمدة</p>
                <Table>
                  <THead>
                    <tr>
                      <TH>#</TH>
                      <TH>المحامي</TH>
                      <TH>مهام معتمدة</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {stageReports.lawyerTaskStats.map((l, i) => (
                      <TR key={l.id}>
                        <TD className="text-[#767676] font-mono text-xs w-8">{i + 1}</TD>
                        <TD className="font-semibold text-[#231F20]">{l.name}</TD>
                        <TD><span className="font-bold tabular-nums">{fmtNum(l.approvedCount)}</span></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </div>

          {/* Lawyer performance table */}
          {lawyerStats.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">أداء المحامين</p>
              <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
                <Table>
                  <THead>
                    <tr>
                      <TH>#</TH>
                      <TH>اسم المحامي</TH>
                      <TH>المحافظة</TH>
                      <TH>المهام المنجزة</TH>
                      <TH>رصيد الأتعاب</TH>
                      <TH>المبالغ المحصّلة</TH>
                      <TH>آخر تحصيل</TH>
                      <TH>آخر إنجاز</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {lawyerStats.map((l: any, i: number) => (
                      <TR key={l.id}>
                        <TD className="text-[#767676] font-mono text-xs w-8">{i + 1}</TD>
                        <TD className="font-semibold text-[#231F20]">{l.full_name}</TD>
                        <TD className="text-[#767676] text-xs">{l.governorate ?? '—'}</TD>
                        <TD>
                          <span className="font-bold text-[#231F20] tabular-nums">{fmtNum(l.completedCount)}</span>
                        </TD>
                        <TD><span className="font-semibold text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(l.feeBalance)}</span></TD>
                        <TD><span className="font-semibold text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(l.collections)}</span></TD>
                        <TD><span className="text-xs text-[#767676] font-mono" dir="ltr">{fmtDate(l.lastPayment)}</span></TD>
                        <TD><span className="text-xs text-[#767676] font-mono" dir="ltr">{l.lastDone ? l.lastDone.split('T')[0] : '—'}</span></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}