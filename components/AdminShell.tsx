'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { USER_ROLE_LABELS } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BranchProvider, useBranchId } from '@/context/branch'
import BranchSelector from '@/components/BranchSelector'
import {
  ADMIN_NOTIFICATIONS_REFRESH,
  fetchAdminNotificationCounts,
  pendingFinanceRequests,
  totalAdminNotifications,
  type AdminNotificationCounts,
} from '@/lib/admin-notifications'

interface AdminShellProps {
  userName: string
  userRole: string
  userBranchId?: string
  initialBranchId?: string | null
  initialBranchName?: string | null
  children: ReactNode
}

const sections = [
  {
    items: [
      { label: 'لوحة التحكم', href: '/admin/dashboard', exact: true, icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      )},
    ],
  },
  {
    label: 'العمليات',
    items: [
      { label: 'المدينون', href: '/admin/debtors', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
      )},
      { label: 'تكليف المهام', href: '/admin/tasks', exact: true, icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
      )},
      { label: 'مراجعة الإنجازات', href: '/admin/tasks/review', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      )},
      { label: 'المحامون', href: '/admin/lawyers', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
      )},
    ],
  },
  {
    label: 'المالية',
    items: [
      { label: 'التسديدات', href: '/admin/payments', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      )},
      { label: 'أتعاب المحامين', href: '/admin/finance', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
      )},
      { label: 'الصرفيات', href: '/admin/expenses', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
      )},
      { label: 'التقارير', href: '/admin/reports', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      )},
    ],
  },
  {
    label: 'النظام',
    items: [
      { label: 'إعدادات الفرع', href: '/admin/settings', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
      )},
      { label: 'سجل النشاط', href: '/admin/activity', icon: (
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      )},
    ],
  },
]

function isActive(href: string, pathname: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

function CountBadge({ count, active }: { count: number; active?: boolean }) {
  if (!count) return null
  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      className={cn(
        'mr-auto min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0',
        active ? 'bg-white text-[#2C8780]' : 'bg-red-500 text-white',
      )}
      aria-label={`${label} إشعار`}
    >
      {label}
    </span>
  )
}

function NavLink({ item, pathname, badge, onClick }: {
  item: { label: string; href: string; exact?: boolean; icon: ReactNode }
  pathname: string
  badge?: number
  onClick?: () => void
}) {
  const active = isActive(item.href, pathname, item.exact)
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
        active ? 'text-white shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/5'
      )}
      style={active ? { background: 'linear-gradient(135deg, #2C8780, #1D6365)' } : undefined}
    >
      <span className={active ? 'text-white' : 'text-white/50'}>{item.icon}</span>
      <span className="flex-1 min-w-0">{item.label}</span>
      <CountBadge count={badge ?? 0} active={active} />
    </Link>
  )
}

