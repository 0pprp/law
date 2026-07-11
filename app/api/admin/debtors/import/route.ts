import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { canImportDebtors, apiForbiddenResponse } from '@/lib/permissions'
import { isMainBranchName } from '@/lib/branch-constants'
import {
  executeDebtorImport,
  type ImportPreviewRow,
  type TaskDefRef,
} from '@/lib/debtor-import'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error
  if (!canImportDebtors(auth.profile?.role)) return apiForbiddenResponse()

  let body: {
    branchId?: string
    governorate?: string
    rows?: ImportPreviewRow[]
    taskDefs?: TaskDefRef[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const branchId = String(body.branchId ?? '').trim()
  if (!branchId) return NextResponse.json({ error: 'معرّف الفرع مطلوب' }, { status: 400 })
  if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const admin = createAdminClient()
  const { data: branch } = await admin.from('branches').select('id, name').eq('id', branchId).maybeSingle()
  if (!branch || isMainBranchName(branch.name)) {
    return NextResponse.json({ error: 'يجب اختيار فرعاً رسمياً قبل الاستيراد' }, { status: 400 })
  }

  // PDF يُرفع لاحقاً من العميل عبر /api/admin/upload-debtor-file
  const validRows = (body.rows ?? [])
    .filter(r => r.valid)
    .map(r => ({ ...r, pdfBlob: null, pdfStatus: '—' as const }))

  if (!validRows.length) {
    return NextResponse.json({ error: 'لا توجد صفوف جاهزة للاستيراد' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const result = await executeDebtorImport(
    admin,
    validRows,
    {
      branchId,
      governorate: String(body.governorate ?? branch.name ?? ''),
      userId: auth.user!.id,
      taskDefs: body.taskDefs ?? [],
      today,
    },
    () => {},
  )

  await logActivity({
    action: 'import_debtors',
    entity_type: 'debtor',
    entity_id: branchId,
    description: `استيراد مدينين: ${result.imported} نجح، ${result.failures.length} فشل`,
  }, auth.supabase)

  return NextResponse.json({ ok: true, ...result })
}
