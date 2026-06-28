'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'

interface Props {
  userId: string
  isActive: boolean
  fullName: string
  readOnly?: boolean
}

export default function LawyerActions({ userId, isActive, fullName, readOnly }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  if (readOnly) return <span className="text-xs text-[#767676]">—</span>

  async function toggle() {
    const verb = isActive ? 'تعطيل' : 'تفعيل'
    if (!confirm(`هل تريد ${verb} حساب "${fullName}"؟`)) return
    setLoading(true)
    const supabase = createClient()
    await supabase.from('profiles').update({ is_active: !isActive }).eq('id', userId)
    if (isActive) {
      await logActivity({
        action: 'deactivate_lawyer',
        entity_type: 'lawyer',
        entity_id: userId,
        description: `تعطيل حساب المحامي: ${fullName}`,
      }, supabase)
    }
    setLoading(false)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-3">
      <Link href={`/admin/lawyers/${userId}/edit`} className="text-slate-600 hover:text-slate-800 font-medium text-xs">
        تعديل
      </Link>
      <button
        onClick={toggle}
        disabled={loading}
        className={`text-xs font-medium disabled:opacity-50 transition-colors ${
          isActive ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'
        }`}
      >
        {loading ? '...' : isActive ? 'تعطيل' : 'تفعيل'}
      </button>
    </div>
  )
}
