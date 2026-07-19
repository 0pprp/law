'use client'

import { useRouter } from 'next/navigation'

interface BackButtonProps {
  /** الوجهة عند فتح الصفحة مباشرة بلا سجل تنقّل */
  fallback: string
  className?: string
}

/** زر «رجوع» — يعود في History إن وُجد، وإلا ينتقل للصفحة الرئيسية للقسم. */
export function BackButton({ fallback, className }: BackButtonProps) {
  const router = useRouter()

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="رجوع"
      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border bg-white text-[#767676] border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 hover:text-[#2C8780] transition-colors ${className ?? ''}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      رجوع
    </button>
  )
}
