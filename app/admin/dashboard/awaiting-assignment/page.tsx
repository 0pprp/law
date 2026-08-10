'use client'

import { useSearchParams } from 'next/navigation'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isLegalManager } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import AwaitingAssignmentCard from '@/components/AwaitingAssignmentCard'
import { cacheInvalidatePrefix } from '@/lib/query-cache'

/** الأسماء التي تحت إسناد مهمة / تجهيز الملفات */
export default function DashboardAwaitingAssignmentPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const searchParams = useSearchParams()
  const ctParam = searchParams.get('ct')
  const caseType = ctParam === 'civil' || ctParam === 'criminal' ? ctParam : undefined
  const isPrepMode = searchParams.get('prep') === '1'
  const mode = isPrepMode ? 'preparing' as const : 'awaiting' as const

  function refreshDashboardCache() {
    cacheInvalidatePrefix('dashboard:v')
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
        title={isPrepMode ? 'تجهيز الملفات' : 'إسناد المهام'}
        subtitle={isPrepMode ? 'مدينون قيد تجهيز الملف لدى المحاسب الرئيسي' : 'الأسماء التي تحت إسناد مهمة'}
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
          <div className={`px-4 sm:px-5 py-3 border-b ${isPrepMode ? 'border-sky-100 bg-sky-50/80' : 'border-amber-100 bg-amber-50/80'}`}>
            <h2 id="awaiting-card-title" className="font-black text-[#231F20] text-base sm:text-lg">
              {isPrepMode ? 'تجهيز الملفات' : 'الأسماء التي تحت إسناد مهمة'}
            </h2>
            <p className="text-xs text-[#767676] mt-0.5">
              {isPrepMode
                ? 'أسماء أُرسلت للمحاسب الرئيسي لتجهيز الملفات'
                : 'حدّد الأسماء ثم أرسلها للتجهيز أو حوّلها للمراقبة عند الحاجة'}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <AwaitingAssignmentCard
              branchId={branchId}
              viewAllBranches={viewAllBranches}
              listId={listId}
              caseType={caseType}
              mode={mode}
              hideHeader
              onAssigned={refreshDashboardCache}
            />
          </div>
        </section>
      )}
    </div>
  )
}
