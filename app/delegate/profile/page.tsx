'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

const TX_LABELS: Record<string, string> = {
  delegate_address_fee_pending: 'أتعاب معلقة — إيجاد عنوان',
  delegate_fee_released: 'تحرير الأتعاب (قابلة للصرف)',
  delegate_fee_rehold: 'إعادة تعليق الأتعاب',
  delegate_wallet_withdrawal: 'صرف من المحفظة',
}

function InfoRow({ label, value, dir }: { label: string; value?: string | null; dir?: 'ltr' }) {
  if (!value) return null
  return (
    <div className="flex justify-between items-center gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-400 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-slate-800 truncate" dir={dir}>{value}</span>
    </div>
  )
}

export default function DelegateProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<{
    full_name?: string | null
    phone?: string | null
    governorate?: string | null
    is_active?: boolean | null
  } | null>(null)
  const [stats, setStats] = useState({ completed: 0, total: 0 })
  const [balances, setBalances] = useState({
    pending_balance: 0,
    available_balance: 0,
    total_withdrawn: 0,
  })
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const walletRes = await fetch('/api/delegate/wallet').then(r => r.json()).catch(() => null)

    const [{ data: p }, { data: tasks }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('tasks').select('task_status').eq('assigned_to', user.id),
    ])

    setProfile(p)
    if (walletRes?.balances) {
      setBalances(walletRes.balances)
      setTransactions(walletRes.transactions ?? [])
    }
    const allTasks = tasks ?? []
    const completed = allTasks.filter(
      t => t.task_status === 'approved' || t.task_status === 'completed',
    )
    setStats({ completed: completed.length, total: allTasks.length })
    setLoading(false)
  }

  useEffect(() => { void load() }, [router])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-10 h-10 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">جارٍ التحميل...</p>
      </div>
    )
  }

  if (!profile) return null

  const initials = profile.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('') ?? 'م'

  return (
    <div className="max-w-lg mx-auto px-0 sm:px-2 pt-2 pb-24 space-y-4">
      <div className="bg-[#231F20] rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-white/[0.03] pointer-events-none" />
        <div className="absolute -right-4 bottom-0 w-24 h-24 rounded-full bg-[#2C8780]/[0.08] pointer-events-none" />
        <div className="relative">
          <div className="w-16 h-16 bg-[#2C8780] rounded-full flex items-center justify-center text-white text-2xl font-black mx-auto mb-3">
            {initials}
          </div>
          <h2 className="text-xl font-black text-center">{profile.full_name}</h2>
          {profile.governorate && (
            <p className="text-slate-400 text-sm mt-1 text-center">{profile.governorate}</p>
          )}
          <div className="mt-3 flex justify-center">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${profile.is_active ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              {profile.is_active ? 'حساب نشط' : 'حساب موقوف'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">المهام المنجزة</p>
          <p className="text-2xl font-black text-[#231F20] tabular-nums">{stats.completed}</p>
          <p className="text-xs text-slate-400 mt-0.5">من {stats.total} مهمة إجمالاً</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-amber-200 rounded-xl px-3 py-2.5 shadow-sm text-center">
            <p className="text-[10px] text-slate-400 font-medium mb-0.5">معلق</p>
            <p className="font-black text-sm tabular-nums text-amber-700" dir="ltr">
              {fmtMoney(balances.pending_balance)}
            </p>
          </div>
          <div className="bg-white border border-[#2C8780]/30 rounded-xl px-3 py-2.5 shadow-sm text-center">
            <p className="text-[10px] text-slate-400 font-medium mb-0.5">قابل للصرف</p>
            <p className="font-black text-sm tabular-nums text-[#2C8780]" dir="ltr">
              {fmtMoney(balances.available_balance)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm text-center">
            <p className="text-[10px] text-slate-400 font-medium mb-0.5">مصروف</p>
            <p className="font-black text-sm tabular-nums text-slate-600" dir="ltr">
              {fmtMoney(balances.total_withdrawn)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4">
        <div className="pt-4 pb-2 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-400">بيانات التواصل</p>
        </div>
        <InfoRow label="الاسم الكامل" value={profile.full_name} />
        <InfoRow label="رقم الهاتف" value={profile.phone} dir="ltr" />
        <InfoRow label="المحافظة" value={profile.governorate} />
      </div>

      <DelegateWalletHistory transactions={transactions} />

      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 hover:bg-red-50 active:bg-red-100 disabled:opacity-60 font-bold py-3.5 rounded-2xl transition-colors text-sm"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        {loggingOut ? 'جارٍ الخروج...' : 'تسجيل الخروج'}
      </button>
    </div>
  )
}

function DelegateWalletHistory({ transactions }: { transactions: any[] }) {
  const { visibleItems, expanded, toggle, hasMore, total } = useShowMore(transactions, LOG_PREVIEW_LIMIT)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 border-b border-slate-100">
        <p className="text-xs font-bold text-slate-400">محفظتي — سجل الحركات</p>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">لا توجد حركات بعد</p>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {visibleItems.map(tx => {
              const amt = Number(tx.amount)
              const isOut = tx.type === 'delegate_wallet_withdrawal' || tx.type === 'delegate_fee_rehold'
              return (
                <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isOut ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      {isOut ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      )}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-black tabular-nums ${isOut ? 'text-red-600' : 'text-emerald-700'}`} dir="ltr">
                      {isOut ? '-' : '+'}{fmtMoney(Math.abs(amt))}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {tx.notes || TX_LABELS[tx.type] || tx.type}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0" dir="ltr">
                    {fmtDate(tx.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
          <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={total} />
        </>
      )}
    </div>
  )
}
