import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { isAccountant, isViewer, apiForbiddenResponse } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'

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
    .from('task_attachments')
    .select('id, file_path, task:tasks!task_attachments_task_id_fkey(branch_id)')
    .eq('id', fileId)
    .maybeSingle()

  if (error) return apiServerError('delete-task-file', error)
  if (!row || row.file_path !== filePath) return safeClientError('الملف غير موجود', 404)

  const task = Array.isArray(row.task) ? row.task[0] : row.task
  const branchId = (task as { branch_id?: string | null } | null)?.branch_id ?? null
  if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const { error: storageErr } = await admin.storage.from('task-files').remove([row.file_path])
  if (storageErr) return apiServerError('delete-task-file:storage', storageErr)

  const { error: dbErr } = await admin.from('task_attachments').delete().eq('id', fileId)
  if (dbErr) return apiServerError('delete-task-file:db', dbErr)

  await logActivity({
    action: 'delete_task_file',
    entity_type: 'file',
    entity_id: fileId,
    description: `حذف ملف مهمة: ${fileName ?? filePath}`,
  }, auth.supabase)

  return NextResponse.json({ ok: true })
}
