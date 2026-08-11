import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse } from '@/lib/permissions'
import { requireDebtorInScope } from '@/lib/section-guard'
import { logActivity } from '@/lib/activity-log'
import {
  isHearingPostponeAllowed,
  postponeHearingDate,
  type HearingPostponementRow,
} from '@/lib/hearing-postpone'

type RouteContext = { params: Promise<{ id: string }> }

/** قائمة تأجيلات تاريخ المرافعة */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const { id: debtorId } = await params
  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)

  const gate = await requireDebtorInScope(admin, scope, debtorId, 'id')
  if (!gate.ok) return gate.error

  const { data, error } = await admin
    .from('hearing_postponements')
    .select('id, debtor_id, old_date, new_date, reason, created_by, created_at')
    .eq('debtor_id', debtorId)
    .order('created_at', { ascending: false })

  let rows: HearingPostponementRow[] = []

  if (!error) {
    rows = (data ?? []) as HearingPostponementRow[]
  } else {
    // احتياطي من سجل النشاط إن لم يُنشأ الجدول بعد
    const { data: logs } = await admin
      .from('activity_logs')
      .select('id, entity_id, new_data, created_at, user_id')
      .eq('entity_type', 'debtor')
      .eq('entity_id', debtorId)
      .eq('action', 'hearing_postponed')
      .order('created_at', { ascending: false })
      .limit(50)

    rows = (logs ?? []).map((log: {
      id: string
      entity_id: string
      new_data: Record<string, unknown> | null
      created_at: string
      user_id: string | null
    }) => ({
      id: log.id,
      debtor_id: log.entity_id,
      old_date: String(log.new_data?.old_date ?? '').slice(0, 10),
      new_date: String(log.new_data?.new_date ?? '').slice(0, 10),
      reason: String(log.new_data?.reason ?? ''),
      created_by: log.user_id,
      created_at: log.created_at,
    })).filter(r => r.old_date && r.new_date)
  }

  const creatorIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))] as string[]
  const nameById = new Map<string, string>()
  if (creatorIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', creatorIds)
    for (const p of profiles ?? []) {
      nameById.set(p.id, p.full_name ?? '')
    }
  }

  return NextResponse.json({
    rows: rows.map(r => ({
      ...r,
      old_date: String(r.old_date).slice(0, 10),
      new_date: String(r.new_date).slice(0, 10),
      created_by_name: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
    })),
  })
}

/** تأجيل تاريخ المرافعة */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  if (!isHearingPostponeAllowed(auth.profile?.role)) {
    return apiForbiddenResponse()
  }

  const { id: debtorId } = await params
  let body: { newDate?: unknown; reason?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    debtorId,
    'id, full_name, case_type, first_hearing_date',
  )
  if (!gate.ok) return gate.error

  const result = await postponeHearingDate({
    admin,
    debtorId,
    newDate: String(body.newDate ?? ''),
    reason: String(body.reason ?? ''),
    actorId: auth.user?.id ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  const debtor = gate.data as { full_name?: string | null; case_type?: string | null }
  await logActivity({
    action: 'hearing_postponed',
    entity_type: 'debtor',
    entity_id: debtorId,
    description: `تأجّلت مرافعة ${debtor.full_name ?? ''} من ${result.oldDate} إلى ${result.newDate}`,
    metadata: {
      old_date: result.oldDate,
      new_date: result.newDate,
      reason: String(body.reason ?? '').trim(),
    },
    case_type: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
  }, admin)

  return NextResponse.json({
    ok: true,
    oldDate: result.oldDate,
    newDate: result.newDate,
  })
}
