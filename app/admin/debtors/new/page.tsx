'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useBranchId } from '@/context/branch'

const FORM_RECEIPT_TYPES: ReceiptType[] = ['check', 'bill_of_exchange', 'trust']

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

function Field({ label, required: req, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#231F20] mb-1.5">
        {label}{req && <span className="text-red-500 mr-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

interface TaskDef { id: string; label: string; fee_amount: number }

export default function NewDebtorPage() {
  const router = useRouter()
  const branchId = useBranchId()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [taskDefs, setTaskDefs] = useState<TaskDef[]>([])
  const [selectedTaskDefId, setSelectedTaskDefId] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    governorate: '',
    address: '',
    employer: '',
    id_number: '',
    export_date: '',
    receipt_type: 'check' as ReceiptType,
    receipt_number: '',
    receipt_amount: '',
    remaining_amount: '',
    lawyer_fees: '',
    penalty_amount: '',
    has_contract: false,
    notes: '',
  })

  // Load task definitions for current branch
  useEffect(() => {
    let q = createClient().from('task_definitions').select('id, label, fee_amount').eq('is_active', true)
    if (branchId) q = (q as any).eq('branch_id', branchId)
    q.order('sort_order').order('label').then(({ data }) => setTaskDefs(data ?? []))
  }, [branchId])

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

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
    setSaving(true)
    setError('')

    if (!selectedTaskDefId) {
      setError('يجب اختيار المهمة الأولية للمدين — لا يمكن إضافة مدين بدون مهمة')
      setSaving(false)
      return
    }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const taskDef = taskDefs.find(t => t.id === selectedTaskDefId)

    const { data: newDebtor, error: dbError } = await supabase.from('debtors').insert({
      full_name: form.full_name,
      phone: form.phone || null,
      governorate: form.governorate || null,
      address: form.address || null,
      employer: form.employer || null,
      id_number: form.id_number || null,
      export_date: form.export_date || new Date().toISOString().split('T')[0],
      receipt_type: form.receipt_type,
      receipt_number: form.receipt_number || null,
      receipt_amount: parseFloat(form.receipt_amount) || 0,
      remaining_amount: parseFloat(form.remaining_amount) || 0,
      lawyer_fees: parseFloat(form.lawyer_fees) || 0,
      penalty_amount: form.has_contract ? (parseFloat(form.penalty_amount) || 0) : 0,
      notes: form.notes || null,
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

    if (pdfFile) {
      const safeFileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
      const filePath = `${newDebtor.id}/${safeFileName}`
      const { error: uploadError } = await supabase.storage
        .from('debtor-files')
        .upload(filePath, pdfFile, { contentType: 'application/pdf' })
      if (uploadError) {
        setError(`تم إنشاء المدين لكن فشل رفع الملف: ${uploadError.message}`)
        setSaving(false)
        return
      }
      await supabase.from('debtor_attachments').insert({
        debtor_id: newDebtor.id,
        file_name: pdfFile.name,
        file_path: filePath,
        file_size: pdfFile.size,
        mime_type: pdfFile.type,
        uploaded_by: user.id,
      })
    }

    router.push('/admin/debtors')
  }

  const selectedDef = taskDefs.find(t => t.id === selectedTaskDefId)

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="إضافة مدين جديد"
        breadcrumb={[{ label: 'المدينون', href: '/admin/debtors' }, { label: 'إضافة جديد' }]}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Initial Task Selection */}
        <Card>
          <CardHeader title="المهمة الأولية المطلوبة" />
          <div className="p-5">
            <Field label="المهمة القانونية لهذا المدين" required>
              <select
                value={selectedTaskDefId}
                onChange={e => setSelectedTaskDefId(e.target.value)}
                className={INP}
                required
              >
                <option value="">— اختر المهمة الأولية —</option>
                {taskDefs.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label}{t.fee_amount > 0 ? ` — ${Number(t.fee_amount).toLocaleString('en-US')} د.ع` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {selectedDef && (
              <div className="mt-3 flex items-center gap-2 bg-[#2C8780]/8 border border-[#2C8780]/20 rounded-xl px-4 py-2.5">
                <svg className="w-4 h-4 text-[#2C8780] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p className="text-sm text-[#2C8780] font-semibold">
                  ستُنشأ مهمة <span className="font-black">"{selectedDef.label}"</span> بانتظار تكليف محامٍ
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="البيانات الشخصية" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} required className={INP} placeholder="اسم المدين الكامل" />
            </Field>
            <Field label="رقم الهاتف">
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={INP} dir="ltr" placeholder="+964..." />
            </Field>
            <Field label="رقم الهوية">
              <input type="text" value={form.id_number} onChange={e => set('id_number', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="جهة العمل">
              <input type="text" value={form.employer} onChange={e => set('employer', e.target.value)} className={INP} />
            </Field>
            <Field label="المحافظة">
              <input type="text" value={form.governorate} onChange={e => set('governorate', e.target.value)} className={INP} placeholder="مثال: بغداد" />
            </Field>
            <Field label="العنوان التفصيلي">
              <input type="text" value={form.address} onChange={e => set('address', e.target.value)} className={INP} placeholder="الحي، الشارع، رقم الدار" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="بيانات المستند" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="نوع الصك" required>
              <select value={form.receipt_type} onChange={e => set('receipt_type', e.target.value)} required className={INP}>
                {FORM_RECEIPT_TYPES.map(t => <option key={t} value={t}>{RECEIPT_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="رقم الصك / المستند">
              <input type="text" value={form.receipt_number} onChange={e => set('receipt_number', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="تاريخ الإصدار">
              <input type="date" value={form.export_date} onChange={e => set('export_date', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="المبلغ الأصلي (د.ع)">
              <input type="number" value={form.receipt_amount} onChange={e => set('receipt_amount', e.target.value)} className={INP} min="0" step="any" dir="ltr" placeholder="0" />
            </Field>
            <Field label="المبلغ المتبقي (د.ع)">
              <input type="number" value={form.remaining_amount} onChange={e => set('remaining_amount', e.target.value)} className={INP} min="0" step="any" dir="ltr" placeholder="0" />
            </Field>
            <Field label="أتعاب المحامي (د.ع)">
              <input type="number" value={form.lawyer_fees} onChange={e => set('lawyer_fees', e.target.value)} className={INP} min="0" step="any" dir="ltr" placeholder="0" />
            </Field>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={form.has_contract}
                  onChange={e => { set('has_contract', e.target.checked); if (!e.target.checked) set('penalty_amount', '') }}
                  className="w-4 h-4 rounded accent-[#2C8780]" />
                <span className="text-sm font-semibold text-[#231F20]">يوجد عقد موقّع</span>
              </label>
            </div>
            {form.has_contract && (
              <Field label="الشرط الجزائي (د.ع)">
                <input type="number" value={form.penalty_amount} onChange={e => set('penalty_amount', e.target.value)} className={INP} min="0" step="any" dir="ltr" placeholder="0" />
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="ملف المدين" />
          <div className="p-5 space-y-4">
            <Field label="ملف PDF (اختياري)">
              <input type="file" accept="application/pdf" onChange={handleFileChange}
                className="w-full text-sm text-[#231F20] file:ml-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#2C8780]/8 file:text-[#2C8780] hover:file:bg-[#2C8780]/15 cursor-pointer" />
              {pdfFile && <p className="text-xs text-emerald-700 mt-1.5 font-semibold">✓ {pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
            </Field>
            <Field label="ملاحظات">
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={`${INP} resize-none`} placeholder="ملاحظات إضافية..." />
            </Field>
          </div>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
        )}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving}>
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
