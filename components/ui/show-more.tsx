'use client'

import { useMemo, useState } from 'react'

export const LOG_PREVIEW_LIMIT = 3
export const DEBTOR_LIST_PREVIEW_LIMIT = 10

export function useShowMore<T>(items: T[], limit: number) {
  const [expanded, setExpanded] = useState(false)
  const hasMore = items.length > limit
  const visibleItems = useMemo(
    () => (expanded || !hasMore ? items : items.slice(0, limit)),
    [items, expanded, hasMore, limit],
  )

  return {
    visibleItems,
    expanded,
    toggle: () => setExpanded(v => !v),
    hasMore,
    total: items.length,
  }
}

export function ShowMoreFooter({
  hasMore,
  expanded,
  onToggle,
  total,
}: {
  hasMore: boolean
  expanded: boolean
  onToggle: () => void
  total: number
}) {
  if (!hasMore) return null

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full py-3 text-sm font-bold text-[#2C8780] hover:bg-[#2C8780]/5 transition-colors border-t border-slate-100"
    >
      {expanded ? 'إظهار أقل' : `إظهار الكل (${total})`}
    </button>
  )
}
