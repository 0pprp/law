import { createClient } from '@/lib/supabase/server'
import {
  fetchLawyerAssignedTasks,
  fetchLawyerTaskStatusCounts,
} from '@/lib/task-assignment'
import { fetchDelegateWallet } from '@/lib/delegate-wallet'
import { resolveTaskLabel } from '@/lib/task-display-label'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { isTaskOverdue } from '@/lib/local-date'
import { lawyerTaskStatusLabel, isLawyerAchievedTask } from '@/lib/lawyer-task-display'
import type { TaskStatus } from '@/lib/types'

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
}

function StatCard({ href, count, label }: { href: string; count: number; label: string }) {
  return (
    <Link href={href} className="block group">
      <div className="bg-white rounded-3xl p-4 text-center shadow-sm ring-1 ring-[#2C8780]/15 transition-all active:scale-[0.98] group-hover:shadow-md">
        <p className="text-2xl font-black tabular-nums leading-none text-[#2C8780]">{count}</p>
        <p className="text-[11px] font-bold mt-2 text-[#2C8780]/90">{label}</p>
      </div>
    </Link>
  )
}

export default async function DelegateDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, tasksRes, wallet, counts] = await Promise.all([
    supabase.from('profiles').select('full_name, governorate, is_active, phone').eq('id', user.id).single(),
    fetchLawyerAssignedTasks(supabase, user.id, { limit: 50 }),
    fetchDelegateWallet(supabase, user.id),
    fetchLawyerTaskStatusCounts(supabase, user.id),
  ])

  const allTasks = tasksRes.tasks
  const latestTasks = allTasks.slice(0, 6)
  const overdue = allTasks.filter(
    t => t.due_date && isTaskOverdue(t.due_date) && !['completed', 'closed', 'failed', 'approved'].includes(t.task_status),
  )

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
        <div className="relative z-10 flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black shrink-0"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-white/45 text-[11px] font-semibold mb-1">مرحباً بك</p>
            <h1 className="text-xl font-black text-white leading-snug truncate">{profile?.full_name ?? 'المندوب'}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {profile?.governorate && (
                <span className="text-white/55 text-[11px]">{profile.governorate}</span>
              )}
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${profile?.is_active ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-red-500/15 text-red-300 border-red-500/25'}`}>
                {profile?.is_active ? 'نشط' : 'موقوف'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <Link href="/delegate/profile" className="block">
        <div className="bg-white rounded-3xl border border-[rgba(118,118,118,0.12)] p-4 grid grid-cols-3 gap-3 shadow-sm active:scale-[0.99] transition-transform">
          <div className="text-center">
            <p className="text-[10px] text-[#767676] font-bold mb-1">معلق</p>
            <p className="text-sm font-black tabular-nums text-amber-700" dir="ltr">{fmtMoney(wallet.pending_balance)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[#767676] font-bold mb-1">قابل للصرف</p>
            <p className="text-sm font-black tabular-nums text-[#2C8780]" dir="ltr">{fmtMoney(wallet.available_balance)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[#767676] font-bold mb-1">مصروف</p>
            <p className="text-sm font-black tabular-nums text-[#767676]" dir="ltr">{fmtMoney(wallet.total_withdrawn)}</p>
          </div>
        </div>
      </Link>

      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-3xl p-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-bold text-red-700">مهام متأخرة</p>
            <p className="text-xs text-red-500 mt-0.5">{overdue.length} مهمة</p>
          </div>
          <Link href="/delegate/tasks?f=in_progress" className="text-xs text-red-600 font-bold bg-white border border-red-200 px-3 py-1.5 rounded-xl">
            عرض
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <StatCard href="/delegate/tasks?f=assignment_pending_acceptance" count={counts.assignment_pending_acceptance} label="طلبات تكليف" />
        <StatCard href="/delegate/tasks?f=assigned" count={counts.assigned} label="مكلفة" />
        <StatCard href="/delegate/tasks?f=in_progress" count={counts.in_progress} label="قيد التنفيذ" />
        <StatCard href="/delegate/tasks?f=submitted" count={counts.submitted} label="بانتظار الاعتماد" />
        <StatCard href="/delegate/tasks?f=completed" count={counts.completed} label="منجزة" />
        <StatCard href="/delegate/tasks?f=rejected" count={counts.rejected} label="مرفوضة" />
      </div>

      <section className="bg-white rounded-3xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-black text-[#231F20] text-sm">آخر المهام</h2>
          <Link href="/delegate/tasks" className="text-xs text-[#2C8780] font-bold hover:underline">عرض الكل ←</Link>
        </div>
        {latestTasks.length === 0 ? (
          <div className="px-5 pb-8 pt-2 text-center">
            <p className="text-sm text-[#767676] font-medium">لا توجد مهام مسندة إليك بعد</p>
          </div>
        ) : (
          <div className="px-3 pb-3 space-y-2">
            {latestTasks.map((task: any) => (
              <Link key={task.id} href={`/delegate/tasks/${task.id}`} className="block">
                <div className="rounded-2xl border border-[rgba(118,118,118,0.1)] bg-[#F3F1F2]/50 p-4">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#231F20] text-sm truncate">{task.debtors?.full_name ?? '—'}</p>
                      <p className="text-xs text-[#767676] mt-0.5">{resolveTaskLabel(task.task_type, task.task_label)}</p>
                    </div>
                    <Badge variant={isLawyerAchievedTask(task.task_status) ? 'success' : (STATUS_BADGE[task.task_status as TaskStatus] ?? 'default')}>
                      {lawyerTaskStatusLabel(task.task_status, task, user.id)}
                    </Badge>
                  </div>
                  {task.due_date && (
                    <p className="text-[11px] text-[#767676]" dir="ltr">📅 {fmtDate(task.due_date)}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
