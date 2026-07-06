import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReceiptType } from '@/lib/types'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import { findOrCreateBranchList } from '@/lib/branch-lists'

export const IMPORT_EXCEL_HEADERS = [
  'الاسم الكامل',
  'رقم الهاتف',
  'رقم الهوية',
  'رقم الوصل',
  'نوع السند',
  'مبلغ السند',
  'المبلغ المتبقي',
  'مجموع الصرفيات',
  'يوجد عقد',
  'الشرط الجزائي',
  'العنوان',
  'ملاحظات',
  'المهمة المطلوبة',
  'اسم ملف PDF',
  'القائمة',
] as const

export const IMPORT_EXPENSES_GROUP_LABEL = 'مجموع صرفيات سابق من Excel'

export type ImportExcelHeader = (typeof IMPORT_EXCEL_HEADERS)[number]

export interface ParsedImportRow {
  rowNum: number
  full_name: string
  phone: string
  id_number: string
  receipt_number: string
  receipt_type_raw: string
  receipt_amount_raw: string
  remaining_amount_raw: string
  expenses_total_raw: string
  has_contract_raw: string
  penalty_amount_raw: string
  address: string
  notes: string
  task_label: string
  pdf_filename: string
  list_name_raw: string
}

export interface ImportPreviewRow extends ParsedImportRow {
  valid: boolean
  errors: string[]
  warnings: string[]
  pdfStatus: 'موجود' | 'غير موجود' | 'ليس PDF' | 'بدون ملف' | '—'
  receipt_type: ReceiptType | null
  receipt_amount: number | null
  /** المتبقي من الوصل (من Excel — بعد تسديدات سابقة على السند) */
  receipt_remaining: number | null
  expenses_total: number
  /** المبلغ المطلوب = المتبقي من الوصل + مجموع الصرفيات؛ ويساوي المتبقي عند الإضافة */
  required_amount: number | null
  has_contract: boolean
  penalty_amount: number
  task_definition_id: string | null
  pdfBlob: Blob | null
  list_name: string | null
}

export interface TaskDefRef {
  id: string
  label: string
  fee_amount: number
}

export type ImportProgressPhase =
  | 'idle'
  | 'reading_excel'
  | 'reading_zip'
  | 'validating'
  | 'creating_debtors'
  | 'creating_tasks'
  | 'uploading_files'
  | 'done'

export interface ImportProgress {
  phase: ImportProgressPhase
  current: number
  total: number
  message: string
}

export interface ImportExecuteResult {
  imported: number
  failed: number
  failures: { rowNum: number; full_name: string; receipt_number: string; errors: string[] }[]
}

const RECEIPT_TYPE_BY_LABEL: Record<string, ReceiptType> = {
  صك: 'check',
  check: 'check',
  كمبيالة: 'bill_of_exchange',
  كومبيالة: 'bill_of_exchange',
  bill_of_exchange: 'bill_of_exchange',
  'وصل أمانة': 'trust',
  'وصل امانة': 'trust',
  'وصل امانه': 'trust',
  trust: 'trust',
  عقد: 'contract',
  contract: 'contract',
  أخرى: 'other',
  other: 'other',
}

/** توحيد كتابة نوع السند — مرن لـ وصل أمانة وكمبيالة */
export function normalizeReceiptTypeInput(raw: string): string {
  const s = raw
    .trim()
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase()

  if (s === 'وصل امانة' || s === 'وصل امانه') return 'وصل أمانة'
  if (s === 'كمبيالة' || s === 'كومبيالة') return 'كمبيالة'
  return raw.trim()
}

/** المبلغ المطلوب عند الاستيراد = المتبقي من الوصل + مجموع الصرفيات */
export function computeImportRequiredAmount(
  receiptRemaining: number,
  expensesTotal: number,
): number {
  return receiptRemaining + expensesTotal
}

function readExpensesTotalCell(row: Record<string, unknown>): string {
  const primary = cellStr(row['مجموع الصرفيات'])
  if (primary) return primary
  return cellStr(row['مجموعة الصرفيات'])
}

function normalizeFileName(name: string): string {
  return name.trim().toLowerCase().replace(/\\/g, '/').split('/').pop() ?? ''
}

function parseBool(val: string): boolean {
  const s = val.trim().toLowerCase()
  return s === 'نعم' || s === 'yes' || s === 'true' || s === '1' || s === 'y'
}

