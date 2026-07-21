import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff, sessionCaseScope } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { logActivity } from '@/lib/activity-log'
import { isPdfFile } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { requireDebtorInScope } from '@/lib/section-guard'

const MAX_BYTES = 15 * 1024 * 1024

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error

  const formData = await request.formData()
  const file = formData.get('file')
  const debtorId = String(formData.get('debtorId') ?? '').trim()

  if (!debtorId) {
    return safeClientError('معرّف المدين مطلوب', 400)
  }
  if (!(file instanceof File) || file.size === 0) {
    return safeClientError('ملف غير صالح', 400)
  }
  if (file.size > MAX_BYTES) {
    return safeClientError('حجم الملف يتجاوز 15 ميجابايت', 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!isPdfFile(file, buffer)) {
    return safeClientError('يجب أن يكون الملف بصيغة PDF فقط', 400)
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id, branch_id, case_type')
  if (!gate.ok) return gate.error

  const debtor = gate.data as { id: string; branch_id: string | null }

  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) {
    return safeClientError('صلاحية غير كافية', 403)
  }

  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  const filePath = `${debtorId}/${safeName}`

  const { error: uploadErr } = await admin.storage
    .from('debtor-files')
    .upload(filePath, buffer, { contentType: 'application/pdf', upsert: false })

  if (uploadErr) {
    return apiServerError('upload-debtor-file', uploadErr, 'فشل رفع الملف')
  }

  const { data: row, error: insertErr } = await admin
    .from('debtor_attachments')
    .insert({
      debtor_id: debtorId,
      file_name: file.name.slice(0, 200),
      file_path: filePath,
      file_size: file.size,
      mime_type: 'application/pdf',
      uploaded_by: auth.user!.id,
    })
    .select('id, file_name, file_path, file_size, mime_type, created_at')
    .single()

  if (insertErr) {
    await admin.storage.from('debtor-files').remove([filePath])
    return apiServerError('upload-debtor-file:db', insertErr, 'فشل حفظ المرفق')
  }

  await logActivity({
    action: 'upload_debtor_file',
    entity_type: 'debtor',
    entity_id: debtorId,
    description: `رفع ملف مدين: ${file.name.slice(0, 120)}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, filePath, attachment: row })
}
