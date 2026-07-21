import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canEditDebtor } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { logActivity } from '@/lib/activity-log'
import { requireDebtorInScope } from '@/lib/section-guard'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import {
  buildCriminalFilePath,
  isCriminalFileKind,
  validateCriminalPdfUpload,
  type CriminalFileKind,
} from '@/lib/criminal-debtor-files'
import { fetchCriminalDebtorDetails, upsertCriminalDebtorDetails } from '@/lib/criminal-debtor-details'

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
  const formData = await request.formData()
  const file = formData.get('file')
  const kindRaw = String(formData.get('kind') ?? 'documents').trim()
  if (!isCriminalFileKind(kindRaw)) {
    return safeClientError('نوع الملف غير صالح', 400)
  }
  const kind: CriminalFileKind = kindRaw

  if (!(file instanceof File) || file.size === 0) {
    return safeClientError('ملف غير صالح', 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const validationError = validateCriminalPdfUpload(file, buffer)
  if (validationError) return safeClientError(validationError, 400)

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id, branch_id, case_type')
  if (!gate.ok) return gate.error
  if (gate.caseType !== 'criminal') {
    return safeClientError('هذه الملفات للمدين الجزائي فقط', 400)
  }

  const debtor = gate.data as { id: string; branch_id: string | null }
  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  const existing = await fetchCriminalDebtorDetails(admin, debtorId)
  const oldPath =
    kind === 'petition'
      ? existing?.petition_file_path ?? null
      : existing?.documents_contract_file_path ?? null

  const newPath = buildCriminalFilePath(debtorId, kind)

  const { error: uploadErr } = await admin.storage
    .from('debtor-files')
    .upload(newPath, buffer, { contentType: 'application/pdf', upsert: false })

  if (uploadErr) {
    return apiServerError('criminal-file:upload', uploadErr, 'فشل رفع الملف')
  }

  const patch =
    kind === 'petition'
      ? { petition_file_path: newPath }
      : { documents_contract_file_path: newPath }

  const detailsRes = await upsertCriminalDebtorDetails(admin, debtorId, {
    ...(existing ?? {}),
    ...patch,
  })

  if (detailsRes.error) {
    await admin.storage.from('debtor-files').remove([newPath])
    return apiServerError('criminal-file:db', detailsRes.error, 'فشل حفظ مسار الملف')
  }

  if (oldPath && isSafeStoragePath(oldPath) && oldPath !== newPath) {
    await admin.storage.from('debtor-files').remove([oldPath]).catch(() => null)
  }

  await logActivity({
    action: kind === 'petition' ? 'upload_criminal_petition' : 'upload_criminal_documents',
    entity_type: 'debtor',
    entity_id: debtorId,
    description: kind === 'petition' ? 'رفع/استبدال عريضة الدعوى' : 'رفع/استبدال المستمسكات والعقد',
    case_type: 'criminal',
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    kind,
    filePath: newPath,
    details: detailsRes.data,
  })
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

  if (!filePath || !isSafeStoragePath(filePath)) {
    return NextResponse.json({ error: 'الملف غير موجود', missing: true }, { status: 404 })
  }

  const { data, error } = await admin.storage
    .from('debtor-files')
    .createSignedUrl(filePath, 60 * 10)

  if (error || !data?.signedUrl) {
    return apiServerError('criminal-file:signed', error, 'تعذر إنشاء رابط الملف')
  }

  return NextResponse.json({ url: data.signedUrl, filePath })
}
