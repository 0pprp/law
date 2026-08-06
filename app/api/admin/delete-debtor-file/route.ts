import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { canEditDebtor, apiForbiddenResponse } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireDebtorInScope } from '@/lib/section-guard'
import { deleteFromR2, r2ObjectKey } from '@/lib/r2-storage'
import { relativeStoredPath } from '@/lib/stored-file-url'

export async function DELETE(request: Request) {
  const auth = await getSessionProfile()
  if (!auth.user || !auth.profile) return safeClientError('غير مصرح', 401)
  if (!canEditDebtor(auth.profile.role)) return apiForbiddenResponse()

  const { fileId, filePath, fileName } = await request.json().catch(() => ({}))
  if (!fileId || !filePath) return safeClientError('fileId and filePath required', 400)

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('debtor_attachments')
    .select('id, file_path, debtor_id, debtor:debtors!debtor_attachments_debtor_id_fkey(branch_id)')
    .eq('id', fileId)
    .maybeSingle()

  if (error) return apiServerError('delete-debtor-file', error)
  if (!row?.file_path) return safeClientError('الملف غير موجود', 404)
  if (isSafeStoragePath(filePath) && row.file_path !== filePath) {
    return safeClientError('الملف غير موجود', 404)
  }

  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, row.debtor_id)
  if (!gate.ok) return gate.error

  const debtor = Array.isArray(row.debtor) ? row.debtor[0] : row.debtor
  const branchId = (debtor as { branch_id?: string | null } | null)?.branch_id ?? null
  if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const rel = relativeStoredPath('debtor-files', row.file_path)
  if (!rel) return safeClientError('مسار غير صالح', 400)

  try {
    await deleteFromR2(r2ObjectKey('debtor-files', rel))
  } catch (storageErr) {
    return apiServerError('delete-debtor-file:storage', storageErr)
  }

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
