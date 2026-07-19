'use client'

import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canReviewPaymentNoncomplianceRequest } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import PaymentNoncomplianceRequestsCard from '@/components/PaymentNoncomplianceRequestsCard'
import { cacheInvalidatePrefix } from '@/lib/query-cache'

/** لوحة التحكم ← طلبات عدم الالتزام (مدير / مسؤول القانونية) */
export default function DashboardNoncompliancePage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()

  if (!canReviewPaymentNoncomplianceRequest(role)) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
        ليست لديك صلاحية لعرض هذه الصفحة.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="طلبات عدم الالتزام"
        subtitle="طلبات معلّقة من مسؤول متابعة التسديد — الموافقة تعيد المدين إلى آخر مهمة غير مكلفة"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      {!branchId && !viewAllBranches ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو اختر «الكل».
        </div>
      ) : (
        <PaymentNoncomplianceRequestsCard
          branchId={branchId}
          viewAllBranches={viewAllBranches}
          hideHeader
          onChanged={() => cacheInvalidatePrefix('dashboard:')}
        />
      )}
    </div>
  )
}
