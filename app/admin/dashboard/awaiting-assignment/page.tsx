'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isLegalManager } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import AwaitingAssignmentCard from '@/components/AwaitingAssignmentCard'
import DuplicateNamesCard from '@/components/DuplicateNamesCard'
import { cacheInvalidatePrefix } from '@/lib/query-cache'

/**
 * كاردان منفصلان بالكامل تحت بعض (عرض كامل للجدول والتحديد المتعدد).
 * مزامنة انتقائية: النقل يحدّث المكررة فقط؛ التراجع يحدّث تحت إسناد فقط.
 * فلتر ct من اللوحة (civil/criminal) يُمرَّر للكاردين.
 */
export default function DashboardAwaitingAssignmentPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const searchParams = useSearchParams()
  const ctParam = searchParams.get('ct')
  const caseType = ctParam === 'civil' || ctParam === 'criminal' ? ctParam : undefined
  const [awaitingKey, setAwaitingKey] = useState(0)
  const [duplicatesKey, setDuplicatesKey] = useState(0)

  function refreshDashboardCache() {
    cacheInvalidatePrefix('dashboard:v8:')
  }

  /** بعد النقل من تحت إسناد → حدّث كارد المكررة فقط (بدون إعادة تركيب الأول ومسح التحديد أثناء العمل) */
  function onMovedToDuplicates() {
    refreshDashboardCache()
    setDuplicatesKey(k => k + 1)
  }

  /** بعد تراجع/إسناد من المكررة → حدّث كارد تحت إسناد */
  function onDuplicatesChanged() {
    refreshDashboardCache()
    setAwaitingKey(k => k + 1)
    setDuplicatesKey(k => k + 1)
  }

  if (!isAdmin(role) && !isLegalManager(role) && !canAssignTasks(role)) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
        ليست لديك صلاحية لعرض هذه الصفحة.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="إسناد المهام"
        subtitle="كاردان منفصلان — حدّد عدة أسماء ثم انقلها للمكررة"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      {!branchId && !viewAllBranches ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو اختر «الكل».
        </div>
      ) : (
        <div className="space-y-5">
          <section
            aria-labelledby="awaiting-card-title"
            className="rounded-2xl border border-[rgba(118,118,118,0.2)] bg-white shadow-sm ring-1 ring-black/[0.03]"
          >
            <div className="px-4 sm:px-5 py-3 border-b border-amber-100 bg-amber-50/80">
              <h2 id="awaiting-card-title" className="font-black text-[#231F20] text-base sm:text-lg">
                الأسماء التي تحت إسناد مهمة
              </h2>
              <p className="text-xs text-[#767676] mt-0.5">
                ضع علامة ✓ على أكثر من اسم ثم اضغط «نقل للأسماء المكررة»
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <AwaitingAssignmentCard
                key={`awaiting-${awaitingKey}-${caseType ?? 'all'}`}
                branchId={branchId}
                viewAllBranches={viewAllBranches}
                listId={listId}
                caseType={caseType}
                hideHeader
                onAssigned={onMovedToDuplicates}
              />
            </div>
          </section>

          <section
            id="duplicates"
            aria-labelledby="duplicates-card-title"
            className="rounded-2xl border border-violet-300 bg-white shadow-sm ring-1 ring-violet-500/10 scroll-mt-24"
          >
            <div className="px-4 sm:px-5 py-3 border-b border-violet-100 bg-violet-50/80">
              <h2 id="duplicates-card-title" className="font-black text-[#231F20] text-base sm:text-lg">
                الأسماء المكررة
              </h2>
              <p className="text-xs text-[#767676] mt-0.5">محوّلون من تحت إسناد مهمة — زر تراجع يعيدهم</p>
            </div>
            <div className="p-4 sm:p-5">
              <DuplicateNamesCard
                key={`duplicates-${duplicatesKey}-${caseType ?? 'all'}`}
                branchId={branchId}
                viewAllBranches={viewAllBranches}
                listId={listId}
                caseType={caseType}
                hideHeader
                onAssigned={onDuplicatesChanged}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
