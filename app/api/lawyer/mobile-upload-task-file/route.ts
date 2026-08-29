import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isFieldWorkerRole } from '@/lib/permissions'
import { sanitizeStorageKey } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { uploadToR2, deleteFromR2, r2ObjectKey } from '@/lib/r2-storage'
import { logR2UploadError, r2UploadClientMessage } from '@/lib/r2-upload-diagnostics'
import { fetchStaffProfile } from '@/lib/staff-profile'

const MAX_BYTES = 15 * 1024 * 1024

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx'])
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function resolveExt(fileName: string, mime: string): string {
  const fromName = (fileName.split('.').pop() || '').toLowerCase().replace(/[^\w]/g, '')
  if (ALLOWED_EXT.has(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('pdf')) return 'pdf'
  return ''
}

function isAllowedMobileFile(fileName: string, mime: string): boolean {
  const ext = resolveExt(fileName, mime)
  return ALLOWED_EXT.has(ext) || ALLOWED_EXT.has(ext === 'jpg' ? 'jpeg' : ext)
}

/**
 * رفع مرفقات المهام من تطبيق Flutter عبر Bearer JWT أو حقل access_token.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const authHeader = request.headers.get('authorization') || ''
    const headerToken = authHeader.replace(/^Bearer\s+/i, '').trim()
    const fieldToken = String(formData.get('access_token') ?? formData.get('accessToken') ?? '').trim()
    const token = headerToken || fieldToken
    if (!token) {
      return safeClientError('غير مصرح — أعد تسجيل الدخول', 401)
    }

    const admin = createAdminClient()
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData.user) {
      console.error('[lawyer/mobile-upload-task-file] getUser', userErr?.message)
      return safeClientError('انتهت الجلسة — أعد تسجيل الدخول', 401)
    }
    const user = userData.user

    const profile = await fetchStaffProfile(admin, user.id)
    if (!profile?.role) {
      return safeClientError('الملف غير موجود', 401)
    }
    if (profile.is_active === false) {
      return safeClientError('الحساب غير مفعّل', 403)
    }
    if (!isFieldWorkerRole(profile.role)) {
      return safeClientError('صلاحية غير كافية', 403)
    }

    const file = formData.get('file')
    const taskId = String(formData.get('taskId') ?? '').trim()
    const descriptionRaw = String(formData.get('description') ?? '').trim() || null
    const description = sanitizeStorageKey(descriptionRaw, 48)

    if (!taskId) return safeClientError('معرّف المهمة مطلوب', 400)
    if (!(file instanceof File) || file.size === 0) return safeClientError('ملف غير صالح', 400)
    if (file.size > MAX_BYTES) return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)

    const mime = (file.type || '').toLowerCase()
    if (!isAllowedMobileFile(file.name, mime)) {
      return safeClientError('نوع الملف غير مسموح (صورة أو PDF)', 400)
    }

    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .select('id, assigned_to, branch_id')
      .eq('id', taskId)
      .maybeSingle()

    if (taskErr || !task) return safeClientError('المهمة غير موجودة', 404)
    if (task.assigned_to !== user.id) return safeClientError('المهمة غير مسندة إليك', 403)

    const ext = resolveExt(file.name, mime) || 'bin'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const filePath = `${taskId}/${description ? `${description}-` : ''}${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = mime || MIME_BY_EXT[ext] || 'application/octet-stream'
    const r2Key = r2ObjectKey('task-files', filePath)

    try {
      await uploadToR2(buffer, r2Key, contentType)
    } catch (uploadErr) {
      logR2UploadError('lawyer/mobile-upload-task-file', uploadErr, {
        taskId,
        objectKey: r2Key,
        fileName: file.name,
        fileSize: file.size,
        contentType,
        role: profile.role,
      })
      return safeClientError(r2UploadClientMessage(uploadErr), 500)
    }

    const { data: row, error: insertErr } = await admin
      .from('task_attachments')
      .insert({
        task_id: taskId,
        file_name: (file.name || `file.${ext}`).slice(0, 200),
        file_path: filePath,
        file_size: file.size,
        mime_type: contentType,
        description: descriptionRaw?.slice(0, 200) ?? null,
        uploaded_by: user.id,
      })
      .select('id, file_name, file_path, file_size, mime_type, description, created_at')
      .single()

    if (insertErr) {
      await deleteFromR2(r2Key).catch(() => null)
      return apiServerError('lawyer/mobile-upload-task-file:db', insertErr, 'فشل حفظ المرفق')
    }

    return NextResponse.json({ ok: true, filePath, attachment: row })
  } catch (e) {
    console.error('[lawyer/mobile-upload-task-file]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
