import { createClient } from '@/lib/supabase/server'
import { getBranchContext } from '@/lib/branch-context'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { fmtDate, fmtMoney } from '@/lib/utils'
import DelegateActions from '@/components/DelegateActions'
import { canManageDelegates, canDeleteUsers, canReadAllBranches } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'
import { fetchDelegateWallet } from '@/lib/delegate-wallet'

export default async function DelegatesPage() {
  const supabase = await createClient()
  const { branchId } = await getBranchContext()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const myProfile = await fetchStaffRoleFields(supabase, user.id)
  if (!canManageDelegates(myProfile?.role)) redirect('/admin/dashboard')

  const canDelete = canDeleteUsers(myProfile?.role)

  const showAllBranches = canReadAllBranches(myProfile?.role, myProfile?.accountant_type)

  let q = supabase
    .from('profiles')
    .select('id, full_name, username, phone, is_active, created_at, branch_id')
    .eq('role', 'delegate')
    .order('created_at', { ascending: false })

  if (branchId && !showAllBranches) q = q.eq('branch_id', branchId)
  else if (branchId) q = q.eq('branch_id', branchId)

  const [{ data: delegates }, { data: branchRows }] = await Promise.all([
    q,
    showAllBranches || !branchId
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
  const activeCount = (delegates ?? []).filter(d => d.is_active).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="المندوبون"
        subtitle={`${delegates?.length ?? 0} مندوب • ${activeCount} نشط`}
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
        {!delegates?.length ? (
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
          <div className="hidden md:block">
            <Table>
              <THead>
                <tr>
                  <TH>الاسم</TH>
                  <TH>اسم المستخدم</TH>
                  {(showAllBranches || !branchId) && <TH>الفرع</TH>}
                  <TH>الهاتف</TH>
                  <TH>معلق</TH>
                  <TH>قابل للصرف</TH>
                  <TH>الحالة</TH>
                  <TH>تاريخ الإنشاء</TH>
                  <TH className="text-center">الإجراءات</TH>
                </tr>
              </THead>
              <TBody>
                {delegates.map(d => {
                  const w = walletMap.get(d.id)
                  return (
                    <TR key={d.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
                          >
                            <span className="text-white text-xs font-bold">
                              {d.full_name?.split(' ').filter(Boolean).slice(0, 2).map((x: string) => x[0]).join('') || '؟'}
                            </span>
                          </div>
                          <span className="font-semibold text-[#231F20]">{d.full_name}</span>
                        </div>
                      </TD>
                      <TD>
                        {d.username
                          ? <span className="font-mono text-xs text-[#767676] bg-[rgba(118,118,118,0.06)] px-2 py-1 rounded-lg" dir="ltr">{d.username}</span>
                          : <Badge variant="warning">لا يوجد</Badge>}
                      </TD>
                      {(showAllBranches || !branchId) && (
                        <TD><span className="text-xs text-[#767676]">{branchNameMap.get(d.branch_id) ?? '—'}</span></TD>
                      )}
                      <TD><span className="text-xs font-mono text-[#767676]" dir="ltr">{d.phone ?? '—'}</span></TD>
                      <TD><span className="text-xs font-bold tabular-nums" dir="ltr">{fmtMoney(w?.pending_balance ?? 0)}</span></TD>
                      <TD><span className="text-xs font-bold text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(w?.available_balance ?? 0)}</span></TD>
                      <TD>
                        <Badge variant={d.is_active ? 'success' : 'danger'} dot>
                          {d.is_active ? 'نشط' : 'موقوف'}
                        </Badge>
                      </TD>
                      <TD><span className="text-xs text-[#767676]" dir="ltr">{fmtDate(d.created_at)}</span></TD>
                      <TD>
                        <DelegateActions
                          userId={d.id}
                          isActive={d.is_active}
                          fullName={d.full_name}
                          canDelete={canDelete}
                        />
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>
        )}

        {!!delegates?.length && (
          <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
            {delegates.map(d => {
              const w = walletMap.get(d.id)
              return (
                <div key={d.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-[#231F20]">{d.full_name}</p>
                    <Badge variant={d.is_active ? 'success' : 'danger'} dot>
                      {d.is_active ? 'نشط' : 'موقوف'}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#767676]" dir="ltr">{d.username ?? '—'} · {d.phone ?? '—'}</p>
                  <div className="flex gap-4 text-xs">
                    <span>معلق: <b dir="ltr">{fmtMoney(w?.pending_balance ?? 0)}</b></span>
                    <span>قابل للصرف: <b className="text-[#2C8780]" dir="ltr">{fmtMoney(w?.available_balance ?? 0)}</b></span>
                  </div>
                  <DelegateActions
                    userId={d.id}
                    isActive={d.is_active}
                    fullName={d.full_name}
                    canDelete={canDelete}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
