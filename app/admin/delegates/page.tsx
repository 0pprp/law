import { createClient } from '@/lib/supabase/server'
import { getBranchContext } from '@/lib/branch-context'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { canManageDelegates, canDeleteUsers } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'
import { fetchDelegateWallet } from '@/lib/delegate-wallet'
import DelegatesTable, { type DelegatesTableRow } from './delegates-table'

export default async function DelegatesPage() {
  const supabase = await createClient()
  const { branchId, viewAllBranches } = await getBranchContext()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const myProfile = await fetchStaffRoleFields(supabase, user.id)
  if (!canManageDelegates(myProfile?.role)) redirect('/admin/dashboard')

  const canDelete = canDeleteUsers(myProfile?.role)

  const showBranchCol = viewAllBranches || !branchId

  let q = supabase
    .from('profiles')
    .select('id, full_name, username, phone, is_active, created_at, branch_id')
    .eq('role', 'delegate')
    .order('created_at', { ascending: false })

  if (branchId) q = q.eq('branch_id', branchId)

  const [{ data: delegates }, { data: branchRows }] = await Promise.all([
    branchId || viewAllBranches ? q : Promise.resolve({ data: [] as any[] }),
    showBranchCol
      ? supabase.from('branches').select('id, name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const branchNameMap = new Map((branchRows ?? []).map(b => [b.id, b.name]))
  const wallets = await Promise.all(
    (delegates ?? []).map(async d => ({
      id: d.id,
      wallet: await fetchDelegateWallet(supabase, d.id),
    })),
  )
  const walletMap = new Map(wallets.map(w => [w.id, w.wallet]))

  const tableRows: DelegatesTableRow[] = (delegates ?? []).map(d => {
    const w = walletMap.get(d.id)
    return {
      id: d.id,
      full_name: d.full_name,
      username: d.username ?? null,
      phone: d.phone ?? null,
      is_active: Boolean(d.is_active),
      created_at: d.created_at,
      branch_name: branchNameMap.get(d.branch_id) ?? null,
      pending_balance: w?.pending_balance ?? 0,
      available_balance: w?.available_balance ?? 0,
    }
  })

  const activeCount = tableRows.filter(d => d.is_active).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="المندوبون"
        subtitle={`${tableRows.length} مندوب • ${activeCount} نشط`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/delegates/report">
              <Button variant="outline" size="sm">تقرير الأتعاب</Button>
            </Link>
            <Link href="/admin/delegates/wallets">
              <Button variant="outline" size="sm">المحافظ</Button>
            </Link>
            <Link href="/admin/delegates/new">
              <Button variant="primary" size="sm">+ مندوب جديد</Button>
            </Link>
          </div>
        }
      />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {!tableRows.length ? (
          <EmptyState
            title="لا يوجد مندوبون"
            description="أضف مندوباً لتكليفه بمهام إيجاد العنوان"
            action={
              <Link href="/admin/delegates/new">
                <Button variant="primary" size="sm">+ مندوب جديد</Button>
              </Link>
            }
          />
        ) : (
          <DelegatesTable
            rows={tableRows}
            showBranchCol={showBranchCol}
            canDelete={canDelete}
          />
        )}
      </div>
    </div>
  )
}
