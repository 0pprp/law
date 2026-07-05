'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId, useBranch } from '@/context/branch'
import { isMainBranchName } from '@/lib/branch-constants'
import { cacheDelete } from '@/lib/query-cache'
import { logActivity } from '@/lib/activity-log'
import { Button } from '@/components/ui/button'
import {
  parseImportExcel,
  buildPdfMap,
  validateImportRows,
  fetchExistingReceiptNumbers,
  executeDebtorImport,
  downloadImportTemplate,
  downloadErrorReport,
  IMPORT_RECEIPT_TYPE_HINT,
  type ImportPreviewRow,
  type ImportProgress,
  type TaskDefRef,
  type ImportExecuteResult,
} from '@/lib/debtor-import'

type Step = 'upload' | 'preview' | 'importing' | 'done'

interface Props {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

const PHASE_LABELS: Record<ImportProgress['phase'], string> = {
  idle: '',
  reading_excel: 'قراءة ملف Excel',
  reading_zip: 'قراءة ملفات PDF',
  validating: 'فحص البيانات',
  creating_debtors: 'إنشاء المدينين',
  creating_tasks: 'إنشاء المهام',
  uploading_files: 'رفع الملفات',
  done: 'اكتمل',
}

export default function DebtorImportModal({ open, onClose, onComplete }: Props) {
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const branchOk = !!(branchId && branchName && !isMainBranchName(branchName))

  const [step, setStep] = useState<Step>('upload')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [pdfFiles, setPdfFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<ImportPreviewRow[]>([])
  const [taskDefs, setTaskDefs] = useState<TaskDefRef[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportExecuteResult | null>(null)

  const reset = useCallback(() => {
    setStep('upload')
    setExcelFile(null)
    setZipFile(null)
    setPdfFiles([])
    setPreview([])
    setTaskDefs([])
    setError('')
    setLoading(false)
    setProgress(null)
    setResult(null)
  }, [])

  function handleClose() {
    if (loading) return
    reset()
    onClose()
  }

  async function handlePreview() {
    if (!branchOk || !branchId) {
      setError('اختر فرعاً رسمياً من القائمة العلوية')
      return
    }
    if (!excelFile) { setError('ارفع ملف Excel'); return }

    setLoading(true)
    setError('')
    setProgress({ phase: 'reading_excel', current: 0, total: 1, message: 'قراءة Excel...' })

    try {
      const supabase = createClient()
      let defsQ = supabase.from('task_definitions').select('id, label, fee_amount').eq('is_active', true)
      defsQ = (defsQ as typeof defsQ).eq('branch_id', branchId)
      const rows = await parseImportExcel(excelFile)
      setProgress({ phase: 'reading_zip', current: 0, total: 1, message: 'قراءة ملفات PDF...' })
      const pdfMap = await buildPdfMap(zipFile, pdfFiles)
      const { data: defs } = await defsQ.order('sort_order').order('label')

      const taskDefList = (defs ?? []) as TaskDefRef[]
      if (!taskDefList.length) {
        setError('لا توجد مهام معرّفة في هذا الفرع')
        setLoading(false)
        return
      }
      if (!rows.length) {
        setError('ملف Excel فارغ أو لا يحتوي صفوف بيانات')
        setLoading(false)
        return
      }

      setProgress({ phase: 'validating', current: 0, total: rows.length, message: 'فحص البيانات...' })
      const existing = await fetchExistingReceiptNumbers(supabase, branchId)
      const validated = validateImportRows(rows, pdfMap, taskDefList, existing)

      setTaskDefs(taskDefList)
      setPreview(validated)
      setStep('preview')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل قراءة الملفات')
    }
    setLoading(false)
    setProgress(null)
  }

  async function handleImport() {
    if (!branchOk || !branchId || !branchName) return
    const validRows = preview.filter(r => r.valid)
    if (!validRows.length) {
      setError('لا توجد صفوف صالحة للاستيراد')
      return
    }

    const pdfWarningRows = validRows.filter(r => r.warnings.some(w => w.includes('PDF')))
    if (pdfWarningRows.length > 0) {
      const names = pdfWarningRows.slice(0, 5).map(r => r.full_name).join('، ')
      const more = pdfWarningRows.length > 5 ? ` و${pdfWarningRows.length - 5} آخرين` : ''
      const ok = window.confirm(
        `${pdfWarningRows.length} مدين بدون ملف PDF (${names}${more}).\n\nهل تريد المتابعة؟ يمكنك إضافة PDF لاحقاً من بروفايل المدين.`,
      )
      if (!ok) return
    }

    setLoading(true)
    setError('')
    setStep('importing')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('يجب تسجيل الدخول')
      setLoading(false)
      return
    }

    const today = new Date().toISOString().split('T')[0]
    const importResult = await executeDebtorImport(
      supabase,
      validRows,
      { branchId, governorate: branchName, userId: user.id, taskDefs, today },
      setProgress,
    )

    const previewFailures = preview
      .filter(r => !r.valid)
      .map(r => ({
        rowNum: r.rowNum,
        full_name: r.full_name,
        receipt_number: r.receipt_number,
        errors: r.errors,
      }))

    const fullResult: ImportExecuteResult = {
      imported: importResult.imported,
      failed: importResult.failed + previewFailures.length,
      failures: [...previewFailures, ...importResult.failures],
    }

    await logActivity({
      action: 'create_debtor',
      entity_type: 'debtor',
      description: `استيراد جماعي: ${importResult.imported} مدين — فشل ${fullResult.failed}`,
    }, supabase)

    if (branchId) {
      cacheDelete(`tasks:assign:${branchId}`)
      cacheDelete(`dashboard:${branchId}`)
    }

    setResult(fullResult)
    setStep('done')
    setLoading(false)
    onComplete()
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
            <h2 className="text-lg font-black text-[#231F20]">استيراد المدينين من Excel</h2>
            {branchName && (
              <p className="text-xs text-[#767676] mt-0.5">الفرع: {branchName}</p>
            )}
          </div>
          <button type="button" onClick={handleClose} disabled={loading}
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
                <Button type="button" variant="outline" size="sm" onClick={() => downloadImportTemplate()}>
                  تحميل قالب Excel
                </Button>
              </div>
              <p className="text-xs text-[#767676]">
                أنواع السند: {IMPORT_RECEIPT_TYPE_HINT} · المهمة يجب أن تطابق اسم المهمة في الفرع <span className="font-semibold">تماماً</span>.
                {' '}مجموعة التسديدات ومجموعة الصرفيات <span className="font-semibold">اختياريان</span> — رقم إجمالي واحد لكل حقل.
                {' '}رقم الهوية <span className="font-semibold">اختياري</span>.
                {' '}ملف PDF <span className="font-semibold">اختياري</span> — ارفع ZIP للمجموعة أو ملفات PDF فردية.
              </p>

              <div className="grid grid-cols-1 gap-4">
                <label className="block">
                  <span className="text-sm font-bold text-[#231F20] mb-2 block">ملف Excel (.xlsx / .xls) *</span>
                  <input type="file" accept=".xlsx,.xls" onChange={e => setExcelFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-[#767676] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2C8780]/10 file:text-[#2C8780] file:font-semibold" />
                  {excelFile && <p className="text-xs text-[#2C8780] mt-1">{excelFile.name}</p>}
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-sm font-bold text-[#231F20] mb-2 block">ملف ZIP (مجموعة PDF)</span>
                    <span className="text-[10px] text-[#767676] block mb-1.5">اختياري — لعدة مدينين دفعة واحدة</span>
                    <input type="file" accept=".zip,application/zip" onChange={e => setZipFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-[#767676] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2C8780]/10 file:text-[#2C8780] file:font-semibold" />
                    {zipFile && <p className="text-xs text-[#2C8780] mt-1">{zipFile.name}</p>}
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold text-[#231F20] mb-2 block">ملفات PDF فردية</span>
                    <span className="text-[10px] text-[#767676] block mb-1.5">اختياري — ملف أو أكثر (مدين واحد أو أكثر)</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      onChange={e => setPdfFiles(Array.from(e.target.files ?? []))}
                      className="block w-full text-sm text-[#767676] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#2C8780]/10 file:text-[#2C8780] file:font-semibold"
                    />
                    {pdfFiles.length > 0 && (
                      <p className="text-xs text-[#2C8780] mt-1">{pdfFiles.length} ملف: {pdfFiles.map(f => f.name).join('، ')}</p>
                    )}
                  </label>
                </div>
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="font-bold text-emerald-700">{validCount} صالح</span>
                {warningCount > 0 && (
                  <span className="font-bold text-amber-700">{warningCount} تحذير PDF</span>
                )}
                <span className="font-bold text-red-600">{invalidCount} خطأ</span>
                <span className="text-[#767676]">من {preview.length} صف</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[rgba(118,118,118,0.15)]">
                <table className="w-full text-xs">
                  <thead className="bg-[#F3F1F2]">
                    <tr>
                      {['#', 'الاسم', 'الهاتف', 'رقم الهوية', 'رقم الوصل', 'المهمة', 'PDF', 'حالة PDF', 'الحالة', 'تنبيه', 'خطأ'].map(h => (
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
                        row.pdfStatus === 'ليس PDF' ? 'text-red-600' : 'text-[#767676]'
                      return (
                      <tr key={row.rowNum} className={rowCls}>
                        <td className="px-3 py-2 font-mono">{row.rowNum}</td>
                        <td className="px-3 py-2 font-semibold">{row.full_name || '—'}</td>
                        <td className="px-3 py-2 font-mono" dir="ltr">{row.phone || '—'}</td>
                        <td className="px-3 py-2 font-mono" dir="ltr">{row.id_number || '—'}</td>
                        <td className="px-3 py-2 font-mono" dir="ltr">{row.receipt_number || '—'}</td>
                        <td className="px-3 py-2">{row.task_label || '—'}</td>
                        <td className="px-3 py-2 truncate max-w-[120px]" title={row.pdf_filename}>{row.pdf_filename || '—'}</td>
                        <td className={`px-3 py-2 ${pdfStatusCls}`}>
                          {row.pdfStatus === 'غير موجود' || row.pdfStatus === 'بدون ملف' ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-amber-500" aria-hidden>⚠</span>
                              {row.pdfStatus}
                            </span>
                          ) : row.pdfStatus}
                        </td>
                        <td className="px-3 py-2">
                          {!row.valid ? (
                            <span className="font-bold text-red-600">خطأ</span>
                          ) : hasWarning ? (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700">
                              <span aria-hidden>⚠</span>
                              صالح
                            </span>
                          ) : (
                            <span className="font-bold text-emerald-700">صالح</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-amber-700 max-w-[180px]">{row.warnings.join(' · ') || '—'}</td>
                        <td className="px-3 py-2 text-red-600 max-w-[180px]">{row.errors.join(' · ') || '—'}</td>
                      </tr>
                    )})}
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
                تم استيراد <span className="font-bold text-emerald-700">{result.imported}</span>
                {' · '}
                فشل <span className="font-bold text-red-600">{result.failed}</span>
              </p>
              {result.failures.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => downloadErrorReport(result.failures)}>
                  تحميل تقرير الأخطاء Excel
                </Button>
              )}
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
              <Button type="button" variant="primary" onClick={handlePreview} loading={loading} disabled={!branchOk}>
                معاينة
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('upload')} disabled={loading}>رجوع</Button>
              <Button type="button" variant="primary" onClick={handleImport} loading={loading} disabled={validCount === 0}>
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
