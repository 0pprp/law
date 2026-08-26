'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { RequiredField } from '@/lib/types'
import { useBranchId, useBranch } from '@/context/branch'
import { formatMoney } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { filterSelectableBranches } from '@/lib/branch-constants'
import { appConfirm } from '@/lib/app-dialog'
import { PremiumSelect } from '@/components/ui/premium-select'
import { CRIMINAL_TASK_DEF_ADMIN_COLUMNS } from '@/lib/criminal-task-def-columns'
import { SortableTH } from '@/components/ui/data-table'
import { useTableSort } from '@/hooks/use-table-sort'

const INP = 'w-full px-3 py-2 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

/** أنواع الحقول حسب البرومبت */
const FIELD_TYPE_OPTIONS = [
  { value: 'note', label: 'ملاحظة' },
  { value: 'image', label: 'صورة' },
  { value: 'pdf', label: 'ملف PDF' },
  { value: 'text', label: 'نص' },
  { value: 'date', label: 'تاريخ' },
  { value: 'decision_number', label: 'رقم القرار' },
  { value: 'case_number', label: 'رقم الدعوى' },
  { value: 'gps', label: 'موقع GPS' },
]

interface TaskDef {
  id: string
  label: string
  fee_amount: number
  actual_fee_amount: number
  sort_order: number
  is_active: boolean
  branch_id: string
}

interface ExpenseLine {
  name: string
  max_amount: string
}

interface ExpenseRow {
  id: string
  task_definition_id: string
  name: string
  max_amount: number
  sort_order: number
}

interface ReqField {
  id: string
  task_definition_id: string
  field_key: string
  field_type: string
  field_label: string | null
  is_required: boolean
  sort_order: number
}

interface HybridLinkDraft {
  linked_definition_id: string
  label: string
  fee_amount: number
  is_optional: boolean
}

interface DynField {
  field_label: string
  field_type: string
  is_required: boolean
}

function emptyDynField(): DynField {
  return { field_label: '', field_type: 'text', is_required: true }
}

function fieldDisplayLabel(f: ReqField | DynField): string {
  if ('field_label' in f && f.field_label) return f.field_label
  const type = f.field_type
  return REQUIRED_FIELD_LABELS[type as RequiredField] ?? type
}

function isMissingHybridSchema(message: string | undefined | null): boolean {
  const m = String(message ?? '').toLowerCase()
  return (
    m.includes('criminal_case_task_definition_links')
    || m.includes('task_definition_links')
    || m.includes('is_hybrid')
    || m.includes('does not exist')
    || m.includes('could not find')
    || m.includes('schema cache')
    || m.includes('pgrst205')
    || m.includes('pgrst204')
    || m.includes('42703')
    || m.includes('42p01')
  )
}

async function findIdsByLabel(
  supabase: ReturnType<typeof createClient>,
  label: string,
  opts: { applyAll: boolean; branchId: string | null; allowedBranchIds: Set<string> },
): Promise<string[]> {
  let q = (supabase as any)
    .from('criminal_case_task_definitions')
    .select('id, branch_id')
    .eq('label', label)

  if (!opts.applyAll && opts.branchId) {
    q = q.eq('branch_id', opts.branchId)
  }

  const { data, error } = await q
  if (error || !data?.length) return []

  return (data as { id: string; branch_id: string }[])
    .filter(r => opts.allowedBranchIds.has(r.branch_id))
    .map(r => r.id)
}

