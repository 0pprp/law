'use client'

import Link from 'next/link'
import { PERMISSION_DENIED_MSG } from '@/lib/permissions'

export default function PermissionDenied({
  message = PERMISSION_DENIED_MSG,
  backHref = '/admin/dashboard',
}: {
  message?: string
  backHref?: string
}) {
  return (
    <div className="max-w-md mx-auto py-20 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center text-2xl mx-auto">⛔</div>
      <h1 className="text-lg font-black text-[#231F20]">صلاحية غير كافية</h1>
      <p className="text-sm text-[#767676]">{message}</p>
      <Link
        href={backHref}
        className="inline-block mt-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
      >
        العودة للوحة التحكم
      </Link>
    </div>
  )
}
