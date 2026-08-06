import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { isFieldWorkerRole, isViewer } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/api-auth'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { deleteFromR2, r2ObjectKey } from '@/lib/r2-storage'
import { relativeStoredPath } from '@/lib/stored-file-url'

const BLOCKED_STATUSES = new Set(['approved', 'completed', 'closed'])

export async function DELETE(request: Request) {
  const auth = await getSessionProfile()
  if (!auth.user || !auth.profile) return safeClientError('غير مصرح', 401)
  if (isViewer(auth.profile.role)) return safeClientError('صلاحية غير كافية', 403)
  if (!isFieldWorkerRole(auth.profile.role)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const { fileId, filePath, fileName } = await request.json().catch(() => ({}))
  if (!fileId || !filePath) return safeClientError('fileId and filePath required', 400)

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('task_attachments')
    .select('id, file_path, file_name, task_id, uploaded_by, task:tasks!task_attachments_task_id_fkey(id, assigned_to, task_status)')
    .eq('id', fileId)
    .maybeSingle()

  if (error) return apiServerError('worker/delete-task-file', error)
  if (!row?.file_path) return safeClientError('الملف غير موجود', 404)
  if (isSafeStoragePath(filePath) && row.file_path !== filePath) {
    return safeClientError('الملف غير موجود', 404)
  }

  const task = Array.isArray(row.task) ? row.task[0] : row.task
  if (!task || (task as { assigned_to?: string | null }).assigned_to !== auth.user.id) {
    return safeClientError('المهمة غير مسندة إليك', 403)
  }

  const status = String((task as { task_status?: string }).task_status ?? '')
  if (BLOCKED_STATUSES.has(status)) {
    return safeClientError('لا يمكن حذف المرفقات بعد اعتماد المهمة', 403)
  }

  const rel = relativeStoredPath('task-files', row.file_path)
  if (!rel) return safeClientError('مسار غير صالح', 400)

  try {
    await deleteFromR2(r2ObjectKey('task-files', rel))
  } catch (storageErr) {
    return apiServerError('worker/delete-task-file:storage', storageErr)
  }

  const { error: dbErr } = await admin.from('task_attachments').delete().eq('id', fileId)
  if (dbErr) return apiServerError('worker/delete-task-file:db', dbErr)

  await logActivity({
    action: 'delete_task_file',
    entity_type: 'file',
    entity_id: fileId,
    description: `حذف مرفق مهمة (محامي/مندوب): ${fileName ?? row.file_name ?? filePath}`,
  }, auth.supabase)

  return NextResponse.json({ ok: true })
}
