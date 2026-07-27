'use client'

import { useMemo, useState } from 'react'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import { formatMoney } from '@/lib/money-input'
import type { HybridLinkInfo } from '@/lib/hybrid-task-links'

export type HybridSelectionResult = {
  /** معرّفات التعريفات المحددة (تشمل الأساسية دائماً) */
  selectedDefinitionIds: string[]
  /** المهام المرتبطة المحددة فقط */
  selectedLinked: HybridLinkInfo[]
}

interface Props {
  parentLabel: string
  parentFee: number
  parentDefinitionId: string
  links: HybridLinkInfo[]
  onClose: () => void
  onContinue: (result: HybridSelectionResult) => void
}

export default function HybridTaskSelectionModal({
  parentLabel,
  parentFee,
  parentDefinitionId,
  links,
  onClose,
  onContinue,
}: Props) {
  const [selectedLinkedIds, setSelectedLinkedIds] = useState<Set<string>>(() => {
    // الإلزامية محددة افتراضياً
    return new Set(links.filter(l => !l.is_optional).map(l => l.linked_definition_id))
  })

  const requiredMissing = useMemo(
    () => links.some(l => !l.is_optional && !selectedLinkedIds.has(l.linked_definition_id)),
    [links, selectedLinkedIds],
  )

  function toggleLinked(id: string, isOptional: boolean) {
    if (!isOptional) return // إلزامية لا تُلغى من الواجهة — لكن نسمح بإعادة التحديد إن فُقدت
    setSelectedLinkedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleContinue() {
    if (requiredMissing) return
    const selectedLinked = links.filter(l => selectedLinkedIds.has(l.linked_definition_id))
    onContinue({
      selectedDefinitionIds: [parentDefinitionId, ...selectedLinked.map(l => l.linked_definition_id)],
      selectedLinked,
    })
  }

  return (
    <CenteredModalPortal onBackdropClick={onClose} zIndex={56} ariaLabelledBy="hybrid-select-title">
      <div className="bg-white w-full max-w-lg rounded-2xl max-h-[min(85vh,720px)] flex flex-col shadow-2xl border border-slate-200/80">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <h2 id="hybrid-select-title" className="font-black text-[#231F20] text-base">اختيار المهام</h2>
            <p className="text-xs text-[#767676] mt-1 leading-relaxed">
              المهمة الأساسية ثابتة — يمكنك إضافة المهام المرتبطة الاختيارية
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 shrink-0"
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3 min-h-0">
          {/* الأساسية — مقفلة */}
          <label className="flex items-start gap-3 px-3.5 py-3 rounded-xl border-2 border-[#2C8780]/40 bg-[#2C8780]/8">
            <input
              type="checkbox"
              checked
              disabled
              className="accent-[#2C8780] w-4 h-4 mt-0.5 opacity-80"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-[#231F20]">{parentLabel}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2C8780]/15 text-[#2C8780]">
                  أساسية
                </span>
              </span>
              <span className="block text-[11px] text-[#767676] tabular-nums mt-1" dir="ltr">
                {formatMoney(parentFee, { suffix: false })} د.ع
              </span>
            </span>
          </label>

          {links.map(link => {
            const checked = selectedLinkedIds.has(link.linked_definition_id)
            const locked = !link.is_optional
            return (
              <label
                key={link.linked_definition_id}
                className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border cursor-pointer ${
                  checked
                    ? 'border-sky-300 bg-sky-50/60'
                    : 'border-slate-200 bg-white'
                } ${locked ? 'cursor-default' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggleLinked(link.linked_definition_id, link.is_optional)}
                  className="accent-[#2C8780] w-4 h-4 mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-[#231F20]">{link.label || 'مهمة مرتبطة'}</span>
                    {!link.is_optional && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        إلزامية
                      </span>
                    )}
                    {link.is_optional && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        اختيارية
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-[#767676] tabular-nums mt-1" dir="ltr">
                    {formatMoney(Number(link.fee_amount), { suffix: false })} د.ع
                  </span>
                </span>
              </label>
            )
          })}

          {requiredMissing && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              يجب تحديد كل المهام الإلزامية للمتابعة
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 shrink-0 bg-white rounded-b-2xl">
          <button
            type="button"
            onClick={handleContinue}
            disabled={requiredMissing}
            className="w-full py-3.5 rounded-xl text-white font-black text-sm disabled:opacity-50 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            متابعة
          </button>
        </div>
      </div>
    </CenteredModalPortal>
  )
}
