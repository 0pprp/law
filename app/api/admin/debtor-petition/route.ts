import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canEditDebtor } from '@/lib/permissions'
import { canStaffOrChiefWriteDebtor } from '@/lib/chief-accountant-access'
import { logActivity } from '@/lib/activity-log'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireDebtorInScope } from '@/lib/section-guard'
import { deleteFromR2, r2ObjectKey, uploadToR2 } from '@/lib/r2-storage'
import {
  logR2UploadError,
  missingR2EnvironmentVariables,
  r2UploadClientMessage,
} from '@/lib/r2-upload-diagnostics'
import {
  normalizePetitionFields,
  validatePetitionFields,
  PETITION_ATTACHMENT_LABEL,
  buildPetitionFileName,
  type DebtorPetitionFields,
} from '@/lib/debtor-petition'
import {
  generateDebtorPetitionDocx,
  PETITION_DOCX_MIME,
} from '@/lib/debtor-petition-docx'

type PetitionAction = 'docx' | 'pdf' | 'save'

function decodeDocxBase64(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const cleaned = raw
    .replace(/^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/i, '')
    .replace(/^data:application\/octet-stream;base64,/i, '')
    .trim()
  try {
    const buf = Buffer.from(cleaned, 'base64')
    // ZIP/OOXML magic: PK
    if (buf.length < 100 || buf.slice(0, 2).toString('binary') !== 'PK') return null
    return buf
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canEditDebtor(auth.profile?.role)) return apiForbiddenResponse()

  let body: {
    action?: unknown
    debtorId?: unknown
    fields?: Partial<DebtorPetitionFields>
    download?: unknown
    docxBase64?: unknown
    /** توافق قديم — يُتجاهل لصالح Word */
    pdfBase64?: unknown
    fileName?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const actionRaw = String(body.action ?? '').trim()
  // pdf القديم يُعامل كتنزيل Word
  const action = (actionRaw === 'pdf' ? 'docx' : actionRaw) as PetitionAction
  if (action !== 'docx' && action !== 'save') {
    return safeClientError('إجراء غير مدعوم', 400)
  }
  const alsoDownload = body.download === true

  const debtorId = String(body.debtorId ?? '').trim()
  if (!debtorId) return safeClientError('معرّف المدين مطلوب', 400)

  const fields = normalizePetitionFields(body.fields ?? {})
  const validationError = validatePetitionFields(fields)
  if (validationError) return safeClientError(validationError, 400)

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id, branch_id, case_type, assigned_chief_accountant_id')
  if (!gate.ok) return gate.error

  const debtor = gate.data as {
    id: string
    branch_id: string | null
    case_type?: string | null
    assigned_chief_accountant_id?: string | null
  }
  if (!canStaffOrChiefWriteDebtor(
    { ...auth.profile!, id: auth.user!.id },
    debtor,
  )) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  let fileBuffer: Buffer
  let fileName: string

  const clientDocx = decodeDocxBase64(body.docxBase64)
  if (clientDocx) {
    fileBuffer = clientDocx
    const requested = String(body.fileName ?? '').trim()
    fileName = requested
      ? (requested.toLowerCase().endsWith('.docx') ? requested : `${requested.replace(/\.pdf$/i, '')}.docx`)
      : buildPetitionFileName(fields.defendantName)
  } else {
    try {
      ;({ buffer: fileBuffer, fileName } = await generateDebtorPetitionDocx(fields))
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'خطأ غير معروف'
      return apiServerError(
        'debtor-petition:docx',
        e,
        `فشل توليد ملف Word للعريضة — ${detail.slice(0, 180)}`,
      )
    }
  }

  if (action === 'docx') {
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': PETITION_DOCX_MIME,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // action === 'save'
  const missingR2Env = missingR2EnvironmentVariables()
  if (missingR2Env.length) {
    return safeClientError(
      `إعدادات تخزين R2 ناقصة في الخادم: ${missingR2Env.join(', ')}`,
      500,
    )
  }

  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.docx`
  const filePath = `${debtorId}/petitions/${safeName}`
  const objectKey = r2ObjectKey('debtor-files', filePath)

  try {
    await uploadToR2(fileBuffer, objectKey, PETITION_DOCX_MIME)
  } catch (uploadErr) {
    logR2UploadError('debtor-petition:save', uploadErr, {
      debtorId,
      objectKey,
      fileName,
      fileSize: fileBuffer.length,
      role: auth.profile?.role,
    })
    return safeClientError(r2UploadClientMessage(uploadErr), 500)
  }

  const displayName = fileName.slice(0, 200)

  const { data: row, error: insertErr } = await admin
    .from('debtor_attachments')
    .insert({
      debtor_id: debtorId,
      file_name: displayName,
      file_path: filePath,
      file_size: fileBuffer.length,
      mime_type: PETITION_DOCX_MIME,
      uploaded_by: auth.user!.id,
    })
    .select('id, file_name, file_path, file_size, mime_type, created_at')
    .single()

  if (insertErr) {
    await deleteFromR2(objectKey).catch(() => null)
    return apiServerError('debtor-petition:db', insertErr, 'فشل حفظ المرفق')
  }

  await logActivity({
    action: 'create_debtor_petition',
    entity_type: 'debtor',
    entity_id: debtorId,
    description: `تم إنشاء ${PETITION_ATTACHMENT_LABEL} (Word) وحفظها في مرفقات المدين`,
    case_type: gate.caseType,
    metadata: {
      attachment_id: row.id,
      file_path: filePath,
      file_name: displayName,
      created_by: auth.user!.id,
      case_type: gate.caseType,
      defendant_name: fields.defendantName,
      downloaded: alsoDownload,
      format: 'docx',
      client_docx: Boolean(clientDocx),
    },
  }, auth.supabase)

  if (alsoDownload) {
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': PETITION_DOCX_MIME,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
        'X-Attachment-Id': row.id,
        'X-Attachment-Saved': '1',
      },
    })
  }

  return NextResponse.json({
    ok: true,
    attachment: row,
    filePath,
    fileName: displayName,
  })
}
