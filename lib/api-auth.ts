import { createClient } from '@/lib/supabase/server'
import { apiForbiddenResponse, canDelete, canReadAdminData, isViewer, STAFF_ROLES, writeForbiddenIfViewer } from '@/lib/permissions'
import type { UserRole } from '@/lib/types'

export type SessionProfile = {
  id: string
  role: UserRole
  branch_id: string | null
  full_name: string | null
}

export async function getSessionProfile(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: { id: string } | null
  profile: SessionProfile | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, profile: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, branch_id, full_name')
    .eq('id', user.id)
    .single()

  return {
    supabase,
    user: { id: user.id },
    profile: profile as SessionProfile | null,
  }
}

export async function requireStaffProfile() {
  const ctx = await getSessionProfile()
  if (!ctx.user) return { ...ctx, error: Response.json({ error: 'غير مصرح' }, { status: 401 }) }
  if (!ctx.profile || !STAFF_ROLES.includes(ctx.profile.role)) {
    return { ...ctx, error: apiForbiddenResponse() }
  }
  return { ...ctx, error: null as Response | null }
}

export async function requireMutationStaff() {
  const ctx = await requireStaffProfile()
  if (ctx.error) return ctx
  const denied = writeForbiddenIfViewer(ctx.profile?.role)
  if (denied) return { ...ctx, error: denied }
  return ctx
}

export async function requireReadAdminProfile() {
  const ctx = await getSessionProfile()
  if (!ctx.user) return { ...ctx, error: Response.json({ error: 'غير مصرح' }, { status: 401 }) }
  if (!ctx.profile || !canReadAdminData(ctx.profile.role)) {
    return { ...ctx, error: apiForbiddenResponse() }
  }
  return { ...ctx, error: null as Response | null }
}

export async function requireAdminProfile() {
  const ctx = await getSessionProfile()
  if (!ctx.user) return { ...ctx, error: Response.json({ error: 'غير مصرح' }, { status: 401 }) }
  if (ctx.profile?.role !== 'admin') {
    return { ...ctx, error: apiForbiddenResponse() }
  }
  return { ...ctx, error: null as Response | null }
}

export async function requireCanDeleteProfile() {
  const ctx = await requireStaffProfile()
  if (ctx.error) return ctx
  if (!canDelete(ctx.profile?.role)) {
    return { ...ctx, error: apiForbiddenResponse() }
  }
  return ctx
}
