import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardHeader } from '@/components/ui/card'
import DebtorActivityList from '@/components/DebtorActivityList'
import { fetchStaffProfile } from '@/lib/staff-profile'
import { canStaffOrChiefReadDebtor } from '@/lib/chief-accountant-access'

interface Props {
  debtorId: string
  taskIds: string[]
}

export default async function DebtorActivityPanel({ debtorId, taskIds }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = user ? await fetchStaffProfile(supabase, user.id) : null
  const admin = createAdminClient()

  const { data: accessDebtor } = await admin
    .from('debtors')
    .select('id, branch_id, assigned_chief_accountant_id')
    .eq('id', debtorId)
    .maybeSingle()

  const canRead = accessDebtor
    && canStaffOrChiefReadDebtor(
      profile ? { ...profile, id: user!.id } : null,
      accessDebtor,
    )
  const db = canRead ? admin : supabase

  const orParts = [`and(entity_type.eq.debtor,entity_id.eq.${debtorId})`]
  if (taskIds.length > 0) {
    orParts.push(`and(entity_type.eq.task,entity_id.in.(${taskIds.join(',')}))`)
  }

  const { data: logs } = await db
    .from('activity_logs')
    .select('id, action, entity_type, entity_id, new_data, created_at, user:profiles!activity_logs_user_id_fkey(full_name, role)')
    .or(orParts.join(','))
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = logs ?? []

  return (
    <Card>
      <CardHeader title={`سجل النشاط (${rows.length})`} />
      <DebtorActivityList rows={rows as any} />
    </Card>
  )
}
