import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
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
  executeCriminalDebtorImport,
  type CriminalImportExecuteResult,
  type CriminalPreviewRow,
} from '@/lib/criminal-debtor-import'

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

/**
 * استيراد جزائي عبر JSON (مثل المدني).
 * ملفات PDF تُرفع من المتصفح بعد الإنشاء عبر /api/admin/debtors/[id]/criminal-file
 * لتجنب فشل رفع ZIP الكبير في طلب واحد.
 */
export async function POST(request: NextRequest) {
  // لا نستخدم requireMutationStaff حتى يعمل مسؤول الجزائيات أيضاً
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canImportCriminalDebtors(auth.profile?.role)) return apiForbiddenResponse()

  const scope = sessionCaseScope(auth.profile)
  if (!assertSectionAccess(scope, 'criminal')) {
    return apiForbiddenResponse()
  }

  let body: {
    defaultBranchId?: string
    importRunId?: string
    rows?: CriminalPreviewRow[]
  }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const defaultBranchId = String(body.defaultBranchId ?? '').trim() || null
  const importRunId = String(body.importRunId ?? '').trim()
  const rows = Array.isArray(body.rows) ? body.rows : []

  if (!importRunId || !UUID_RE.test(importRunId)) {
    return safeClientError('معرف التشغيل مطلوب', 400)
  }
  if (!defaultBranchId) {
    return safeClientError('معرّف الفرع مطلوب', 400)
  }
  if (!canStaffWriteBranch(auth.profile, defaultBranchId)) {
    return apiForbiddenResponse()
  }

  const admin = createAdminClient()

  const existing = await findExistingRun(admin, importRunId, auth.user!.id)
  if (existing) {
    return NextResponse.json({ ok: true, ...existing })
  }

  const { data: branch } = await admin
    .from('branches')
    .select('id, name')
    .eq('id', defaultBranchId)
    .maybeSingle()
  if (!branch || isMainBranchName(branch.name)) {
    return safeClientError('الفرع الافتراضي غير صالح', 400)
  }

  // أعد التحقق من صلاحية الفرع لكل صف صالح
  const sanitized: CriminalPreviewRow[] = rows.map(r => {
    if (!r?.valid) return r
    const branchId = String(r.branchId ?? '').trim() || null
    if (!branchId || !canStaffWriteBranch(auth.profile, branchId)) {
      return {
        ...r,
        valid: false,
        errors: [...(r.errors ?? []), 'لا صلاحية للاستيراد إلى هذا الفرع'],
      }
    }
    return r
  })

  const ready = sanitized.filter(r => r.valid)
  if (!ready.length) {
    return safeClientError('لا توجد صفوف صالحة للاستيراد', 400)
  }

  try {
    await logActivity({
      action: 'import_criminal_debtors_start',
      entity_type: 'debtor',
      entity_id: defaultBranchId,
      description: `بدء استيراد جزائي (${ready.length} صف) — ${importRunId.slice(0, 8)}`,
      case_type: 'criminal',
      metadata: { import_run_id: importRunId, row_count: ready.length },
    }, auth.supabase)

    // بدون ZIP — رفع الملفات من العميل بعد الإنشاء
    const result = await executeCriminalDebtorImport(admin, sanitized, {
      userId: auth.user!.id,
      profile: auth.profile!,
      pdfByKey: new Map(),
      importRunId,
    })

    await saveRun(admin, importRunId, auth.user!.id, result)

    await logActivity({
      action: 'import_criminal_debtors',
      entity_type: 'debtor',
      entity_id: defaultBranchId,
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
