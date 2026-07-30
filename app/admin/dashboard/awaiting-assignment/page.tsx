'use client'

import { useSearchParams } from 'next/navigation'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isLegalManager } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import AwaitingAssignmentCard from '@/components/AwaitingAssignmentCard'
import { cacheInvalidatePrefix } from '@/lib/query-cache'

/** الأسماء التي تحت إسناد مهمة — بدون كارد الأسماء المكررة */
export default function DashboardAwaitingAssignmentPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const searchParams = useSearchParams()
  const ctParam = searchParams.get('ct')
  const caseType = ctParam === 'civil' || ctParam === 'criminal' ? ctParam : undefined

  function refreshDashboardCache() {
    cacheInvalidatePrefix('dashboard:v10:')
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
        subtitle="الأسماء التي تحت إسناد مهمة"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      {!branchId && !viewAllBranches ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو اختر «الكل».
        </div>
      ) : (
        <section
          aria-labelledby="awaiting-card-title"
          className="rounded-2xl border border-[rgba(118,118,118,0.2)] bg-white shadow-sm ring-1 ring-black/[0.03]"
        >
          <div className="px-4 sm:px-5 py-3 border-b border-amber-100 bg-amber-50/80">
            <h2 id="awaiting-card-title" className="font-black text-[#231F20] text-base sm:text-lg">
              الأسماء التي تحت إسناد مهمة
            </h2>
            <p className="text-xs text-[#767676] mt-0.5">
              حدّد الأسماء ثم حوّلها إلى تبويب الأسماء التي تحتاج مراقبة عند الحاجة
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <AwaitingAssignmentCard
              branchId={branchId}
              viewAllBranches={viewAllBranches}
              listId={listId}
              caseType={caseType}
              hideHeader
              onAssigned={refreshDashboardCache}
            />
          </div>
        </section>
      )}
    </div>
  )
}
