'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

function Field({ label, required: req, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}{req && <span className="text-red-500 mr-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

interface PendingFile { file: File; description: string }

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function NewLawyerPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])

  const [form, setForm] = useState({
    full_name: '', username: '', email: '', temporary_password: '',
    phone: '', governorate: '', identity_type: '', identity_number: '', identity_category: '', is_active: true,
  })

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    setPendingFiles(prev => [...prev, ...selected.map(f => ({ file: f, description: '' }))])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(idx: number) { setPendingFiles(prev => prev.filter((_, i) => i !== idx)) }
  function setFileDesc(idx: number, desc: string) { setPendingFiles(prev => prev.map((pf, i) => i === idx ? { ...pf, description: desc } : pf)) }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await fetch('/api/admin/lawyers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name,
        username: form.username.trim().toLowerCase(),
        email: form.email,
        temporary_password: form.temporary_password,
        phone: form.phone, is_active: form.is_active,
        governorate: form.governorate, identity_type: form.identity_type,
        identity_number: form.identity_number, identity_category: form.identity_category,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'حدث خطأ غير متوقع'); setSaving(false); return }
    const lawyerId: string = data.lawyerId
    if (pendingFiles.length > 0) {
      const supabase = createClient()
      for (const { file, description } of pendingFiles) {
        const ext = file.name.split('.').pop() ?? 'bin'
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const filePath = `${lawyerId}/${safeName}`
        const { error: uploadErr } = await supabase.storage.from('lawyer-files').upload(filePath, file, { contentType: file.type })
        if (uploadErr) { setError(`تم إنشاء الحساب لكن فشل رفع "${file.name}": ${uploadErr.message}`); setSaving(false); return }
        await supabase.from('lawyer_attachments').insert({ lawyer_id: lawyerId, file_name: file.name, file_path: filePath, file_size: file.size, mime_type: file.type, description: description || null })
        await logActivity({ action: 'upload_lawyer_file', entity_type: 'lawyer', entity_id: lawyerId, description: `رفع مستمسك محامي: ${file.name}` }, supabase)
      }
    }
    router.push('/admin/lawyers')
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="إضافة محامي جديد"
        breadcrumb={[{ label: 'المستخدمون', href: '/admin/lawyers' }, { label: 'محامي جديد' }]}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader title="بيانات الحساب" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} required className={INP} placeholder="اسم المحامي الكامل" />
            </Field>
            <Field label="اسم المستخدم" required hint="أحرف إنجليزية صغيرة، أرقام، نقطة، شرطة سفلية فقط">
              <input type="text" value={form.username}
                onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                required minLength={3} maxLength={50} pattern="[a-z0-9._]{3,50}" className={INP} dir="ltr" placeholder="مثال: ali_lawyer" />
            </Field>
            <Field label="البريد الإلكتروني" required>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required className={INP} dir="ltr" placeholder="lawyer@example.com" />
            </Field>
            <Field label="كلمة المرور المؤقتة" required hint="6 أحرف على الأقل">
              <input type="text" value={form.temporary_password} onChange={e => set('temporary_password', e.target.value)} required minLength={6} className={INP} dir="ltr" />
            </Field>
            <Field label="رقم الهاتف">
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={INP} dir="ltr" placeholder="+964..." />
            </Field>
            <div className="flex items-center gap-2.5 pt-6">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="w-4 h-4 rounded accent-[#2C8780]" />
              <label htmlFor="is_active" className="text-sm font-semibold text-slate-700 select-none cursor-pointer">الحساب فعال</label>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="بيانات الهوية" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="المحافظة">
              <input type="text" value={form.governorate} onChange={e => set('governorate', e.target.value)} className={INP} placeholder="مثال: بغداد" />
            </Field>
            <Field label="نوع الهوية">
              <input type="text" value={form.identity_type} onChange={e => set('identity_type', e.target.value)} className={INP} placeholder="جواز / هوية وطنية / نقابة" />
            </Field>
            <Field label="رقم الهوية">
              <input type="text" value={form.identity_number} onChange={e => set('identity_number', e.target.value)} className={INP} dir="ltr" placeholder="رقم الهوية أو الإجازة" />
            </Field>
            <Field label="فئة الهوية">
              <input type="text" value={form.identity_category} onChange={e => set('identity_category', e.target.value)} className={INP} placeholder="محامي مرافع / مستشار..." />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">مستمسكات المحامي</h3>
            <label className="cursor-pointer">
              <input ref={fileInputRef} type="file" multiple accept="application/pdf,image/*" onChange={handleFileSelect} className="hidden" />
              <span className="text-xs font-semibold bg-[#2C8780] hover:bg-[#1D6365] text-white px-3 py-1.5 rounded-lg transition-colors">+ إضافة ملف</span>
            </label>
          </div>
          <div className="p-5">
            <p className="text-xs text-slate-400 mb-3">PDF أو صور — هوية المحامي، نقابة المحامين، وكالة، مستمسكات أخرى</p>
            {pendingFiles.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">لم يُختر أي ملف بعد</p>
            ) : (
              <div className="space-y-2">
                {pendingFiles.map((pf, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2.5">
                    <span className="text-base shrink-0">{pf.file.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{pf.file.name}</p>
                      <p className="text-xs text-slate-400">{formatSize(pf.file.size)}</p>
                    </div>
                    <input type="text" value={pf.description} onChange={e => setFileDesc(idx, e.target.value)}
                      placeholder="وصف (اختياري)" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-[#EA7300]/30 bg-white" />
                    <button type="button" onClick={() => removeFile(idx)} className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 px-1">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving}>إنشاء الحساب</Button>
          <Link href="/admin/lawyers"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>
    </div>
  )
}