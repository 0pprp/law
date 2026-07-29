import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { canReadAllBranches, isAdmin, isLegalManager } from '@/lib/permissions'
import { isSafeStoragePath } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireLawyerInScope } from '@/lib/section-guard'
import { canResolveStoredFilePath, storedFileUrl } from '@/lib/stored-file-url'

export async function POST(request: Request) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  const profile = auth.profile!

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
  if (!fileId && path && !isSafeStoragePath(path) && !canResolveStoredFilePath('lawyer-files', path)) {
    return safeClientError('مسار غير صالح', 400)
  }

  const admin = createAdminClient()
  let q = admin
    .from('lawyer_attachments')
    .select('id, file_path, lawyer_id')
  if (fileId) q = q.eq('id', fileId)
  else q = q.eq('file_path', path!)

  const { data: row, error } = await q.maybeSingle()
  if (error) return apiServerError('lawyer-file-url', error)
  if (!row?.file_path || !row.lawyer_id) return safeClientError('الملف غير موجود', 404)

  if (fileId && path && isSafeStoragePath(path) && row.file_path !== path) {
    return safeClientError('الملف غير موجود', 404)
  }

  const scope = sessionCaseScope(profile)
  const gate = await requireLawyerInScope(admin, scope, row.lawyer_id)
  if (!gate.ok) return gate.error

  const lawyerBranch = (gate.data as { branch_id?: string | null }).branch_id ?? null
  const canRead = lawyerBranch
    ? canStaffReadBranch(profile, lawyerBranch)
    : isAdmin(profile.role)
      || profile.role === 'employee'
      || isLegalManager(profile.role)
      || canReadAllBranches(profile.role, profile.accountant_type)
  if (!canRead) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const url = storedFileUrl('lawyer-files', row.file_path)
  if (!url) return safeClientError('رابط الملف غير متاح', 404)

  return NextResponse.json({ url })
}
