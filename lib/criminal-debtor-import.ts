/**
 * استيراد مدينين جزائيين من Excel + ZIP اختياري.
 * لا يغيّر مسار الاستيراد المدني.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CRIMINAL_IMPORT_CANONICAL_HEADERS,
  CRIMINAL_IMPORT_FIELD_BY_CANONICAL,
  CRIMINAL_IMPORT_HEADER_SYNONYMS,
  type CriminalImportFieldKey,
} from '@/lib/criminal-import-columns'
import {
  cellToString,
  normalizeForMatch,
  normalizeHeaderLabel,
  normalizePdfFileName,
  parseContractGuarantorImport,
  parseCriminalImportAmount,
  parseCriminalIncidentDate,
  sanitizeDisplayText,
} from '@/lib/criminal-import-normalize'
import {
  CRIMINAL_IMPORT_EXCEL_EXTS,
  CRIMINAL_IMPORT_EXCEL_MIME,
  CRIMINAL_IMPORT_MAX_EXCEL_BYTES,
  CRIMINAL_IMPORT_MAX_ROWS,
} from '@/lib/criminal-import-limits'
import {
  buildCriminalPdfLookup,
  parseCriminalImportZipSafe,
  type SafeZipPdf,
} from '@/lib/criminal-import-zip'
import { upsertCriminalDebtorDetails, deleteCriminalDebtorDetails } from '@/lib/criminal-debtor-details'
import { buildCriminalFilePath } from '@/lib/criminal-debtor-files'
import { computeDebtorRequiredAmount, computeRemainingFromRequired } from '@/lib/debtor-balances'
import { localTodayYmd } from '@/lib/local-date'
import { isMainBranchName } from '@/lib/branch-constants'
import { canStaffWriteBranch, type BranchAccessProfile } from '@/lib/staff-branch-access'
import { isSafeStoragePath } from '@/lib/storage-path'

export type CriminalImportRowStatus = 'success' | 'success_with_warning' | 'failed'

export interface CriminalParsedRow {
  rowNum: number
  full_name: string
  branch_name: string
  job_title: string
  current_address: string
  incident_date_raw: unknown
  charge_type: string
  amount_raw: unknown
  contract_raw: string
  first_witness: string
  second_witness: string
  documents_filename: string
}

export interface CriminalPreviewRow extends CriminalParsedRow {
  valid: boolean
  errors: string[]
  warnings: string[]
  incident_date: string | null
  amount_owed: number | null
  contract_guarantor: 'yes' | 'no' | 'contract_only' | null
  branchId: string | null
  resolvedBranchName: string | null
  pdfKey: string | null
  pdfStatus: 'موجود' | 'غير موجود' | 'مكرر في ZIP' | 'بدون ملف' | '—'
}

export interface CriminalImportRowResult {
  rowNum: number
  full_name: string
  branch: string
  status: CriminalImportRowStatus
  errors: string[]
  warnings: string[]
  pdfName: string | null
  pdfUpload: 'uploaded' | 'missing' | 'failed' | 'skipped' | 'none'
  possibleDuplicate: boolean
  debtorId: string | null
}

export interface CriminalImportExecuteResult {
  total: number
  success: number
  successWithWarning: number
  failed: number
  durationMs: number
  rows: CriminalImportRowResult[]
  importRunId: string
  duplicateRequest?: boolean
}

export type CriminalImportProgressPhase =
  | 'idle'
  | 'reading_excel'
  | 'reading_zip'
  | 'validating'
  | 'importing'
  | 'done'

export interface CriminalImportProgress {
  phase: CriminalImportProgressPhase
  current: number
  total: number
  message: string
}

function readField(
  mapped: Partial<Record<CriminalImportFieldKey, unknown>>,
  key: CriminalImportFieldKey,
): unknown {
  return mapped[key]
}

/** التحقق من ملف Excel قبل القراءة */
export function validateCriminalImportExcelFile(file: File): string | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!CRIMINAL_IMPORT_EXCEL_EXTS.has(ext)) {
    return 'صيغة Excel غير مدعومة — استخدم .xlsx أو .xls'
  }
  if (file.size <= 0) return 'ملف Excel فارغ'
  if (file.size > CRIMINAL_IMPORT_MAX_EXCEL_BYTES) {
    return `حجم Excel يتجاوز الحد (${Math.floor(CRIMINAL_IMPORT_MAX_EXCEL_BYTES / (1024 * 1024))} ميجابايت)`
  }
  const mime = (file.type || '').toLowerCase()
  if (mime && !CRIMINAL_IMPORT_EXCEL_MIME.has(mime) && !mime.includes('spreadsheet') && !mime.includes('excel')) {
    return 'نوع ملف Excel غير صالح'
  }
  // رفض امتدادات ماكرو شائعة بالاسم
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xlsm') || lower.endsWith('.xlsb') || lower.endsWith('.xltm')) {
    return 'ملفات الماكرو غير مسموحة'
  }
  return null
}

