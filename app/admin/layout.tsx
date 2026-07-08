import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import AdminShell from '@/components/AdminShell'
import { BRANCH_COOKIE, BRANCH_COOKIE_ALL } from '@/lib/branch-context'
import { isMainBranchName } from '@/lib/branch-constants'
import { canReadAllBranches, isGeneralAccountant } from '@/lib/permissions'
import { fetchStaffProfile } from '@/lib/staff-profile'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await fetchStaffProfile(supabase, user.id)

  if (profile?.role === 'lawyer') redirect('/lawyer')
  if (profile?.role === 'delegate') redirect('/delegate')

  // لا نفترض employee إذا فشل التحميل — نُبقي الأدمن يعمل بعد إصلاح الاستعلام
  const role = profile?.role ?? null
  if (!role) redirect('/login')

  const canPickBranch = canReadAllBranches(role, profile?.accountant_type)
  const allowViewAll = isGeneralAccountant(role, profile?.accountant_type)

  let initialBranchId: string | null = null
  let initialBranchName: string | null = null
  let initialViewAll = false

  if (canPickBranch) {
    const cookieStore = await cookies()
    const raw = cookieStore.get(BRANCH_COOKIE)?.value ?? null
    if (raw === BRANCH_COOKIE_ALL || (allowViewAll && !raw)) {
      initialBranchId = null
      initialBranchName = null
      initialViewAll = true
    } else if (raw) {
      initialBranchId = raw
      const { data: branch } = await supabase
        .from('branches')
        .select('name')
        .eq('id', initialBranchId)
        .single()
      initialBranchName = branch?.name ?? null
      if (isMainBranchName(initialBranchName)) {
        initialBranchId = null
        initialBranchName = null
        initialViewAll = allowViewAll
      }
    }
  } else {
    initialBranchId = profile?.branch_id ?? null
    if (initialBranchId) {
      const { data: branch } = await supabase
        .from('branches')
        .select('name')
        .eq('id', initialBranchId)
        .single()
      initialBranchName = branch?.name ?? null
    }
  }

  return (
    <AdminShell
      userName={profile?.full_name ?? ''}
      userRole={role}
      accountantType={profile?.accountant_type ?? 'branch'}
      userBranchId={profile?.branch_id ?? undefined}
      initialBranchId={initialBranchId}
      initialBranchName={initialBranchName}
      initialViewAll={initialViewAll}
    >
      {children}
    </AdminShell>
  )
}
