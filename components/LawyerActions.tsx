'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { readApiError } from '@/lib/read-api-error'

interface Props {
  userId: string
  isActive: boolean
  fullName: string
  role?: string | null
  canDelete?: boolean
  showEdit?: boolean
}

export default function LawyerActions({
  userId,
  isActive,
  fullName,
  role,
  canDelete = false,
  showEdit = true,
}: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const isAdminAccount = role === 'admin'

  async function toggle() {
    if (!canDelete || isAdminAccount) return
    const verb = isActive ? 'تعطيل' : 'تفعيل'
    const ok = await appConfirm({
      title: isActive ? 'تعطيل الحساب' : 'تفعيل الحساب',
      message: `هل تريد ${verb} حساب «${fullName}»؟`,
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
    if (!canDelete || isAdminAccount) return
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `هل أنت متأكد من حذف «${fullName}» نهائياً؟\nلا يمكن التراجع عن هذا الإجراء.`,
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

  return (
    <div className="flex items-center gap-3 flex-wrap justify-center">
      {showEdit && (
        <Link href={`/admin/lawyers/${userId}/edit`} className="text-slate-600 hover:text-slate-800 font-medium text-xs">
          تعديل
        </Link>
      )}
      {canDelete && !isAdminAccount && (
        <>
          <button
            onClick={toggle}
            disabled={loading}
            className={`text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              isActive ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800'
            }`}
          >
            {loading ? '...' : isActive ? 'تعطيل' : 'تفعيل'}
          </button>
          <button
            onClick={remove}
            disabled={loading}
            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '...' : 'حذف'}
          </button>
        </>
      )}
    </div>
  )
}
