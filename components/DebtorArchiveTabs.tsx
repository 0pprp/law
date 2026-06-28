'use client'

import { useState, type ReactNode } from 'react'

const TABS = [
  { id: 'overview', label: 'نظرة عامة' },
  { id: 'tasks', label: 'المهام' },
  { id: 'attachments', label: 'المرفقات' },
  { id: 'expenses', label: 'الصرفيات' },
  { id: 'payments', label: 'التسديدات' },
  { id: 'gps', label: 'GPS' },
  { id: 'activity', label: 'سجل النشاط' },
] as const

type TabId = (typeof TABS)[number]['id']

interface Props {
  overview: ReactNode
  tasks: ReactNode
  attachments: ReactNode
  expenses: ReactNode
  payments: ReactNode
  gps: ReactNode
  activity: ReactNode
}

export default function DebtorArchiveTabs({
  overview,
  tasks,
  attachments,
  expenses,
  payments,
  gps,
  activity,
}: Props) {
  const [tab, setTab] = useState<TabId>('overview')

  const panels: Record<TabId, ReactNode> = {
    overview,
    tasks,
    attachments,
    expenses,
    payments,
    gps,
    activity,
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              tab === t.id
                ? 'bg-[#2C8780] text-white shadow-sm'
                : 'bg-white text-[#767676] border border-[rgba(118,118,118,0.15)] hover:border-[#2C8780]/30 hover:text-[#2C8780]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{panels[tab]}</div>
    </div>
  )
}
