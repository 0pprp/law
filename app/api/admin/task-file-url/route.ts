import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireTaskInScope } from '@/lib/section-guard'
import { canResolveStoredFilePath, storedFileUrl } from '@/lib/stored-file-url'

export async function POST(request: Request) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  let path: string | undefined
  let fileId: string | undefined
  try {
    const body = await request.json()
    path = typeof body.path === 'string' ? body.path.trim() : undefined
    fileId = typeof body.fileId === 'string' ? body.fileId.trim() : undefined
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  if (!fileId && !path) return safeClientError('معرّف أو مسار الملف مطلوب', 400)
  if (!fileId && path && !isSafeStoragePath(path) && !canResolveStoredFilePath('task-files', path)) {
    return safeClientError('مسار غير صالح', 400)
  }

  const admin = createAdminClient()
  let q = admin
    .from('task_attachments')
    .select('id, file_path, task_id, task:tasks!task_attachments_task_id_fkey(branch_id)')
  if (fileId) q = q.eq('id', fileId)
  else q = q.eq('file_path', path!)

  const { data: row, error } = await q.maybeSingle()
  if (error) return apiServerError('task-file-url', error)
  if (!row?.file_path) return safeClientError('الملف غير موجود', 404)

  if (fileId && path && isSafeStoragePath(path) && row.file_path !== path) {
    return safeClientError('الملف غير موجود', 404)
  }

  const scope = sessionCaseScope(auth.profile)
  const gate = await requireTaskInScope(admin, scope, row.task_id)
  if (!gate.ok) return gate.error

  const task = Array.isArray(row.task) ? row.task[0] : row.task
  const branchId = (task as { branch_id?: string | null } | null)?.branch_id ?? null
  if (!canStaffReadBranch(auth.profile, branchId)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const url = storedFileUrl('task-files', row.file_path)
  if (!url) return safeClientError('رابط الملف غير متاح', 404)

  return NextResponse.json({ url })
}
