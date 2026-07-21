import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { isAccountant, isViewer, apiForbiddenResponse } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireDebtorInScope } from '@/lib/section-guard'

export async function DELETE(request: Request) {
  const auth = await getSessionProfile()
  if (!auth.user || !auth.profile) return safeClientError('غير مصرح', 401)
  if (isAccountant(auth.profile.role) || isViewer(auth.profile.role)) return apiForbiddenResponse()
  if (!['admin', 'employee'].includes(auth.profile.role)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const { fileId, filePath, fileName } = await request.json().catch(() => ({}))
  if (!fileId || !filePath) return safeClientError('fileId and filePath required', 400)
  if (!isSafeStoragePath(filePath)) return safeClientError('مسار غير صالح', 400)

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('debtor_attachments')
    .select('id, file_path, debtor_id, debtor:debtors!debtor_attachments_debtor_id_fkey(branch_id)')
    .eq('id', fileId)
    .maybeSingle()

  if (error) return apiServerError('delete-debtor-file', error)
  if (!row || row.file_path !== filePath) return safeClientError('الملف غير موجود', 404)

  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, row.debtor_id)
  if (!gate.ok) return gate.error

  const debtor = Array.isArray(row.debtor) ? row.debtor[0] : row.debtor
  const branchId = (debtor as { branch_id?: string | null } | null)?.branch_id ?? null
  if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const { error: storageErr } = await admin.storage.from('debtor-files').remove([row.file_path])
  if (storageErr) return apiServerError('delete-debtor-file:storage', storageErr)

  const { error: dbErr } = await admin.from('debtor_attachments').delete().eq('id', fileId)
  if (dbErr) return apiServerError('delete-debtor-file:db', dbErr)

  await logActivity({
    action: 'delete_debtor_file',
    entity_type: 'file',
    entity_id: fileId,
    description: `حذف ملف مدين: ${fileName ?? filePath}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true })
}
