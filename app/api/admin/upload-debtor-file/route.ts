import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canEditDebtor } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { logActivity } from '@/lib/activity-log'
import { isPdfFile } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireDebtorInScope } from '@/lib/section-guard'
import {
  createR2PresignedUploadUrl,
  getR2ObjectMetadata,
  isR2PdfObject,
  uploadToR2,
  deleteFromR2,
  r2ObjectKey,
} from '@/lib/r2-storage'

const MAX_BYTES = 15 * 1024 * 1024

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canEditDebtor(auth.profile?.role)) return apiForbiddenResponse()

  const contentType = request.headers.get('content-type') ?? ''
  let jsonBody: {
    action?: unknown
    debtorId?: unknown
    fileName?: unknown
    fileSize?: unknown
    filePath?: unknown
  } | null = null
  let formData: FormData | null = null
  if (contentType.includes('application/json')) {
    jsonBody = await request.json().catch(() => null)
  } else {
    formData = await request.formData()
  }
  const debtorId = String(jsonBody?.debtorId ?? formData?.get('debtorId') ?? '').trim()
  if (!debtorId) return safeClientError('معرّف المدين مطلوب', 400)

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id, branch_id, case_type')
  if (!gate.ok) return gate.error
  const debtorCaseType = gate.caseType

  const debtor = gate.data as { id: string; branch_id: string | null }

  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  async function finalize(filePath: string, fileName: string, fileSize: number) {
    const r2Key = r2ObjectKey('debtor-files', filePath)
    const { data: existing } = await admin
      .from('debtor_attachments')
      .select('id, file_name, file_path, file_size, mime_type, created_at')
      .eq('debtor_id', debtorId)
      .eq('file_path', filePath)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ ok: true, filePath, attachment: existing })
    }

    const { data: row, error: insertErr } = await admin
      .from('debtor_attachments')
      .insert({
        debtor_id: debtorId,
        file_name: fileName.slice(0, 200),
        file_path: filePath,
        file_size: fileSize,
        mime_type: 'application/pdf',
        uploaded_by: auth.user!.id,
      })
      .select('id, file_name, file_path, file_size, mime_type, created_at')
      .single()

    if (insertErr) {
      await deleteFromR2(r2Key).catch(() => null)
      return apiServerError('upload-debtor-file:db', insertErr, 'فشل حفظ المرفق')
    }

    await logActivity({
      action: 'upload_debtor_file',
      entity_type: 'debtor',
      entity_id: debtorId,
      description: `رفع ملف مدين: ${fileName.slice(0, 120)}`,
      case_type: debtorCaseType,
    }, auth.supabase)

    return NextResponse.json({ ok: true, filePath, attachment: row })
  }

  if (jsonBody) {
    const fileName = String(jsonBody.fileName ?? '').trim()
    const fileSize = Number(jsonBody.fileSize)
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return safeClientError('يجب أن يكون الملف بصيغة PDF فقط', 400)
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
      return safeClientError('حجم الملف غير صالح أو يتجاوز 15 ميجابايت', 400)
    }

    if (jsonBody.action === 'prepare') {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
      const filePath = `${debtorId}/${safeName}`
      const uploadUrl = await createR2PresignedUploadUrl(
        r2ObjectKey('debtor-files', filePath),
        'application/pdf',
      )
      return NextResponse.json({ uploadUrl, filePath, contentType: 'application/pdf' })
    }

    if (jsonBody.action === 'commit') {
      const filePath = String(jsonBody.filePath ?? '').trim()
      if (!filePath.startsWith(`${debtorId}/`) || !filePath.toLowerCase().endsWith('.pdf')) {
        return safeClientError('مسار الملف غير صالح', 400)
      }
      const metadata = await getR2ObjectMetadata(r2ObjectKey('debtor-files', filePath))
      if (
        !metadata
        || metadata.size <= 0
        || metadata.size > MAX_BYTES
        || metadata.contentType !== 'application/pdf'
        || !(await isR2PdfObject(r2ObjectKey('debtor-files', filePath)))
      ) {
        return safeClientError('لم يكتمل رفع ملف PDF إلى التخزين', 400)
      }
      return finalize(filePath, fileName, metadata.size)
    }

    return safeClientError('عملية رفع غير صالحة', 400)
  }

  // توافق خلفي للطلبات الصغيرة القديمة.
  const file = formData?.get('file')
  if (!(file instanceof File) || file.size === 0) return safeClientError('ملف غير صالح', 400)
  if (file.size > MAX_BYTES) return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!isPdfFile(file, buffer)) return safeClientError('يجب أن يكون الملف بصيغة PDF فقط', 400)

  const filePath = `${debtorId}/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  try {
    await uploadToR2(buffer, r2ObjectKey('debtor-files', filePath), 'application/pdf')
  } catch (uploadErr) {
    return apiServerError('upload-debtor-file', uploadErr, 'فشل رفع الملف')
  }

  return finalize(filePath, file.name, file.size)
}
