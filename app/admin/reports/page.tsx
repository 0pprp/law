'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtNum, fmtDate } from '@/lib/utils'
import { achievementFee } from '@/lib/achievement-report'
import { DebtorSearchPicker } from '@/components/ui/debtor-search-picker'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { PremiumSelect } from '@/components/ui/premium-select'
import {
  fetchReportSnapshot,
  buildAchievementByType,
  buildAchievementByLawyer,
  type ReportSnapshot,
} from '@/lib/reports-data'

interface Filters { dateFrom: string; dateTo: string; debtorId: string; lawyerId: string }
const EMPTY: Filters = { dateFrom: '', dateTo: '', debtorId: '', lawyerId: '' }

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

function IconMoney() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function IconExpense() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg> }
function IconFee() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg> }
function IconTask() { return <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }

export default function ReportsPage() {
  const branchId = useBranchId()
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)

  useEffect(() => {
    if (!branchId) {
      setSnapshot(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    fetchReportSnapshot(createClient(), branchId, applied).then(data => {
      if (!cancelled) {
        setSnapshot(data)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [branchId, applied])

  const achievements = snapshot?.achievements ?? []
  const lawyers = snapshot?.lawyers ?? []

  const achievementByType = useMemo(
    () => buildAchievementByType(achievements),
    [achievements],
  )

  const achievementByLawyer = useMemo(
    () => buildAchievementByLawyer(achievements, lawyers),
    [achievements, lawyers],
  )

  const summary = useMemo(() => {
    if (!snapshot) {
      return {
        totalPayments: 0,
        totalExpenses: 0,
        lawyerFees: 0,
        totalRequired: 0,
        achievementCount: 0,
        openCount: 0,
      }
    }
    const achievementFees = achievements.reduce((s, t) => s + achievementFee(t), 0)
    return {
      totalPayments: snapshot.totalPayments,
      totalExpenses: snapshot.totalExpenses,
      lawyerFees: achievementFees,
      totalRequired: snapshot.totalRequired,
      achievementCount: achievements.length,
      openCount: snapshot.openTaskCount,
    }
  }, [snapshot, achievements])

  const stageReports = useMemo(() => {
    if (!snapshot) {
      return {
        stageCounts: [] as ReportSnapshot['stageCounts'],
        closedCount: 0,
        avgTransitionDays: null as number | null,
        topTasks: [] as { label: string; count: number }[],
        totalActive: 0,
      }
    }
    return {
      stageCounts: snapshot.stageCounts,
      closedCount: snapshot.closedCount,
      avgTransitionDays: snapshot.avgTransitionDays,
      topTasks: snapshot.topTasks,
      totalActive: snapshot.totalActive,
    }
  }, [snapshot])

  function d(k: keyof Filters, v: string) { setDraft(prev => ({ ...prev, [k]: v })) }
  const hasApplied = Object.values(applied).some(Boolean)

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير" subtitle="تحليل شامل للأداء والمالية" />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-5">
        <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">معايير التقرير</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="md:col-span-1">
            <DateRangePicker
              dateFrom={draft.dateFrom}
              dateTo={draft.dateTo}
              onChange={({ dateFrom, dateTo }) => setDraft(prev => ({ ...prev, dateFrom, dateTo }))}
              fieldLabel="فترة التقرير"
              headerTitle="اختر فترة التقرير"
              placeholder="اختر فترة التقرير"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[#767676] mb-1">المدين (بحث)</label>
            <DebtorSearchPicker
              value={draft.debtorId}
              onChange={(id) => d('debtorId', id)}
              branchId={branchId}
              allowClear
              clearLabel="كل المدينين"
            />
          </div>
          <div>
            <PremiumSelect
              value={draft.lawyerId}
              onChange={v => d('lawyerId', v)}
              options={[
                { value: '', label: 'كل المحامين' },
                ...lawyers.map(x => ({ value: x.id, label: x.full_name })),
              ]}
              fieldLabel="المحامي"
              placeholder="كل المحامين"
              headerTitle="تصفية حسب المحامي"
              searchPlaceholder="بحث بالاسم..."
              searchable
            />
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
          <div>
            <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-3">ملخص المالي</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard label="إجمالي التسديدات" value={fmtMoney(summary.totalPayments)} icon={<IconMoney />} iconBg="bg-green-600" accent="green" />
              <StatCard label="إجمالي الصرفيات" value={fmtMoney(summary.totalExpenses)} icon={<IconExpense />} iconBg="bg-red-500" accent="red" />
              <StatCard label="أتعاب الإنجازات" value={fmtMoney(summary.lawyerFees)} icon={<IconFee />} accent="teal" />
              <StatCard label="إجمالي المطلوب" value={fmtMoney(summary.totalRequired)} icon={<IconMoney />} iconBg="bg-blue-600" accent="blue" />
              <StatCard label="إجمالي الإنجازات" value={fmtNum(summary.achievementCount)} icon={<IconTask />} iconBg="bg-green-600" accent="green" sub="مهام اعتمدها الأدمن" />
              <StatCard label="مهام قيد التنفيذ" value={fmtNum(summary.openCount)} icon={<IconTask />} iconBg="bg-[#767676]" />
            </div>
          </div>

          <div className={`rounded-xl p-5 border-2 ${summary.totalPayments - summary.totalExpenses >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <p className="text-sm font-medium text-[#767676] mb-1">الصافي (تسديدات − صرفيات)</p>
            <p className={`text-3xl font-black tabular-nums ${summary.totalPayments - summary.totalExpenses >= 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
              {fmtMoney(summary.totalPayments - summary.totalExpenses)}
            </p>
          </div>

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
                label="أكثر إنجاز تنفيذاً"
                value={achievementByType[0]?.count ?? 0}
                sub={achievementByType[0]?.label ?? '—'}
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
          </div>

          <div>
            <p className="text-xs font-bold text-[#767676] uppercase tracking-wider mb-1">تقرير الإنجازات</p>
            <p className="text-xs text-[#767676] mb-3">المهام التي سلّمها المحامي واعتمدها الأدمن — مرتبة من الأكثر إلى الأقل</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <StatCard label="إجمالي الإنجازات" value={fmtNum(achievements.length)} accent="teal" />
              <StatCard label="أتعاب الإنجازات" value={fmtMoney(summary.lawyerFees)} accent="green" />
              <StatCard
                label="أنواع الإنجازات"
                value={fmtNum(achievementByType.length)}
                sub="أنواع مهام مختلفة"
                accent="blue"
              />
            </div>

            {achievementByType.length > 0 ? (
              <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden mb-4">
                <p className="text-xs font-bold text-[#767676] uppercase tracking-wider px-5 pt-4 pb-2">الإنجازات حسب نوع المهمة</p>
                <Table>
                  <THead>
                    <tr>
                      <TH>#</TH>
                      <TH>نوع المهمة / الإنجاز</TH>
                      <TH>عدد الإنجازات</TH>
                      <TH>أتعاب محسوبة</TH>
                      <TH>النسبة</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {achievementByType.map((row, i) => {
                      const pct = achievements.length > 0 ? Math.round((row.count / achievements.length) * 100) : 0
                      return (
                        <TR key={row.key}>
                          <TD className="text-[#767676] font-mono text-xs w-8">{i + 1}</TD>
                          <TD className="font-semibold text-[#231F20]">{row.label}</TD>
                          <TD><span className="font-bold tabular-nums text-[#2C8780]">{fmtNum(row.count)}</span></TD>
                          <TD><span className="font-semibold tabular-nums" dir="ltr">{fmtMoney(row.fees)}</span></TD>
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
            ) : (
              <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-8 text-center mb-4">
                <p className="text-sm text-[#767676]">لا توجد إنجازات معتمدة ضمن الفترة المحددة</p>
              </div>
            )}

            {achievementByLawyer.length > 0 && (
              <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
                <p className="text-xs font-bold text-[#767676] uppercase tracking-wider px-5 pt-4 pb-2">الإنجازات حسب المحامي</p>
                <Table>
                  <THead>
                    <tr>
                      <TH>#</TH>
                      <TH>المحامي</TH>
                      <TH>المحافظة</TH>
                      <TH>عدد الإنجازات</TH>
                      <TH>أكثر إنجاز</TH>
                      <TH>أتعاب الإنجازات</TH>
                      <TH>آخر إنجاز</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {achievementByLawyer.map((l, i) => (
                      <TR key={l.id}>
                        <TD className="text-[#767676] font-mono text-xs w-8">{i + 1}</TD>
                        <TD className="font-semibold text-[#231F20]">{l.name}</TD>
                        <TD className="text-[#767676] text-xs">{l.governorate ?? '—'}</TD>
                        <TD><span className="font-bold tabular-nums text-[#2C8780]">{fmtNum(l.count)}</span></TD>
                        <TD className="text-xs">
                          <span className="font-semibold text-[#231F20]">{l.topLabel}</span>
                          <span className="text-[#767676]"> ({fmtNum(l.topCount)})</span>
                        </TD>
                        <TD><span className="font-semibold text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(l.fees)}</span></TD>
                        <TD><span className="text-xs text-[#767676] font-mono" dir="ltr">{fmtDate(l.lastDate)}</span></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
