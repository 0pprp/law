'use client'

import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isLegalManager } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import AwaitingAssignmentCard from '@/components/AwaitingAssignmentCard'
import { cacheInvalidatePrefix } from '@/lib/query-cache'

/** لوحة التحكم ← الأسماء التي تحت إسناد مهمة */
export default function DashboardAwaitingAssignmentPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()

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
        title="الأسماء التي تحت إسناد مهمة"
        subtitle="مدينون بلا مهمة مطلوبة — الأقدم أولاً"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      {!branchId && !viewAllBranches ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو اختر «الكل».
        </div>
      ) : (
        <AwaitingAssignmentCard
          branchId={branchId}
          viewAllBranches={viewAllBranches}
          hideHeader
          onAssigned={() => cacheInvalidatePrefix('dashboard:v2:')}
        />
      )}
    </div>
  )
}
