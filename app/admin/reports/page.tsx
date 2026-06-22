'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_FEE_MAP } from '@/lib/constants'
import type { TaskType } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtNum, fmtDate } from '@/lib/utils'

interface Filters { dateFrom: string; dateTo: string; debtorId: string; lawyerId: string }
const EMPTY: Filters = { dateFrom: '', dateTo: '', debtorId: '', lawyerId: '' }
const OPEN_STATUSES = ['new', 'in_progress', 'postponed', 'needs_info']

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

function IconMoney() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function IconExpense() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg> }
function IconFee() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg> }
function IconTask() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }

export default function ReportsPage() {
  const [lawyers, setLawyers] = useState<any[]>([])
  const [debtors, setDebtors] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('profiles').select('id, full_name, governorate').eq('role', 'lawyer').eq('is_active', true).order('full_name'),
      supabase.from('debtors').select('id, full_name, required_amount').order('full_name'),
      supabase.from('tasks').select('id, task_type, task_status, assigned_to, debtor_id, completed_at, due_date, created_at'),
      supabase.from('expenses').select('id, debtor_id, amount, expense_date'),
      supabase.from('debtor_payments').select('id, debtor_id, lawyer_id, amount, payment_date').order('payment_date', { ascending: false }),
    ]).then(([{ data: l }, { data: d }, { data: t }, { data: e }, { data: p }]) => {
      setLawyers(l ?? []); setDebtors(d ?? []); setTasks(t ?? [])
      setExpenses(e ?? []); setPayments(p ?? [])
      setLoading(false)
    })
  }, [])

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