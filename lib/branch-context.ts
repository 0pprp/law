import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const BRANCH_COOKIE = 'qalat_branch'

export interface BranchContext {
  branchId: string | null
  isAdmin: boolean
}

export async function getBranchContext(): Promise<BranchContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { branchId: null, isAdmin: false }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, branch_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  if (isAdmin) {
    const cookieStore = await cookies()
    const branchId = cookieStore.get(BRANCH_COOKIE)?.value ?? null
    return { branchId, isAdmin }
  }

  return { branchId: profile?.branch_id ?? null, isAdmin: false }
}

export async function getActiveBranchId(): Promise<string | null> {
  const ctx = await getBranchContext()
  return ctx.branchId
}
