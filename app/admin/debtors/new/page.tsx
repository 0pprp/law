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
import { parseMoneyInput } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { uploadDebtorPdfFile } from '@/lib/debtor-file-upload'
import { canAddDebtor } from '@/lib/permissions'
import { useAdminRole } from '@/context/admin-role'
import BranchListSelect from '@/components/BranchListSelect'
import { useBranchLists } from '@/hooks/use-branch-lists'
import {
  isReceiptNumberMissing,
  RECEIPT_NUMBER_DUP_BRANCH_ERROR,
  RECEIPT_NUMBER_EMPTY_ERROR,
} from '@/lib/receipt-number'

const FORM_RECEIPT_TYPES: ReceiptType[] = ['check', 'bill_of_exchange', 'trust']
/** قيمة واجهة فقط — تُحفظ في DB كـ other لتفادي كسر القيود */
const RECEIPT_TYPE_NONE = 'none'

type DebtorFormField = 'selectedTaskDefId' | 'receipt_number'

type FieldErrors = Partial<Record<DebtorFormField, string>>

interface TaskDef { id: string; label: string; fee_amount: number; task_type: string | null }

function resolveReceiptType(value: string): ReceiptType {
  if (!value || value === RECEIPT_TYPE_NONE) return 'other'
  if ((FORM_RECEIPT_TYPES as string[]).includes(value)) return value as ReceiptType
  return 'other'
}

