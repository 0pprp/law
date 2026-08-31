import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile, requireStaffProfile } from '@/lib/api-auth'
import {
  canManageTaskManagement,
  canApproveCompletions,
  apiForbiddenResponse,
  isFieldWorkerRole,
} from '@/lib/permissions'

type LinkInput = {
  linked_definition_id: string
  is_optional?: boolean
  sort_order?: number
}

type LinkRow = {
  id: string
  parent_definition_id: string
  linked_definition_id: string
  is_optional: boolean
  sort_order: number
  label: string
  fee_amount: number
}

function isMissingHybridSchema(message: string | undefined | null): boolean {
  const m = String(message ?? '').toLowerCase()
  return (
    m.includes('criminal_case_task_definition_links')
    || m.includes('is_hybrid')
    || m.includes('does not exist')
    || m.includes('could not find')
    || m.includes('schema cache')
    || m.includes('pgrst205')
    || m.includes('pgrst204')
    || m.includes('42703')
    || m.includes('42p01')
  )
}

async function requireAdmin() {
  const auth = await requireStaffProfile()
  if (auth.error) return { error: auth.error }
  if (!canManageTaskManagement(auth.profile?.role)) return { error: apiForbiddenResponse() }
  return { auth }
}

/** روابط المهمة الهجينة الجزائية — قراءة للمدير أو المحامي/المندوب */
export async function GET(request: NextRequest) {
  const ctx = await getSessionProfile()
  if (!ctx.user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (!ctx.profile) return apiForbiddenResponse()

  const canRead =
    canManageTaskManagement(ctx.profile.role)
    || isFieldWorkerRole(ctx.profile.role)
    || canApproveCompletions(ctx.profile.role)
  if (!canRead) return apiForbiddenResponse()

  const parentId = request.nextUrl.searchParams.get('parent_id')?.trim()
  if (!parentId) {
    return NextResponse.json({ error: 'parent_id مطلوب' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('criminal_case_task_definition_links')
      .select(`
        id,
        parent_definition_id,
        linked_definition_id,
        is_optional,
        sort_order,
        linked:criminal_case_task_definitions!criminal_case_task_definition_links_linked_definition_id_fkey (
          label,
          fee_amount
        )
      `)
      .eq('parent_definition_id', parentId)
      .order('sort_order', { ascending: true })

    if (error) {
      if (isMissingHybridSchema(error.message)) {
        return NextResponse.json({ links: [], schemaReady: false })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const links: LinkRow[] = (data ?? []).map((row: any) => {
      const linked = Array.isArray(row.linked) ? row.linked[0] : row.linked
      return {
        id: String(row.id),
        parent_definition_id: String(row.parent_definition_id),
        linked_definition_id: String(row.linked_definition_id),
        is_optional: row.is_optional !== false,
        sort_order: Number(row.sort_order ?? 0),
        label: String(linked?.label ?? ''),
        fee_amount: Number(linked?.fee_amount ?? 0),
      }
    })

    return NextResponse.json({ links, schemaReady: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMissingHybridSchema(msg)) {
      return NextResponse.json({ links: [], schemaReady: false })
    }
    console.error('[criminal-task-definition-links GET]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}

/**
 * استبدال روابط المهمة الهجينة الجزائية:
 * يحذف القديمة ثم يدرج الجديدة، ويحدّث is_hybrid على التعريف الأساسي.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const parentId = String(body.parent_definition_id ?? '').trim()
  if (!parentId) {
    return NextResponse.json({ error: 'parent_definition_id مطلوب' }, { status: 400 })
  }

  const isHybrid = body.is_hybrid === undefined ? true : Boolean(body.is_hybrid)
  const rawLinks = Array.isArray(body.links) ? (body.links as LinkInput[]) : []

  const links = rawLinks
    .map((l, idx) => ({
      linked_definition_id: String(l.linked_definition_id ?? '').trim(),
      is_optional: l.is_optional !== false,
      sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : idx,
    }))
    .filter(l => l.linked_definition_id && l.linked_definition_id !== parentId)

  const seen = new Set<string>()
  const uniqueLinks = links.filter(l => {
    if (seen.has(l.linked_definition_id)) return false
    seen.add(l.linked_definition_id)
    return true
  })

  try {
    const admin = createAdminClient()

    const { error: hybridErr } = await admin
      .from('criminal_case_task_definitions')
      .update({ is_hybrid: isHybrid } as any)
      .eq('id', parentId)

    if (hybridErr) {
      if (isMissingHybridSchema(hybridErr.message)) {
        return NextResponse.json({
          links: [],
          schemaReady: false,
          warning: 'أعمدة/جداول المهمة الهجينة الجزائية غير مطبّقة بعد على قاعدة البيانات',
        })
      }
      return NextResponse.json({ error: hybridErr.message }, { status: 500 })
    }

    if (!isHybrid || uniqueLinks.length === 0) {
      const { error: delErr } = await admin
        .from('criminal_case_task_definition_links')
        .delete()
        .eq('parent_definition_id', parentId)

      if (delErr) {
        if (isMissingHybridSchema(delErr.message)) {
          return NextResponse.json({
            links: [],
            schemaReady: false,
            warning: 'جدول criminal_case_task_definition_links غير موجود بعد',
          })
        }
        return NextResponse.json({ error: delErr.message }, { status: 500 })
      }

      return NextResponse.json({ ok: true, links: [], schemaReady: true })
    }

    const { error: delErr } = await admin
      .from('criminal_case_task_definition_links')
      .delete()
      .eq('parent_definition_id', parentId)

    if (delErr) {
      if (isMissingHybridSchema(delErr.message)) {
        return NextResponse.json({
          links: [],
          schemaReady: false,
          warning: 'جدول criminal_case_task_definition_links غير موجود بعد',
        })
      }
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    const { error: insErr } = await admin.from('criminal_case_task_definition_links').insert(
      uniqueLinks.map((l, idx) => ({
        parent_definition_id: parentId,
        linked_definition_id: l.linked_definition_id,
        is_optional: l.is_optional,
        sort_order: idx,
      })),
    )

    if (insErr) {
      if (isMissingHybridSchema(insErr.message)) {
        return NextResponse.json({
          links: [],
          schemaReady: false,
          warning: 'جدول criminal_case_task_definition_links غير موجود بعد',
        })
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      schemaReady: true,
      links: uniqueLinks.map((l, idx) => ({ ...l, sort_order: idx })),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMissingHybridSchema(msg)) {
      return NextResponse.json({
        links: [],
        schemaReady: false,
        warning: 'أعمدة/جداول المهمة الهجينة الجزائية غير مطبّقة بعد على قاعدة البيانات',
      })
    }
    console.error('[criminal-task-definition-links POST]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
