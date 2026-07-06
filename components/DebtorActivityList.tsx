'use client'

import { Badge } from '@/components/ui/badge'
import {
  ACTIVITY_ACTION_BADGE,
  activityActionLabel,
  activityLogDescription,
  fmtActivityDate,
  fmtActivityTime,
} from '@/lib/activity-labels'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

export interface DebtorActivityLogRow {
  id: string
  action: string
  entity_type: string | null
  entity_id: string | null
  new_data?: { description?: string } | null
  created_at: string
  user?: { full_name?: string | null; role?: string | null } | null
}

export default function DebtorActivityList({ rows }: { rows: DebtorActivityLogRow[] }) {
  const { visibleItems, expanded, toggle, hasMore, total } = useShowMore(rows, LOG_PREVIEW_LIMIT)

  if (rows.length === 0) {
    return <div className="py-10 text-center text-[#767676] text-sm">لا يوجد نشاط مسجّل</div>
  }

  return (
    <>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {visibleItems.map(log => (
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
            <span className="text-xs text-[#767676] font-mono shrink-0 text-left" dir="ltr">
              <span className="block font-semibold text-[#231F20]">{fmtActivityDate(log.created_at)}</span>
              <span className="block">{fmtActivityTime(log.created_at)}</span>
            </span>
          </div>
        ))}
      </div>
      <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={total} />
    </>
  )
}
