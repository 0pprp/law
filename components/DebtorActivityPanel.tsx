import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader } from '@/components/ui/card'
import DebtorActivityList from '@/components/DebtorActivityList'

interface Props {
  debtorId: string
  taskIds: string[]
}

export default async function DebtorActivityPanel({ debtorId, taskIds }: Props) {
  const supabase = await createClient()

  const orParts = [`and(entity_type.eq.debtor,entity_id.eq.${debtorId})`]
  if (taskIds.length > 0) {
    orParts.push(`and(entity_type.eq.task,entity_id.in.(${taskIds.join(',')}))`)
  }

  const { data: logs } = await supabase
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
