import { createClient } from '@/lib/supabase/server'
import { apiForbiddenResponse, canDelete, canReadAdminData, isViewer, STAFF_ROLES, writeForbiddenIfViewer } from '@/lib/permissions'
import type { UserRole } from '@/lib/types'
import type { AccountantType } from '@/lib/accountant-type'
import { fetchStaffProfile } from '@/lib/staff-profile'
import { normalizeAccountantType } from '@/lib/accountant-type'

export type SessionProfile = {
  id: string
  role: UserRole
  branch_id: string | null
  full_name: string | null
  accountant_type: AccountantType
  is_active: boolean
}

export async function getSessionProfile(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: { id: string } | null
  profile: SessionProfile | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, profile: null }

  const row = await fetchStaffProfile(supabase, user.id)
  if (!row?.role) return { supabase, user: { id: user.id }, profile: null }

  if (row.is_active === false) {
    await supabase.auth.signOut()
    return { supabase, user: { id: user.id }, profile: null }
  }

  return {
    supabase,
    user: { id: user.id },
    profile: {
      id: user.id,
      role: row.role as UserRole,
      branch_id: row.branch_id ?? null,
      full_name: row.full_name ?? null,
      accountant_type: normalizeAccountantType(row.accountant_type),
      is_active: true,
    },
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
