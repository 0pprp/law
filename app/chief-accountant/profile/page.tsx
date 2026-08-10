'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ChiefAccountantProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<{ full_name?: string; phone?: string | null; username?: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('full_name, phone, username')
        .eq('id', user.id)
        .single()
      setProfile(data)
      setLoading(false)
    })()
  }, [router])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-10 h-10 border-2 border-[#0369a1]/30 border-t-[#0369a1] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-4 pb-10">
      <h1 className="text-xl font-black text-[#231F20]">حسابي</h1>
      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm px-4 py-2">
        <div className="flex justify-between py-3 border-b border-slate-100">
          <span className="text-sm text-slate-400">الاسم</span>
          <span className="text-sm font-semibold text-slate-800">{profile?.full_name ?? '—'}</span>
        </div>
        {profile?.username && (
          <div className="flex justify-between py-3 border-b border-slate-100">
            <span className="text-sm text-slate-400">اسم المستخدم</span>
            <span className="text-sm font-semibold text-slate-800" dir="ltr">{profile.username}</span>
          </div>
        )}
        {profile?.phone && (
          <div className="flex justify-between py-3">
            <span className="text-sm text-slate-400">الهاتف</span>
            <span className="text-sm font-semibold text-slate-800" dir="ltr">{profile.phone}</span>
          </div>
        )}
      </div>
      <p className="text-xs text-[#767676] px-1">الدور: محاسب رئيسي — تجهيز الملفات</p>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loggingOut}
        className="w-full py-3 rounded-2xl text-sm font-bold text-red-700 bg-red-50 border border-red-100 disabled:opacity-50"
      >
        {loggingOut ? 'جارٍ الخروج...' : 'تسجيل الخروج'}
      </button>
    </div>
  )
}
