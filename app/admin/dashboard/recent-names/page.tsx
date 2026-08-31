'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import ExperimentalQueuePanel from '@/components/ExperimentalQueuePanel'

export default function RecentNamesPage() {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-2 text-xs text-[#767676]">
        <Link href="/admin/dashboard" className="hover:text-[#2C8780] hover:underline">لوحة التحكم</Link>
        <span>/</span>
        <span className="text-[#231F20] font-semibold">الأسماء المضافة مؤخراً</span>
      </div>
      <Suspense fallback={<div className="text-sm text-[#767676]">جارٍ التحميل...</div>}>
        <ExperimentalQueuePanel queue="recent" />
      </Suspense>
    </div>
  )
}
