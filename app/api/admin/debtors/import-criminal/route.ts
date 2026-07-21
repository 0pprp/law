import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff, sessionCaseScope } from '@/lib/api-auth'
import {
  apiForbiddenResponse,
  canImportCriminalDebtors,
} from '@/lib/permissions'
import { assertSectionAccess } from '@/lib/case-scope'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { isMainBranchName } from '@/lib/branch-constants'
import { logActivity } from '@/lib/activity-log'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import {
  parseCriminalImportExcel,
  validateCriminalImportRows,
  executeCriminalDebtorImport,
  type CriminalImportExecuteResult,
} from '@/lib/criminal-debtor-import'
import {
  parseCriminalImportZipSafe,
  buildCriminalPdfLookup,
  type SafeZipPdf,
} from '@/lib/criminal-import-zip'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function findExistingRun(
  admin: ReturnType<typeof createAdminClient>,
  importRunId: string,
  userId: string,
): Promise<CriminalImportExecuteResult | null> {
  try {
    const { data } = await admin
      .from('criminal_import_runs')
      .select('result')
      .eq('id', importRunId)
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.result && typeof data.result === 'object') {
      return { ...(data.result as CriminalImportExecuteResult), duplicateRequest: true }
    }
  } catch {
    /* الجدول قد لا يكون مفعّلاً بعد */
  }
  return null
}

async function saveRun(
  admin: ReturnType<typeof createAdminClient>,
  importRunId: string,
  userId: string,
  result: CriminalImportExecuteResult,
): Promise<void> {
  try {
    await admin.from('criminal_import_runs').upsert({
      id: importRunId,
      user_id: userId,
      status: 'completed',
      result,
      created_at: new Date().toISOString(),
    })
  } catch {
    /* non-blocking */
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error
  if (!canImportCriminalDebtors(auth.profile?.role)) return apiForbiddenResponse()

  const scope = sessionCaseScope(auth.profile)
  if (!assertSectionAccess(scope, 'criminal')) {
    return apiForbiddenResponse()
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const excel = form.get('excel')
  const zip = form.get('zip')
  const defaultBranchId = String(form.get('defaultBranchId') ?? '').trim() || null
  const importRunId = String(form.get('importRunId') ?? '').trim()

  if (!importRunId || !UUID_RE.test(importRunId)) {
    return safeClientError('معرف التشغيل مطلوب', 400)
  }
  if (!(excel instanceof File) || excel.size === 0) {
    return safeClientError('ملف Excel مطلوب', 400)
  }
  if (zip != null && zip !== '' && !(zip instanceof File)) {
    return safeClientError('ملف ZIP غير صالح', 400)
  }

  const admin = createAdminClient()

  const existing = await findExistingRun(admin, importRunId, auth.user!.id)
  if (existing) {
    return NextResponse.json({ ok: true, ...existing })
  }

  const { data: branchesData } = await admin.from('branches').select('id, name').order('name')
  const branches = (branchesData ?? []).filter(b => !isMainBranchName(b.name))
  const allowedBranches = branches.filter(b => canStaffWriteBranch(auth.profile, b.id))

  let defaultBranchName: string | null = null
  if (defaultBranchId) {
    if (!canStaffWriteBranch(auth.profile, defaultBranchId)) return apiForbiddenResponse()
    const b = allowedBranches.find(x => x.id === defaultBranchId)
    if (!b) return safeClientError('الفرع الافتراضي غير صالح', 400)
    defaultBranchName = b.name
  }

  const parsed = await parseCriminalImportExcel(excel)
  if (parsed.error) return safeClientError(parsed.error, 400)
  if (!parsed.rows.length) return safeClientError('ملف Excel فارغ أو بلا صفوف بيانات', 400)

  let pdfByKey = new Map<string, SafeZipPdf>()
  let pdfDuplicates = new Set<string>()
  let hasZip = false

  if (zip instanceof File && zip.size > 0) {
    hasZip = true
    const zipRes = await parseCriminalImportZipSafe(zip)
    if (!zipRes.ok) return safeClientError(zipRes.error, 400)
    const lookup = buildCriminalPdfLookup(zipRes.files)
    pdfByKey = lookup.byKey
    pdfDuplicates = lookup.duplicates
  }

  const preview = validateCriminalImportRows(parsed.rows, {
    branches: allowedBranches,
    defaultBranchId,
    defaultBranchName,
    profile: auth.profile,
    pdfByKey,
    pdfDuplicates,
    hasZip,
  })

  try {
    await logActivity({
      action: 'import_criminal_debtors_start',
      entity_type: 'debtor',
      entity_id: defaultBranchId || allowedBranches[0]?.id || auth.user!.id,
      description: `بدء استيراد جزائي (${parsed.rows.length} صف) — ${importRunId.slice(0, 8)}`,
      case_type: 'criminal',
      metadata: { import_run_id: importRunId, row_count: parsed.rows.length },
    }, auth.supabase)

    const result = await executeCriminalDebtorImport(admin, preview, {
      userId: auth.user!.id,
      profile: auth.profile!,
      pdfByKey,
      importRunId,
    })

    await saveRun(admin, importRunId, auth.user!.id, result)

    await logActivity({
      action: 'import_criminal_debtors',
      entity_type: 'debtor',
      entity_id: defaultBranchId || allowedBranches[0]?.id || auth.user!.id,
      description: `استيراد جزائي: ${result.success} نجاح، ${result.successWithWarning} مع تحذير، ${result.failed} فشل`,
      case_type: 'criminal',
      metadata: {
        import_run_id: importRunId,
        success: result.success,
        success_with_warning: result.successWithWarning,
        failed: result.failed,
        total: result.total,
      },
    }, auth.supabase)

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return apiServerError('import-criminal', e, 'فشل استيراد المدينين الجزائيين')
  }
}