function mapRowHeaders(
  row: Record<string, unknown>,
): { mapped: Partial<Record<CriminalImportFieldKey, unknown>>; unknownHeaders: string[] } {
  const mapped: Partial<Record<CriminalImportFieldKey, unknown>> = {}
  const unknownHeaders: string[] = []
  for (const [header, value] of Object.entries(row)) {
    const norm = normalizeHeaderLabel(header)
    if (!norm) continue
    const field = CRIMINAL_IMPORT_HEADER_SYNONYMS[norm]
    if (!field) {
      // رأس غير معروف — لا يكسر؛ يُتجاهل
      if (sanitizeDisplayText(header)) unknownHeaders.push(String(header))
      continue
    }
    // أول مرادف يفوز — لا تكتب فوق قيمة موجودة غير فارغة
    const existing = mapped[field]
    if (existing != null && cellToString(existing) !== '') continue
    mapped[field] = value
  }
  return { mapped, unknownHeaders }
}

export async function parseCriminalImportExcel(file: File | ArrayBuffer, fileName = 'import.xlsx'): Promise<{
  rows: CriminalParsedRow[]
  error?: string
}> {
  if (file instanceof File) {
    const err = validateCriminalImportExcelFile(file)
    if (err) return { rows: [], error: err }
  }

  const XLSX = await import('xlsx')
  const buf = file instanceof File ? await file.arrayBuffer() : file
  let wb: import('xlsx').WorkBook
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, cellText: false })
  } catch {
    return { rows: [], error: 'ملف Excel تالف أو غير قابل للقراءة' }
  }

  if (!wb.SheetNames?.length) return { rows: [], error: 'ملف Excel بلا أوراق' }

  // تجاهل ورقة التعليمات
  const dataSheetName =
    wb.SheetNames.find(n => normalizeForMatch(n) !== normalizeForMatch('التعليمات'))
    ?? wb.SheetNames[0]
  const sheet = wb.Sheets[dataSheetName]
  if (!sheet) return { rows: [], error: 'لا توجد ورقة بيانات صالحة' }

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })

  if (json.length > CRIMINAL_IMPORT_MAX_ROWS) {
    return {
      rows: [],
      error: `عدد الصفوف يتجاوز الحد (${CRIMINAL_IMPORT_MAX_ROWS}). قسّم الملف ثم أعد المحاولة.`,
    }
  }

  const rows: CriminalParsedRow[] = []
  json.forEach((row, idx) => {
    const { mapped } = mapRowHeaders(row)
    const full_name = sanitizeDisplayText(readField(mapped, 'full_name'))
    const branch_name = sanitizeDisplayText(readField(mapped, 'branch_name'))
    const job_title = sanitizeDisplayText(readField(mapped, 'job_title'))
    const current_address = sanitizeDisplayText(readField(mapped, 'current_address'))
    const charge_type = sanitizeDisplayText(readField(mapped, 'charge_type'))
    const first_witness = sanitizeDisplayText(readField(mapped, 'first_witness'))
    const second_witness = sanitizeDisplayText(readField(mapped, 'second_witness'))
    const documents_filename = sanitizeDisplayText(readField(mapped, 'documents_filename'))
    const contract_raw = sanitizeDisplayText(readField(mapped, 'contract_guarantor'))
    const incident_date_raw = readField(mapped, 'incident_date')
    const amount_raw = readField(mapped, 'amount_owed')

    const hasAny = [
      full_name,
      branch_name,
      job_title,
      current_address,
      charge_type,
      documents_filename,
      cellToString(incident_date_raw),
      cellToString(amount_raw),
      contract_raw,
    ].some(Boolean)
    if (!hasAny) return

    // صفوف تعليمات داخل ورقة البيانات
    if (full_name.includes('إلزامي') || full_name.startsWith('ملاحظة:')) return

    rows.push({
      rowNum: idx + 2,
      full_name,
      branch_name,
      job_title,
      current_address,
      incident_date_raw,
      charge_type,
      amount_raw,
      contract_raw,
      first_witness,
      second_witness,
      documents_filename,
    })
  })

  void fileName
  return { rows }
}

