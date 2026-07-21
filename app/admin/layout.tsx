import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import AdminShell from '@/components/AdminShell'
import { BRANCH_COOKIE, BRANCH_COOKIE_ALL, BRANCH_LIST_COOKIE } from '@/lib/branch-context'
import { isMainBranchName } from '@/lib/branch-constants'
import { canReadAllBranches, canUseViewAllBranchesFilter, isGeneralAccountant, isPaymentFollowUp } from '@/lib/permissions'
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
  const allowViewAll = canUseViewAllBranchesFilter(role, profile?.accountant_type)
  // مسؤول متابعة التسديد يرى كل المحافظات افتراضياً (مثل المحاسب العام)
  const defaultToAll = isGeneralAccountant(role, profile?.accountant_type) || isPaymentFollowUp(role)

  let initialBranchId: string | null = null
  let initialBranchName: string | null = null
  let initialViewAll = false
  let initialListId: string | null = null
  let initialListName: string | null = null

  if (canPickBranch) {
    const cookieStore = await cookies()
    const raw = cookieStore.get(BRANCH_COOKIE)?.value ?? null
    if (raw === BRANCH_COOKIE_ALL) {
      if (allowViewAll) {
        initialBranchId = null
        initialBranchName = null
        initialViewAll = true
      }
    } else if (defaultToAll && !raw) {
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
        initialViewAll = allowViewAll && defaultToAll
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

  // فلتر القائمة — فقط مع فرع محدد، وتُتجاهل إن لم تعد تابعة للفرع
  {
    const cookieStore = await cookies()
    const listRaw = cookieStore.get(BRANCH_LIST_COOKIE)?.value?.trim() || null
    if (listRaw) {
      if (initialBranchId && !initialViewAll) {
        const { data: list } = await supabase
          .from('branch_lists')
          .select('id, name')
          .eq('id', listRaw)
          .eq('branch_id', initialBranchId)
          .maybeSingle()
        if (list) {
          initialListId = list.id
          initialListName = list.name
        } else {
          // كوكي قائمة من فرع آخر أو قائمة محذوفة — امسحها فوراً
          cookieStore.set(BRANCH_LIST_COOKIE, '', {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 0,
          })
        }
      } else {
        // بدون فرع محدد (كل الفروع) لا معنى لفلتر القائمة
        cookieStore.set(BRANCH_LIST_COOKIE, '', {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 0,
        })
      }
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
      initialListId={initialListId}
      initialListName={initialListName}
    >
      {children}
    </AdminShell>
  )
}
