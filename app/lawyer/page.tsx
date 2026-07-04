import { createClient } from '@/lib/supabase/server'
import type { TaskStatus } from '@/lib/types'
import {
  fetchLawyerAssignedTasks,
  fetchLawyerTaskStatusCounts,
} from '@/lib/task-assignment'
import { fetchLawyerWalletBalances } from '@/lib/lawyer-wallet'
import { resolveTaskLabel } from '@/lib/task-display-label'
import LawyerWalletSummary from '@/components/LawyerWalletSummary'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { isTaskOverdue } from '@/lib/local-date'
import { lawyerTaskStatusLabel, isLawyerAchievedTask } from '@/lib/lawyer-task-display'

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  new: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

function StatCard({
  href,
  count,
  label,
  accent,
}: {
  href: string
  count: number
  label: string
  accent: 'blue' | 'teal' | 'emerald' | 'purple' | 'amber' | 'red'
}) {
  const styles = {
    blue: { ring: 'ring-blue-100', num: 'text-blue-700', lbl: 'text-blue-600/90', bg: 'bg-blue-50/80' },
    teal: { ring: 'ring-[#2C8780]/15', num: 'text-[#2C8780]', lbl: 'text-[#2C8780]/90', bg: 'bg-[#2C8780]/5' },
    emerald: { ring: 'ring-emerald-100', num: 'text-emerald-700', lbl: 'text-emerald-600/90', bg: 'bg-emerald-50/80' },
    purple: { ring: 'ring-purple-100', num: 'text-purple-700', lbl: 'text-purple-600/90', bg: 'bg-purple-50/80' },
    amber: { ring: 'ring-amber-100', num: 'text-amber-700', lbl: 'text-amber-600/90', bg: 'bg-amber-50/80' },
    red: { ring: 'ring-red-100', num: 'text-red-700', lbl: 'text-red-600/90', bg: 'bg-red-50/80' },
  }[accent]

  return (
    <Link href={href} className="block group">
      <div
        className={`${styles.bg} bg-white rounded-3xl p-4 text-center shadow-sm ring-1 ${styles.ring} transition-all active:scale-[0.98] group-hover:shadow-md`}
      >
        <p className={`text-2xl sm:text-3xl font-black tabular-nums leading-none ${styles.num}`}>{count}</p>
        <p className={`text-[11px] font-bold mt-2 leading-snug ${styles.lbl}`}>{label}</p>
      </div>
    </Link>
  )
}