export type BranchRef = { id: string; name: string }

export function resolveCriminalImportBranch(opts: {
  rowBranchName: string
  defaultBranchId: string | null
  defaultBranchName: string | null
  branches: BranchRef[]
  profile: BranchAccessProfile | null
}): { ok: true; branchId: string; branchName: string } | { ok: false; error: string } {
  const raw = sanitizeDisplayText(opts.rowBranchName)
  if (raw) {
    const key = normalizeForMatch(raw)
    const matches = opts.branches.filter(b => normalizeForMatch(b.name) === key)
    if (matches.length === 0) return { ok: false, error: `الفرع غير موجود: ${raw}` }
    if (matches.length > 1) {
      return { ok: false, error: `اسم الفرع يطابق أكثر من فرع — حدّد اسماً أدق: ${raw}` }
    }
    const b = matches[0]
    if (isMainBranchName(b.name)) return { ok: false, error: 'لا يمكن الاستيراد إلى الفرع الرئيسي' }
    if (!canStaffWriteBranch(opts.profile, b.id)) {
      return { ok: false, error: 'لا صلاحية للاستيراد إلى هذا الفرع' }
    }
    return { ok: true, branchId: b.id, branchName: b.name }
  }

  if (opts.defaultBranchId && opts.defaultBranchName) {
    if (isMainBranchName(opts.defaultBranchName)) {
      return { ok: false, error: 'لا يمكن الاستيراد إلى الفرع الرئيسي' }
    }
    if (!canStaffWriteBranch(opts.profile, opts.defaultBranchId)) {
      return { ok: false, error: 'لا صلاحية للاستيراد إلى الفرع الافتراضي' }
    }
    return { ok: true, branchId: opts.defaultBranchId, branchName: opts.defaultBranchName }
  }

  return { ok: false, error: 'الفرع مطلوب — عبّئ العمود أو اختر فرعاً افتراضياً' }
}

export function validateCriminalImportRows(
  rows: CriminalParsedRow[],
  opts: {
    branches: BranchRef[]
    defaultBranchId: string | null
    defaultBranchName: string | null
    profile: BranchAccessProfile | null
    pdfByKey: Map<string, SafeZipPdf>
    pdfDuplicates: Set<string>
    hasZip: boolean
  },
): CriminalPreviewRow[] {
  const usedPdfKeys = new Set<string>()

  return rows.map(row => {
    const errors: string[] = []
    const warnings: string[] = []

    if (!row.full_name) errors.push('الاسم فارغ')

    const branchRes = resolveCriminalImportBranch({
      rowBranchName: row.branch_name,
      defaultBranchId: opts.defaultBranchId,
      defaultBranchName: opts.defaultBranchName,
      branches: opts.branches,
      profile: opts.profile,
    })
    let branchId: string | null = null
    let resolvedBranchName: string | null = null
    if (branchRes.ok) {
      branchId = branchRes.branchId
      resolvedBranchName = branchRes.branchName
    } else {
      errors.push(branchRes.error)
    }

    const dateRes = parseCriminalIncidentDate(row.incident_date_raw)
    if (!dateRes.ok) errors.push(dateRes.error)
    const incident_date = dateRes.ok ? dateRes.value : null

    const amountRes = parseCriminalImportAmount(row.amount_raw)
    if (!amountRes.ok) errors.push(amountRes.error)
    const amount_owed = amountRes.ok ? amountRes.value : null

    const contractRes = parseContractGuarantorImport(row.contract_raw)
    if (!contractRes.ok) errors.push(contractRes.error)
    const contract_guarantor = contractRes.ok ? contractRes.value : null

    let pdfKey: string | null = null
    let pdfStatus: CriminalPreviewRow['pdfStatus'] = '—'
    if (!row.documents_filename) {
      pdfStatus = 'بدون ملف'
    } else {
      pdfKey = normalizePdfFileName(row.documents_filename)
      if (!pdfKey.endsWith('.pdf')) {
        // اسمح بالاسم بدون امتداد إن وُجد في ZIP
        const withExt = `${pdfKey}.pdf`
        if (opts.pdfByKey.has(withExt) || opts.pdfDuplicates.has(withExt)) {
          pdfKey = withExt
        }
      }
      if (opts.pdfDuplicates.has(pdfKey)) {
        errors.push('اسم الملف مكرر داخل ZIP — لا يمكن التخمين')
        pdfStatus = 'مكرر في ZIP'
      } else if (opts.pdfByKey.has(pdfKey)) {
        if (usedPdfKeys.has(pdfKey)) {
          errors.push('الملف مستخدم بالفعل في صف آخر')
          pdfStatus = 'موجود'
        } else {
          usedPdfKeys.add(pdfKey)
          pdfStatus = 'موجود'
        }
      } else if (opts.hasZip) {
        warnings.push('ملف المستمسكات غير موجود في ZIP — سيُنشأ المدين ويمكن رفع الملف لاحقاً')
        pdfStatus = 'غير موجود'
      } else {
        warnings.push('لم يُرفق ZIP — سيُنشأ المدين بدون ملف المستمسكات')
        pdfStatus = 'غير موجود'
      }
    }

    return {
      ...row,
      valid: errors.length === 0,
      errors,
      warnings,
      incident_date,
      amount_owed,
      contract_guarantor,
      branchId,
      resolvedBranchName,
      pdfKey,
      pdfStatus,
    }
  })
}

