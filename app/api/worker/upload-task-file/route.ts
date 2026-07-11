import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/api-auth'
import { canWriteData, isFieldWorkerRole, isViewer } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { logActivity } from '@/lib/activity-log'
import { isAllowedTaskFile, sanitizeStorageKey } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'

const MAX_BYTES = 15 * 1024 * 1024

export async function POST(request: NextRequest) {
  const { user, profile, supabase } = await getSessionProfile()
  if (!user || !profile) {
    return safeClientError('غير مصرح', 401)
  }
  if (isViewer(profile.role)) {
    return safeClientError('صلاحية غير كافية', 403)
  }
  if (!isFieldWorkerRole(profile.role) && !canWriteData(profile.role)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const formData = await request.formData()
  const file = formData.get('file')
  const taskId = String(formData.get('taskId') ?? '').trim()
  const descriptionRaw = String(formData.get('description') ?? '').trim() || null
  const description = sanitizeStorageKey(descriptionRaw, 48)
  const kind = String(formData.get('kind') ?? 'attachment').trim() === 'expense' ? 'expense' : 'attachment'

  if (!taskId) {
    return safeClientError('معرّف المهمة مطلوب', 400)
  }
  if (!(file instanceof File) || file.size === 0) {
    return safeClientError('ملف غير صالح', 400)
  }
  if (file.size > MAX_BYTES) {
    return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)
  }
  if (!isAllowedTaskFile(file)) {
    return safeClientError('نوع الملف غير مسموح', 400)
  }

  const admin = createAdminClient()
  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('id, assigned_to, branch_id')
    .eq('id', taskId)
    .maybeSingle()

  if (taskErr || !task) {
    return safeClientError('المهمة غير موجودة', 404)
  }

  if (isFieldWorkerRole(profile.role)) {
    if (task.assigned_to !== user.id) {
      return safeClientError('المهمة غير مسندة إليك', 403)
    }
  } else if (!canStaffWriteBranch(profile, task.branch_id)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const ext = (file.name.split('.').pop() || 'bin').replace(/[^\w]/g, '').toLowerCase().slice(0, 8) || 'bin'
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const filePath = kind === 'expense'
    ? `expenses/${taskId}/${safeName}`
    : `${taskId}/${description ? `${description}-` : ''}${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await admin.storage
    .from('task-files')
    .upload(filePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadErr) {
    return apiServerError('upload-task-file', uploadErr, 'فشل رفع الملف')
  }

  let attachment = null
  if (kind === 'attachment') {
    const { data: row, error: insertErr } = await admin
      .from('task_attachments')
      .insert({
        task_id: taskId,
        file_name: file.name.slice(0, 200),
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type || null,
        description: descriptionRaw?.slice(0, 200) ?? null,
        uploaded_by: user.id,
      })
      .select('id, file_name, file_path, file_size, mime_type, description, created_at')
      .single()

    if (insertErr) {
      await admin.storage.from('task-files').remove([filePath])
      return apiServerError('upload-task-file:db', insertErr, 'فشل حفظ المرفق')
    }
    attachment = row

    await logActivity({
      action: 'upload_task_file',
      entity_type: 'task',
      entity_id: taskId,
      description: `رفع ملف مهمة: ${file.name.slice(0, 120)}`,
    }, supabase)
  }

  return NextResponse.json({ ok: true, filePath, attachment })
}
