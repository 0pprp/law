'use client'

import { useState, useCallback, useEffect } from 'react'
import { useBranchId, useBranch } from '@/context/branch'
import { isMainBranchName } from '@/lib/branch-constants'
import { cacheDelete } from '@/lib/query-cache'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import {
  parseCriminalImportExcel,
  validateCriminalImportRows,
  downloadCriminalImportTemplate,
  downloadCriminalImportReport,
  type CriminalPreviewRow,
  type CriminalImportExecuteResult,
  type CriminalImportProgress,
} from '@/lib/criminal-debtor-import'
import {
  parseCriminalImportZipSafe,
  buildCriminalPdfLookup,
} from '@/lib/criminal-import-zip'
import { useAdminRole } from '@/context/admin-role'

type Step = 'upload' | 'preview' | 'importing' | 'done'

interface Props {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

const PHASE_LABELS: Record<CriminalImportProgress['phase'], string> = {
  idle: '',
  reading_excel: 'قراءة Excel',
  reading_zip: 'قراءة ZIP',
  validating: 'فحص البيانات',
  importing: 'استيراد السجلات',
  done: 'اكتمل',
}

export default function CriminalDebtorImportModal({ open, onClose, onComplete }: Props) {
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const role = useAdminRole()
  const branchOk = !!(branchId && branchName && !isMainBranchName(branchName))

  const [step, setStep] = useState<Step>('upload')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [branchOptions, setBranchOptions] = useState<{ value: string; label: string }[]>([])
  const [preview, setPreview] = useState<CriminalPreviewRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<CriminalImportProgress | null>(null)
  const [result, setResult] = useState<CriminalImportExecuteResult | null>(null)
  const [importRunId, setImportRunId] = useState('')

  const reset = useCallback(() => {
    setStep('upload')
    setExcelFile(null)
    setZipFile(null)
    setPreview([])
    setError('')
    setLoading(false)
    setSubmitting(false)
    setProgress(null)
    setResult(null)
    setImportRunId('')
  }, [])

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    void supabase.from('branches').select('id, name').order('name').then(({ data }) => {
      const opts = (data ?? [])
        .filter(b => !isMainBranchName(b.name))
        .map(b => ({ value: b.id, label: b.name }))
      setBranchOptions(opts)
    })
  }, [open])

  function handleClose() {
    if (loading || submitting) return
    reset()
    onClose()
  }

  async function handlePreview() {
    if (!branchOk || !branchId) {
      setError('اختر فرعاً رسمياً من القائمة العلوية قبل الاستيراد')
      return
    }
    if (!excelFile) { setError('ارفع ملف Excel'); return }
    setLoading(true)
    setError('')
    setProgress({ phase: 'reading_excel', current: 0, total: 1, message: 'قراءة Excel...' })

    try {
      const parsed = await parseCriminalImportExcel(excelFile)
      if (parsed.error) { setError(parsed.error); setLoading(false); setProgress(null); return }
      if (!parsed.rows.length) {
        setError('ملف Excel فارغ أو بلا صفوف بيانات')
        setLoading(false)
        setProgress(null)
        return
      }

      setProgress({ phase: 'reading_zip', current: 0, total: 1, message: 'قراءة ZIP...' })
      let pdfByKey = new Map<string, import('@/lib/criminal-import-zip').SafeZipPdf>()
      let pdfDuplicates = new Set<string>()
      let hasZip = false
      if (zipFile) {
        const zipRes = await parseCriminalImportZipSafe(zipFile)
        if (!zipRes.ok) { setError(zipRes.error); setLoading(false); setProgress(null); return }
        const lookup = buildCriminalPdfLookup(zipRes.files)
        pdfByKey = lookup.byKey
        pdfDuplicates = lookup.duplicates
        hasZip = true
      }

      setProgress({ phase: 'validating', current: 0, total: parsed.rows.length, message: 'فحص...' })
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const { data: profile } = user
        ? await supabase.from('profiles').select('role, branch_id, accountant_type').eq('id', user.id).maybeSingle()
        : { data: null }

      const validated = validateCriminalImportRows(parsed.rows, {
        branches: branchOptions.map(o => ({ id: o.value, name: o.label })),
        defaultBranchId: branchId,
        defaultBranchName: branchName,
        profile: profile ? { role: profile.role, branch_id: profile.branch_id, accountant_type: profile.accountant_type } : { role },
        pdfByKey,
        pdfDuplicates,
        hasZip,
      })

      setPreview(validated)
      setImportRunId(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      )
      setStep('preview')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل قراءة الملفات')
    }
    setLoading(false)
    setProgress(null)
  }

  async function handleImport() {
    if (!excelFile || submitting || !branchOk || !branchId) return
    const ready = preview.filter(r => r.valid)
    if (!ready.length) { setError('لا توجد صفوف صالحة'); return }

    setSubmitting(true)
    setLoading(true)
    setError('')
    setStep('importing')
    setProgress({ phase: 'importing', current: 0, total: ready.length, message: 'جاري الاستيراد...' })

    try {
      const form = new FormData()
      form.append('excel', excelFile)
      if (zipFile) form.append('zip', zipFile)
      form.append('defaultBranchId', branchId)
      form.append('importRunId', importRunId || crypto.randomUUID())

      const res = await fetch('/api/admin/debtors/import-criminal', {
        method: 'POST',
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل الاستيراد')
        setStep('preview')
        setSubmitting(false)
        setLoading(false)
        setProgress(null)
        return
      }

      const importResult = json as CriminalImportExecuteResult
      setResult(importResult)
      setStep('done')
      setProgress({ phase: 'done', current: 1, total: 1, message: 'اكتمل' })

      cacheDelete(`dashboard:${branchId}`)
      if ((importResult.success + importResult.successWithWarning) > 0) onComplete()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الاستيراد')
      setStep('preview')
    }
    setSubmitting(false)
    setLoading(false)
  }

  if (!open) return null

  const validCount = preview.filter(r => r.valid).length
  const invalidCount = preview.filter(r => !r.valid).length
  const warningCount = preview.filter(r => r.valid && r.warnings.length > 0).length
  const progressPct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={handleClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.12)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-black text-[#231F20]">استيراد مدينين جزائيين من Excel</h2>
            {branchName && (
              <p className="text-xs text-[#767676] mt-0.5">الفرع: {branchName}</p>
            )}
          </div>
          <button type="button" onClick={handleClose} disabled={loading || submitting}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-[#767676] text-xl disabled:opacity-40">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!branchOk && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
              اختر فرعاً رسمياً من القائمة العلوية قبل الاستيراد.
            </div>
          )}

          {step === 'upload' && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void downloadCriminalImportTemplate()}>
                  تحميل قالب Excel
                </Button>
              </div>
              <p className="text-xs text-[#767676]">
                الاسم والفرع إلزاميان في Excel (أو يُستخدم الفرع الحالي من الشريط العلوي إن تُرك عمود الفرع فارغاً).
                {' '}قيم العقد والكفيل: <span className="font-semibold">نعم / لا / فقط عقد</span>.
                {' '}تنسيق التاريخ: YYYY-MM-DD أو DD/MM/YYYY.
                {' '}اسم ملف المستمسكات يجب أن يطابق الموجود داخل ZIP (PDF فقط).
                {' '}عريضة الدعوى <span className="font-semibold">لا تُستورد هنا</span> — تُرفع لاحقاً من صفحة المدين.
              </p>

              <div className="grid grid-cols-1 gap-4">
                <label className="block">
                  <span className="text-sm font-bold text-[#231F20] mb-2 block">ملف Excel (.xlsx / .xls) *</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={e => setExcelFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-[#767676] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2C8780]/10 file:text-[#2C8780] file:font-semibold"
                  />
                  {excelFile && <p className="text-xs text-[#2C8780] mt-1">{excelFile.name}</p>}
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-[#231F20] mb-2 block">ملف ZIP (مستمسكات PDF)</span>
                  <span className="text-[10px] text-[#767676] block mb-1.5">اختياري — لعدة مدينين دفعة واحدة</span>
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    onChange={e => setZipFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-[#767676] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2C8780]/10 file:text-[#2C8780] file:font-semibold"
                  />
                  {zipFile && <p className="text-xs text-[#2C8780] mt-1">{zipFile.name}</p>}
                </label>
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="font-bold text-emerald-700">{validCount} صالح</span>
                {warningCount > 0 && (
                  <span className="font-bold text-amber-700">{warningCount} تحذير</span>
                )}
                <span className="font-bold text-red-600">{invalidCount} خطأ</span>
                <span className="text-[#767676]">من {preview.length} صف</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[rgba(118,118,118,0.15)] max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-[#F3F1F2] sticky top-0">
                    <tr>
                      {['#', 'الاسم', 'الفرع', 'PDF', 'حالة PDF', 'الحالة', 'تنبيه', 'خطأ'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-right font-bold text-[#767676] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(118,118,118,0.08)]">
                    {preview.map(row => {
                      const hasWarning = row.valid && row.warnings.length > 0
                      const rowCls = !row.valid ? 'bg-red-50/50' : hasWarning ? 'bg-amber-50/60' : ''
                      const pdfStatusCls =
                        row.pdfStatus === 'موجود' ? 'text-emerald-700' :
                        row.pdfStatus === 'بدون ملف' || row.pdfStatus === 'غير موجود' ? 'text-amber-700 font-semibold' :
                        row.pdfStatus === 'مكرر في ZIP' ? 'text-red-600' : 'text-[#767676]'
                      return (
                        <tr key={row.rowNum} className={rowCls}>
                          <td className="px-3 py-2 font-mono">{row.rowNum}</td>
                          <td className="px-3 py-2 font-semibold">{row.full_name || '—'}</td>
                          <td className="px-3 py-2">{row.resolvedBranchName || row.branch_name || '—'}</td>
                          <td className="px-3 py-2 truncate max-w-[120px]" title={row.documents_filename}>{row.documents_filename || '—'}</td>
                          <td className={`px-3 py-2 ${pdfStatusCls}`}>{row.pdfStatus}</td>
                          <td className="px-3 py-2">
                            {!row.valid ? (
                              <span className="font-bold text-red-600">خطأ</span>
                            ) : hasWarning ? (
                              <span className="font-bold text-amber-700">صالح</span>
                            ) : (
                              <span className="font-bold text-emerald-700">صالح</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-amber-700 max-w-[180px]">{row.warnings.join(' · ') || '—'}</td>
                          <td className="px-3 py-2 text-red-600 max-w-[180px]">{row.errors.join(' · ') || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === 'importing' && progress && (
            <div className="py-8 space-y-4">
              <p className="text-sm font-bold text-[#231F20] text-center">
                {PHASE_LABELS[progress.phase]} — {progress.message}
              </p>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden max-w-md mx-auto">
                <div className="h-full bg-[#2C8780] transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-[#767676] text-center tabular-nums">
                {progress.current} / {progress.total}
              </p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="py-6 space-y-4 text-center">
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-black text-[#231F20]">اكتمل الاستيراد</p>
              <p className="text-sm text-[#767676]">
                نجاح <span className="font-bold text-emerald-700">{result.success}</span>
                {' · '}
                مع تحذير <span className="font-bold text-amber-700">{result.successWithWarning}</span>
                {' · '}
                فشل <span className="font-bold text-red-600">{result.failed}</span>
              </p>
              <p className="text-xs text-[#767676]">
                المدة: {result.durationMs} مللي ثانية
                {result.duplicateRequest ? ' · طلب مكرر (Idempotent)' : ''}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void downloadCriminalImportReport(result)}>
                تحميل تقرير النتائج Excel
              </Button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.12)] flex justify-end gap-2 shrink-0">
          {step === 'upload' && (
            <>
              <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
              <Button type="button" variant="primary" onClick={() => void handlePreview()} loading={loading} disabled={!branchOk || !excelFile}>
                معاينة
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button type="button" variant="outline" onClick={() => { setStep('upload'); setPreview([]) }} disabled={loading || submitting}>رجوع</Button>
              <Button type="button" variant="primary" onClick={() => void handleImport()} loading={loading || submitting} disabled={validCount === 0}>
                تنفيذ الاستيراد ({validCount})
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button type="button" variant="primary" onClick={handleClose}>إغلاق</Button>
          )}
        </div>
      </div>
    </div>
  )
}
