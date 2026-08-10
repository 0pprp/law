import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffOrChiefReadDebtor } from '@/lib/chief-accountant-access'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireDebtorInScope } from '@/lib/section-guard'
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
  // عند وجود fileId نثق بالمعرّف — المسارات المطلقة القديمة (Supabase) تفشل isSafeStoragePath
  if (!fileId && path && !isSafeStoragePath(path) && !canResolveStoredFilePath('debtor-files', path)) {
    return safeClientError('مسار غير صالح', 400)
  }

  const admin = createAdminClient()
  let q = admin
    .from('debtor_attachments')
    .select('id, file_path, debtor_id, debtor:debtors!debtor_attachments_debtor_id_fkey(branch_id, assigned_chief_accountant_id)')
  if (fileId) q = q.eq('id', fileId)
  else q = q.eq('file_path', path!)

  const { data: row, error } = await q.maybeSingle()
  if (error) return apiServerError('debtor-file-url', error)
  if (!row?.file_path) return safeClientError('الملف غير موجود', 404)

  // تطابق المسار فقط للمسارات النسبية الآمنة — الروابط المطلقة القديمة قد تختلف شكلياً
  if (fileId && path && isSafeStoragePath(path) && row.file_path !== path) {
    return safeClientError('الملف غير موجود', 404)
  }

  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, row.debtor_id)
  if (!gate.ok) return gate.error

  const debtor = Array.isArray(row.debtor) ? row.debtor[0] : row.debtor
  const branchId = (debtor as { branch_id?: string | null } | null)?.branch_id ?? null
  const assigned = (debtor as { assigned_chief_accountant_id?: string | null } | null)?.assigned_chief_accountant_id ?? null
  if (!canStaffOrChiefReadDebtor(
    { ...auth.profile!, id: auth.user!.id },
    { branch_id: branchId, assigned_chief_accountant_id: assigned },
  )) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const url = storedFileUrl('debtor-files', row.file_path)
  if (!url) return safeClientError('رابط الملف غير متاح', 404)

  return NextResponse.json({ url })
}
