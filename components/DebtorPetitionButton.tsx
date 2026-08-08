'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import { arabicAmountInWords, formatPetitionAmountDigits } from '@/lib/arabic-tafqeet'
import {
  buildPetitionHtml,
  buildPetitionFileName,
  DEFAULT_PLAINTIFF_NAME,
  emptyPetitionFields,
  normalizePetitionFields,
  PETITION_FIELD_KEYS,
  PETITION_FIELD_LABELS,
  validatePetitionFields,
  type DebtorPetitionFields,
} from '@/lib/debtor-petition'
import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input'
import { appAlert } from '@/lib/app-dialog'
import {
  blobToBase64,
  htmlToPetitionPdfBlob,
  triggerBlobDownload,
} from '@/lib/debtor-petition-client-pdf'

const INP =
  'w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

export interface DebtorPetitionDefaults {
  courtName?: string | null
  defendantName?: string | null
  defendantOccupation?: string | null
  defendantAddress?: string | null
  amount?: number | null
  lawyerName?: string | null
  plaintiffName?: string | null
}

interface Props {
  debtorId: string
  defaults: DebtorPetitionDefaults
}

type Step = 'form' | 'preview'

export default function DebtorPetitionButton({ debtorId, defaults }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [fields, setFields] = useState<DebtorPetitionFields>(emptyPetitionFields())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function hydrateFromDefaults() {
    const amountNum = Number(defaults.amount ?? 0)
    const amountDigits = amountNum > 0 ? formatPetitionAmountDigits(amountNum) : ''
    setFields({
      courtName: (defaults.courtName ?? '').trim(),
      plaintiffName: (defaults.plaintiffName ?? DEFAULT_PLAINTIFF_NAME).trim() || DEFAULT_PLAINTIFF_NAME,
      defendantName: (defaults.defendantName ?? '').trim(),
      defendantOccupation: (defaults.defendantOccupation ?? '').trim(),
      defendantAddress: (defaults.defendantAddress ?? '').trim(),
      amountDigits,
      amountWords: amountDigits ? arabicAmountInWords(amountDigits) : '',
      lawyerName: (defaults.lawyerName ?? '').trim(),
    })
  }

  useEffect(() => {
    if (!open) return
    hydrateFromDefaults()
    setStep('form')
    setError('')
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open only
  }, [open])

  const previewHtml = useMemo(() => buildPetitionHtml(fields), [fields])

  function updateField<K extends keyof DebtorPetitionFields>(key: K, value: string) {
    setFields(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'amountDigits') {
        const digits = formatMoneyInput(value)
        next.amountDigits = digits
        const n = parseMoneyInput(digits)
        if (n > 0) next.amountWords = arabicAmountInWords(n)
      }
      return next
    })
  }

  function handleCreatePreview() {
    const normalized = normalizePetitionFields(fields)
    const err = validatePetitionFields(normalized)
    if (err) {
      setError(err)
      return
    }
    setFields(normalized)
    setError('')
    setStep('preview')
  }

  async function downloadAndSave() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const normalized = normalizePetitionFields(fields)
      const html = buildPetitionHtml(normalized)
      const fileName = buildPetitionFileName(normalized.defendantName)
      const pdfBlob = await htmlToPetitionPdfBlob(html)

      // تنزيل فوري من نفس شكل المعاينة (عربية صحيحة)
      triggerBlobDownload(pdfBlob, fileName)

      // حفظ في المرفقات عبر رفع الـ PDF الجاهز
      const pdfBase64 = await blobToBase64(pdfBlob)
      const res = await fetch('/api/admin/debtor-petition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          download: false,
          debtorId,
          fields: normalized,
          pdfBase64,
          fileName,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : 'تم التنزيل لكن فشل الحفظ في المرفقات')
      }

      await appAlert({
        message: 'تم تنزيل العريضة وحفظها في مرفقات المدين',
        variant: 'success',
      })
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تنزيل وحفظ العريضة')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-white px-3 py-1.5 rounded-lg transition-colors font-semibold hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
      >
        إنشاء عريضة الدعوى
      </button>

      {open && (
        <CenteredModalPortal onBackdropClick={() => !busy && setOpen(false)} zIndex={80}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-[#231F20]">
                  {step === 'form' ? 'إنشاء عريضة الدعوى' : 'معاينة عريضة الدعوى'}
                </h2>
                <p className="text-[11px] text-[#767676] mt-0.5">
                  {step === 'form'
                    ? 'عدّل الحقول ثم أنشئ المعاينة — لن تُحفظ بيانات المدين الأصلية'
                    : 'راجع النص ثم نزّل العريضة — تُحفظ تلقائيًا في المرفقات'}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="text-[#767676] hover:text-[#231F20] text-sm font-bold px-2"
              >
                إغلاق
              </button>
            </div>

            <div className={`flex-1 p-5 ${step === 'preview' ? 'overflow-hidden flex flex-col min-h-0' : 'overflow-y-auto'}`}>
              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shrink-0">
                  {error}
                </div>
              )}

              {step === 'form' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PETITION_FIELD_KEYS.map(key => (
                    <label
                      key={key}
                      className={`block space-y-1 ${key === 'defendantAddress' || key === 'amountWords' ? 'sm:col-span-2' : ''}`}
                    >
                      <span className="text-xs font-bold text-[#767676]">
                        {PETITION_FIELD_LABELS[key]} <span className="text-red-500">*</span>
                      </span>
                      {key === 'defendantAddress' || key === 'amountWords' ? (
                        <textarea
                          className={`${INP} resize-none min-h-[72px]`}
                          value={fields[key]}
                          onChange={e => updateField(key, e.target.value)}
                          required
                        />
                      ) : (
                        <input
                          className={INP}
                          value={fields[key]}
                          onChange={e => updateField(key, e.target.value)}
                          dir={key === 'amountDigits' ? 'ltr' : undefined}
                          required
                        />
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex-1 min-h-0">
                  <iframe
                    title="معاينة عريضة الدعوى"
                    className="w-full h-full min-h-[55vh] bg-white border-0"
                    srcDoc={previewHtml}
                    scrolling="yes"
                  />
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              {step === 'form' ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                    className="text-sm font-bold text-[#767676] px-3 py-2"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCreatePreview}
                    className="text-sm font-bold text-white px-4 py-2.5 rounded-xl disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                  >
                    إنشاء العريضة
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setStep('form'); setError('') }}
                    className="text-sm font-bold text-[#767676] border border-slate-200 px-3 py-2 rounded-xl"
                  >
                    رجوع للتعديل
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void downloadAndSave()}
                      className="text-sm font-bold text-white px-4 py-2.5 rounded-xl disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                    >
                      {busy ? 'جارٍ الحفظ والتنزيل...' : 'تنزيل PDF'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CenteredModalPortal>
      )}
    </>
  )
}
