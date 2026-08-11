import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { fetchStaffProfile, type StaffProfileRow } from '@/lib/staff-profile'

/** يُخزَّن لكل طلب RSC — يمنع تكرار getUser/profile داخل نفس الرحلة */
export const getRequestUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const getRequestStaffProfile = cache(async (userId: string): Promise<StaffProfileRow | null> => {
  const supabase = await createClient()
  return fetchStaffProfile(supabase, userId)
})

export const getRequestBranchName = cache(async (branchId: string): Promise<string | null> => {
  const supabase = await createClient()
  const { data } = await supabase.from('branches').select('name').eq('id', branchId).maybeSingle()
  return data?.name ?? null
})

export const getRequestBranchList = cache(async (
  listId: string,
  branchId: string,
): Promise<{ id: string; name: string } | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('branch_lists')
    .select('id, name')
    .eq('id', listId)
    .eq('branch_id', branchId)
    .maybeSingle()
  return data ?? null
})
