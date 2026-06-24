'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fetchLawyerWalletBalance } from '@/lib/task-approval'
import { fmtMoney } from '@/lib/utils'

function InfoRow({ label, value, dir }: { label: string; value?: string | null; dir?: 'ltr' }) {
  if (!value) return null
  return (
    <div className="flex justify-between items-center gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-400 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-slate-800 truncate" dir={dir}>{value}</span>
    </div>
  )
}

export default function LawyerProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [stats, setStats] = useState({ completed: 0, total: 0, feeBalance: 0, collections: 0, attachmentCount: 0 })
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const [{ data: p }, { count }, { data: tasks }, { data: payments }, walletBalance] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('lawyer_attachments').select('*', { count: 'exact', head: true }).eq('lawyer_id', user.id),
        supabase.from('tasks').select('task_type, task_status').eq('assigned_to', user.id),
        supabase.from('debtor_payments').select('amount').eq('lawyer_id', user.id),
        fetchLawyerWalletBalance(supabase, user.id),
      ])
      setProfile(p)
      const allTasks = tasks ?? []
      const completed = allTasks.filter(t => t.task_status === 'approved' || t.task_status === 'completed')
      setStats({
        completed: completed.length,
        total: allTasks.length,
        feeBalance: walletBalance,
        collections: (payments ?? []).reduce((s, pay) => s + Number(pay.amount), 0),
        attachmentCount: count ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [router])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="w-10 h-10 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">جارٍ التحميل...</p>
    </div>
  )

  if (!profile) return null

  const initials = profile.full_name?.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') ?? 'م'

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-24 space-y-4">

      {/* Profile hero */}
      <div className="bg-[#231F20] rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-white/[0.03] pointer-events-none" />
        <div className="absolute -right-4 bottom-0 w-24 h-24 rounded-full bg-[#2C8780]/[0.08] pointer-events-none" />
        <div className="relative">
          <div className="w-16 h-16 bg-[#2C8780] rounded-full flex items-center justify-center text-white text-2xl font-black mx-auto mb-3">
            {initials}
          </div>
          <h2 className="text-xl font-black text-center">{profile.full_name}</h2>
          {profile.governorate && (
            <p className="text-slate-400 text-sm mt-1 flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-[#2C8780] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              {profile.governorate}
            </p>
          )}
          <div className="mt-3 flex justify-center">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${profile.is_active ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              {profile.is_active ? 'حساب نشط' : 'حساب موقوف'}
            </span>
          </div>
        </div>
      </div>

      {/* Performance stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">المهام المنجزة</p>
          <p className="text-2xl font-black text-[#231F20] tabular-nums">{stats.completed}</p>
          <p className="text-xs text-slate-400 mt-0.5">من {stats.total} مهمة إجمالاً</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#2C8780]/30 shadow-sm p-4">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">رصيد الأتعاب</p>
          <p className="text-lg font-black text-[#2C8780] tabular-nums leading-tight">{fmtMoney(stats.feeBalance)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-4">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">مجموع التحصيلات</p>
          <p className="text-lg font-black text-green-700 tabular-nums leading-tight">{fmtMoney(stats.collections)}</p>
        </div>
        {stats.attachmentCount > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <p className="text-[10px] font-semibold text-slate-400 mb-1">المستمسكات</p>
            <p className="text-2xl font-black text-slate-800 tabular-nums">{stats.attachmentCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">ملف مرفوع</p>
          </div>
        )}
      </div>

      {/* Contact info */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4">
        <div className="pt-4 pb-2 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-400">بيانات التواصل</p>
        </div>
        <InfoRow label="الاسم الكامل" value={profile.full_name} />
        <InfoRow label="رقم الهاتف" value={profile.phone} dir="ltr" />
        <InfoRow label="المحافظة" value={profile.governorate} />
      </div>

      {/* Identity info */}
      {(profile.identity_type || profile.identity_number || profile.identity_category) && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4">
          <div className="pt-4 pb-2 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-400">بيانات الهوية</p>
          </div>
          <InfoRow label="نوع الهوية" value={profile.identity_type} />
          <InfoRow label="رقم الهوية / الإجازة" value={profile.identity_number} dir="ltr" />
          <InfoRow label="فئة الهوية" value={profile.identity_category} />
        </div>
      )}

      {/* Logout */}
      <button onClick={handleLogout} disabled={loggingOut}
        className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 hover:bg-red-50 active:bg-red-100 disabled:opacity-60 font-bold py-3.5 rounded-2xl transition-colors text-sm">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        {loggingOut ? 'جارٍ الخروج...' : 'تسجيل الخروج'}
      </button>
    </div>
  )
}