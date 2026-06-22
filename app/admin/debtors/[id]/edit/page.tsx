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
import { Card, CardHeader } from '@/components/ui/card'
import { fmtDate } from '@/lib/utils'

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

interface Attachment { id: string; file_name: string; file_path: string; file_size: number | null }

export default function EditDebtorPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)

  const [form, setForm] = useState({
    full_name: '', phone: '', address: '', employer: '', id_number: '',
    receipt_type: 'check' as ReceiptType,
    receipt_number: '', receipt_amount: '', remaining_amount: '', lawyer_fees: '',
    penalty_amount: '', has_contract: false, notes: '',
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
        const hasPenalty = parseFloat(data.penalty_amount) > 0
        setForm({
          full_name: data.full_name ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          employer: data.employer ?? '',
          id_number: data.id_number ?? '',
          receipt_type: data.receipt_type ?? 'check',
          receipt_number: data.receipt_number ?? '',
          receipt_amount: data.receipt_amount?.toString() ?? '',
          remaining_amount: data.remaining_amount?.toString() ?? '',
          lawyer_fees: data.lawyer_fees?.toString() ?? '',
          penalty_amount: data.penalty_amount?.toString() ?? '',
          has_contract: hasPenalty,
          notes: data.notes ?? '',
        })
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
    if (!confirm(`هل تريد حذف هذا الملف؟\n"${file.file_name}"`)) return
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
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { error: dbError } = await supabase.from('debtors').update({
      full_name: form.full_name, phone: form.phone || null, address: form.address || null,
      employer: form.employer || null, id_number: form.id_number || null,
      receipt_type: form.receipt_type, receipt_number: form.receipt_number || null,
      receipt_amount: parseFloat(form.receipt_amount) || 0,
      remaining_amount: parseFloat(form.remaining_amount) || 0,
      lawyer_fees: parseFloat(form.lawyer_fees) || 0,
      penalty_amount: form.has_contract ? (parseFloat(form.penalty_amount) || 0) : 0,
      notes: form.notes || null,
    }).eq('id', id)
    if (dbError) { setError(dbError.message); setSaving(false); return }
    await logActivity({ action: 'update_debtor', entity_type: 'debtor', entity_id: id, description: `تعديل بيانات المدين: ${form.full_name}` }, supabase)
    if (pdfFile) {
      const safeFileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
      const filePath = `${id}/${safeFileName}`
      const { error: uploadError } = await supabase.storage.from('debtor-files').upload(filePath, pdfFile, { contentType: 'application/pdf' })
      if (uploadError) { setError(`تم حفظ البيانات لكن فشل رفع الملف: ${uploadError.message}`); setSaving(false); return }
      await supabase.from('debtor_attachments').insert({ debtor_id: id, file_name: pdfFile.name, file_path: filePath, file_size: pdfFile.size, mime_type: pdfFile.type, uploaded_by: user.id })
    }
    router.push('/admin/debtors')
  }

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-20">
      <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
    </div>
  )

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="تعديل بيانات المدين"
        subtitle={createdAt ? `تاريخ الإضافة: ${fmtDate(createdAt)}` : undefined}
        breadcrumb={[{ label: 'المدينون', href: '/admin/debtors' }, { label: 'تعديل' }]}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader title="البيانات الشخصية" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} required className={INP} />
            </Field>
            <Field label="رقم الهاتف">
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="رقم الهوية">
              <input type="text" value={form.id_number} onChange={e => set('id_number', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="جهة العمل">
              <input type="text" value={form.employer} onChange={e => set('employer', e.target.value)} className={INP} />
            </Field>
            <div className="md:col-span-2">
              <Field label="العنوان">
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)} className={INP} />
              </Field>
            </div>
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
            <Field label="رقم الصك">
              <input type="text" value={form.receipt_number} onChange={e => set('receipt_number', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="المبلغ الأصلي (د.ع)">
              <input type="number" value={form.receipt_amount} onChange={e => set('receipt_amount', e.target.value)} className={INP} min="0" step="any" dir="ltr" />
            </Field>
            <Field label="المبلغ المتبقي (د.ع)">
              <input type="number" value={form.remaining_amount} onChange={e => set('remaining_amount', e.target.value)} className={INP} min="0" step="any" dir="ltr" />
            </Field>
            <Field label="أتعاب المحامي (د.ع)">
              <input type="number" value={form.lawyer_fees} onChange={e => set('lawyer_fees', e.target.value)} className={INP} min="0" step="any" dir="ltr" />
            </Field>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" id="has_contract" checked={form.has_contract}
                  onChange={e => { set('has_contract', e.target.checked); if (!e.target.checked) set('penalty_amount', '0') }}
                  className="w-4 h-4 rounded accent-[#2C8780]" />
                <span className="text-sm font-semibold text-[#231F20]">يوجد عقد موقّع</span>
              </label>
            </div>
            {form.has_contract && (
              <Field label="الشرط الجزائي (د.ع)">
                <input type="number" value={form.penalty_amount} onChange={e => set('penalty_amount', e.target.value)} className={INP} min="0" step="any" dir="ltr" />
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="ملف المدين" />
          <div className="p-5 space-y-4">
            {attachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#767676] mb-1">الملفات الحالية:</p>
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 bg-[rgba(118,118,118,0.04)] rounded-lg px-3 py-2.5 border border-[rgba(118,118,118,0.1)]">
                    <svg className="w-4 h-4 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 15v-4H9l3-5 3 5h-2v4h-2z" /></svg>
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
            <Field label="رفع ملف PDF جديد (اختياري)">
              <input type="file" accept="application/pdf" onChange={handleFileChange}
                className="w-full text-sm text-[#231F20] file:ml-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#2C8780]/8 file:text-[#2C8780] hover:file:bg-[#2C8780]/15 cursor-pointer" />
              {pdfFile && <p className="text-xs text-emerald-700 mt-1.5 font-semibold">✓ {pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="ملاحظات" />
          <div className="p-5">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={`${INP} resize-none`} placeholder="ملاحظات إضافية..." />
          </div>
        </Card>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving}>حفظ التعديلات</Button>
          <Link href="/admin/debtors"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>
    </div>
  )
}