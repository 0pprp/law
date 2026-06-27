'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatLocalDeadlineFromIso } from '@/lib/local-date'
import { formatErrorMessage } from '@/lib/format-error'

interface Props {
  taskId: string
  expiresAt?: string | null
}

export default function TaskAcceptanceActions({ taskId, expiresAt }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<'accept' | 'reject' | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  async function respond(action: 'accept' | 'reject') {
    if (action === 'reject' && !reason.trim()) {
      setError('يرجى إدخال سبب الرفض')
      return
    }
    setLoading(action)
    setError('')
    try {
      const res = await fetch('/api/lawyer/task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action, reason: reason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'فشل تنفيذ الطلب')
        setLoading(null)
        return
      }
      router.refresh()
      if (action === 'reject') router.push('/lawyer/tasks')
    } catch (e: unknown) {
      console.error(e)
      setError(formatErrorMessage(e))
      setLoading(null)
    }
  }

  const deadlineLabel = expiresAt
    ? formatLocalDeadlineFromIso(expiresAt)
    : 'نهاية اليوم التالي'

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 space-y-3 shadow-sm">
      <div>
        <p className="text-sm font-black text-amber-900">طلب تكليف جديد</p>
        <p className="text-xs text-amber-800 mt-1 leading-relaxed">
          تم تكليفك بهذه المهمة. يجب قبولها أو رفضها قبل{' '}
          <span className="font-bold" dir="ltr">{deadlineLabel}</span>.
          {' '}بعد انتهاء المهلة تُعتبر موافقة تلقائية.
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {!showReject ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => respond('accept')}
            disabled={!!loading}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {loading === 'accept' ? 'جارٍ القبول...' : 'قبول التكليف'}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={!!loading}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-red-700 bg-white border border-red-200 disabled:opacity-50"
          >
            رفض
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="سبب الرفض..."
            rows={3}
            className="w-full text-sm border border-red-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => respond('reject')}
              disabled={!!loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 disabled:opacity-50"
            >
              {loading === 'reject' ? 'جارٍ الرفض...' : 'تأكيد الرفض'}
            </button>
            <button
              type="button"
              onClick={() => { setShowReject(false); setReason(''); setError('') }}
              disabled={!!loading}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-white border border-slate-200"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
