'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useBranchId, useBranch } from '@/context/branch'
import { isMainBranchName } from '@/lib/branch-constants'
import { LEGAL_ISSUE_DATE_LABEL, RECEIPT_NUMBER_LABEL, RECEIPT_TYPE_LABEL, RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'
import { PremiumSelect } from '@/components/ui/premium-select'
import { FormFlow, FormFlowHero, FormFlowStep, FormField, formInputClass } from '@/components/ui/form-flow'
import { cn } from '@/lib/utils'
import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input'
import { canAddDebtor } from '@/lib/permissions'
import { useAdminRole } from '@/context/admin-role'

const FORM_RECEIPT_TYPES: ReceiptType[] = ['check', 'bill_of_exchange', 'trust']

type DebtorFormField =
  | 'selectedTaskDefId'
  | 'full_name'
  | 'phone'
  | 'id_number'
  | 'address'
  | 'receipt_number'
  | 'receipt_amount'
  | 'remaining_amount'
  | 'penalty_amount'

type FieldErrors = Partial<Record<DebtorFormField, string>>

interface TaskDef { id: string; label: string; fee_amount: number }

function hasMoneyDigits(value: string): boolean {
  return value.replace(/[^\d]/g, '').length > 0
}

export default function NewDebtorPage() {
  const router = useRouter()
  const role = useAdminRole()
  const readOnly = !canAddDebtor(role)
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const today = new Date().toISOString().split('T')[0]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [taskDefs, setTaskDefs] = useState<TaskDef[]>([])
  const [selectedTaskDefId, setSelectedTaskDefId] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    address: '',
    id_number: '',
    receipt_type: 'check' as ReceiptType,
    receipt_number: '',
    receipt_amount: '',
    remaining_amount: '',
    penalty_amount: '',
    has_contract: false,
    receipt_signed_legal_costs: false,
    notes: '',
  })

  useEffect(() => {
    let q = createClient().from('task_definitions').select('id, label, fee_amount').eq('is_active', true)
    if (branchId) q = (q as any).eq('branch_id', branchId)
    q.order('sort_order').order('label').then(({ data }) => setTaskDefs(data ?? []))
  }, [branchId])

  function clearFieldError(field: DebtorFormField) {
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function setMoney(field: 'receipt_amount' | 'remaining_amount' | 'penalty_amount', raw: string) {
    setForm(prev => ({ ...prev, [field]: raw.replace(/[^\d]/g, '') }))
    clearFieldError(field)
  }

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field in fieldErrors) clearFieldError(field as DebtorFormField)
  }

  function inputClass(field?: DebtorFormField) {
    return cn(
      formInputClass,
      field && fieldErrors[field] && 'border-red-400 focus:border-red-500 focus:ring-red-200/40',
    )
  }

  function validateForm(): FieldErrors {
    const errors: FieldErrors = {}
    if (!selectedTaskDefId) errors.selectedTaskDefId = 'يرجى اختيار المهمة الأولية'
    if (!form.full_name.trim()) errors.full_name = 'يرجى إدخال الاسم الكامل'
    if (!form.phone.trim()) errors.phone = 'يرجى إدخال رقم الهاتف'
    if (!form.id_number.trim()) errors.id_number = 'يرجى إدخال رقم الهوية'
    if (!form.address.trim()) errors.address = 'يرجى إدخال العنوان التفصيلي'
    if (!form.receipt_number.trim()) errors.receipt_number = `يرجى إدخال ${RECEIPT_NUMBER_LABEL}`
    if (!hasMoneyDigits(form.receipt_amount)) errors.receipt_amount = `يرجى إدخال ${RECEIPT_AMOUNT_LABEL}`
    if (!hasMoneyDigits(form.remaining_amount)) errors.remaining_amount = 'يرجى إدخال المبلغ المتبقي'
    if (form.has_contract && !hasMoneyDigits(form.penalty_amount)) {
      errors.penalty_amount = 'يرجى إدخال الشرط الجزائي'
    }
    return errors
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file && file.type !== 'application/pdf') {
      setError('يجب أن يكون الملف بصيغة PDF فقط')
      setPdfFile(null)
      e.target.value = ''
      return
    }
    setError('')
    setPdfFile(file)
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (readOnly) return
    setSaving(true)
    setError('')

    if (!branchId || isMainBranchName(branchName)) {
      setError('يجب اختيار فرعاً رسمياً من القائمة العلوية قبل إضافة مدين')
      setSaving(false)
      return
    }

    const validationErrors = validateForm()
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setError('يرجى تعبئة جميع الحقول الإلزامية قبل الحفظ')
      setSaving(false)
      return
    }
    setFieldErrors({})

    if (pdfFile && pdfFile.type !== 'application/pdf') {
      setError('يجب أن يكون الملف بصيغة PDF فقط')
      setSaving(false)
      return
    }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const taskDef = taskDefs.find(t => t.id === selectedTaskDefId)
    const governorate = branchName ?? null

    const { data: newDebtor, error: dbError } = await supabase.from('debtors').insert({
      full_name: form.full_name,
      phone: form.phone.trim(),
      governorate,
      address: form.address.trim(),
      id_number: form.id_number.trim(),
      export_date: today,
      receipt_type: form.receipt_type,
      receipt_number: form.receipt_number.trim(),
      receipt_amount: parseMoneyInput(form.receipt_amount),
      remaining_amount: parseMoneyInput(form.remaining_amount),
      required_amount: parseMoneyInput(form.remaining_amount),
      lawyer_fees: 0,
      penalty_amount: form.has_contract ? parseMoneyInput(form.penalty_amount) : 0,
      receipt_signed_legal_costs: form.receipt_signed_legal_costs,
      notes: form.notes.trim() || null,
      created_by: user.id,
      branch_id: branchId,
    }).select('id').single()

    if (dbError || !newDebtor) {
      setError(dbError?.message ?? 'فشل إنشاء المدين')
      setSaving(false)
      return
    }

    const { data: newTask, error: taskErr } = await supabase.from('tasks').insert({
      debtor_id: newDebtor.id,
      task_definition_id: selectedTaskDefId,
      task_status: 'waiting_assignment',
      reward_amount: taskDef?.fee_amount ?? 0,
      created_by: user.id,
      branch_id: branchId,
    }).select('id').single()

    if (taskErr) {
      await supabase.from('debtors').delete().eq('id', newDebtor.id)
      setError(`فشل إنشاء المهمة الأولية: ${taskErr.message}`)
      setSaving(false)
      return
    }

    const { error: linkErr } = await supabase.from('debtors').update({ current_task_id: newTask.id }).eq('id', newDebtor.id)
    if (linkErr) {
      await supabase.from('tasks').delete().eq('id', newTask.id)
      await supabase.from('debtors').delete().eq('id', newDebtor.id)
      setError(`فشل ربط المهمة بالمدين: ${linkErr.message}`)
      setSaving(false)
      return
    }

    const safeFileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
    const filePath = `${newDebtor.id}/${safeFileName}`

    if (pdfFile) {
      const { error: uploadError } = await supabase.storage
        .from('debtor-files')
        .upload(filePath, pdfFile, { contentType: 'application/pdf' })

      if (uploadError) {
        await supabase.from('tasks').delete().eq('id', newTask.id)
        await supabase.from('debtors').delete().eq('id', newDebtor.id)
        setError(`فشل رفع ملف PDF: ${uploadError.message}`)
        setSaving(false)
        return
      }

      const { error: attachErr } = await supabase.from('debtor_attachments').insert({
        debtor_id: newDebtor.id,
        file_name: pdfFile.name,
        file_path: filePath,
        file_size: pdfFile.size,
        mime_type: pdfFile.type,
        uploaded_by: user.id,
      })

      if (attachErr) {
        await supabase.storage.from('debtor-files').remove([filePath])
        await supabase.from('tasks').delete().eq('id', newTask.id)
        await supabase.from('debtors').delete().eq('id', newDebtor.id)
        setError(`فشل حفظ سجل الملف: ${attachErr.message}`)
        setSaving(false)
        return
      }
    }

    router.push('/admin/debtors')
  }

  const selectedDef = taskDefs.find(t => t.id === selectedTaskDefId)
  const branchOk = branchId && branchName && !isMainBranchName(branchName)

  const taskOptions = taskDefs.map(t => ({
    value: t.id,
    label: t.label,
    hint: t.fee_amount > 0 ? `${Number(t.fee_amount).toLocaleString('en-US')} د.ع أتعاب` : undefined,
  }))

  const receiptOptions = FORM_RECEIPT_TYPES.map(t => ({
    value: t,
    label: RECEIPT_TYPE_LABELS[t],
  }))

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="إضافة مدين جديد"
        subtitle="سجّل بيانات المدين واربطه بمهمته الأولية في فرعك الحالي"
        breadcrumb={[{ label: 'المدينون', href: '/admin/debtors' }, { label: 'إضافة جديد' }]}
      />

      {readOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          عرض النموذج فقط — لا تملك صلاحية إضافة مدين.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <FormFlow>
          {branchOk ? (
            <FormFlowHero
              branchName={branchName!}
              meta={[{ label: LEGAL_ISSUE_DATE_LABEL, value: today }]}
            />
          ) : (
            <FormFlowHero warning="اختر فرعاً رسمياً من القائمة العلوية قبل إضافة مدين." />
          )}

          <FormFlowStep
            step={1}
            title="المهمة الأولية"
            subtitle="اختر المهمة القانونية التي يبدأ بها مسار هذا المدين"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          >
            <FormField label="المهمة القانونية لهذا المدين" required error={fieldErrors.selectedTaskDefId}>
              <PremiumSelect
                value={selectedTaskDefId}
                onChange={v => { setSelectedTaskDefId(v); clearFieldError('selectedTaskDefId') }}
                options={taskOptions}
                placeholder="— اختر المهمة الأولية —"
                headerTitle="اختر المهمة القانونية"
                headerSubtitle={`${taskDefs.length} مهمة متاحة في هذا الفرع`}
                searchPlaceholder="بحث في المهام..."
                disabled={!branchOk}
              />
            </FormField>
            {selectedDef && (
              <div className="mt-3 flex items-start gap-2.5 bg-[#2C8780]/6 border border-[#2C8780]/20 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-[#2C8780]/12 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-[#231F20] leading-relaxed">
                  ستُنشأ مهمة <span className="font-black text-[#2C8780]">«{selectedDef.label}»</span> بانتظار تكليف محامٍ فور الحفظ.
                </p>
              </div>
            )}
          </FormFlowStep>

          <FormFlowStep
            step={2}
            title="البيانات الشخصية"
            subtitle="معلومات التواصل والهوية للمدين"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="الاسم الكامل" required error={fieldErrors.full_name}>
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputClass('full_name')} placeholder="اسم المدين الكامل" />
              </FormField>
              <FormField label="رقم الهاتف" required error={fieldErrors.phone}>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputClass('phone')} dir="ltr" placeholder="+964..." />
              </FormField>
              <FormField label="رقم الهوية" required error={fieldErrors.id_number}>
                <input type="text" value={form.id_number} onChange={e => set('id_number', e.target.value)} className={inputClass('id_number')} dir="ltr" />
              </FormField>
              <FormField label="العنوان التفصيلي" required error={fieldErrors.address}>
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)} className={inputClass('address')} placeholder="الحي، الشارع، رقم الدار" />
              </FormField>
            </div>
          </FormFlowStep>

          <FormFlowStep
            step={3}
            title="بيانات المستند"
            subtitle="تفاصيل الوصل والمبالغ المالية"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label={RECEIPT_TYPE_LABEL} required>
                <PremiumSelect
                  value={form.receipt_type}
                  onChange={v => set('receipt_type', v)}
                  options={receiptOptions}
                  headerTitle={RECEIPT_TYPE_LABEL}
                  searchable={false}
                />
              </FormField>
              <FormField label={RECEIPT_NUMBER_LABEL} required error={fieldErrors.receipt_number}>
                <input type="text" value={form.receipt_number} onChange={e => set('receipt_number', e.target.value)} className={inputClass('receipt_number')} dir="ltr" />
              </FormField>
              <FormField label={`${RECEIPT_AMOUNT_LABEL} (د.ع)`} required error={fieldErrors.receipt_amount}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatMoneyInput(form.receipt_amount)}
                  onChange={e => setMoney('receipt_amount', e.target.value)}
                  className={inputClass('receipt_amount')}
                  dir="ltr"
                  placeholder="0"
                />
              </FormField>
              <FormField label="المبلغ المتبقي (د.ع)" required error={fieldErrors.remaining_amount}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatMoneyInput(form.remaining_amount)}
                  onChange={e => setMoney('remaining_amount', e.target.value)}
                  className={inputClass('remaining_amount')}
                  dir="ltr"
                  placeholder="0"
                />
              </FormField>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-[rgba(118,118,118,0.12)] bg-[#FAFAFA] hover:bg-[#F3F1F2] transition-colors">
                  <input type="checkbox" checked={form.receipt_signed_legal_costs}
                    onChange={e => set('receipt_signed_legal_costs', e.target.checked)}
                    className="w-4 h-4 rounded accent-[#2C8780]" />
                  <span className="text-sm font-semibold text-[#231F20]">هل الوصل موقّع ليتحمّل المدين التكاليف القانونية؟</span>
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-[rgba(118,118,118,0.12)] bg-[#FAFAFA] hover:bg-[#F3F1F2] transition-colors">
                  <input type="checkbox" checked={form.has_contract}
                    onChange={e => {
                      const checked = e.target.checked
                      set('has_contract', checked)
                      if (!checked) {
                        set('penalty_amount', '')
                        clearFieldError('penalty_amount')
                      }
                    }}
                    className="w-4 h-4 rounded accent-[#2C8780]" />
                  <span className="text-sm font-semibold text-[#231F20]">يوجد عقد موقّع</span>
                </label>
              </div>
              {form.has_contract && (
                <FormField label="الشرط الجزائي (د.ع)" required error={fieldErrors.penalty_amount}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatMoneyInput(form.penalty_amount)}
                    onChange={e => setMoney('penalty_amount', e.target.value)}
                    className={inputClass('penalty_amount')}
                    dir="ltr"
                    placeholder="0"
                  />
                </FormField>
              )}
            </div>
          </FormFlowStep>

          <FormFlowStep
            step={4}
            title="ملف المدين والملاحظات"
            subtitle="ارفع ملف PDF إن وُجد — اختياري"
            isLast
          >
            <div className="space-y-4">
              <FormField label="ملف PDF" hint="اختياري — PDF فقط">
                <label className={cn(
                  'flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all',
                  pdfFile
                    ? 'border-[#2C8780]/40 bg-[#2C8780]/5'
                    : 'border-[rgba(118,118,118,0.2)] bg-[#FAFAFA] hover:border-[#2C8780]/35 hover:bg-[#2C8780]/3',
                )}>
                  <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
                  <div className="w-12 h-12 rounded-2xl bg-[#2C8780]/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  {pdfFile ? (
                    <>
                      <p className="text-sm font-bold text-[#2C8780]">{pdfFile.name}</p>
                      <p className="text-xs text-[#767676]">{(pdfFile.size / 1024).toFixed(0)} KB — اضغط لتغيير الملف</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-[#231F20]">اسحب الملف أو اضغط للرفع</p>
                      <p className="text-xs text-[#767676]">PDF فقط</p>
                    </>
                  )}
                </label>
              </FormField>
              <FormField label="ملاحظات" hint="اختياري">
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={cn(formInputClass, 'resize-none')} placeholder="ملاحظات إضافية..." />
              </FormField>
            </div>
          </FormFlowStep>
        </FormFlow>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving} disabled={!branchOk || readOnly}>
            حفظ المدين وإنشاء المهمة
          </Button>
          <Link href="/admin/debtors">
            <Button type="button" variant="outline">إلغاء</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
