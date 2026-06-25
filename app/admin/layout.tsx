import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import AdminShell from '@/components/AdminShell'
import { BRANCH_COOKIE } from '@/lib/branch-context'
import { isMainBranchName } from '@/lib/branch-constants'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, branch_id')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'lawyer') redirect('/lawyer')

  const isAdmin = profile?.role === 'admin'

  // For admin: read selected branch from cookie; for others: use their assigned branch
  let initialBranchId: string | null = null
  let initialBranchName: string | null = null

  if (isAdmin) {
    const cookieStore = await cookies()
    initialBranchId = cookieStore.get(BRANCH_COOKIE)?.value ?? null
    if (initialBranchId) {
      const { data: branch } = await supabase
        .from('branches')
        .select('name')
        .eq('id', initialBranchId)
        .single()
      initialBranchName = branch?.name ?? null
      if (isMainBranchName(initialBranchName)) {
        initialBranchId = null
        initialBranchName = null
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
      userRole={profile?.role ?? 'employee'}
      userBranchId={profile?.branch_id ?? undefined}
      initialBranchId={initialBranchId}
      initialBranchName={initialBranchName}
    >
      {children}
    </AdminShell>
  )
}
