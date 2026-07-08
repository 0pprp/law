'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { readApiError } from '@/lib/read-api-error'

interface Props {
  userId: string
  isActive: boolean
  fullName: string
  canDelete?: boolean
}

export default function DelegateActions({ userId, isActive, fullName, canDelete = false }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function toggle() {
    if (!canDelete) return
    const verb = isActive ? 'تعطيل' : 'تفعيل'
    const ok = await appConfirm({
      title: isActive ? 'تعطيل المندوب' : 'تفعيل المندوب',
      message: `هل تريد ${verb} المندوب «${fullName}»؟`,
      confirmLabel: verb,
      danger: isActive,
    })
    if (!ok) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/toggle-user-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isActive: !isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        await appAlert({ message: readApiError(data, 'فشل تحديث الحالة'), variant: 'error' })
        setLoading(false)
        return
      }
      router.refresh()
    } catch {
      await appAlert({ message: 'حدث خطأ غير متوقع', variant: 'error' })
    }
    setLoading(false)
  }

  async function remove() {
    if (!canDelete) return
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `هل أنت متأكد من حذف المندوب «${fullName}» نهائياً؟\nلا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        await appAlert({ message: readApiError(data, 'فشل الحذف'), variant: 'error' })
        setLoading(false)
        return
      }
      router.refresh()
    } catch {
      await appAlert({ message: 'حدث خطأ غير متوقع', variant: 'error' })
    }
    setLoading(false)
  }

  if (!canDelete) {
    return <span className="text-[10px] text-[#767676]">—</span>
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={toggle}
        disabled={loading}
        className={`text-xs font-medium disabled:opacity-50 transition-colors ${
          isActive ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800'
        }`}
      >
        {loading ? '...' : isActive ? 'تعطيل' : 'تفعيل'}
      </button>
      <button
        onClick={remove}
        disabled={loading}
        className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
      >
        {loading ? '...' : 'حذف'}
      </button>
    </div>
  )
}
