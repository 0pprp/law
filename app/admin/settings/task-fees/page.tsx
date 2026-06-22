import { TASK_FEE_MAP } from '@/lib/constants'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'

export default function TaskFeesPage() {
  const entries = Object.entries(TASK_FEE_MAP) as [TaskType, number][]
  const total = entries.reduce((s, [, fee]) => s + fee, 0)

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="أسعار المهام"
        subtitle="الأتعاب الافتراضية المضافة تلقائياً عند إنجاز كل مهمة"
      />

      <div className="bg-[#2C8780]/8 border border-[#2C8780]/20 rounded-2xl p-4 text-sm text-[#231F20] leading-relaxed">
        هذه الأسعار تُطبَّق تلقائياً عند وضع المحامي حالة المهمة كـ <strong>تم الإنجاز</strong> لأول مرة.
        سيتم تفعيل تعديل الأسعار من لوحة التحكم لاحقاً.
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
            <tr>
              <th className="text-right px-5 py-3 font-semibold text-[#767676] text-xs">نوع المهمة</th>
              <th className="text-left px-5 py-3 font-semibold text-[#767676] text-xs">الأتعاب الافتراضية</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(118,118,118,0.08)]">
            {entries.map(([type, fee]) => (
              <tr key={type} className="hover:bg-[#F3F1F2]/60 transition-colors">
                <td className="px-5 py-3 text-[#231F20] font-medium">{TASK_TYPE_LABELS[type]}</td>
                <td className="px-5 py-3 text-[#2C8780] font-bold tabular-nums text-left" dir="ltr">
                  {fee.toLocaleString('en-US')} د.ع
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#2C8780]/8 border-t-2 border-[#2C8780]/20">
              <td className="px-5 py-3.5 font-bold text-[#231F20]">الإجمالي</td>
              <td className="px-5 py-3.5 font-black text-[#2C8780] tabular-nums text-left" dir="ltr">
                {total.toLocaleString('en-US')} د.ع
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}