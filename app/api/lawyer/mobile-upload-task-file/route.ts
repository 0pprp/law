/**
 * Mobile task-file upload — JSON only (reliable Authorization header on Android).
 * Accepts: { taskId, fileName, contentType, dataBase64, access_token? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isFieldWorkerRole } from '@/lib/permissions'
import { sanitizeStorageKey } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { uploadToR2, deleteFromR2, r2ObjectKey } from '@/lib/r2-storage'
import { logR2UploadError, r2UploadClientMessage } from '@/lib/r2-upload-diagnostics'
import { fetchStaffProfile } from '@/lib/staff-profile'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx'])

function extOf(name: string, mime: string): string {
  const fromName = (name.split('.').pop() || '').toLowerCase().replace(/[^\w]/g, '')
  if (ALLOWED_EXT.has(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName
  const m = mime.toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  return 'jpg'
}

async function authenticate(req: NextRequest, bodyToken?: string) {
  const header = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const token = header || (bodyToken || '').trim()
  if (!token) return { error: safeClientError('MOBILE_AUTH_NO_TOKEN', 401) }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) {
    console.error('[mobile-upload-json] getUser', error?.message)
    return { error: safeClientError('MOBILE_AUTH_BAD_TOKEN', 401) }
  }

  const profile = await fetchStaffProfile(admin, data.user.id)
  if (!profile?.role) return { error: safeClientError('MOBILE_AUTH_NO_PROFILE', 401) }
  if (profile.is_active === false) return { error: safeClientError('MOBILE_AUTH_INACTIVE', 403) }
  if (!isFieldWorkerRole(profile.role)) return { error: safeClientError('MOBILE_AUTH_FORBIDDEN', 403) }

  return { admin, user: data.user, profile, token }
}

export async function POST(request: NextRequest) {
  try {
    const contentTypeHeader = request.headers.get('content-type') || ''

    // --- JSON path (preferred for mobile) ---
    if (contentTypeHeader.includes('application/json')) {
      const body = await request.json().catch(() => null) as {
        taskId?: string
        fileName?: string
        contentType?: string
        dataBase64?: string
        description?: string
        access_token?: string
      } | null

      if (!body) return safeClientError('JSON غير صالح', 400)

      const auth = await authenticate(request, body.access_token)
      if ('error' in auth && auth.error) return auth.error
      const { admin, user, profile } = auth as Exclude<typeof auth, { error: Response }>

      const taskId = String(body.taskId ?? '').trim()
      const fileName = String(body.fileName ?? 'upload.jpg').trim() || 'upload.jpg'
      const mime = String(body.contentType ?? 'image/jpeg').trim() || 'image/jpeg'
      const b64 = String(body.dataBase64 ?? '').replace(/^data:[^;]+;base64,/, '')
      if (!taskId) return safeClientError('معرّف المهمة مطلوب', 400)
      if (!b64) return safeClientError('الملف فارغ', 400)

      const buffer = Buffer.from(b64, 'base64')
      if (buffer.length === 0) return safeClientError('الملف فارغ', 400)
      if (buffer.length > MAX_BYTES) return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)

      const ext = extOf(fileName, mime)
      if (!ALLOWED_EXT.has(ext) && ext !== 'jpeg') {
        return safeClientError('نوع الملف غير مسموح', 400)
      }

      return await saveFile({
        admin,
        userId: user.id,
        role: profile.role,
        taskId,
        fileName,
        mime,
        buffer,
        description: body.description ?? null,
      })
    }

    // --- Multipart fallback ---
    const formData = await request.formData()
    const auth = await authenticate(
      request,
      String(formData.get('access_token') ?? formData.get('accessToken') ?? ''),
    )
    if ('error' in auth && auth.error) return auth.error
    const { admin, user, profile } = auth as Exclude<typeof auth, { error: Response }>

    const file = formData.get('file')
    const taskId = String(formData.get('taskId') ?? '').trim()
    const descriptionRaw = String(formData.get('description') ?? '').trim() || null
    if (!taskId) return safeClientError('معرّف المهمة مطلوب', 400)
    if (!(file instanceof File) || file.size === 0) return safeClientError('ملف غير صالح', 400)
    if (file.size > MAX_BYTES) return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const mime = file.type || 'image/jpeg'
    return await saveFile({
      admin,
      userId: user.id,
      role: profile.role,
      taskId,
      fileName: file.name || 'upload.jpg',
      mime,
      buffer,
      description: descriptionRaw,
    })
  } catch (e) {
    console.error('[lawyer/mobile-upload-task-file]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع', code: 'MOBILE_UPLOAD_CRASH' }, { status: 500 })
  }
}

async function saveFile(opts: {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  role: string
  taskId: string
  fileName: string
  mime: string
  buffer: Buffer
  description: string | null
}) {
  const { admin, userId, role, taskId, fileName, mime, buffer, description } = opts

  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('id, assigned_to, branch_id')
    .eq('id', taskId)
    .maybeSingle()

  if (taskErr || !task) return safeClientError('المهمة غير موجودة', 404)
  if (task.assigned_to !== userId) return safeClientError('المهمة غير مسندة إليك', 403)

  const ext = extOf(fileName, mime)
  const descKey = sanitizeStorageKey(description, 48)
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const filePath = `${taskId}/${descKey ? `${descKey}-` : ''}${safeName}`
  const r2Key = r2ObjectKey('task-files', filePath)
  const contentType = mime || 'application/octet-stream'

  try {
    await uploadToR2(buffer, r2Key, contentType)
  } catch (uploadErr) {
    logR2UploadError('lawyer/mobile-upload-task-file', uploadErr, {
      taskId,
      objectKey: r2Key,
      fileName,
      fileSize: buffer.length,
      contentType,
      role,
    })
    return safeClientError(r2UploadClientMessage(uploadErr), 500)
  }

  const { data: row, error: insertErr } = await admin
    .from('task_attachments')
    .insert({
      task_id: taskId,
      file_name: fileName.slice(0, 200),
      file_path: filePath,
      file_size: buffer.length,
      mime_type: contentType,
      description: description?.slice(0, 200) ?? null,
      uploaded_by: userId,
    })
    .select('id, file_name, file_path, file_size, mime_type, description, created_at')
    .single()

  if (insertErr) {
    await deleteFromR2(r2Key).catch(() => null)
    return apiServerError('lawyer/mobile-upload-task-file:db', insertErr, 'فشل حفظ المرفق')
  }

  return NextResponse.json({ ok: true, filePath, attachment: row, via: 'mobile-json-or-multipart' })
}
