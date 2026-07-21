'use client'

import { PremiumSelect } from '@/components/ui/premium-select'
import { useBranchLists } from '@/hooks/use-branch-lists'

/**
 * بوكس فرع/محافظة مع فلتر قوائم ذلك الفرع (PremiumSelect المعتمد).
 * يُعرض فقط عندما يستدعيه الأب لفرع يحتوي أسماء.
 */
export default function BranchListBox({
  branchId,
  branchName,
  count,
  listId,
  onListChange,
  children,
  loadingCount,
}: {
  branchId: string
  branchName: string
  count: number | null
  listId: string
  onListChange: (listId: string) => void
  children: React.ReactNode
  loadingCount?: boolean
}) {
  const { lists, loading: listsLoading } = useBranchLists(branchId)

  return (
    <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[rgba(118,118,118,0.1)] flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <h3 className="font-black text-[#231F20] text-base truncate">{branchName}</h3>
          <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-[#2C8780]/12 text-[#1D6365] text-sm font-black tabular-nums shrink-0">
            {loadingCount || count === null ? '—' : count}
          </span>
        </div>
        <div className="w-full sm:w-64 shrink-0">
          <PremiumSelect
            value={listId}
            onChange={onListChange}
            options={[
              { value: '', label: 'كل القوائم' },
              ...lists.map(l => ({ value: l.id, label: l.name })),
            ]}
            placeholder="كل القوائم"
            fieldLabel={`قوائم ${branchName}`}
            headerTitle={`قوائم ${branchName}`}
            searchPlaceholder="بحث بالقائمة..."
            disabled={listsLoading}
          />
        </div>
      </div>
      {children}
    </div>
  )
}
