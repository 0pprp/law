'use client'

import { FormField, formInputClass } from '@/components/ui/form-flow'
import { DatePicker } from '@/components/ui/date-picker'

export type CriminalDetailsFormState = {
  job_title: string
  current_address: string
  incident_date: string
  charge_type: string
  /** نص حر */
  contract_guarantor_status: string
  first_witness_name: string
  second_witness_name: string
  amount_owed: string
}

export const EMPTY_CRIMINAL_DETAILS: CriminalDetailsFormState = {
  job_title: '',
  current_address: '',
  incident_date: '',
  charge_type: '',
  contract_guarantor_status: '',
  first_witness_name: '',
  second_witness_name: '',
  amount_owed: '',
}

export function criminalDetailsPayload(form: CriminalDetailsFormState) {
  return {
    job_title: form.job_title.trim() || null,
    current_address: form.current_address.trim() || null,
    incident_date: form.incident_date.trim() || null,
    charge_type: form.charge_type.trim() || null,
    amount_owed: form.amount_owed.trim() || null,
    contract_guarantor_status: form.contract_guarantor_status.trim() || null,
    first_witness_name: form.first_witness_name.trim() || null,
    second_witness_name: form.second_witness_name.trim() || null,
  }
}

/** تحقق عميل: اسم+فرع إلزاميان؛ تاريخ صحيح إن وُجد */
export function validateCriminalClientForm(
  fullName: string,
  branchId: string | null | undefined,
  form: CriminalDetailsFormState,
): string | null {
  if (!fullName.trim()) return 'الاسم مطلوب'
  if (!branchId) return 'الفرع مطلوب'
  if (form.incident_date.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.incident_date.trim())) {
      return 'تاريخ الواقعة غير صالح'
    }
  }
  return null
}

type Props = {
  form: CriminalDetailsFormState
  onChange: (field: keyof CriminalDetailsFormState, value: string) => void
  disabled?: boolean
  showAmount?: boolean
  /** إظهار حقل المستمسكات (إنشاء فقط) */
  documentsSlot?: React.ReactNode
}

export function CriminalDebtorFields({
  form,
  onChange,
  disabled,
  showAmount = true,
  documentsSlot,
}: Props) {
  return (
    <div className="space-y-4">
      <FormField label="العنوان الوظيفي">
        <input
          className={formInputClass}
          value={form.job_title}
          disabled={disabled}
          onChange={e => onChange('job_title', e.target.value)}
          placeholder="اختياري"
        />
      </FormField>
      <FormField label="عنوان السكن الحالي">
        <input
          className={formInputClass}
          value={form.current_address}
          disabled={disabled}
          onChange={e => onChange('current_address', e.target.value)}
          placeholder="اختياري"
        />
      </FormField>
      <FormField label="تاريخ الواقعة">
        <DatePicker
          value={form.incident_date}
          onChange={v => onChange('incident_date', v)}
          disabled={disabled}
          headerTitle="تاريخ الواقعة"
          placeholder="اختياري — اختر التاريخ"
        />
      </FormField>
      <FormField label="نوع التهمة">
        <input
          className={formInputClass}
          value={form.charge_type}
          disabled={disabled}
          onChange={e => onChange('charge_type', e.target.value)}
          placeholder="اختياري"
        />
      </FormField>
      {showAmount && (
        <FormField label="المبلغ الذي بذمته">
          <input
            className={formInputClass}
            value={form.amount_owed}
            disabled={disabled}
            onChange={e => onChange('amount_owed', e.target.value)}
            placeholder="اختياري — نص حر"
          />
        </FormField>
      )}
      <FormField label="هل لديه عقد وكفيل">
        <input
          className={formInputClass}
          value={form.contract_guarantor_status}
          disabled={disabled}
          onChange={e => onChange('contract_guarantor_status', e.target.value)}
          placeholder="اختياري — نص حر"
        />
      </FormField>
      <FormField label="اسم الشاهد الأول">
        <input
          className={formInputClass}
          value={form.first_witness_name}
          disabled={disabled}
          onChange={e => onChange('first_witness_name', e.target.value)}
          placeholder="اختياري"
        />
      </FormField>
      <FormField label="اسم الشاهد الثاني">
        <input
          className={formInputClass}
          value={form.second_witness_name}
          disabled={disabled}
          onChange={e => onChange('second_witness_name', e.target.value)}
          placeholder="اختياري"
        />
      </FormField>
      {documentsSlot}
    </div>
  )
}
