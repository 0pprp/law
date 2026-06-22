'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!email.trim()) { setError('يرجى إدخال البريد الإلكتروني'); return }
    if (!password) { setError('يرجى إدخال كلمة المرور'); return }

    setLoading(true)
    setError('')

    try {
      const supabase = createClient()

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        setError('البريد الإلكتروني أو كلمة المرور غير صحيحة')
        setLoading(false)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('حدث خطأ أثناء تسجيل الدخول'); setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single()

      if (profile?.is_active === false) {
        await supabase.auth.signOut()
        setError('الحساب غير فعال، يرجى التواصل مع الإدارة')
        setLoading(false)
        return
      }

      router.replace(profile?.role === 'lawyer' ? '/lawyer' : '/admin/dashboard')
      router.refresh()
    } catch {
      setError('حدث خطأ في الاتصال، يرجى المحاولة مرة أخرى')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F3F1F2] flex items-center justify-center p-4" dir="rtl">
      {/* Subtle background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-[#2C8780]/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-[#1D6365]/4 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div
            className="inline-flex w-20 h-20 rounded-3xl items-center justify-center mb-5 shadow-xl"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth={1.4} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-[#231F20] tracking-tight">قلعة الضمان</h1>
          <p className="text-[#767676] text-sm mt-2">النظام الإداري والقانوني للتحصيل والمتابعة</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] p-8 shadow-lg shadow-black/5">
          <h2 className="text-[#231F20] font-bold text-lg mb-6">تسجيل الدخول</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-[#231F20] mb-2">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#767676]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  dir="ltr"
                  placeholder="example@domain.com"
                  className="w-full bg-white border border-[rgba(118,118,118,0.2)] rounded-lg pr-10 pl-4 py-3 text-[#231F20] placeholder:text-[#767676]/60 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-[#231F20] mb-2">
                كلمة المرور
              </label>
              <div className="relative">
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#767676]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  dir="ltr"
                  placeholder="••••••••"
                  className="w-full bg-white border border-[rgba(118,118,118,0.2)] rounded-lg pr-10 pl-11 py-3 text-[#231F20] placeholder:text-[#767676]/60 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  tabIndex={-1}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#767676] hover:text-[#231F20] transition-colors p-1"
                >
                  {showPass ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
                <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-red-600 text-sm">{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full text-white font-bold py-3.5 rounded-xl transition-all text-base shadow-md mt-2 disabled:opacity-60 hover:opacity-90 active:opacity-80"
              style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  جارٍ الدخول...
                </span>
              ) : 'تسجيل الدخول'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#767676] mt-6">
          قلعة الضمان © 2025 — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  )
}