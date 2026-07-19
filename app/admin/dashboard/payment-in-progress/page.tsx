'use client'

import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canViewPaymentInProgressCard } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import PaymentInProgressCard from '@/components/PaymentInProgressCard'

/** لوحة التحكم ← جاري التسديد (مدير / مسؤول القانونية) */
export default function DashboardPaymentInProgressPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()

  if (!canViewPaymentInProgressCard(role)) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
        ليست لديك صلاحية لعرض هذه الصفحة.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="جاري التسديد"
        subtitle="المدينون قيد متابعة تحصيل الأقساط"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      {!branchId && !viewAllBranches ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو اختر «الكل».
        </div>
      ) : (
        <PaymentInProgressCard
          branchId={branchId}
          viewAllBranches={viewAllBranches}
          hideHeader
        />
      )}
    </div>
  )
}
