'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { TaskType, RequiredField } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { useBranchId } from '@/context/branch'

const INP = 'w-full px-3 py-2 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

const ALL_FIELDS: RequiredField[] = [
  'note', 'image', 'pdf', 'decision_number', 'case_number',
  'date', 'gps', 'receipt', 'legal_result', 'court_decision', 'team',
]

interface TaskDef {
  id: string
  task_type: TaskType
  label: string
  fee_amount: number
  sort_order: number
  is_active: boolean
}

interface ReqField {
  id: string
  task_definition_id: string
  field_key: string
  field_type: RequiredField
  field_label: string | null
  is_required: boolean
  sort_order: number
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ def, reqFields, onClose, onSaved }: {
  def: TaskDef
  reqFields: ReqField[]
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(def.label)
  const [fee, setFee] = useState(String(def.fee_amount))
  const [activeFields, setActiveFields] = useState<Set<RequiredField>>(
    new Set(reqFields.map(f => f.field_type))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleField(f: RequiredField) {
    setActiveFields(prev => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    const supabase = createClient()

    // 1. Update task_definitions label & fee
    const { error: defErr } = await (supabase as any)
      .from('task_definitions')
      .update({ label: label.trim(), fee_amount: Number(fee) || 0 })
      .eq('id', def.id)

    if (defErr) { setError(defErr.message); setSaving(false); return }

    // 2. Delete removed fields
    const toDelete = reqFields.filter(f => !activeFields.has(f.field_type)).map(f => f.id)
    if (toDelete.length > 0) {
      await (supabase as any).from('task_required_fields').delete().in('id', toDelete)
    }

    // 3. Insert newly added fields
    const existingTypes = new Set(reqFields.map(f => f.field_type))
    const toInsert = ALL_FIELDS
      .filter(f => activeFields.has(f) && !existingTypes.has(f))
      .map((f, idx) => ({
        task_definition_id: def.id,
        field_key: f,
        field_type: f,
        sort_order: reqFields.length + idx,
      }))

    if (toInsert.length > 0) {
      await (supabase as any).from('task_required_fields').insert(toInsert)
    }

    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-[#231F20] text-sm">{TASK_TYPE_LABELS[def.task_type]}</h2>
            <p className="text-xs text-[#767676] mt-0.5">تعديل الأتعاب والحقول المطلوبة</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-lg leading-none hover:bg-slate-200 transition-colors">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم المهمة</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className={INP} />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب (د.ع)</label>
            <input type="number" value={fee} onChange={e => setFee(e.target.value)}
              className={INP} dir="ltr" min="0" />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-2">
              الحقول الإلزامية عند الإنجاز
              <span className="text-[#767676] font-normal mr-2">({activeFields.size} محدد)</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_FIELDS.map(f => {
                const active = activeFields.has(f)
                return (
                  <label key={f}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                      active
                        ? 'bg-[#2C8780]/8 border-[#2C8780]/40 text-[#2C8780]'
                        : 'border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-[#F3F1F2]'
                    }`}>
                    <input type="checkbox" checked={active} onChange={() => toggleField(f)}
                      className="accent-[#2C8780] w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{REQUIRED_FIELD_LABELS[f]}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3 shrink-0 bg-[#F3F1F2]/50">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">
            إلغاء
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TaskDefinitionsPage() {
  const branchId = useBranchId()
  const [defs, setDefs] = useState<TaskDef[]>([])
  const [reqFields, setReqFields] = useState<ReqField[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TaskDef | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    if (!branchId) {
      setDefs([])
      setReqFields([])
      setLoading(false)
      return
    }
    const [{ data: defData }, { data: fieldData }] = await Promise.all([
      (supabase as any).from('task_definitions').select('*').eq('branch_id', branchId).order('sort_order'),
      (supabase as any).from('task_required_fields').select('*').order('sort_order'),
    ])
    const branchDefs = (defData ?? []) as TaskDef[]
    const defIds = new Set(branchDefs.map(d => d.id))
    setDefs(branchDefs)
    setReqFields(((fieldData ?? []) as ReqField[]).filter(f => defIds.has(f.task_definition_id)))
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  async function toggleActive(def: TaskDef) {
    const supabase = createClient()
    await (supabase as any).from('task_definitions').update({ is_active: !def.is_active }).eq('id', def.id)
    setDefs(ds => ds.map(d => d.id === def.id ? { ...d, is_active: !d.is_active } : d))
  }

  const editingFields = editing ? reqFields.filter(f => f.task_definition_id === editing.id) : []

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="تعريفات المهام"
        subtitle="إدارة أنواع المهام والأتعاب والحقول الإلزامية"
      />

      <div className="bg-[#2C8780]/8 border border-[#2C8780]/20 rounded-2xl px-4 py-3 text-sm text-[#231F20]">
        الحقول المحددة هنا تظهر للمحامي في نافذة الإنجاز الإلزامية — لا يمكنه الإرسال بدون تعبئتها.
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <svg className="w-5 h-5 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
              <tr>
                <th className="text-right px-4 py-3 font-semibold text-[#767676] text-xs">نوع المهمة</th>
                <th className="px-4 py-3 font-semibold text-[#767676] text-xs text-left">الأتعاب</th>
                <th className="text-right px-4 py-3 font-semibold text-[#767676] text-xs">الحقول الإلزامية</th>
                <th className="text-center px-4 py-3 font-semibold text-[#767676] text-xs">الحالة</th>
                <th className="text-center px-4 py-3 font-semibold text-[#767676] text-xs">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(118,118,118,0.08)]">
              {defs.map(def => {
                const fields = reqFields.filter(f => f.task_definition_id === def.id)
                return (
                  <tr key={def.id} className={`hover:bg-[#F3F1F2]/50 transition-colors ${!def.is_active ? 'opacity-40' : ''}`}>
                    <td className="px-4 py-3 font-semibold text-[#231F20]">{def.label}</td>
                    <td className="px-4 py-3 text-[#2C8780] font-black tabular-nums text-left" dir="ltr">
                      {Number(def.fee_amount).toLocaleString('en-US')} <span className="text-[10px] font-normal">د.ع</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {fields.length === 0 ? (
                          <span className="text-xs text-[#767676] italic">لا شيء</span>
                        ) : fields.map(f => (
                          <span key={f.id}
                            className="text-[10px] bg-[#2C8780]/8 text-[#2C8780] px-2 py-0.5 rounded-full font-semibold">
                            {f.field_label ?? REQUIRED_FIELD_LABELS[f.field_type] ?? f.field_type}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                        def.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {def.is_active ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setEditing(def)}
                          className="text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 hover:text-[#2C8780] px-2.5 py-1.5 rounded-lg transition-colors">
                          تعديل
                        </button>
                        <button onClick={() => toggleActive(def)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            def.is_active
                              ? 'text-red-600 border-red-200 hover:bg-red-50'
                              : 'text-green-600 border-green-200 hover:bg-green-50'
                          }`}>
                          {def.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EditModal
          def={editing}
          reqFields={editingFields}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