async function findPossibleDuplicate(
  admin: SupabaseClient,
  opts: { fullName: string; branchId: string; incidentDate: string | null },
): Promise<boolean> {
  const nameKey = normalizeForMatch(opts.fullName)
  if (!nameKey) return false
  let q = admin
    .from('debtors')
    .select('id, full_name, case_type')
    .eq('branch_id', opts.branchId)
    .eq('case_type', 'criminal')
    .limit(50)
  const { data } = await q
  if (!data?.length) return false
  const nameMatches = data.filter(d => normalizeForMatch(d.full_name) === nameKey)
  if (!nameMatches.length) return false
  if (!opts.incidentDate) return true
  // إن وُجد تاريخ — تحقق من التفاصيل
  const ids = nameMatches.map(d => d.id)
  const { data: details } = await admin
    .from('criminal_debtor_details')
    .select('debtor_id, incident_date')
    .in('debtor_id', ids)
  if (!details?.length) return true
  return details.some(d => d.incident_date === opts.incidentDate)
}

async function cleanupCriminalDebtor(
  admin: SupabaseClient,
  debtorId: string,
  storagePaths: string[],
): Promise<void> {
  for (const p of storagePaths) {
    if (isSafeStoragePath(p)) {
      await admin.storage.from('debtor-files').remove([p]).catch(() => null)
    }
  }
  await deleteCriminalDebtorDetails(admin, debtorId)
  await admin.from('debtors').delete().eq('id', debtorId)
}

