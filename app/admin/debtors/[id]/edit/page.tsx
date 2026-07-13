'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { fmtDate } from '@/lib/utils'
import { parseMoneyInput } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { uploadDebtorPdfFile } from '@/lib/debtor-file-upload'
import { computeDebtorRequiredAmount, computeRemainingFromRequired } from '@/lib/debtor-balances'
import { RECEIPT_NUMBER_LABEL, RECEIPT_TYPE_LABEL, RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'
import { PremiumSelect } from '@/components/ui/premium-select'
import { FormFlow, FormFlowStep, FormField, formInputClass } from '@/components/ui/form-flow'
import { cn } from '@/lib/utils'
import { useAdminRole } from '@/context/admin-role'
import BranchListSelect from '@/components/BranchListSelect'
import { fetchBranchLists } from '@/lib/branch-lists'
import type { BranchList } from '@/lib/branch-lists'
import { canAddDebtor, canAssignTasks, canEditRecords } from '@/lib/permissions'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import { appConfirm } from '@/lib/app-dialog'
import {
  findDuplicateReceiptInBranch,
  isReceiptNumberMissing,
  normalizeReceiptNumberInput,
  RECEIPT_NUMBER_DUP_BRANCH_ERROR,
  RECEIPT_NUMBER_EMPTY_ERROR,
} from '@/lib/receipt-number'

const FORM_RECEIPT_TYPES: ReceiptType[] = ['check', 'bill_of_exchange', 'trust']

interface Attachment { id: string; file_name: string; file_path: string; file_size: number | null }

export default function EditDebtorPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const role = useAdminRole()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [debtorBranchId, setDebtorBranchId] = useState<string | null>(null)
  const [branchLists, setBranchLists] = useState<BranchList[]>([])
  const [totalPayments, setTotalPayments] = useState(0)

  const [form, setForm] = useState({
    full_name: '', phone: '', address: '', id_number: '',
    receipt_type: 'check' as ReceiptType,
    receipt_number: '', receipt_amount: '', remaining_amount: '', lawyer_fees: '',
    penalty_amount: '', has_contract: false, receipt_signed_legal_costs: false, notes: '',
    branch_list_id: '',
  })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data }, { data: files }] = await Promise.all([
        supabase.from('debtors').select('*').eq('id', id).single(),
        supabase.from('debtor_attachments').select('id, file_name, file_path, file_size').eq('debtor_id', id),
      ])
      if (data) {
        setCreatedAt(data.created_at ?? null)
        setDebtorBranchId(data.branch_id ?? null)
        setTotalPayments(Number(data.total_payments ?? 0))
        const hasPenalty = parseMoneyInput(data.penalty_amount) > 0
        setForm({
          full_name: data.full_name ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          id_number: data.id_number ?? '',
          receipt_type: data.receipt_type ?? 'check',
          receipt_number: data.receipt_number ?? '',
          receipt_amount: data.receipt_amount?.toString() ?? '',
          remaining_amount: data.remaining_amount?.toString() ?? '',
          lawyer_fees: data.lawyer_fees?.toString() ?? '',
          penalty_amount: data.penalty_amount?.toString() ?? '',
          has_contract: hasPenalty,
          receipt_signed_legal_costs: Boolean(data.receipt_signed_legal_costs),
          notes: data.notes ?? '',
          branch_list_id: data.branch_list_id ?? '',
        })
        if (data.branch_id) {
          fetchBranchLists(supabase, data.branch_id).then(setBranchLists)
        }
      }
      setAttachments(files ?? [])
      setLoading(false)
    }
    load()
  }, [id])

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file && file.type !== 'application/pdf') { setError('يجب أن يكون الملف بصيغة PDF فقط'); setPdfFile(null); e.target.value = ''; return }
    setError(''); setPdfFile(file)
  }

  async function deleteFile(file: Attachment) {
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `هل تريد حذف هذا الملف؟\n«${file.file_name}»`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return
    setDeletingFileId(file.id)
    try {
      const res = await fetch('/api/admin/delete-debtor-file', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: file.id, filePath: file.file_path, fileName: file.file_name }) })
      if (!res.ok) { const { error: err } = await res.json(); setError(`فشل حذف الملف: ${err ?? 'خطأ غير معروف'}`) }
      else setAttachments(prev => prev.filter(a => a.id !== file.id))
    } catch { setError('حدث خطأ أثناء حذف الملف') }
    finally { setDeletingFileId(null) }
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (readOnly) return
    setSaving(true); setError('')
    const receiptNumber = normalizeReceiptNumberInput(form.receipt_number)
    if (isReceiptNumberMissing(receiptNumber)) {
      setError(RECEIPT_NUMBER_EMPTY_ERROR)
      setSaving(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    if (debtorBranchId) {
      const dup = await findDuplicateReceiptInBranch(supabase, debtorBranchId, receiptNumber, id)
      if (dup.error) {
        setError(dup.error)
        setSaving(false)
        return
      }
      if (dup.duplicate) {
        setError(RECEIPT_NUMBER_DUP_BRANCH_ERROR)
        setSaving(false)
        return
      }
    }

    const receiptRemaining = parseMoneyInput(form.remaining_amount)
    const receiptAmount = parseMoneyInput(form.receipt_amount)
    const penalty = form.has_contract ? parseMoneyInput(form.penalty_amount) : 0

    const updatePayload: Record<string, unknown> = {
      full_name: form.full_name, phone: form.phone || null, address: form.address || null,
      id_number: form.id_number || null,
      receipt_type: form.receipt_type, receipt_number: receiptNumber,
      receipt_amount: receiptAmount,
      lawyer_fees: parseMoneyInput(form.lawyer_fees),
      penalty_amount: penalty,
      receipt_signed_legal_costs: form.receipt_signed_legal_costs,
      notes: form.notes || null,
      branch_list_id: form.branch_list_id || null,
    }

    // إعادة حساب المطلوب فقط إذا لا توجد تسديدات (المتبقي في النموذج = متبقي الوصل)
    if (totalPayments === 0) {
      const required = computeDebtorRequiredAmount(receiptRemaining, penalty, receiptAmount)
      updatePayload.required_amount = required
      updatePayload.remaining_amount = computeRemainingFromRequired(required, 0)
    }

    const { error: dbError } = await supabase.from('debtors').update(updatePayload).eq('id', id)
    if (dbError) { setError(dbError.message); setSaving(false); return }
    await logActivity({ action: 'update_debtor', entity_type: 'debtor', entity_id: id, description: `تعديل بيانات المدين: ${form.full_name}` }, supabase)
    if (pdfFile) {
      try {
        await uploadDebtorPdfFile(id, pdfFile)
      } catch (uploadError) {
        setError(`تم حفظ البيانات لكن فشل رفع الملف: ${uploadError instanceof Error ? uploadError.message : 'خطأ غير معروف'}`)
        setSaving(false)
        return
      }
    }
    router.push('/admin/debtors')
  }

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-20">
      <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
    </div>
  )

  const readOnly = !canEditRecords(role)
  const allowChangeTask = canAddDebtor(role) || canAssignTasks(role)

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="تعديل بيانات المدين"
        subtitle={createdAt ? `تاريخ الإضافة: ${fmtDate(createdAt)}` : undefined}
        breadcrumb={[{ label: 'المدينون', href: '/admin/debtors' }, { label: 'تعديل' }]}
      />

      {allowChangeTask && debtorBranchId && (
        <div className="rounded-xl border border-[#2C8780]/20 bg-[#2C8780]/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#231F20]">المهمة المطلوبة</p>
            <p className="text-xs text-[#767676]">يمكن تغييرها قبل تكليف المهمة فقط</p>
          </div>
          <ChangeDebtorTaskButton debtorId={id} branchId={debtorBranchId} />
        </div>
      )}
      {readOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          عرض البيانات فقط — لا تملك صلاحية تعديل المدين.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset disabled={readOnly} className="space-y-5 border-0 p-0 m-0 min-w-0">
        <FormFlow>
          <FormFlowStep step={1} title="البيانات الشخصية" subtitle="معلومات التواصل والهوية">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="الاسم الكامل" required>
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} required className={formInputClass} />
              </FormField>
              <FormField label="رقم الهاتف">
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={formInputClass} dir="ltr" />
              </FormField>
              <FormField label="رقم الهوية">
                <input type="text" value={form.id_number} onChange={e => set('id_number', e.target.value)} className={formInputClass} dir="ltr" />
              </FormField>
              <FormField label="العنوان" className="md:col-span-2">
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)} className={formInputClass} />
              </FormField>
              <FormField label="القائمة" className="md:col-span-2">
                <BranchListSelect
                  value={form.branch_list_id}
                  onChange={v => set('branch_list_id', v)}
                  lists={branchLists}
                  disabled={!debtorBranchId}
                />
              </FormField>
            </div>
          </FormFlowStep>

          <FormFlowStep step={2} title="بيانات المستند" subtitle="تفاصيل الوصل والمبالغ">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label={RECEIPT_TYPE_LABEL} required>
                <PremiumSelect
                  value={form.receipt_type}
                  onChange={v => set('receipt_type', v)}
                  options={FORM_RECEIPT_TYPES.map(t => ({ value: t, label: RECEIPT_TYPE_LABELS[t] }))}
                  headerTitle={RECEIPT_TYPE_LABEL}
                  searchable={false}
                />
              </FormField>
              <FormField label={RECEIPT_NUMBER_LABEL} required>
                <input type="text" value={form.receipt_number} onChange={e => set('receipt_number', e.target.value)} className={formInputClass} dir="ltr" />
              </FormField>
              <FormField label={`${RECEIPT_AMOUNT_LABEL} (د.ع)`}>
                <MoneyInput value={form.receipt_amount} onChange={v => set('receipt_amount', v)} className={formInputClass} />
              </FormField>
              <FormField label="المبلغ المتبقي (د.ع)">
                <MoneyInput value={form.remaining_amount} onChange={v => set('remaining_amount', v)} className={formInputClass} />
              </FormField>
              <FormField label="أتعاب المحامي (د.ع)">
                <MoneyInput value={form.lawyer_fees} onChange={v => set('lawyer_fees', v)} className={formInputClass} />
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
                  <input type="checkbox" id="has_contract" checked={form.has_contract}
                    onChange={e => { set('has_contract', e.target.checked); if (!e.target.checked) set('penalty_amount', '0') }}
                    className="w-4 h-4 rounded accent-[#2C8780]" />
                  <span className="text-sm font-semibold text-[#231F20]">يوجد عقد موقّع</span>
                </label>
              </div>
              {form.has_contract && (
                <FormField label="الشرط الجزائي (د.ع)">
                  <MoneyInput value={form.penalty_amount} onChange={v => set('penalty_amount', v)} className={formInputClass} />
                </FormField>
              )}
            </div>
          </FormFlowStep>

          <FormFlowStep step={3} title="ملف المدين" subtitle="المستمسكات المرفقة">
            <div className="space-y-4">
              {attachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-[#767676]">الملفات الحالية</p>
                  {attachments.map(a => (
                    <div key={a.id} className="flex items-center gap-2 bg-[#2C8780]/5 rounded-xl px-3 py-2.5 border border-[#2C8780]/15">
                      <div className="w-8 h-8 rounded-lg bg-[#2C8780]/10 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <span className="text-sm text-[#231F20] font-semibold flex-1 min-w-0 truncate">{a.file_name}</span>
                      {a.file_size && <span className="text-xs text-[#767676] shrink-0">{(a.file_size / 1024).toFixed(0)} KB</span>}
                      <button type="button" onClick={() => deleteFile(a)} disabled={deletingFileId === a.id}
                        className="text-xs text-red-600 hover:text-red-800 font-semibold shrink-0 disabled:opacity-50">
                        {deletingFileId === a.id ? '...' : 'حذف'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <FormField label="رفع ملف PDF جديد" hint="اختياري">
                <label className={cn(
                  'flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed cursor-pointer transition-all',
                  pdfFile ? 'border-[#2C8780]/40 bg-[#2C8780]/5' : 'border-[rgba(118,118,118,0.2)] bg-[#FAFAFA] hover:border-[#2C8780]/35',
                )}>
                  <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
                  {pdfFile ? (
                    <p className="text-sm font-bold text-[#2C8780]">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>
                  ) : (
                    <p className="text-sm text-[#767676]">اضغط لرفع ملف PDF</p>
                  )}
                </label>
              </FormField>
            </div>
          </FormFlowStep>

          <FormFlowStep step={4} title="ملاحظات" isLast>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={cn(formInputClass, 'resize-none')} placeholder="ملاحظات إضافية..." />
          </FormFlowStep>
        </FormFlow>
        </fieldset>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving} disabled={readOnly}>حفظ التعديلات</Button>
          <Link href="/admin/debtors"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>
    </div>
  )
}