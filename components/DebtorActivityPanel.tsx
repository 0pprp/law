import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ACTIVITY_ACTION_BADGE,
  activityActionLabel,
  activityLogDescription,
  fmtActivityDateTime,
} from '@/lib/activity-labels'

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
      {rows.length === 0 ? (
        <div className="py-10 text-center text-[#767676] text-sm">لا يوجد نشاط مسجّل</div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.08)]">
          {rows.map((log: any) => (
            <div key={log.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant={ACTIVITY_ACTION_BADGE[log.action] ?? 'default'}>
                    {activityActionLabel(log.action)}
                  </Badge>
                  {log.user?.full_name && (
                    <span className="text-xs text-[#767676]">{log.user.full_name}</span>
                  )}
                </div>
                <p className="text-sm text-[#231F20]">{activityLogDescription(log)}</p>
              </div>
              <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">
                {fmtActivityDateTime(log.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