export async function executeCriminalDebtorImport(
  admin: SupabaseClient,
  rows: CriminalPreviewRow[],
  opts: {
    userId: string
    profile: BranchAccessProfile
    pdfByKey: Map<string, SafeZipPdf>
    importRunId: string
    onProgress?: (p: CriminalImportProgress) => void
  },
): Promise<CriminalImportExecuteResult> {
  const started = Date.now()
  const results: CriminalImportRowResult[] = []
  let success = 0
  let successWithWarning = 0
  let failed = 0
  const today = localTodayYmd()
  const usedPdf = new Set<string>()

  const validRows = rows.filter(r => r.valid)
  opts.onProgress?.({
    phase: 'importing',
    current: 0,
    total: validRows.length,
    message: 'بدء الاستيراد...',
  })

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row.valid) {
      failed += 1
      results.push({
        rowNum: row.rowNum,
        full_name: row.full_name || '—',
        branch: row.resolvedBranchName || row.branch_name || '—',
        status: 'failed',
        errors: row.errors,
        warnings: row.warnings,
        pdfName: row.documents_filename || null,
        pdfUpload: 'none',
        possibleDuplicate: false,
        debtorId: null,
      })
      continue
    }

    opts.onProgress?.({
      phase: 'importing',
      current: success + successWithWarning + 1,
      total: Math.max(validRows.length, 1),
      message: `استيراد: ${row.full_name}`,
    })

    const warnings = [...row.warnings]
    const errors: string[] = []
    let pdfUpload: CriminalImportRowResult['pdfUpload'] = 'none'
    let debtorId: string | null = null
    const storagePaths: string[] = []

    try {
      if (!row.branchId) throw new Error('الفرع غير محدد')

      const possibleDuplicate = await findPossibleDuplicate(admin, {
        fullName: row.full_name,
        branchId: row.branchId,
        incidentDate: row.incident_date,
      })
      if (possibleDuplicate) {
        warnings.push('تكرار محتمل: مدين جزائي بنفس الاسم/الفرع/التاريخ')
      }

      const amount = row.amount_owed ?? 0
      const required = computeDebtorRequiredAmount(amount, 0, 0, 0)
      const remaining = computeRemainingFromRequired(required, 0)

      const { data: newDebtor, error: insertErr } = await admin
        .from('debtors')
        .insert({
          full_name: row.full_name,
          phone: null,
          governorate: null,
          address: null,
          id_number: null,
          export_date: today,
          receipt_type: 'other',
          receipt_number: null,
          receipt_amount: 0,
          remaining_amount: remaining,
          required_amount: required,
          lawyer_fees: 0,
          penalty_amount: 0,
          receipt_signed_legal_costs: false,
          notes: null,
          created_by: opts.userId,
          branch_id: row.branchId,
          branch_list_id: null,
          case_type: 'criminal',
        })
        .select('id')
        .single()

      if (insertErr || !newDebtor) {
        throw new Error(insertErr?.message ?? 'فشل إنشاء المدين')
      }
      const createdId = String(newDebtor.id)
      debtorId = createdId

      const detailsRes = await upsertCriminalDebtorDetails(admin, createdId, {
        job_title: row.job_title || null,
        current_address: row.current_address || null,
        incident_date: row.incident_date,
        charge_type: row.charge_type || null,
        contract_guarantor_status: row.contract_guarantor,
        first_witness_name: row.first_witness || null,
        second_witness_name: row.second_witness || null,
        documents_contract_file_path: null,
        petition_file_path: null,
      })

      if (detailsRes.error) {
        await cleanupCriminalDebtor(admin, createdId, [])
        debtorId = null
        throw new Error(`فشل حفظ التفاصيل: ${detailsRes.error}`)
      }

      // رفع PDF إن وُجد
      if (row.pdfKey && row.pdfStatus === 'موجود') {
        if (usedPdf.has(row.pdfKey)) {
          await cleanupCriminalDebtor(admin, createdId, [])
          debtorId = null
          throw new Error('الملف مستخدم بالفعل في صف آخر')
        }
        const pdf = opts.pdfByKey.get(row.pdfKey)
        if (!pdf) {
          warnings.push('ملف المستمسكات غير موجود — المدين أُنشئ بدون ملف')
          pdfUpload = 'missing'
        } else {
          const path = buildCriminalFilePath(createdId, 'documents')
          const { error: upErr } = await admin.storage
            .from('debtor-files')
            .upload(path, pdf.bytes, { contentType: 'application/pdf', upsert: false })
          if (upErr) {
            await cleanupCriminalDebtor(admin, createdId, [])
            debtorId = null
            throw new Error('فشل رفع ملف المستمسكات')
          }
          storagePaths.push(path)
          const pathUpdate = await upsertCriminalDebtorDetails(admin, createdId, {
            ...(detailsRes.data ?? {}),
            documents_contract_file_path: path,
          })
          if (pathUpdate.error) {
            await cleanupCriminalDebtor(admin, createdId, storagePaths)
            debtorId = null
            throw new Error('فشل حفظ مسار الملف — تم التراجع')
          }
          usedPdf.add(row.pdfKey)
          pdfUpload = 'uploaded'
        }
      } else if (row.documents_filename) {
        pdfUpload = 'missing'
      }

      const status: CriminalImportRowStatus =
        warnings.length > 0 ? 'success_with_warning' : 'success'
      if (status === 'success') success += 1
      else successWithWarning += 1

      results.push({
        rowNum: row.rowNum,
        full_name: row.full_name,
        branch: row.resolvedBranchName || '—',
        status,
        errors: [],
        warnings,
        pdfName: row.documents_filename || null,
        pdfUpload,
        possibleDuplicate,
        debtorId,
      })
    } catch (e) {
      failed += 1
      const msg = e instanceof Error ? e.message : 'فشل غير متوقع'
      errors.push(msg)
      results.push({
        rowNum: row.rowNum,
        full_name: row.full_name || '—',
        branch: row.resolvedBranchName || row.branch_name || '—',
        status: 'failed',
        errors,
        warnings,
        pdfName: row.documents_filename || null,
        pdfUpload: pdfUpload === 'uploaded' ? 'failed' : pdfUpload,
        possibleDuplicate: false,
        debtorId: null,
      })
    }
  }

  opts.onProgress?.({
    phase: 'done',
    current: results.length,
    total: results.length,
    message: 'اكتمل الاستيراد',
  })

  return {
    total: results.length,
    success,
    successWithWarning,
    failed,
    durationMs: Date.now() - started,
    rows: results,
    importRunId: opts.importRunId,
  }
}

