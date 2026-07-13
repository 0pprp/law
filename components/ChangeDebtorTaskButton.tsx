'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PremiumSelect } from '@/components/ui/premium-select'
import { fetchActiveTaskDefinitions } from '@/lib/task-definitions'

interface Props {
  debtorId: string
  branchId: string | null
  currentLabel?: string | null
  /** compact link style for table actions */
  compact?: boolean
  onChanged?: (label: string) => void
}

export default function ChangeDebtorTaskButton({
  debtorId,
  branchId,
  currentLabel,
  compact,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [defs, setDefs] = useState<{ id: string; label: string; fee_amount: number }[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [activeLabel, setActiveLabel] = useState(currentLabel ?? '')

  useEffect(() => {
    setActiveLabel(currentLabel ?? '')
  }, [currentLabel])

  async function openModal() {
    if (!branchId) {
      setError('اختر فرعاً أولاً')
      setOpen(true)
      return
    }
    setOpen(true)
    setError('')
    setLoading(true)
    try {
      const supabase = createClient()
      const list = await fetchActiveTaskDefinitions(supabase, branchId, 'id, label, fee_amount')
      setDefs(list.map(d => ({
        id: String(d.id),
        label: String(d.label ?? ''),
        fee_amount: Number(d.fee_amount) || 0,
      })))

      const { data: debtor } = await supabase
        .from('debtors')
        .select('current_task_id')
        .eq('id', debtorId)
        .maybeSingle()

      if (debtor?.current_task_id) {
        const { data: task } = await supabase
          .from('tasks')
          .select('task_definition_id, task_definitions(label)')
          .eq('id', debtor.current_task_id)
          .maybeSingle()
        const defId = task?.task_definition_id ?? ''
        setSelectedId(defId)
        const emb = task?.task_definitions as { label?: string } | { label?: string }[] | null
        const label = Array.isArray(emb) ? emb[0]?.label : emb?.label
        if (label) setActiveLabel(label)
      } else {
        setSelectedId('')
      }
    } catch {
      setError('فشل تحميل المهام')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!selectedId) {
      setError('اختر المهمة المطلوبة')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/change-debtor-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId, taskDefinitionId: selectedId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل التعديل')
        setSaving(false)
        return
      }
      const label = typeof json.label === 'string' ? json.label : defs.find(d => d.id === selectedId)?.label ?? ''
      setActiveLabel(label)
      onChanged?.(label)
      setOpen(false)
    } catch {
      setError('فشل الاتصال')
    } finally {
      setSaving(false)
    }
  }

  const options = defs.map(d => ({
    value: d.id,
    label: d.label,
    hint: d.fee_amount > 0 ? `${d.fee_amount.toLocaleString('en-US')} د.ع` : undefined,
  }))

  return (
    <>
      <button
        type="button"
        onClick={() => void openModal()}
        className={
          compact
            ? 'text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap'
            : 'text-sm font-semibold text-[#2C8780] hover:underline'
        }
        title={activeLabel ? `المهمة الحالية: ${activeLabel}` : 'تعديل المهمة المطلوبة'}
      >
        {compact ? 'تعديل المهمة' : (activeLabel ? `تعديل المهمة (${activeLabel})` : 'تعيين المهمة المطلوبة')}
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#231F20]">تعديل المهمة المطلوبة</h3>
                <p className="text-xs text-[#767676] mt-1">
                  يُسمح بالتغيير فقط قبل تكليف المهمة أو إنجازها.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-[#767676] hover:text-[#231F20] text-lg leading-none">×</button>
            </div>

            {loading ? (
              <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
            ) : (
              <PremiumSelect
                value={selectedId}
                onChange={setSelectedId}
                options={options}
                placeholder="— اختر المهمة المطلوبة —"
                headerTitle="المهمة المطلوبة"
              />
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm rounded-xl border border-[rgba(118,118,118,0.2)]"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || loading || !selectedId}
                className="px-4 py-2 text-sm rounded-xl text-white font-bold bg-[#2C8780] hover:bg-[#1D6365] disabled:opacity-50"
              >
                {saving ? '...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
