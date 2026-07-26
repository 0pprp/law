import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import {
  apiForbiddenResponse,
  canAssignTasks,
  isAdmin,
  isAnyLegalManager,
} from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'
import { requireDebtorInScope } from '@/lib/section-guard'
import { filterBySection } from '@/lib/case-scope'

const MAX_IDS = 200

function canManageDuplicates(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role)
}

function parseDebtorIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(
    raw
      .map(v => String(v ?? '').trim())
      .filter(Boolean),
  )]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

/**
 * نقل مدينين لكارد «الأسماء المكررة».
 * صلاحيات: مدير / مسؤول قانونية / من يملك تكليف المهام.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const role = auth.profile?.role
  if (!canManageDuplicates(role)) {
    return apiForbiddenResponse()
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const debtorIds = parseDebtorIds(body)
  if (!debtorIds) {
    return NextResponse.json({ error: 'معرّفات المدينين مطلوبة' }, { status: 400 })
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const section = filterBySection(scope)
  const actorId = auth.user?.id ?? null
  const now = new Date().toISOString()

  const updated: string[] = []
  const skipped: string[] = []

  for (const debtorId of debtorIds) {
    const gate = await requireDebtorInScope(
      admin,
      scope,
      debtorId,
      'id, full_name, case_type, duplicate_flagged_at',
    )
    if (!gate.ok) {
      skipped.push(debtorId)
      continue
    }
    if (section && gate.caseType !== section) {
      skipped.push(debtorId)
      continue
    }

    const debtor = gate.data as { id: string; full_name: string | null; duplicate_flagged_at?: string | null }
    if (debtor.duplicate_flagged_at) {
      skipped.push(debtorId)
      continue
    }

    const { error: updErr } = await admin
      .from('debtors')
      .update({
        duplicate_flagged_at: now,
        duplicate_flagged_by: actorId,
      })
      .eq('id', debtorId)

    if (updErr) {
      if (updErr.message?.includes('duplicate_flagged')) {
        return NextResponse.json({
          error: 'عمود الأسماء المكررة غير مفعّل بعد — شغّل supabase/scripts/apply-debtor-duplicate-flag.sql',
        }, { status: 500 })
      }
      console.error('[debtors/mark-duplicate]', updErr.message)
      skipped.push(debtorId)
      continue
    }

    updated.push(debtorId)
    await logActivity({
      action: 'marked_duplicate',
      entity_type: 'debtor',
      entity_id: debtor.id,
      description: `نقل للأسماء المكررة: ${debtor.full_name ?? ''}`,
      case_type: gate.caseType,
    }, auth.supabase)
  }

  return NextResponse.json({
    ok: true,
    updatedCount: updated.length,
    updatedIds: updated,
    skippedIds: skipped,
  })
}
