import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminShell from '@/components/AdminShell'

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

  return (
    <AdminShell
      userName={profile?.full_name ?? ''}
      userRole={profile?.role ?? 'employee'}
      userBranchId={profile?.branch_id ?? undefined}
    >
      {children}
    </AdminShell>
  )
}
