import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canAddDebtor, canAssignTasks, canManageTaskManagement } from '@/lib/permissions'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import {
  syncCriminalDefsToTaskDefinitions,
  TASK_DEF_MULTI_CUSTOM_SQL_HINT,
} from '@/lib/sync-criminal-task-definitions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'

function canList(role: string | null | undefined): boolean {
  return canAssignTasks(role) || canAddDebtor(role) || canManageTaskManagement(role)
}

function looksLikeTaskTypeUniq(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('task_def_type_branch_uniq')
    || (m.includes('task_type') && (m.includes('duplicate') || m.includes('unique') || m.includes('23505')))
  )
}

/**
 * يزامن المهام الجزائية من إدارة المهام ثم يرجع قائمة task_definitions للفرع.
 * GET ?branchId=...
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canList(auth.profile?.role)) return apiForbiddenResponse()

  const branchId = new URL(request.url).searchParams.get('branchId')?.trim() || null
  if (!branchId) return safeClientError('معرّف الفرع مطلوب', 400)
  if (!canStaffReadBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const admin = createAdminClient()

  let syncWarning: string | null = null
  try {
    const syncResult = await syncCriminalDefsToTaskDefinitions(admin, branchId)
    if (syncResult.errors?.some(e => looksLikeTaskTypeUniq(e))) {
      syncWarning = TASK_DEF_MULTI_CUSTOM_SQL_HINT
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[task-definitions/criminal:sync]', msg)
    if (looksLikeTaskTypeUniq(msg)) {
      syncWarning = TASK_DEF_MULTI_CUSTOM_SQL_HINT
    }
  }

  const { data, error } = await admin
    .from('task_definitions')
    .select('id, label, fee_amount, task_type, sort_order, case_type')
    .eq('branch_id', branchId)
    .eq('case_type', 'criminal')
    .eq('is_active', true)
    .order('sort_order')
    .order('label')

  if (error) return apiServerError('task-definitions/criminal:list', error)

  return NextResponse.json({
    definitions: data ?? [],
    warning: syncWarning,
    needsMigration: Boolean(syncWarning),
  })
}
