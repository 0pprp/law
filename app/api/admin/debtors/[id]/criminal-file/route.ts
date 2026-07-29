import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canEditDebtor } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { logActivity } from '@/lib/activity-log'
import { requireDebtorInScope } from '@/lib/section-guard'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import {
  buildCriminalFilePath,
  criminalStorageFolder,
  CRIMINAL_FILE_MAX_BYTES,
  isCriminalFileKind,
  validateCriminalPdfUpload,
  type CriminalFileKind,
} from '@/lib/criminal-debtor-files'
import { fetchCriminalDebtorDetails, upsertCriminalDebtorDetails } from '@/lib/criminal-debtor-details'
import {
  createR2PresignedUploadUrl,
  getR2ObjectMetadata,
  isR2PdfObject,
  uploadToR2,
  deleteFromR2,
  r2ObjectKey,
} from '@/lib/r2-storage'
import { canResolveStoredFilePath, relativeStoredPath, storedFileUrl } from '@/lib/stored-file-url'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * رفع/استبدال ملف جزائي:
 * - kind=documents → المستمسكات والعقد
 * - kind=petition  → عريضة الدعوى (من التفاصيل فقط)
 *
 * الاستبدال الآمن: رفع الجديد → تحديث DB → حذف القديم عند نجاح التحديث.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canEditDebtor(auth.profile?.role)) return apiForbiddenResponse()

  const { id: debtorId } = await params
  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id, branch_id, case_type')
  if (!gate.ok) return gate.error
  if (gate.caseType !== 'criminal') {
    return safeClientError('هذه الملفات للمدين الجزائي فقط', 400)
  }
  const debtorCaseType = gate.caseType

  const debtor = gate.data as { id: string; branch_id: string | null }
  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  async function finalize(kind: CriminalFileKind, newPath: string) {
    const r2Key = r2ObjectKey('debtor-files', newPath)
    const existing = await fetchCriminalDebtorDetails(admin, debtorId)
    const oldPath =
      kind === 'petition'
        ? existing?.petition_file_path ?? null
        : existing?.documents_contract_file_path ?? null
    const patch =
      kind === 'petition'
        ? { petition_file_path: newPath }
        : { documents_contract_file_path: newPath }

    const detailsRes = await upsertCriminalDebtorDetails(admin, debtorId, {
      ...(existing ?? {}),
      ...patch,
    })

    if (detailsRes.error) {
      await deleteFromR2(r2Key).catch(() => null)
      return apiServerError('criminal-file:db', detailsRes.error, 'فشل حفظ مسار الملف')
    }

    if (oldPath) {
      const oldRel = relativeStoredPath('debtor-files', oldPath)
      if (oldRel && oldRel !== newPath) {
        await deleteFromR2(r2ObjectKey('debtor-files', oldRel)).catch(() => null)
      }
    }

    await logActivity({
      action: kind === 'petition' ? 'upload_criminal_petition' : 'upload_criminal_documents',
      entity_type: 'debtor',
      entity_id: debtorId,
      description: kind === 'petition' ? 'رفع/استبدال عريضة الدعوى' : 'رفع/استبدال المستمسكات والعقد',
      case_type: debtorCaseType,
    }, auth.supabase)

    return NextResponse.json({
      ok: true,
      kind,
      filePath: newPath,
      details: detailsRes.data,
    })
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => null) as {
      action?: unknown
      kind?: unknown
      fileName?: unknown
      fileSize?: unknown
      filePath?: unknown
    } | null
    if (!body || !isCriminalFileKind(body.kind)) {
      return safeClientError('طلب أو نوع ملف غير صالح', 400)
    }
    const kind = body.kind

    if (body.action === 'prepare') {
      const fileName = String(body.fileName ?? '').trim()
      const fileSize = Number(body.fileSize)
      if (!fileName.toLowerCase().endsWith('.pdf')) {
        return safeClientError('يجب أن يكون الملف بصيغة PDF فقط', 400)
      }
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > CRIMINAL_FILE_MAX_BYTES) {
        return safeClientError('حجم الملف غير صالح أو يتجاوز 15 ميجابايت', 400)
      }

      const filePath = buildCriminalFilePath(debtorId, kind)
      const uploadUrl = await createR2PresignedUploadUrl(
        r2ObjectKey('debtor-files', filePath),
        'application/pdf',
      )
      return NextResponse.json({ uploadUrl, filePath, contentType: 'application/pdf' })
    }

    if (body.action === 'commit') {
      const filePath = String(body.filePath ?? '').trim()
      const expectedPrefix = `${criminalStorageFolder(kind)}/${debtorId}/`
      if (!filePath.startsWith(expectedPrefix) || !filePath.toLowerCase().endsWith('.pdf')) {
        return safeClientError('مسار الملف غير صالح', 400)
      }
      const metadata = await getR2ObjectMetadata(r2ObjectKey('debtor-files', filePath))
      if (
        !metadata
        || metadata.size <= 0
        || metadata.size > CRIMINAL_FILE_MAX_BYTES
        || metadata.contentType !== 'application/pdf'
        || !(await isR2PdfObject(r2ObjectKey('debtor-files', filePath)))
      ) {
        return safeClientError('لم يكتمل رفع ملف PDF إلى التخزين', 400)
      }
      return finalize(kind, filePath)
    }

    return safeClientError('عملية رفع غير صالحة', 400)
  }

  // توافق خلفي للطلبات الصغيرة القديمة.
  const formData = await request.formData()
  const file = formData.get('file')
  const kindRaw = String(formData.get('kind') ?? 'documents').trim()
  if (!isCriminalFileKind(kindRaw)) return safeClientError('نوع الملف غير صالح', 400)
  if (!(file instanceof File) || file.size === 0) return safeClientError('ملف غير صالح', 400)

  const buffer = Buffer.from(await file.arrayBuffer())
  const validationError = validateCriminalPdfUpload(file, buffer)
  if (validationError) return safeClientError(validationError, 400)

  const newPath = buildCriminalFilePath(debtorId, kindRaw)
  try {
    await uploadToR2(buffer, r2ObjectKey('debtor-files', newPath), 'application/pdf')
  } catch (uploadErr) {
    return apiServerError('criminal-file:upload', uploadErr, 'فشل رفع الملف')
  }

  return finalize(kindRaw, newPath)
}

/** Signed URL لملف جزائي (documents أو petition) */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const { id: debtorId } = await params
  const kindRaw = new URL(request.url).searchParams.get('kind') ?? 'documents'
  if (!isCriminalFileKind(kindRaw)) {
    return safeClientError('نوع الملف غير صالح', 400)
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id, branch_id, case_type')
  if (!gate.ok) return gate.error
  if (gate.caseType !== 'criminal') return safeClientError('غير متاح', 400)

  const details = await fetchCriminalDebtorDetails(admin, debtorId)
  const filePath =
    kindRaw === 'petition'
      ? details?.petition_file_path
      : details?.documents_contract_file_path

  if (!filePath || !canResolveStoredFilePath('debtor-files', filePath)) {
    return NextResponse.json({ error: 'الملف غير موجود', missing: true }, { status: 404 })
  }

  const url = storedFileUrl('debtor-files', filePath)
  if (!url) return NextResponse.json({ error: 'الملف غير موجود', missing: true }, { status: 404 })

  return NextResponse.json({ url, filePath })
}