function parseAmount(raw: string, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const s = raw.trim()
  if (!s) return { ok: true, value: 0 }
  const normalized = s.replace(/,/g, '')
  if (!/^\d+$/.test(normalized)) {
    return { ok: false, error: `${label} — يجب أن يكون رقماً` }
  }
  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label} غير صحيح` }
  return { ok: true, value: n }
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function isTemplatePlaceholderRow(taskLabel: string): boolean {
  const t = taskLabel.trim()
  if (/اكتب اسم المهمة|^—\s*/.test(t)) return true
  if (t.includes('كما في النظام')) return true
  return false
}

export async function parseImportExcel(file: File): Promise<ParsedImportRow[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const rows: ParsedImportRow[] = []

  json.forEach((row, idx) => {
    const full_name = cellStr(row['الاسم الكامل'])
    const phone = cellStr(row['رقم الهاتف'])
    const id_number = cellStr(row['رقم الهوية'])
    const receipt_number = cellStr(row['رقم الوصل'])
    const hasAny = [full_name, phone, id_number, receipt_number, cellStr(row['المهمة المطلوبة']), cellStr(row['اسم ملف PDF'])].some(Boolean)
    if (!hasAny) return

    const task_label = cellStr(row['المهمة المطلوبة'])
    if (isTemplatePlaceholderRow(task_label)) return

    rows.push({
      rowNum: idx + 2,
      full_name,
      phone,
      id_number,
      receipt_number,
      receipt_type_raw: cellStr(row['نوع السند']),
      receipt_amount_raw: cellStr(row['مبلغ السند']),
      remaining_amount_raw: cellStr(row['المبلغ المتبقي']),
      expenses_total_raw: readExpensesTotalCell(row),
      has_contract_raw: cellStr(row['يوجد عقد']),
      penalty_amount_raw: cellStr(row['الشرط الجزائي']),
      address: cellStr(row['العنوان']),
      notes: cellStr(row['ملاحظات']),
      task_label,
      pdf_filename: cellStr(row['اسم ملف PDF']),
      list_name_raw: cellStr(row['القائمة']),
    })
  })

  return rows
}

export async function parseImportZip(file: File): Promise<Map<string, Blob>> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const map = new Map<string, Blob>()

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const name = normalizeFileName(path)
    if (!name) continue
    const blob = await entry.async('blob')
    map.set(name, blob)
  }
  return map
}

/** Individual PDF files — keyed by file name (for single or few debtors). */
export function parseImportPdfFiles(files: File[]): Map<string, Blob> {
  const map = new Map<string, Blob>()
  for (const file of files) {
    const name = normalizeFileName(file.name)
    if (!name) continue
    map.set(name, file)
  }
  return map
}

/** Merge ZIP archive + loose PDF files into one lookup map. */
export async function buildPdfMap(
  zipFile: File | null,
  pdfFiles: File[],
): Promise<Map<string, Blob>> {
  const map = new Map<string, Blob>()
  for (const [k, v] of parseImportPdfFiles(pdfFiles)) map.set(k, v)
  if (zipFile) {
    const fromZip = await parseImportZip(zipFile)
    for (const [k, v] of fromZip) map.set(k, v)
  }
  return map
}

export async function fetchExistingReceiptNumbers(
  supabase: SupabaseClient,
  branchId: string,
): Promise<Set<string>> {
  const set = new Set<string>()
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data } = await supabase
      .from('debtors')
      .select('receipt_number')
      .eq('branch_id', branchId)
      .not('receipt_number', 'is', null)
      .range(from, from + pageSize - 1)
    if (!data?.length) break
    for (const r of data) {
      if (r.receipt_number) set.add(String(r.receipt_number).trim())
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  return set
}

export function validateImportRows(
  rows: ParsedImportRow[],
  pdfMap: Map<string, Blob>,
  taskDefs: TaskDefRef[],
  existingReceipts: Set<string>,
): ImportPreviewRow[] {
  const fileReceipts = new Set<string>()
  const defByLabel = new Map(taskDefs.map(d => [d.label.trim(), d]))

  return rows.map(row => {
    const errors: string[] = []
    const warnings: string[] = []
    let pdfStatus: ImportPreviewRow['pdfStatus'] = '—'
    let pdfBlob: Blob | null = null

    const PDF_WARNING = 'لا يحتوي PDF — يمكن إضافته لاحقاً من بروفايل المدين'

    if (!row.full_name) errors.push('الاسم فارغ')
    if (!row.phone) errors.push('الهاتف فارغ')
    if (!row.receipt_number) {
      errors.push('رقم الوصل فارغ')
    } else {
      const rn = row.receipt_number.trim()
      if (fileReceipts.has(rn)) errors.push('رقم الوصل مكرر داخل الملف')
      else {
        fileReceipts.add(rn)
        if (existingReceipts.has(rn)) errors.push('رقم الوصل موجود سابقاً داخل نفس الفرع')
      }
    }

    const receiptTypeNormalized = normalizeReceiptTypeInput(row.receipt_type_raw)
    const receipt_type =
      RECEIPT_TYPE_BY_LABEL[receiptTypeNormalized]
      ?? RECEIPT_TYPE_BY_LABEL[receiptTypeNormalized.toLowerCase()]
      ?? null
    if (row.receipt_type_raw.trim() && !receipt_type) {
      errors.push('نوع السند غير معروف')
    }

    const receiptAmt = parseAmount(row.receipt_amount_raw, 'مبلغ السند')
    if (!receiptAmt.ok) errors.push(receiptAmt.error)
    const remainAmt = parseAmount(row.remaining_amount_raw, 'المبلغ المتبقي')
    if (!remainAmt.ok) errors.push(remainAmt.error)
    const expensesTotal = parseAmount(row.expenses_total_raw, 'مجموع الصرفيات')
    if (!expensesTotal.ok) errors.push(expensesTotal.error)

    const receipt_remaining = remainAmt.ok ? remainAmt.value : null
    const expenses_total = expensesTotal.ok ? expensesTotal.value : 0
    const required_amount =
      receipt_remaining != null
        ? computeImportRequiredAmount(receipt_remaining, expenses_total)
        : null

    const has_contract = parseBool(row.has_contract_raw)
    const penaltyParsed = parseAmount(row.penalty_amount_raw, 'الشرط الجزائي')
    if (!penaltyParsed.ok) errors.push(penaltyParsed.error)
    const penalty_amount = has_contract && penaltyParsed.ok ? penaltyParsed.value : 0

    let task_definition_id: string | null = null
    if (!row.task_label.trim()) {
      errors.push('المهمة غير موجودة في هذا الفرع')
    } else {
      const def = defByLabel.get(row.task_label.trim())
      if (!def) errors.push('المهمة غير موجودة في هذا الفرع — يجب أن تطابق اسم المهمة في النظام تماماً')
      else task_definition_id = def.id
    }

    if (!row.pdf_filename.trim()) {
      pdfStatus = 'بدون ملف'
      warnings.push(PDF_WARNING)
    } else {
      const key = normalizeFileName(row.pdf_filename)
      const blob = pdfMap.get(key)
      if (!blob) {
        warnings.push(PDF_WARNING)
        pdfStatus = 'غير موجود'
      } else if (!key.endsWith('.pdf')) {
        errors.push('الملف ليس PDF')
        pdfStatus = 'ليس PDF'
      } else {
        pdfBlob = blob
        pdfStatus = 'موجود'
      }
    }

    return {
      ...row,
      valid: errors.length === 0,
      errors,
      warnings,
      pdfStatus,
      receipt_type: receipt_type ?? 'check',
      receipt_amount: receiptAmt.ok ? receiptAmt.value : null,
      receipt_remaining,
      expenses_total,
      required_amount,
      has_contract,
      penalty_amount,
      task_definition_id,
      pdfBlob,
      list_name: row.list_name_raw.trim() || null,
    }
  })
}

export async function downloadImportTemplate(): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([
    [...IMPORT_EXCEL_HEADERS],
    Array(IMPORT_EXCEL_HEADERS.length).fill(''),
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'المدينون')
  XLSX.writeFile(wb, 'قالب-استيراد-المدينين.xlsx')
}

export async function downloadErrorReport(
  failures: ImportExecuteResult['failures'],
): Promise<void> {
  const XLSX = await import('xlsx')
  const data = failures.map(f => ({
    'رقم الصف': f.rowNum,
    'الاسم': f.full_name,
    'رقم الوصل': f.receipt_number,
    'سبب الخطأ': f.errors.join(' · '),
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'أخطاء الاستيراد')
  XLSX.writeFile(wb, `تقرير-أخطاء-الاستيراد-${Date.now()}.xlsx`)
}

const BATCH_SIZE = 25
const UPLOAD_CONCURRENCY = 5

async function yieldUi(): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 0))
}

async function cleanupDebtor(
  supabase: SupabaseClient,
  debtorId: string,
  taskId: string | null,
  filePath: string | null,
): Promise<void> {
  if (filePath) await supabase.storage.from('debtor-files').remove([filePath])
  await supabase.from('expenses').delete().eq('debtor_id', debtorId)
  await supabase.from('debtor_payments').delete().eq('debtor_id', debtorId)
  if (taskId) await supabase.from('tasks').delete().eq('id', taskId)
  await supabase.from('debtors').delete().eq('id', debtorId)
}

async function importImportExpenseRecord(
  supabase: SupabaseClient,
  debtorId: string,
  row: ImportPreviewRow,
  ctx: { branchId: string; userId: string; today: string },
): Promise<string | null> {
  if (row.expenses_total <= 0) return null

  const { error } = await supabase.from('expenses').insert({
    debtor_id: debtorId,
    amount: row.expenses_total,
    expense_type: IMPORT_EXPENSES_GROUP_LABEL,
    description: IMPORT_EXPENSES_GROUP_LABEL,
    expense_date: ctx.today,
    created_by: ctx.userId,
    status: 'approved',
    branch_id: ctx.branchId,
  } as any)
  if (error) return error.message

  return null
}

async function finalizeImportedDebtorBalances(
  supabase: SupabaseClient,
  debtorId: string,
  row: ImportPreviewRow,
): Promise<string | null> {
  const balance = row.required_amount ?? row.receipt_remaining ?? 0

  const { error } = await supabase
    .from('debtors')
    .update({ remaining_amount: balance, required_amount: balance })
    .eq('id', debtorId)

  if (error) return error.message
  return null
}

export async function executeDebtorImport(
  supabase: SupabaseClient,
  validRows: ImportPreviewRow[],
  ctx: {
    branchId: string
    governorate: string
    userId: string
    taskDefs: TaskDefRef[]
    today: string
  },
  onProgress: (p: ImportProgress) => void,
): Promise<ImportExecuteResult> {
  const defMap = new Map(ctx.taskDefs.map(d => [d.id, d]))
  let imported = 0
  const failures: ImportExecuteResult['failures'] = []

  onProgress({ phase: 'creating_debtors', current: 0, total: validRows.length, message: 'إنشاء المدينين...' })

  for (let offset = 0; offset < validRows.length; offset += BATCH_SIZE) {
    const batch = validRows.slice(offset, offset + BATCH_SIZE)
    const listRefs = await Promise.all(
      batch.map(row =>
        row.list_name ? findOrCreateBranchList(supabase, ctx.branchId, row.list_name) : Promise.resolve(null),
      ),
    )
    const debtorPayloads = batch.map((row, i) => ({
      full_name: row.full_name,
      phone: row.phone,
      id_number: row.id_number.trim() || null,
      governorate: ctx.governorate,
      address: row.address || null,
      export_date: ctx.today,
      receipt_type: row.receipt_type ?? 'check',
      receipt_number: row.receipt_number.trim(),
      receipt_amount: row.receipt_amount ?? 0,
      remaining_amount: row.receipt_remaining ?? 0,
      required_amount: row.receipt_remaining ?? 0,
      lawyer_fees: 0,
      penalty_amount: row.penalty_amount,
      notes: row.notes || null,
      created_by: ctx.userId,
      branch_id: ctx.branchId,
      branch_list_id: listRefs[i]?.id ?? null,
    }))

    const { data: debtors, error: dErr } = await supabase
      .from('debtors')
      .insert(debtorPayloads)
      .select('id')

    if (dErr || !debtors?.length) {
      for (const row of batch) {
        failures.push({
          rowNum: row.rowNum,
          full_name: row.full_name,
          receipt_number: row.receipt_number,
          errors: [dErr?.message ?? 'فشل إنشاء المدين'],
        })
      }
      onProgress({
        phase: 'creating_debtors',
        current: Math.min(offset + batch.length, validRows.length),
        total: validRows.length,
        message: 'إنشاء المدينين...',
      })
      await yieldUi()
      continue
    }

    const taskPayloads = debtors.map((d, i) => {
      const row = batch[i]
      const def = row.task_definition_id ? defMap.get(row.task_definition_id) : null
      return {
        debtor_id: d.id,
        task_definition_id: row.task_definition_id!,
        task_status: 'waiting_assignment' as const,
        reward_amount: def?.fee_amount ?? 0,
        created_by: ctx.userId,
        branch_id: ctx.branchId,
      }
    })

    onProgress({
      phase: 'creating_tasks',
      current: offset,
      total: validRows.length,
      message: 'إنشاء المهام...',
    })

    const { data: tasks, error: tErr } = await supabase
      .from('tasks')
      .insert(taskPayloads)
      .select('id, debtor_id')

    if (tErr || !tasks?.length) {
      for (let i = 0; i < debtors.length; i++) {
        await supabase.from('debtors').delete().eq('id', debtors[i].id)
        failures.push({
          rowNum: batch[i].rowNum,
          full_name: batch[i].full_name,
          receipt_number: batch[i].receipt_number,
          errors: [tErr?.message ?? 'فشل إنشاء المهمة'],
        })
      }
      await yieldUi()
      continue
    }

    const taskByDebtor = new Map(tasks.map(t => [t.debtor_id, t.id]))
    const linkResults = await Promise.all(
      debtors.map(d =>
        supabase.from('debtors').update({ current_task_id: taskByDebtor.get(d.id)! }).eq('id', d.id),
      ),
    )
    const linkFailed = linkResults.some(r => r.error)
    if (linkFailed) {
      for (let i = 0; i < debtors.length; i++) {
        await supabase.from('tasks').delete().eq('id', taskByDebtor.get(debtors[i].id)!)
        await supabase.from('debtors').delete().eq('id', debtors[i].id)
        failures.push({
          rowNum: batch[i].rowNum,
          full_name: batch[i].full_name,
          receipt_number: batch[i].receipt_number,
          errors: ['فشل ربط المهمة بالمدين'],
        })
      }
      await yieldUi()
      continue
    }

    const uploadItems: { row: ImportPreviewRow; debtorId: string; taskId: string }[] = []

    for (let i = 0; i < debtors.length; i++) {
      const aggErr = await importImportExpenseRecord(supabase, debtors[i].id, batch[i], ctx)
      if (aggErr) {
        await cleanupDebtor(supabase, debtors[i].id, taskByDebtor.get(debtors[i].id)!, null)
        failures.push({
          rowNum: batch[i].rowNum,
          full_name: batch[i].full_name,
          receipt_number: batch[i].receipt_number,
          errors: [`فشل حفظ مجموع الصرفيات: ${aggErr}`],
        })
        continue
      }

      const balanceErr = await finalizeImportedDebtorBalances(supabase, debtors[i].id, batch[i])
      if (balanceErr) {
        await cleanupDebtor(supabase, debtors[i].id, taskByDebtor.get(debtors[i].id)!, null)
        failures.push({
          rowNum: batch[i].rowNum,
          full_name: batch[i].full_name,
          receipt_number: batch[i].receipt_number,
          errors: [`فشل ضبط أرصدة المدين: ${balanceErr}`],
        })
        continue
      }
      uploadItems.push({
        row: batch[i],
        debtorId: debtors[i].id,
        taskId: taskByDebtor.get(debtors[i].id)!,
      })
    }

    onProgress({
      phase: 'uploading_files',
      current: offset,
      total: validRows.length,
      message: 'رفع ملفات PDF...',
    })

    let uploadIdx = 0

    async function uploadOne(item: (typeof uploadItems)[0]) {
      const { row, debtorId, taskId } = item

      if (!row.pdfBlob) {
        imported++
        return
      }

      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
      const filePath = `${debtorId}/${safeName}`
      const blob = row.pdfBlob
      const file = new File([blob], row.pdf_filename, { type: 'application/pdf' })

      const { error: upErr } = await supabase.storage
        .from('debtor-files')
        .upload(filePath, file, { contentType: 'application/pdf' })

      if (upErr) {
        await cleanupDebtor(supabase, debtorId, taskId, null)
        failures.push({
          rowNum: row.rowNum,
          full_name: row.full_name,
          receipt_number: row.receipt_number,
          errors: [`فشل رفع PDF: ${upErr.message}`],
        })
        return
      }

      const { error: attErr } = await supabase.from('debtor_attachments').insert({
        debtor_id: debtorId,
        file_name: row.pdf_filename,
        file_path: filePath,
        file_size: file.size,
        mime_type: 'application/pdf',
        uploaded_by: ctx.userId,
      })

      if (attErr) {
        await cleanupDebtor(supabase, debtorId, taskId, filePath)
        failures.push({
          rowNum: row.rowNum,
          full_name: row.full_name,
          receipt_number: row.receipt_number,
          errors: [`فشل حفظ سجل الملف: ${attErr.message}`],
        })
        return
      }

      imported++
    }

    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uploadItems.length) }, async () => {
      while (uploadIdx < uploadItems.length) {
        const i = uploadIdx++
        await uploadOne(uploadItems[i])
        onProgress({
          phase: 'uploading_files',
          current: offset + i + 1,
          total: validRows.length,
          message: 'رفع ملفات PDF...',
        })
        await yieldUi()
      }
    })
    await Promise.all(workers)
    await yieldUi()
  }

  onProgress({ phase: 'done', current: validRows.length, total: validRows.length, message: 'اكتمل الاستيراد' })
  return { imported, failed: failures.length, failures }
}

export const IMPORT_RECEIPT_TYPE_HINT = Object.entries(RECEIPT_TYPE_LABELS)
  .map(([, ar]) => ar)
  .join(' · ')
