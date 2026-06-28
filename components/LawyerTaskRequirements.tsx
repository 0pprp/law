import { Card } from '@/components/ui/card'
import { fmtMoney } from '@/lib/utils'
import type { TaskRequiredFieldDisplay } from '@/lib/task-display-label'

interface Props {
  taskLabel: string
  requiredFields: TaskRequiredFieldDisplay[]
  feeAmount?: number | null
}

export default function LawyerTaskRequirements({ taskLabel, requiredFields, feeAmount }: Props) {
  const required = requiredFields.filter(f => f.isRequired)
  const optional = requiredFields.filter(f => !f.isRequired)

  return (
    <Card>
      <div className="px-4 py-3 bg-[#2C8780]/10 border-b border-[#2C8780]/15">
        <p className="text-[10px] font-bold text-[#2C8780] uppercase tracking-wide mb-0.5">اسم المهمة</p>
        <h2 className="font-black text-[#1D6365] text-base leading-snug">{taskLabel}</h2>
        {Number(feeAmount) > 0 && (
          <p className="text-xs text-[#2C8780] font-semibold mt-1" dir="ltr">
            أتعاب المهمة: {fmtMoney(feeAmount!)}
          </p>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {required.length > 0 ? (
          <div>
            <p className="text-xs font-bold text-slate-700 mb-2">المطلوبات الإلزامية</p>
            <ul className="space-y-1.5">
              {required.map((field, i) => (
                <li key={`req-${i}`} className="flex items-start gap-2 text-sm text-slate-800">
                  <span className="text-[#2C8780] font-bold shrink-0 mt-0.5">•</span>
                  <span>{field.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-500">لا توجد حقول إلزامية محددة لهذه المهمة.</p>
        )}

        {optional.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">حقول اختيارية</p>
            <ul className="space-y-1">
              {optional.map((field, i) => (
                <li key={`opt-${i}`} className="flex items-start gap-2 text-xs text-slate-500">
                  <span className="shrink-0">○</span>
                  <span>{field.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
