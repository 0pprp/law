import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { apiForbiddenResponse } from '@/lib/permissions'
import { fetchExistingReceiptNumbers } from '@/lib/debtor-import'

export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const branchId = new URL(request.url).searchParams.get('branchId')?.trim()
  if (!branchId) return NextResponse.json({ error: 'معرّف الفرع مطلوب' }, { status: 400 })
  if (!canStaffReadBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const admin = createAdminClient()
  const set = await fetchExistingReceiptNumbers(admin, branchId)
  return NextResponse.json({ receipts: [...set] })
}