function DynFieldsEditor({
  fields,
  onChange,
}: {
  fields: DynField[]
  onChange: (next: DynField[]) => void
}) {
  function setAt(i: number, key: keyof DynField, val: string | boolean) {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, [key]: val } : f)))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold text-[#231F20]">الحقول الإلزامية</label>
        <button
          type="button"
          onClick={() => onChange([...fields, emptyDynField()])}
          className="text-[11px] px-2.5 py-1 rounded-lg border border-[#2C8780]/40 text-[#2C8780] hover:bg-[#2C8780]/8 transition-colors font-semibold"
        >
          + إضافة حقل
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-[#767676] italic py-2">لا توجد حقول — اضغط «إضافة حقل» لإضافة حقل</p>
      ) : (
        <div className="space-y-2.5">
          {fields.map((f, i) => (
            <div key={i} className="bg-[#F8F7F8] rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={f.field_label}
                  onChange={e => setAt(i, 'field_label', e.target.value)}
                  className={`${INP} flex-1`}
                  placeholder="اسم الحقل (مثال: اسم مركز الشرطة)"
                />
                <button
                  type="button"
                  onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
                  className="w-7 h-7 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 flex items-center justify-center text-lg leading-none shrink-0"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <PremiumSelect
                  value={f.field_type}
                  onChange={v => setAt(i, 'field_type', v)}
                  options={FIELD_TYPE_OPTIONS}
                  headerTitle="نوع الحقل"
                  searchPlaceholder="بحث..."
                  searchable={FIELD_TYPE_OPTIONS.length > 4}
                  className="flex-1"
                />
                <label className="flex items-center gap-1.5 text-xs font-semibold text-[#231F20] cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={f.is_required}
                    onChange={e => setAt(i, 'is_required', e.target.checked)}
                    className="accent-[#2C8780] w-3.5 h-3.5"
                  />
                  إلزامي
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EditModal({
  def,
  reqFields,
  expenseRows,
  applyAll,
  allowedBranchIds,
  branchId,
  sameBranchDefs,
  allDefs,
  onClose,
  onSaved,
}: {
  def: TaskDef
  reqFields: ReqField[]
  expenseRows: ExpenseRow[]
  applyAll: boolean
  allowedBranchIds: Set<string>
  branchId: string | null
  sameBranchDefs: TaskDef[]
  allDefs: TaskDef[]
  onClose: () => void
  onSaved: () => void
}) {
  const originalLabel = def.label
  const [label, setLabel] = useState(def.label)
  const [actualFee, setActualFee] = useState(String(def.actual_fee_amount ?? 0))
  const [expenseLines, setExpenseLines] = useState<ExpenseLine[]>(() =>
    expenseRows.map(r => ({ name: r.name, max_amount: String(r.max_amount) })),
  )
  const [dynFields, setDynFields] = useState<DynField[]>(() =>
    reqFields.map(f => ({
      field_label: f.field_label || f.field_key,
      field_type: f.field_type || 'text',
      is_required: f.is_required,
    })),
  )
  const [isHybrid, setIsHybrid] = useState(false)
  const [hybridLinks, setHybridLinks] = useState<HybridLinkDraft[]>([])
  const [hybridSchemaReady, setHybridSchemaReady] = useState(true)
  const [hybridLoading, setHybridLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const candidateDefs = useMemo(
    () => sameBranchDefs
      .filter(d => d.id !== def.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'ar')),
    [sameBranchDefs, def.id],
  )

  useEffect(() => {
    let cancelled = false

    async function loadHybrid() {
      setHybridLoading(true)
      const supabase = createClient()

      let hybridFlag = false
      try {
        const { data, error: hyErr } = await (supabase as any)
          .from('criminal_case_task_definitions')
          .select('is_hybrid')
          .eq('id', def.id)
          .maybeSingle()
        if (hyErr) throw hyErr
        hybridFlag = Boolean(data?.is_hybrid)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!isMissingHybridSchema(msg)) {
          console.warn('[criminal EditModal] is_hybrid load:', msg)
        }
        hybridFlag = false
        if (!cancelled) setHybridSchemaReady(false)
      }

      let links: HybridLinkDraft[] = []
      try {
        const res = await fetch(`/api/admin/criminal-task-definition-links?parent_id=${encodeURIComponent(def.id)}`)
        const json = await res.json().catch(() => ({}))
        if (!cancelled && json.schemaReady === false) setHybridSchemaReady(false)
        if (Array.isArray(json.links)) {
          links = (json.links as Array<{
            linked_definition_id: string
            label?: string
            fee_amount?: number
            is_optional?: boolean
          }>).map(l => ({
            linked_definition_id: String(l.linked_definition_id),
            label: String(l.label ?? ''),
            fee_amount: Number(l.fee_amount ?? 0),
            is_optional: l.is_optional !== false,
          }))
        }
      } catch {
        if (!cancelled) setHybridSchemaReady(false)
        links = []
      }

      if (cancelled) return
      setIsHybrid(hybridFlag)
      setHybridLinks(links)
      setHybridLoading(false)
    }

    void loadHybrid()
    return () => { cancelled = true }
  }, [def.id])

  function toggleLinkedDef(candidate: TaskDef) {
    setHybridLinks(prev => {
      const exists = prev.some(l => l.linked_definition_id === candidate.id)
      if (exists) return prev.filter(l => l.linked_definition_id !== candidate.id)
      return [
        ...prev,
        {
          linked_definition_id: candidate.id,
          label: candidate.label,
          fee_amount: candidate.fee_amount,
          is_optional: true,
        },
      ]
    })
  }

  function setLinkOptional(linkedId: string, isOptional: boolean) {
    setHybridLinks(prev => prev.map(l => (
      l.linked_definition_id === linkedId ? { ...l, is_optional: isOptional } : l
    )))
  }

  function moveLink(linkedId: string, dir: -1 | 1) {
    setHybridLinks(prev => {
      const idx = prev.findIndex(l => l.linked_definition_id === linkedId)
      if (idx < 0) return prev
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= prev.length) return prev
      const copy = [...prev]
      const tmp = copy[idx]
      copy[idx] = copy[nextIdx]
      copy[nextIdx] = tmp
      return copy
    })
  }

  async function saveHybridForParents(parentIds: string[]): Promise<string | null> {
    try {
      for (const parentId of parentIds) {
        const parent = allDefs.find(d => d.id === parentId)
        if (!parent) continue

        let linksPayload: { linked_definition_id: string; is_optional: boolean; sort_order: number }[] = []

        if (isHybrid) {
          if (parentId === def.id) {
            linksPayload = hybridLinks.map((l, idx) => ({
              linked_definition_id: l.linked_definition_id,
              is_optional: l.is_optional,
              sort_order: idx,
            }))
          } else {
            const branchCandidates = allDefs.filter(d => d.branch_id === parent.branch_id && d.id !== parentId)
            for (let idx = 0; idx < hybridLinks.length; idx++) {
              const src = hybridLinks[idx]
              const match = branchCandidates.find(d => d.label.trim() === src.label.trim())
              if (!match) continue
              linksPayload.push({
                linked_definition_id: match.id,
                is_optional: src.is_optional,
                sort_order: linksPayload.length,
              })
            }
          }
        }

        const res = await fetch('/api/admin/criminal-task-definition-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parent_definition_id: parentId,
            is_hybrid: isHybrid,
            links: isHybrid ? linksPayload : [],
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (json.schemaReady === false) {
          return typeof json.warning === 'string'
            ? json.warning
            : 'أعمدة/جداول المهمة الهجينة الجزائية غير مطبّقة بعد على قاعدة البيانات — باقي التعديلات حُفظت'
        }
        if (!res.ok) {
          return typeof json.error === 'string' ? json.error : 'فشل حفظ روابط المهمة الهجينة'
        }
      }
      return null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isMissingHybridSchema(msg)) {
        return 'أعمدة/جداول المهمة الهجينة الجزائية غير مطبّقة بعد على قاعدة البيانات — باقي التعديلات حُفظت'
      }
      return msg || 'فشل حفظ المهمة الهجينة'
    }
  }

  async function save() {
    const newLabel = label.trim()
    if (!newLabel) { setError('اسم المهمة مطلوب'); return }
    const bad = dynFields.find(f => !f.field_label.trim())
    if (bad) { setError('تحقق من أسماء الحقول'); return }
    if (isHybrid && hybridLinks.length === 0) {
      setError('فعّلت المهمة الهجينة — اختر مهمة مرتبطة واحدة على الأقل أو أوقف الخيار')
      return
    }

    setSaving(true)
    setError('')
    const supabase = createClient()

    const ids = await findIdsByLabel(supabase, originalLabel, {
      applyAll,
      branchId,
      allowedBranchIds,
    })
    if (!ids.length) {
      setError('لم يُعثر على سجلات للتحديث')
      setSaving(false)
      return
    }

    const payload = {
      label: newLabel,
      actual_fee_amount: Number(actualFee) || 0,
      fields: dynFields.map(f => ({
        field_label: f.field_label.trim(),
        field_type: f.field_type,
        is_required: f.is_required,
      })),
      expenses: expenseLines
        .filter(l => l.name.trim() && Number(l.max_amount) > 0)
        .map(l => ({ name: l.name.trim(), max_amount: Number(l.max_amount) })),
    }

    for (const id of ids) {
      const res = await fetch('/api/admin/task-management/criminal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل الحفظ')
        setSaving(false)
        return
      }
    }

    const hybridErr = await saveHybridForParents(ids)
    if (hybridErr) {
      setError(hybridErr)
      setSaving(false)
      if (hybridErr.includes('غير مطبّقة')) {
        onSaved()
      }
      return
    }

    onSaved()
    onClose()
  }

  const selectedIds = new Set(hybridLinks.map(l => l.linked_definition_id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-[#231F20] text-sm">{def.label}</h2>
            <p className="text-xs text-[#767676] mt-0.5">
              {applyAll
                ? 'التعديل سيُطبَّق على كل الفروع التي تملك هذه المهمة'
                : 'تعديل سجل هذا الفرع فقط'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم المهمة</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className={INP} />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب (د.ع) — للمحامي</label>
            <input
              value={formatMoney(Number(def.fee_amount) || 0, { suffix: false })}
              readOnly
              className={`${INP} bg-[#F3F1F2] text-[#767676] cursor-not-allowed`}
              dir="ltr"
            />
            <p className="text-[10px] text-[#767676] mt-1">ثابت على 0 — ما يراه المحامي</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب الفعلية (د.ع)</label>
            <MoneyInput value={actualFee} onChange={v => setActualFee(v)} className={INP} dir="ltr" />
            <p className="text-[10px] text-[#767676] mt-1">للمدير فقط</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-[#231F20]">صرفيات المهمة</label>
              <button type="button" onClick={() => setExpenseLines(prev => [...prev, { name: '', max_amount: '' }])} className="text-[10px] font-bold text-sky-700 hover:underline">+ إضافة صرفية</button>
            </div>
            <div className="space-y-2">
              {expenseLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_32px] gap-2 items-center">
                  <input value={line.name} onChange={e => setExpenseLines(prev => prev.map((l, i) => i === idx ? { ...l, name: e.target.value } : l))} className={INP} placeholder="اسم الصرفية" />
                  <MoneyInput value={line.max_amount} onChange={v => setExpenseLines(prev => prev.map((l, i) => i === idx ? { ...l, max_amount: v } : l))} className={INP} placeholder="الحد" />
                  <button type="button" onClick={() => setExpenseLines(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          </div>
          <DynFieldsEditor fields={dynFields} onChange={setDynFields} />

          <div className="border border-[rgba(118,118,118,0.15)] rounded-xl p-4 space-y-3 bg-[#F8F7F8]/80">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#231F20]">المهمة الهجينة</p>
                <p className="text-[11px] text-[#767676] mt-0.5 leading-relaxed">
                  عند الإنجاز يختار المحامي مهاماً مرتبطة تُنشأ وتُرسل تلقائياً
                </p>
              </div>
              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                <span className="text-[11px] font-semibold text-[#454042]">
                  {isHybrid ? 'مفعّلة' : 'موقوفة'}
                </span>
                <input
                  type="checkbox"
                  checked={isHybrid}
                  disabled={hybridLoading}
                  onChange={e => {
                    const next = e.target.checked
                    setIsHybrid(next)
                    if (!next) setHybridLinks([])
                  }}
                  className="accent-[#2C8780] w-4 h-4"
                />
              </label>
            </div>

            {!hybridSchemaReady && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                جداول المهمة الهجينة غير مطبّقة بعد — يمكنك ضبط الإعداد، والحفظ سيُنبهك إن تعذّر التخزين
              </p>
            )}

            {isHybrid && (
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-[#231F20]">المهام المرتبطة (نفس الفرع)</p>
                {candidateDefs.length === 0 ? (
                  <p className="text-xs text-[#767676] italic">لا توجد مهام أخرى في هذا الفرع</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {candidateDefs.map(c => {
                      const checked = selectedIds.has(c.id)
                      return (
                        <label
                          key={c.id}
                          className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer ${
                            checked
                              ? 'bg-[#2C8780]/8 border-[#2C8780]/40'
                              : 'border-[rgba(118,118,118,0.2)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLinkedDef(c)}
                            className="accent-[#2C8780] w-3.5 h-3.5 mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-[#231F20]">{c.label}</span>
                            <span className="block text-[10px] text-[#767676] tabular-nums mt-0.5" dir="ltr">
                              {formatMoney(Number(c.fee_amount), { suffix: false })} د.ع
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}

                {hybridLinks.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-[rgba(118,118,118,0.1)]">
                    <p className="text-[11px] font-bold text-[#231F20]">ترتيب وطبيعة الارتباط</p>
                    {hybridLinks.map((link, idx) => (
                      <div
                        key={link.linked_definition_id}
                        className="flex items-center gap-2 bg-white border border-[rgba(118,118,118,0.15)] rounded-xl px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveLink(link.linked_definition_id, -1)}
                            disabled={idx === 0}
                            className="w-6 h-5 text-[10px] rounded border border-[rgba(118,118,118,0.2)] disabled:opacity-30"
                            aria-label="أعلى"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveLink(link.linked_definition_id, 1)}
                            disabled={idx === hybridLinks.length - 1}
                            className="w-6 h-5 text-[10px] rounded border border-[rgba(118,118,118,0.2)] disabled:opacity-30"
                            aria-label="أسفل"
                          >
                            ↓
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#231F20] truncate">{link.label}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => setLinkOptional(link.linked_definition_id, true)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                link.is_optional
                                  ? 'bg-sky-50 text-sky-700 border-sky-200'
                                  : 'bg-white text-[#767676] border-[rgba(118,118,118,0.2)]'
                              }`}
                            >
                              اختيارية
                            </button>
                            <button
                              type="button"
                              onClick={() => setLinkOptional(link.linked_definition_id, false)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                !link.is_optional
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-white text-[#767676] border-[rgba(118,118,118,0.2)]'
                              }`}
                            >
                              إلزامية
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3 shrink-0 bg-[#F3F1F2]/50">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676]">إلغاء</button>
          <button type="button" onClick={() => void save()} disabled={saving || hybridLoading} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateModal({
  branchCount,
  applyAll,
  singleBranchId,
  onClose,
  onSaved,
}: {
  branchCount: number
  applyAll: boolean
  singleBranchId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState('')
  const [actualFee, setActualFee] = useState('0')
  const [expenseLines, setExpenseLines] = useState<ExpenseLine[]>([])
  const [dynFields, setDynFields] = useState<DynField[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!label.trim()) { setError('اسم المهمة مطلوب'); return }
    if (!applyAll && !singleBranchId) { setError('حدّد فرعاً'); return }
    const bad = dynFields.find(f => !f.field_label.trim())
    if (bad) { setError('تحقق من أسماء الحقول'); return }

    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/task-management/criminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label.trim(),
        actual_fee_amount: Number(actualFee) || 0,
        applyAllBranches: applyAll,
        branchId: applyAll ? null : singleBranchId,
        fields: dynFields.map(f => ({
          field_label: f.field_label.trim(),
          field_type: f.field_type,
          is_required: f.is_required,
        })),
        expenses: expenseLines
          .filter(l => l.name.trim() && Number(l.max_amount) > 0)
          .map(l => ({ name: l.name.trim(), max_amount: Number(l.max_amount) })),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof json.error === 'string' ? json.error : 'فشل الإنشاء')
      setSaving(false)
      return
    }
    console.log('[task-management/criminal] client got createdCount', json.createdCount)
    onSaved()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-[#231F20] text-sm">إضافة مهمة جزائية</h2>
            {applyAll && (
              <p className="text-xs text-amber-800 mt-0.5 font-medium">سيُطبَّق على {branchCount} فرع</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">اسم المهمة</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className={INP} />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب (د.ع) — للمحامي</label>
            <input
              value="0"
              readOnly
              className={`${INP} bg-[#F3F1F2] text-[#767676] cursor-not-allowed`}
              dir="ltr"
            />
            <p className="text-[10px] text-[#767676] mt-1">ثابت على 0 — ما يراه المحامي</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">الأتعاب الفعلية (د.ع)</label>
            <MoneyInput value={actualFee} onChange={v => setActualFee(v)} className={INP} dir="ltr" />
            <p className="text-[10px] text-[#767676] mt-1">للمدير فقط</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-[#231F20]">صرفيات المهمة</label>
              <button type="button" onClick={() => setExpenseLines(prev => [...prev, { name: '', max_amount: '' }])} className="text-[10px] font-bold text-sky-700 hover:underline">+ إضافة صرفية</button>
            </div>
            <div className="space-y-2">
              {expenseLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_32px] gap-2 items-center">
                  <input value={line.name} onChange={e => setExpenseLines(prev => prev.map((l, i) => i === idx ? { ...l, name: e.target.value } : l))} className={INP} placeholder="اسم الصرفية" />
                  <MoneyInput value={line.max_amount} onChange={v => setExpenseLines(prev => prev.map((l, i) => i === idx ? { ...l, max_amount: v } : l))} className={INP} placeholder="الحد" />
                  <button type="button" onClick={() => setExpenseLines(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          </div>
          <DynFieldsEditor fields={dynFields} onChange={setDynFields} />
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3 shrink-0 bg-[#F3F1F2]/50">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676]">إلغاء</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
            {saving ? 'جارٍ الإنشاء...' : applyAll ? `إنشاء على ${branchCount} فرع` : 'إنشاء'}
          </button>
        </div>
      </div>
    </div>
  )
}

function dedupeByLabel(rows: TaskDef[]): TaskDef[] {
  const seen = new Set<string>()
  const out: TaskDef[] = []
  for (const row of rows) {
    const key = row.label.trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

export default function CriminalTaskManagementPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const [allDefs, setAllDefs] = useState<TaskDef[]>([])
  const [reqFields, setReqFields] = useState<ReqField[]>([])
  const [defExpenses, setDefExpenses] = useState<ExpenseRow[]>([])
  const [allowedBranchIds, setAllowedBranchIds] = useState<Set<string>>(new Set())
  const [branchCount, setBranchCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TaskDef | null>(null)
  const [creating, setCreating] = useState(false)

  const showAll = viewAllBranches || !branchId

  const defs = useMemo(
    () => (showAll ? dedupeByLabel(allDefs) : allDefs),
    [allDefs, showAll],
  )

  const {
    rows: sortedDefs,
    sortKey,
    sortDirection,
    cycleSort,
  } = useTableSort(defs, {
    label: def => def.label,
    fee: def => Number(def.fee_amount),
    actualFee: def => Number(def.actual_fee_amount ?? 0),
    fields: def => reqFields.filter(f => f.task_definition_id === def.id).length,
    expenses: def => defExpenses.filter(e => e.task_definition_id === def.id).length,
    status: def => (def.is_active ? 1 : 0),
  })

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: branches } = await supabase.from('branches').select('id, name').eq('is_active', true)
    const selectable = filterSelectableBranches(branches ?? [])
    setBranchCount(selectable.length)
    const allowed = new Set(selectable.map(b => b.id))
    setAllowedBranchIds(allowed)

    let defQuery = (supabase as any)
      .from('criminal_case_task_definitions')
      .select(CRIMINAL_TASK_DEF_ADMIN_COLUMNS)
      .eq('is_active', true)
      .order('sort_order')

    if (!showAll && branchId) defQuery = defQuery.eq('branch_id', branchId)

    const [{ data: defData }, { data: fieldData }, { data: expData }] = await Promise.all([
      defQuery,
      (supabase as any).from('criminal_case_required_fields').select('*').order('sort_order'),
      (supabase as any).from('criminal_case_task_expense_limits').select('*').order('sort_order'),
    ])

    let branchDefs = ((defData ?? []) as TaskDef[]).filter(d => allowed.has(d.branch_id))

    const defIds = new Set(branchDefs.map(d => d.id))
    setAllDefs(branchDefs)
    setReqFields(((fieldData ?? []) as ReqField[]).filter(f => defIds.has(f.task_definition_id)))
    setDefExpenses(((expData ?? []) as ExpenseRow[]).filter(e => defIds.has(e.task_definition_id)))
    setLoading(false)
  }, [branchId, showAll])

  useEffect(() => { void load() }, [load])

  async function toggleActive(def: TaskDef) {
    const supabase = createClient()
    const ids = await findIdsByLabel(supabase, def.label, {
      applyAll: showAll,
      branchId,
      allowedBranchIds,
    })
    if (!ids.length) return
    const next = !def.is_active
    for (const id of ids) {
      await fetch('/api/admin/task-management/criminal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: next }),
      })
    }
    void load()
  }

  async function archiveDef(def: TaskDef) {
    const ok = await appConfirm({
      title: 'إيقاف المهمة',
      message: showAll
        ? `إيقاف «${def.label}» من كل الفروع التي تملك هذه المهمة؟`
        : `إيقاف «${def.label}» لهذا الفرع فقط؟`,
      confirmLabel: 'إيقاف',
      danger: true,
    })
    if (!ok) return
    const supabase = createClient()
    const ids = await findIdsByLabel(supabase, def.label, {
      applyAll: showAll,
      branchId,
      allowedBranchIds,
    })
    for (const id of ids) {
      await fetch(`/api/admin/task-management/criminal?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    }
    void load()
  }

  const editingFields = editing ? reqFields.filter(f => f.task_definition_id === editing.id) : []
  const editingExpenses = editing ? defExpenses.filter(e => e.task_definition_id === editing.id) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-[#454042]">
            {showAll
              ? 'عرض موحّد بدون تكرار — الإضافة تُنشئ نسخة لكل فرع'
              : 'فرع محدد — الإضافة لهذا الفرع فقط'}
          </p>
          {showAll && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              أي تعديل أو حذف سيُطبَّق على كل الفروع التي تملك هذه المهمة
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!showAll && !branchId}
          className="text-sm font-bold text-white px-4 py-2 rounded-xl disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
        >
          + إضافة مهمة
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <div className="w-5 h-5 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
                <tr>
                  <SortableTH variant="plain" sortKey="label" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="text-right px-4 py-3 font-semibold text-[#767676] text-xs">المهمة</SortableTH>
                  <SortableTH variant="plain" sortKey="fee" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-4 py-3 font-semibold text-[#767676] text-xs text-left">الأتعاب</SortableTH>
                  <SortableTH variant="plain" sortKey="actualFee" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-4 py-3 font-semibold text-[#767676] text-xs text-left">الأتعاب الفعلية</SortableTH>
                  <SortableTH variant="plain" sortKey="fields" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="text-right px-4 py-3 font-semibold text-[#767676] text-xs">الحقول</SortableTH>
                  <SortableTH variant="plain" sortKey="expenses" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="text-center px-4 py-3 font-semibold text-[#767676] text-xs">صرفيات</SortableTH>
                  <SortableTH variant="plain" sortKey="status" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="text-center px-4 py-3 font-semibold text-[#767676] text-xs">الحالة</SortableTH>
                  <th className="text-center px-4 py-3 font-semibold text-[#767676] text-xs">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(118,118,118,0.08)]">
                {sortedDefs.map(def => {
                  const fields = reqFields.filter(f => f.task_definition_id === def.id)
                  const expCount = defExpenses.filter(e => e.task_definition_id === def.id).length
                  return (
                    <tr key={`${def.label}-${def.id}`} className={`hover:bg-[#F3F1F2]/50 ${!def.is_active ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-[#231F20]">{def.label}</td>
                      <td className="px-4 py-3 text-[#2C8780] font-black tabular-nums text-left" dir="ltr">
                        {formatMoney(Number(def.fee_amount), { suffix: false })}{' '}
                        <span className="text-[10px] font-normal">د.ع</span>
                      </td>
                      <td className="px-4 py-3 text-[#1D6365] font-black tabular-nums text-left" dir="ltr">
                        {formatMoney(Number(def.actual_fee_amount ?? 0), { suffix: false })}{' '}
                        <span className="text-[10px] font-normal">د.ع</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {fields.length === 0 ? (
                            <span className="text-xs text-[#767676] italic">لا شيء</span>
                          ) : fields.map(f => (
                            <span key={f.id} className="text-[10px] bg-[#2C8780]/8 text-[#2C8780] px-2 py-0.5 rounded-full font-semibold">
                              {fieldDisplayLabel(f)}
                              {!f.is_required ? ' (اختياري)' : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {expCount > 0 ? (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-sky-100 text-sky-700">{expCount}</span>
                        ) : (
                          <span className="text-[10px] text-[#767676]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${def.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {def.is_active ? 'مفعّل' : 'موقوف'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <button type="button" onClick={() => setEditing(def)} className="text-xs border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg">تعديل</button>
                          <button type="button" onClick={() => void toggleActive(def)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${def.is_active ? 'text-amber-700 border-amber-200' : 'text-green-600 border-green-200'}`}>
                            {def.is_active ? 'إيقاف' : 'تفعيل'}
                          </button>
                          <button type="button" onClick={() => void archiveDef(def)} className="text-xs text-red-600 border border-red-200 px-2.5 py-1.5 rounded-lg">حذف</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!sortedDefs.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-[#767676]">لا مهام جزائية</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          def={editing}
          reqFields={editingFields}
          expenseRows={editingExpenses}
          applyAll={showAll}
          allowedBranchIds={allowedBranchIds}
          branchId={branchId}
          sameBranchDefs={allDefs.filter(d => d.branch_id === editing.branch_id)}
          allDefs={allDefs}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
      {creating && (
        <CreateModal
          branchCount={branchCount}
          applyAll={showAll}
          singleBranchId={branchId}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load() }}
        />
      )}
    </div>
  )
}
