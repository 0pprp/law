'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import ReceiptsPrepCard from '@/components/ReceiptsPrepCard'

function ReceiptsPrepBody() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const searchParams = useSearchParams()
  const ctParam = searchParams.get('ct')
  const caseType = ctParam === 'civil' || ctParam === 'criminal' ? ctParam : undefined

  if (!isAdmin(role) && !isAnyLegalManager(role) && !canAssignTasks(role)) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
        ليست لديك صلاحية لعرض هذه الصفحة.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="تجهيز الوصولات"
        subtitle="إقامة دعوى مكلفة — تأشير تم التجهيز يبقى على الاسم في الكروت اللاحقة"
        actions={<BackButton fallback="/admin/dashboard" />}
      />
      <section
        aria-labelledby="receipts-prep-title"
        className="rounded-2xl border border-[rgba(118,118,118,0.2)] bg-white shadow-sm ring-1 ring-black/[0.03]"
      >
        <div className="px-4 sm:px-5 py-3 border-b border-emerald-100 bg-emerald-50/80">
          <h2 id="receipts-prep-title" className="font-black text-[#231F20] text-base sm:text-lg">
            تجهيز الوصولات
          </h2>
          <p className="text-xs text-[#767676] mt-0.5">
            يظهر الاسم هنا عند تكليف إقامة دعوى، ويغادر بعد إنجاز مهمة المرافعات. التأشير يبقى في كل كارد لاحق.
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <ReceiptsPrepCard
            branchId={branchId}
            viewAllBranches={viewAllBranches}
            listId={listId}
            caseType={caseType}
          />
        </div>
      </section>
    </div>
  )
}

export default function DashboardReceiptsPrepPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[#767676]">جارٍ التحميل...</div>}>
      <ReceiptsPrepBody />
    </Suspense>
  )
}
