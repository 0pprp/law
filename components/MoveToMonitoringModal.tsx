'use client'

import { useEffect, useState } from 'react'
import { PremiumSelect } from '@/components/ui/premium-select'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'

interface StatusOption {
  id: string
  name: string
  is_active?: boolean
}

export default function MoveToMonitoringModal({
  open,
  branchId,
  viewAll = false,
  debtorIds,
  onClose,
  onSuccess,
}: {
  open: boolean
  branchId: string | null
  viewAll?: boolean
  debtorIds: string[]
  onClose: () => void
  onSuccess: (debtorIds: string[], statusName: string) => void
}) {
  const [statuses, setStatuses] = useState<StatusOption[]>([])
  const [statusId, setStatusId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setStatusId('')
    setError('')
    setLoading(true)
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (viewAll) params.set('viewAll', '1')
    else if (branchId) params.set('branchId', branchId)
    fetch(`/api/admin/special-statuses?${params}`, { signal: controller.signal })
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? 'فشل تحميل الصفات')
        setStatuses(
          ((json.statuses ?? []) as StatusOption[]).filter(status => status.is_active !== false),
        )
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'فشل تحميل الصفات')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, branchId, viewAll])

  async function submit() {
    if (!statusId || !debtorIds.length || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/debtors/set-special-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds, statusId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'فشل تحويل الأسماء')
      const statusName = statuses.find(status => status.id === statusId)?.name ?? 'الصفة المحددة'
      invalidateDashboardCounts()
      onSuccess(debtorIds, statusName)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحويل الأسماء')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-[#231F20]">تحويل إلى متابعة القانونية</h2>
            <p className="mt-1 text-xs text-[#767676]">
              سيتم تحويل {debtorIds.length} اسم وحفظ المهمة المرتبطة للرجوع إليها لاحقاً
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-xl leading-none text-[#767676] hover:text-[#231F20] disabled:opacity-50"
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <PremiumSelect
          value={statusId}
          onChange={value => {
            setStatusId(value)
            setError('')
          }}
          options={[
            { value: '', label: '— اختر الصفة —' },
            ...statuses.map(status => ({ value: status.id, label: status.name })),
          ]}
          placeholder={loading ? 'جارٍ تحميل الصفات...' : '— اختر الصفة —'}
          fieldLabel="الصفة"
          headerTitle="اختر الصفة"
          searchPlaceholder="بحث في الصفات..."
          searchable
          disabled={loading || saving}
        />

        {!loading && statuses.length === 0 && !error && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            لا توجد صفات نشطة لهذا الفرع. أضف صفة أولاً من تبويب متابعة القانونية.
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[rgba(118,118,118,0.2)] px-4 py-2 text-sm font-bold text-[#454042] disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || loading || !statusId || !debtorIds.length}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {saving ? 'جارٍ التحويل...' : 'تم'}
          </button>
        </div>
      </div>
    </div>
  )
}