export default async function LawyerDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, lawyerTasksRes, walletBalances, counts] = await Promise.all([
    supabase.from('profiles').select('full_name, governorate, is_active, phone').eq('id', user.id).single(),
    fetchLawyerAssignedTasks(supabase, user.id, { limit: 50 }),
    fetchLawyerWalletBalances(supabase, user.id),
    fetchLawyerTaskStatusCounts(supabase, user.id),
  ])

  const allTasks = lawyerTasksRes.tasks
  const overdue = allTasks.filter(
    t => t.due_date && isTaskOverdue(t.due_date) && !['completed', 'closed', 'failed', 'approved'].includes(t.task_status),
  )
  const latestTasks = allTasks.slice(0, 6)

  const initials = profile?.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('') ?? 'م'

  return (
    <div className="max-w-lg mx-auto px-0 sm:px-2 pt-2 pb-24 space-y-5">

      <div
        className="rounded-3xl p-5 relative overflow-hidden shadow-lg shadow-black/10"
        style={{ background: 'linear-gradient(145deg, #231F20 0%, #1a1617 55%, #1D6365 100%)' }}
      >
        <div className="absolute -left-12 -top-12 w-40 h-40 rounded-full bg-white/[0.04]" />
        <div className="absolute -right-6 -bottom-8 w-28 h-28 rounded-full bg-[#2C8780]/20 blur-2xl" />
        <div className="relative z-10 flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black shrink-0 shadow-inner" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-white/45 text-[11px] font-semibold tracking-wide mb-1">مرحباً بك</p>
            <h1 className="text-xl font-black text-white leading-snug truncate">{profile?.full_name ?? 'المحامي'}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {profile?.governorate && (
                <span className="flex items-center gap-1 text-white/55 text-[11px]">
                  <svg className="w-3.5 h-3.5 text-[#2C8780] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {profile.governorate}
                </span>
              )}
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${profile?.is_active ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-red-500/15 text-red-300 border-red-500/25'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {profile?.is_active ? 'نشط' : 'موقوف'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-3xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700">مهام متأخرة</p>
            <p className="text-xs text-red-500 mt-0.5">{overdue.length} مهمة تجاوزت تاريخ الاستحقاق</p>
          </div>
          <Link href="/lawyer/tasks?f=in_progress" className="text-xs text-red-600 font-bold bg-white border border-red-200 px-3 py-1.5 rounded-xl whitespace-nowrap">عرض</Link>
        </div>
      )}

      {counts.assignment_pending_acceptance > 0 && (
        <Link href="/lawyer/tasks?f=assignment_pending_acceptance" className="block">
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 flex items-center gap-3 shadow-sm active:scale-[0.99] transition-transform">
            <div className="w-11 h-11 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0 text-lg">📋</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-amber-900">طلبات تكليف بانتظار ردك</p>
              <p className="text-xs text-amber-700 mt-0.5">{counts.assignment_pending_acceptance} مهمة — اقبل أو ارفض</p>
            </div>
            <span className="text-amber-900 font-black text-2xl tabular-nums">{counts.assignment_pending_acceptance}</span>
          </div>
        </Link>
      )}

      <LawyerWalletSummary
        feeBalance={walletBalances.fees}
        savingsBalance={walletBalances.savings}
      />

      <div>
        <p className="text-xs font-bold text-[#767676] mb-2 px-1">ملخص المهام</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatCard href="/lawyer/tasks?f=assignment_pending_acceptance" count={counts.assignment_pending_acceptance} label="طلبات تكليف" accent="amber" />
          <StatCard href="/lawyer/tasks?f=assigned" count={counts.assigned} label="مكلفة" accent="blue" />
          <StatCard href="/lawyer/tasks?f=in_progress" count={counts.in_progress} label="قيد التنفيذ" accent="teal" />
          <StatCard href="/lawyer/tasks?f=submitted" count={counts.submitted} label="بانتظار الاعتماد" accent="purple" />
          <StatCard href="/lawyer/tasks?f=completed" count={counts.completed} label="منجزة" accent="emerald" />
          <StatCard href="/lawyer/tasks?f=rejected" count={counts.rejected} label="مرفوضة" accent="red" />
        </div>
      </div>

      <section className="bg-white rounded-3xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-black text-[#231F20] text-sm">آخر المهام</h2>
          <Link href="/lawyer/tasks" className="text-xs text-[#2C8780] font-bold hover:underline">عرض الكل ←</Link>
        </div>

        {latestTasks.length === 0 ? (
          <div className="px-5 pb-8 pt-2 text-center">
            <div className="w-14 h-14 bg-[#2C8780]/8 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-[#2C8780]/35" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm text-[#767676] font-medium">لا توجد مهام مسندة إليك بعد</p>
          </div>
        ) : (
          <div className="px-3 pb-3 space-y-2">
            {latestTasks.map((task: any) => {
              const isOverdue = task.due_date && isTaskOverdue(task.due_date) && !['completed', 'closed', 'failed', 'approved'].includes(task.task_status)
              const fee = Number(task.reward_amount ?? 0)
              return (
                <Link key={task.id} href={`/lawyer/tasks/${task.id}`} className="block">
                  <div className={`rounded-2xl border p-4 transition-colors active:bg-[#2C8780]/[0.03] ${isOverdue ? 'border-red-200 bg-red-50/40' : 'border-[rgba(118,118,118,0.1)] bg-[#F3F1F2]/50'}`}>
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#231F20] text-sm truncate">{task.debtors?.full_name ?? '—'}</p>
                        <p className="text-xs text-[#767676] mt-0.5">{resolveTaskLabel(task.task_type, task.task_label)}</p>
                      </div>
                      <Badge variant={isLawyerAchievedTask(task.task_status) ? 'success' : (STATUS_BADGE[task.task_status as TaskStatus] ?? 'default')}>
                        {lawyerTaskStatusLabel(task.task_status)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#767676]">
                      {task.court_name && <span>🏛 {task.court_name}</span>}
                      {task.due_date && (
                        <span className={isOverdue ? 'text-red-500 font-semibold' : ''} dir="ltr">
                          📅 {fmtDate(task.due_date)}
                        </span>
                      )}
                      {fee > 0 && (
                        <span className="text-[#2C8780] font-bold tabular-nums" dir="ltr">
                          أتعاب: {fmtMoney(fee)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        <div className="px-4 pb-4 pt-1">
          <Link
            href="/lawyer/tasks"
            className="block w-full text-white text-sm font-bold py-3.5 rounded-2xl text-center transition-all shadow-md active:scale-[0.99] hover:opacity-95"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            عرض جميع المهام ({counts.all})
          </Link>
        </div>
      </section>
    </div>
  )
}
