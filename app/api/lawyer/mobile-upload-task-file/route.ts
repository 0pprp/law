import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { isFieldWorkerRole } from '@/lib/permissions'
import { isAllowedTaskFile, sanitizeStorageKey } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { uploadToR2, deleteFromR2, r2ObjectKey } from '@/lib/r2-storage'
import { logR2UploadError, r2UploadClientMessage } from '@/lib/r2-upload-diagnostics'
import { fetchStaffProfile } from '@/lib/staff-profile'

const MAX_BYTES = 15 * 1024 * 1024

/**
 * رفع مرفقات المهام من تطبيق Flutter عبر Bearer JWT (بدون كوكيز الويب).
 * نفس مسار التخزين/الجدول المستخدم في /api/worker/upload-task-file.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    if (!token) return safeClientError('غير مصرح', 401)

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) return safeClientError('إعدادات الخادم غير مكتملة', 500)

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser(token)
    if (userErr || !user) return safeClientError('غير مصرح', 401)

    const admin = createAdminClient()
    const profile = await fetchStaffProfile(admin, user.id)
    if (!profile?.role || profile.is_active === false) {
      return safeClientError('غير مصرح', 401)
    }
    if (!isFieldWorkerRole(profile.role) && profile.role !== 'lawyer') {
      return safeClientError('صلاحية غير كافية', 403)
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const taskId = String(formData.get('taskId') ?? '').trim()
    const descriptionRaw = String(formData.get('description') ?? '').trim() || null
    const description = sanitizeStorageKey(descriptionRaw, 48)

    if (!taskId) return safeClientError('معرّف المهمة مطلوب', 400)
    if (!(file instanceof File) || file.size === 0) return safeClientError('ملف غير صالح', 400)
    if (file.size > MAX_BYTES) return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)
    if (!isAllowedTaskFile(file)) return safeClientError('نوع الملف غير مسموح', 400)

    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .select('id, assigned_to, branch_id')
      .eq('id', taskId)
      .maybeSingle()

    if (taskErr || !task) return safeClientError('المهمة غير موجودة', 404)
    if (task.assigned_to !== user.id) return safeClientError('المهمة غير مسندة إليك', 403)

    const ext = (file.name.split('.').pop() || 'bin').replace(/[^\w]/g, '').toLowerCase().slice(0, 8) || 'bin'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const filePath = `${taskId}/${description ? `${description}-` : ''}${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const r2Key = r2ObjectKey('task-files', filePath)

    try {
      await uploadToR2(buffer, r2Key, file.type || 'application/octet-stream')
    } catch (uploadErr) {
      logR2UploadError('lawyer/mobile-upload-task-file', uploadErr, {
        taskId,
        objectKey: r2Key,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        role: profile.role,
      })
      return safeClientError(r2UploadClientMessage(uploadErr), 500)
    }

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
      await deleteFromR2(r2Key).catch(() => null)
      return apiServerError('lawyer/mobile-upload-task-file:db', insertErr, 'فشل حفظ المرفق')
    }

    return NextResponse.json({ ok: true, filePath, attachment: row })
  } catch (e) {
    console.error('[lawyer/mobile-upload-task-file]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
