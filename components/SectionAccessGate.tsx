'use client'

import { resolveCaseScope, type CaseSection } from '@/lib/case-scope'
import { useAdminRole } from '@/context/admin-role'
import PermissionDenied from '@/components/PermissionDenied'

/**
 * حراسة صفحة لم تُكتمل بعد لقسم معيّن — تمنع تسريب البيانات بدل عرض خاطئ.
 * استخدمها حول صفحات الجزائي غير الجاهزة، أو أخفِ الرابط من Nav.
 */
export function SectionUnsupportedNotice({
  title = 'هذا القسم غير مدعوم مؤقتًا',
  message = 'الميزة قيد التهيئة لقسمك الحالي. لن تُعرض بيانات من القسم الآخر.',
}: {
  title?: string
  message?: string
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center" dir="rtl">
      <p className="text-base font-bold text-[#231F20]">{title}</p>
      <p className="text-sm text-[#767676] mt-2 max-w-md mx-auto">{message}</p>
    </div>
  )
}

/** إن كان دور المستخدم لا يطابق القسم المطلوب للصفحة */
export function SectionAccessGate({
  required,
  children,
  unsupported,
}: {
  required: CaseSection
  children: React.ReactNode
  /** إن true اعرض رسالة بدل 403 عندما القسم غير مدعوم بعد */
  unsupported?: boolean
}) {
  const role = useAdminRole()
  const scope = resolveCaseScope(role)

  if (required === 'both') return <>{children}</>

  if (scope.section === 'both' || scope.section === required) {
    return <>{children}</>
  }

  if (unsupported) {
    return <SectionUnsupportedNotice />
  }

  return <PermissionDenied message="لا صلاحية على هذا القسم (مدني/جزائي)." />
}