export async function downloadCriminalImportTemplate(): Promise<void> {
  const XLSX = await import('xlsx')
  const headers = [...CRIMINAL_IMPORT_CANONICAL_HEADERS]
  const ws = XLSX.utils.aoa_to_sheet([headers])
  const instructions = XLSX.utils.aoa_to_sheet([
    ['تعليمات استيراد المدينين الجزائيين'],
    [''],
    ['1. الاسم والفرع إلزاميان (أو فرع افتراضي من الواجهة إن تُرك عمود الفرع فارغاً).'],
    ['2. قيم العقد والكفيل المقبولة: نعم / لا / فقط عقد (أو yes / no / contract_only).'],
    ['3. تنسيق التاريخ: YYYY-MM-DD أو DD/MM/YYYY أو تاريخ Excel.'],
    ['4. اسم ملف المستمسكات يجب أن يطابق اسماً داخل ZIP (PDF فقط).'],
    ['5. عريضة الدعوى لا تُستورد هنا — تُرفع لاحقاً من صفحة المدين.'],
    ['6. لا تضع صفوف أمثلة حقيقية في ورقة البيانات.'],
    ['7. كل السجلات تُنشأ كجزائي (case_type=criminal) وبدون قائمة فرع.'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'المدينون الجزائيون')
  XLSX.utils.book_append_sheet(wb, instructions, 'التعليمات')
  XLSX.writeFile(wb, 'قالب-استيراد-المدينين-الجزائيين.xlsx')
}

export async function downloadCriminalImportReport(
  result: CriminalImportExecuteResult,
): Promise<void> {
  const XLSX = await import('xlsx')
  const data = result.rows.map(r => ({
    'رقم الصف': r.rowNum,
    الاسم: r.full_name,
    الفرع: r.branch,
    الحالة: r.status,
    'سبب الفشل': r.errors.join(' | '),
    التحذيرات: r.warnings.join(' | '),
    'اسم PDF': r.pdfName ?? '',
    'رفع PDF': r.pdfUpload,
    'تكرار محتمل': r.possibleDuplicate ? 'نعم' : 'لا',
    'معرّف المدين': r.debtorId ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const summary = XLSX.utils.aoa_to_sheet([
    ['إجمالي', result.total],
    ['نجاح', result.success],
    ['نجاح مع تحذير', result.successWithWarning],
    ['فشل', result.failed],
    ['المدة (مللي ثانية)', result.durationMs],
    ['معرف التشغيل', result.importRunId],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summary, 'ملخص')
  XLSX.utils.book_append_sheet(wb, ws, 'التفاصيل')
  XLSX.writeFile(wb, `تقرير-استيراد-جزائي-${Date.now()}.xlsx`)
}

/** إعادة تصدير مساعدة للمعاينة مع ZIP */
export { parseCriminalImportZipSafe, buildCriminalPdfLookup }

/** للقالب والاختبارات */
export function criminalImportCanonicalHeaders(): readonly string[] {
  return CRIMINAL_IMPORT_CANONICAL_HEADERS
}

export function criminalImportFieldFromHeader(header: string): CriminalImportFieldKey | null {
  const norm = normalizeHeaderLabel(header)
  return CRIMINAL_IMPORT_HEADER_SYNONYMS[norm]
    ?? CRIMINAL_IMPORT_FIELD_BY_CANONICAL[header as keyof typeof CRIMINAL_IMPORT_FIELD_BY_CANONICAL]
    ?? null
}