function HeaderNotifications({
  counts,
  open,
  onToggle,
  onClose,
}: {
  counts: AdminNotificationCounts
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const total = totalAdminNotifications(counts)
  if (!total) return null

  const financePending = pendingFinanceRequests(counts)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="relative w-9 h-9 flex items-center justify-center text-[#767676] hover:text-[#231F20] hover:bg-[rgba(118,118,118,0.08)] rounded-lg transition-colors"
        aria-label={`${total} إشعارات`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
          {total > 99 ? '99+' : total}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
          <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-lg z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-[rgba(118,118,118,0.1)]">
              <p className="text-sm font-bold text-[#231F20]">الإشعارات</p>
              <p className="text-[11px] text-[#767676] mt-0.5">{total} بانتظار الإجراء</p>
            </div>
            <div className="py-1">
              {counts.pendingReview > 0 && (
                <Link
                  href="/admin/tasks/review"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#F8F7F8] transition-colors"
                >
                  <span className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#231F20]">مراجعة الإنجازات</p>
                    <p className="text-[11px] text-[#767676]">مهام بانتظار الاعتماد</p>
                  </div>
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {counts.pendingReview}
                  </span>
                </Link>
              )}
              {financePending > 0 && (
                <Link
                  href="/admin/finance"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#F8F7F8] transition-colors"
                >
                  <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#231F20]">أتعاب المحامين</p>
                    <p className="text-[11px] text-[#767676]">
                      {counts.pendingPayoutRequests > 0 && counts.pendingTaskFeeReceipts > 0
                        ? 'طلبات صرف + أتعاب مهام'
                        : counts.pendingPayoutRequests > 0
                          ? 'طلبات صرف بانتظار الموافقة'
                          : 'أتعاب مهام بانتظار الاعتماد'}
                    </p>
                  </div>
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {financePending}
                  </span>
                </Link>
              )}
              {counts.pendingExpenses > 0 && (
                <Link
                  href="/admin/expenses?status=pending_approval"
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#F8F7F8] transition-colors"
                >
                  <span className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#231F20]">الصرفيات</p>
                    <p className="text-[11px] text-[#767676]">صرفيات بانتظار الاعتماد</p>
                  </div>
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {counts.pendingExpenses}
                  </span>
                </Link>
              )}
              {counts.pendingExpensesByType.map(item => (
                <Link
                  key={item.type}
                  href={`/admin/expenses?status=pending_approval&type=${encodeURIComponent(item.type)}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-2.5 pr-8 hover:bg-[#F8F7F8] transition-colors border-t border-[rgba(118,118,118,0.06)]"
                >
                  <span className="w-6 h-6 rounded-md bg-orange-50 text-orange-600 flex items-center justify-center shrink-0 text-[10px] font-black">
                    •
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#231F20] truncate">{item.type}</p>
                  </div>
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {item.count}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function useAdminNotifications(branchId: string | null, pathname: string) {
  const [counts, setCounts] = useState<AdminNotificationCounts>({
    pendingReview: 0,
    pendingPayoutRequests: 0,
    pendingTaskFeeReceipts: 0,
    pendingExpenses: 0,
    pendingExpensesByType: [],
  })

  const load = useCallback(async () => {
    if (!branchId) {
      setCounts({
        pendingReview: 0,
        pendingPayoutRequests: 0,
        pendingTaskFeeReceipts: 0,
        pendingExpenses: 0,
        pendingExpensesByType: [],
      })
      return
    }
    const next = await fetchAdminNotificationCounts()
    setCounts(next)
  }, [branchId])

  useEffect(() => { load() }, [load, pathname])

  useEffect(() => {
    const onRefresh = () => { load() }
    window.addEventListener(ADMIN_NOTIFICATIONS_REFRESH, onRefresh)
    window.addEventListener('focus', onRefresh)
    const timer = setInterval(load, 45000)
    return () => {
      window.removeEventListener(ADMIN_NOTIFICATIONS_REFRESH, onRefresh)
      window.removeEventListener('focus', onRefresh)
      clearInterval(timer)
    }
  }, [load])

  return counts
}

function badgeForHref(href: string, counts: AdminNotificationCounts): number {
  if (href === '/admin/tasks/review') return counts.pendingReview
  if (href === '/admin/finance') return pendingFinanceRequests(counts)
  if (href === '/admin/expenses') return counts.pendingExpenses
  return 0
}

function getArabicDate() {
  return new Date().toLocaleDateString('ar-IQ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export default function AdminShell(props: AdminShellProps) {
  return (
    <BranchProvider
      initialBranchId={props.initialBranchId ?? null}
      initialBranchName={props.initialBranchName ?? null}
    >
      <AdminShellInner {...props} />
    </BranchProvider>
  )
}

function AdminShellInner({
  userName,
  userRole,
  userBranchId,
  initialBranchId,
  initialBranchName,
  children,
}: AdminShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const branchId = useBranchId()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [arabicDate, setArabicDate] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const counts = useAdminNotifications(branchId, pathname)

  useEffect(() => { setArabicDate(getArabicDate()) }, [])
  useEffect(() => { setDrawerOpen(false); setNotifOpen(false) }, [pathname])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = userName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('') || 'م'

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.07]">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        </div>
        <div>
          <p className="font-bold text-white text-sm leading-none">قلعة الضمان</p>
          <p className="text-white/30 text-[10px] mt-0.5">النظام القانوني الإداري</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-none">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-4' : ''}>
            {section.label && (
              <>
                <div className="border-t border-white/[0.05] mb-3" />
                <p className="text-white/20 text-[9px] font-bold uppercase tracking-[0.2em] px-3 mb-1.5">{section.label}</p>
              </>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  badge={badgeForHref(item.href, counts)}
                  onClick={() => setDrawerOpen(false)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-3 px-2 py-1.5 mb-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-semibold truncate leading-none">{userName}</p>
            <p className="text-white/30 text-[10px] mt-0.5 truncate">{USER_ROLE_LABELS[userRole as UserRole] ?? userRole}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/35 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
          {loggingOut ? 'جارٍ الخروج...' : 'تسجيل الخروج'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="h-screen overflow-hidden" dir="rtl">
        {/* Desktop sidebar — fixed full height, does not scroll with content */}
        <aside className="hidden lg:flex fixed top-0 right-0 bottom-0 w-60 z-30 bg-[#231F20] flex-col">
          {SidebarContent}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
        )}

        <aside className={cn(
          'fixed top-0 right-0 h-full w-64 bg-[#231F20] z-50 lg:hidden transition-transform duration-300 flex flex-col',
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        )}>
          <button onClick={() => setDrawerOpen(false)} className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          {SidebarContent}
        </aside>

        {/* Main column — scrolls independently */}
        <div className="h-screen overflow-y-auto flex flex-col lg:mr-60 min-w-0">
          <header className="sticky top-0 z-20 bg-white border-b border-[rgba(118,118,118,0.1)] h-14 flex items-center px-4 lg:px-6 gap-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
            <button onClick={() => setDrawerOpen(true)} className="lg:hidden w-9 h-9 flex items-center justify-center text-[#767676] hover:text-[#231F20] hover:bg-[rgba(118,118,118,0.08)] rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>

            <div className="flex lg:hidden items-center gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
              </div>
              <span className="font-bold text-sm text-[#231F20]">قلعة الضمان</span>
            </div>

            <div className="hidden lg:flex items-center gap-2 text-xs text-[#767676]">
              <svg className="w-3.5 h-3.5 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>{arabicDate}</span>
            </div>

            {/* ── Premium Branch Selector ── */}
            <div className="hidden sm:block">
              <BranchSelector
                userRole={userRole}
                userBranchId={userBranchId}
                initialBranchId={initialBranchId ?? undefined}
                initialBranchName={initialBranchName ?? undefined}
              />
            </div>

            <div className="flex items-center gap-2 mr-auto">
              <HeaderNotifications
                counts={counts}
                open={notifOpen}
                onToggle={() => setNotifOpen(v => !v)}
                onClose={() => setNotifOpen(false)}
              />
              <div className="hidden sm:flex flex-col items-end">
                <p className="text-xs font-semibold text-[#231F20] leading-none">{userName}</p>
                <p className="text-[10px] text-[#767676] mt-0.5">{USER_ROLE_LABELS[userRole as UserRole] ?? userRole}</p>
              </div>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
                {initials}
              </div>
            </div>
          </header>

          <main className="flex-1 p-4 lg:p-6 min-w-0 bg-[#F8F7F8]">
            {children}
          </main>
        </div>
    </div>
  )
}
