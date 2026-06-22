import { createClient } from '@/lib/supabase/server'
import { TASK_FEE_MAP } from '@/lib/constants'
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskStatus, TaskType } from '@/lib/types'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { fmtMoney, fmtDate } from '@/lib/utils'

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  new: 'info',
  in_progress: 'warning',
  completed: 'success',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

export default async function LawyerDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: tasks }, { data: payments }] = await Promise.all([
    supabase.from('profiles').select('full_name, governorate, is_active, phone').eq('id', user.id).single(),
    supabase.from('tasks')
      .select('id, task_type, task_status, due_date, court_name, governorate, created_at, debtors(full_name)')
      .eq('assigned_to', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('debtor_payments').select('amount').eq('lawyer_id', user.id),
  ])

  const allTasks = tasks ?? []
  const feeBalance = allTasks.filter(t => t.task_status === 'completed').reduce((s, t) => s + (TASK_FEE_MAP[t.task_type as TaskType] ?? 0), 0)
  const totalCollections = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0)

  const counts = {
    new: allTasks.filter(t => t.task_status === 'new').length,
    in_progress: allTasks.filter(t => t.task_status === 'in_progress').length,
    completed: allTasks.filter(t => t.task_status === 'completed').length,
  }

  const today = new Date().toISOString().split('T')[0]
  const overdue = allTasks.filter(t => t.due_date && t.due_date < today && !['completed', 'closed', 'failed'].includes(t.task_status))
  const latestTasks = allTasks.slice(0, 6)

  return (
    <div className="max-w-lg mx-auto pb-20">

      {/* Welcome hero */}
      <div className="px-5 pt-7 pb-10 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #231F20 0%, #1a1617 100%)' }}>
        <div className="absolute -left-10 -top-10 w-48 h-48 rounded-full bg-white/[0.03]" />
        <div className="absolute right-0 bottom-0 w-32 h-32 rounded-full bg-[#2C8780]/10" />
        <div className="relative z-10">
          <p className="text-white/40 text-xs mb-1">مرحباً بك</p>
          <h1 className="text-2xl font-black text-white mb-2 leading-tight">{profile?.full_name ?? 'المحامي'}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {profile?.governorate && (
              <span className="flex items-center gap-1.5 text-white/50 text-xs">
                <svg className="w-3.5 h-3.5 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {profile.governorate}
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${profile?.is_active ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              {profile?.is_active ? 'نشط' : 'موقوف'}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4 -mt-4">
        {/* Overdue alert */}
        {overdue.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-700">مهام متأخرة</p>
              <p className="text-xs text-red-500">{overdue.length} مهمة تجاوزت تاريخ الاستحقاق</p>
            </div>
            <Link href="/lawyer/tasks?f=overdue" className="text-xs text-red-600 font-semibold border border-red-200 px-2 py-1 rounded-lg whitespace-nowrap">عرض</Link>
          </div>
        )}

        {/* Financial cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-[#2C8780]/25 shadow-sm p-4">
            <p className="text-[10px] font-bold text-[#767676] mb-2">رصيد الأتعاب</p>
            <p className="text-lg font-black text-[#2C8780] leading-tight tabular-nums" dir="ltr">{fmtMoney(feeBalance)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-4">
            <p className="text-[10px] font-bold text-[#767676] mb-2">مجموع التحصيلات</p>
            <p className="text-lg font-black text-emerald-700 leading-tight tabular-nums" dir="ltr">{fmtMoney(totalCollections)}</p>
          </div>
        </div>

        {/* Task count chips */}
        <div className="grid grid-cols-3 gap-2">
          <Link href="/lawyer/tasks?f=new">
            <div className="bg-white border border-blue-200 rounded-2xl p-3 text-center shadow-sm active:bg-blue-50 transition-colors">
              <p className="text-2xl font-black text-blue-700 tabular-nums">{counts.new}</p>
              <p className="text-[11px] font-semibold text-blue-600 mt-0.5">جديدة</p>
            </div>
          </Link>
          <Link href="/lawyer/tasks?f=in_progress">
            <div className="bg-white border border-[#2C8780]/25 rounded-2xl p-3 text-center shadow-sm active:bg-[#2C8780]/5 transition-colors">
              <p className="text-2xl font-black text-[#2C8780] tabular-nums">{counts.in_progress}</p>
              <p className="text-[11px] font-semibold text-[#2C8780] mt-0.5">قيد التنفيذ</p>
            </div>
          </Link>
          <Link href="/lawyer/tasks?f=completed">
            <div className="bg-white border border-emerald-200 rounded-2xl p-3 text-center shadow-sm active:bg-emerald-50 transition-colors">
              <p className="text-2xl font-black text-emerald-700 tabular-nums">{counts.completed}</p>
              <p className="text-[11px] font-semibold text-emerald-600 mt-0.5">منجزة</p>
            </div>
          </Link>
        </div>

        {/* Latest tasks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-[#231F20] text-sm">آخر المهام</h2>
            <Link href="/lawyer/tasks" className="text-xs text-[#2C8780] font-semibold hover:underline">عرض الكل ←</Link>
          </div>

          {latestTasks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] p-8 text-center shadow-sm">
              <div className="w-12 h-12 bg-[rgba(44,135,128,0.08)] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-[#2C8780]/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              </div>
              <p className="text-sm text-[#767676] font-medium">لا توجد مهام مسندة إليك بعد</p>
            </div>
          ) : (
            <div className="space-y-2">
              {latestTasks.map((task: any) => {
                const isOverdue = task.due_date && task.due_date < today && !['completed', 'closed', 'failed'].includes(task.task_status)
                return (
                  <Link key={task.id} href={`/lawyer/tasks/${task.id}`} className="block">
                    <div className={`bg-white rounded-2xl border shadow-sm p-4 active:bg-[rgba(44,135,128,0.03)] transition-colors ${isOverdue ? 'border-red-200' : 'border-[rgba(118,118,118,0.15)]'}`}>
                      <div className="flex items-start gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-[#231F20] text-sm truncate">{(task.debtors as any)?.full_name ?? '—'}</p>
                          <p className="text-xs text-[#767676] mt-0.5">{TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type}</p>
                        </div>
                        <Badge variant={STATUS_BADGE[task.task_status as TaskStatus] ?? 'default'}>
                          {TASK_STATUS_LABELS[task.task_status as TaskStatus]}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#767676]">
                        {task.court_name && <span>🏛 {task.court_name}</span>}
                        {task.due_date && (
                          <span className={isOverdue ? 'text-red-500 font-semibold' : ''} dir="ltr">
                            📅 {fmtDate(task.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <Link href="/lawyer/tasks" className="block w-full text-white text-sm font-bold py-4 rounded-2xl text-center transition-colors shadow-sm hover:opacity-90" style={{ background: 'linear-gradient(135deg, #231F20, #2d2829)' }}>
          عرض جميع المهام
        </Link>
      </div>
    </div>
  )
}