export default function NewDebtorPage() {
  const router = useRouter()
  const role = useAdminRole()
  const readOnly = !canAddDebtor(role)
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const { lists: branchLists } = useBranchLists(branchId)
  const today = new Date().toISOString().split('T')[0]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [taskDefs, setTaskDefs] = useState<TaskDef[]>([])
  const [selectedTaskDefId, setSelectedTaskDefId] = useState('')
  const [branchListId, setBranchListId] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    address: '',
    id_number: '',
    receipt_type: RECEIPT_TYPE_NONE,
    receipt_number: '',
    receipt_amount: '',
    remaining_amount: '',
    penalty_amount: '',
    has_contract: false,
    receipt_signed_legal_costs: false,
    notes: '',
  })

  useEffect(() => {
    let q = createClient().from('task_definitions').select('id, label, fee_amount, task_type').eq('is_active', true)
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

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field === 'receipt_number') clearFieldError('receipt_number')
  }

  function inputClass(invalid?: boolean) {
    return cn(
      formInputClass,
      invalid && 'border-red-400 focus:border-red-500 focus:ring-red-200/40',
    )
  }

  /** المهمة مطلوبة + رقم الوصل غير فارغ */
  function validateForm(): FieldErrors {
    const errors: FieldErrors = {}
    if (!selectedTaskDefId) {
      errors.selectedTaskDefId = 'يجب اختيار المهمة المطلوبة قبل إضافة المدين.'
    }
    if (isReceiptNumberMissing(form.receipt_number)) {
      errors.receipt_number = RECEIPT_NUMBER_EMPTY_ERROR
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
      setError(
        validationErrors.receipt_number
        ?? validationErrors.selectedTaskDefId
        ?? 'يجب إكمال الحقول المطلوبة قبل إضافة المدين.',
      )
      setSaving(false)
      return
    }
    setFieldErrors({})

    if (pdfFile && pdfFile.type !== 'application/pdf') {
      setError('يجب أن يكون الملف بصيغة PDF فقط')
      setSaving(false)
      return
    }

    const remaining = parseMoneyInput(form.remaining_amount)
    const receiptAmount = parseMoneyInput(form.receipt_amount)
    const penalty = form.has_contract ? parseMoneyInput(form.penalty_amount) : 0

    try {
      const res = await fetch('/api/admin/debtors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          taskDefinitionId: selectedTaskDefId,
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          id_number: form.id_number.trim(),
          receipt_type: resolveReceiptType(form.receipt_type),
          receipt_number: form.receipt_number,
          receipt_amount: receiptAmount,
          remaining_amount: remaining,
          penalty_amount: penalty,
          has_contract: form.has_contract,
          receipt_signed_legal_costs: form.receipt_signed_legal_costs,
          notes: form.notes.trim(),
          branch_list_id: branchListId || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.id) {
        const msg = typeof json.error === 'string' ? json.error : 'فشل إنشاء المدين'
        if (msg === RECEIPT_NUMBER_DUP_BRANCH_ERROR || msg === RECEIPT_NUMBER_EMPTY_ERROR) {
          setFieldErrors({ receipt_number: msg })
        }
        setError(msg)
        setSaving(false)
        return
      }

      if (pdfFile) {
        try {
          await uploadDebtorPdfFile(json.id, pdfFile)
        } catch (uploadError) {
          setError(`تم إنشاء المدين لكن فشل رفع ملف PDF: ${uploadError instanceof Error ? uploadError.message : 'خطأ غير معروف'}`)
          setSaving(false)
          return
        }
      }

      router.push('/admin/debtors')
    } catch {
      setError('فشل إنشاء المدين')
      setSaving(false)
    }
  }

  const selectedDef = taskDefs.find(t => t.id === selectedTaskDefId)
  const branchOk = branchId && branchName && !isMainBranchName(branchName)

  const taskOptions = taskDefs.map(t => ({
    value: t.id,
    label: t.label,
    hint: t.fee_amount > 0 ? `${Number(t.fee_amount).toLocaleString('en-US')} د.ع أتعاب` : undefined,
  }))

  const receiptOptions = [
    { value: RECEIPT_TYPE_NONE, label: 'لا يوجد' },
    ...FORM_RECEIPT_TYPES.map(t => ({
      value: t,
      label: RECEIPT_TYPE_LABELS[t],
    })),
  ]

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
            title="المهمة المطلوبة"
            subtitle="هذا الحقل الإلزامي الوحيد — بدون اختيار المهمة لا يمكن إضافة المدين"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          >
            <FormField label="المهمة المطلوبة" required error={fieldErrors.selectedTaskDefId}>
              <PremiumSelect
                value={selectedTaskDefId}
                onChange={v => { setSelectedTaskDefId(v); clearFieldError('selectedTaskDefId') }}
                options={taskOptions}
                placeholder="— اختر المهمة المطلوبة —"
                headerTitle="اختر المهمة المطلوبة"
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
              <FormField label="الاسم الكامل" hint="اختياري">
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputClass()} placeholder="اسم المدين الكامل" />
              </FormField>
              <FormField label="رقم الهاتف" hint="اختياري">
                <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputClass()} dir="ltr" placeholder="+964..." />
              </FormField>
              <FormField label="رقم الهوية" hint="اختياري">
                <input type="text" value={form.id_number} onChange={e => set('id_number', e.target.value)} className={inputClass()} dir="ltr" />
              </FormField>
              <FormField label="العنوان التفصيلي" hint="اختياري">
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)} className={inputClass()} placeholder="الحي، الشارع، رقم الدار" />
              </FormField>
              <FormField label="القائمة" hint="اختياري">
                <BranchListSelect
                  value={branchListId}
                  onChange={setBranchListId}
                  lists={branchLists}
                  disabled={!branchId}
                />
              </FormField>
            </div>
          </FormFlowStep>

          <FormFlowStep
            step={3}
            title="بيانات المستند"
            subtitle="كل الحقول اختيارية — يمكن تركها فارغة"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label={RECEIPT_TYPE_LABEL} hint="اختياري">
                <PremiumSelect
                  value={form.receipt_type}
                  onChange={v => set('receipt_type', v)}
                  options={receiptOptions}
                  headerTitle={RECEIPT_TYPE_LABEL}
                  searchable={false}
                />
              </FormField>
              <FormField label={RECEIPT_NUMBER_LABEL} required error={fieldErrors.receipt_number}>
                <input
                  type="text"
                  value={form.receipt_number}
                  onChange={e => set('receipt_number', e.target.value)}
                  className={inputClass(!!fieldErrors.receipt_number)}
                  dir="ltr"
                />
              </FormField>
              <FormField label={`${RECEIPT_AMOUNT_LABEL} (د.ع)`} hint="اختياري — يُنسّق تلقائياً كل 3 أرقام">
                <MoneyInput
                  value={form.receipt_amount}
                  onChange={v => set('receipt_amount', v)}
                  className={inputClass()}
                  placeholder="0"
                />
              </FormField>
              <FormField label="المبلغ المتبقي (د.ع)" hint="اختياري — يُنسّق تلقائياً كل 3 أرقام">
                <MoneyInput
                  value={form.remaining_amount}
                  onChange={v => set('remaining_amount', v)}
                  className={inputClass()}
                  placeholder="0"
                />
              </FormField>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-[rgba(118,118,118,0.12)] bg-[#FAFAFA] hover:bg-[#F3F1F2] transition-colors">
                  <input type="checkbox" checked={form.has_contract}
                    onChange={e => {
                      const checked = e.target.checked
                      // مرتبطان: عقد موقّع ⇒ الوصل موقّع لتحمل التكاليف القانونية
                      setForm(prev => ({
                        ...prev,
                        has_contract: checked,
                        receipt_signed_legal_costs: checked,
                        penalty_amount: checked ? prev.penalty_amount : '',
                      }))
                    }}
                    className="w-4 h-4 rounded accent-[#2C8780]" />
                  <span className="text-sm font-semibold text-[#231F20]">يوجد عقد موقّع</span>
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-[rgba(118,118,118,0.12)] bg-[#FAFAFA] hover:bg-[#F3F1F2] transition-colors">
                  <input type="checkbox" checked={form.receipt_signed_legal_costs}
                    onChange={e => {
                      const checked = e.target.checked
                      // مرتبطان: إلغاء أحدهما يلغي الآخر، وتفعيل التكاليف يستلزم العقد
                      setForm(prev => ({
                        ...prev,
                        receipt_signed_legal_costs: checked,
                        has_contract: checked,
                        penalty_amount: checked ? prev.penalty_amount : '',
                      }))
                    }}
                    className="w-4 h-4 rounded accent-[#2C8780]" />
                  <span className="text-sm font-semibold text-[#231F20]">هل الوصل موقّع ليتحمّل المدين التكاليف القانونية؟</span>
                </label>
                {form.has_contract && (
                  <p className="text-[11px] text-[#2C8780] mt-1.5 px-1">مربوط مع «يوجد عقد موقّع» — يُفعَّلان معاً.</p>
                )}
              </div>
              {form.has_contract && (
                <FormField label="الشرط الجزائي (د.ع)" hint="اختياري — يُنسّق تلقائياً كل 3 أرقام">
                  <MoneyInput
                    value={form.penalty_amount}
                    onChange={v => set('penalty_amount', v)}
                    className={inputClass()}
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
