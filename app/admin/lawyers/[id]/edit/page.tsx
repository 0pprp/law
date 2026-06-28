'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { USER_ROLE_LABELS } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { fmtDate } from '@/lib/utils'
import { useBranchId, useBranch } from '@/context/branch'
import { PremiumSelect } from '@/components/ui/premium-select'

const ROLES: UserRole[] = ['admin', 'employee', 'accountant', 'lawyer', 'viewer']
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

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Attachment { id: string; file_name: string; file_path: string; file_size: number | null; mime_type: string | null; description: string | null; created_at: string }

export default function EditLawyerPage() {
  const router = useRouter()
  const params = useParams()
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const id = params.id as string
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [uploadDesc, setUploadDesc] = useState('')

  const [form, setForm] = useState({
    username: '', full_name: '', phone: '', governorate: '',
    identity_type: '', identity_number: '', identity_category: '',
    role: 'lawyer' as UserRole, is_active: true,
  })
  const [profileBranchId, setProfileBranchId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data }, { data: files }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('lawyer_attachments').select('*').eq('lawyer_id', id).order('created_at', { ascending: false }),
      ])
      if (data) {
        setProfileBranchId(data.branch_id ?? null)
        setForm({ username: data.username ?? '', full_name: data.full_name ?? '', phone: data.phone ?? '', governorate: data.governorate ?? '', identity_type: data.identity_type ?? '', identity_number: data.identity_number ?? '', identity_category: data.identity_category ?? '', role: data.role ?? 'lawyer', is_active: data.is_active ?? true })
      }
      setAttachments(files ?? [])
      setLoading(false)
    }
    load()
  }, [id])

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setSaving(true); setError('')
    const cleanUsername = form.username.trim().toLowerCase()
    if (cleanUsername && !/^[a-z0-9._]{3,50}$/.test(cleanUsername)) {
      setError('اسم المستخدم: أحرف إنجليزية صغيرة وأرقام ونقطة وشرطة سفلية فقط (3-50 حرفاً)')
      setSaving(false); return
    }
    const supabase = createClient()
    const updatePayload: Record<string, unknown> = {
      username: cleanUsername || null, full_name: form.full_name, phone: form.phone || null,
      governorate: form.governorate || null, identity_type: form.identity_type || null,
      identity_number: form.identity_number || null, identity_category: form.identity_category || null,
      role: form.role, is_active: form.is_active,
    }
    if (!profileBranchId && branchId) updatePayload.branch_id = branchId

    const { error: dbError } = await supabase.from('profiles').update(updatePayload).eq('id', id)
    if (dbError) {
      setError(dbError.code === '23505' ? 'اسم المستخدم مستخدم مسبقاً — يرجى اختيار اسم آخر' : dbError.message)
      setSaving(false); return
    }
    await logActivity({ action: 'update_lawyer_identity', entity_type: 'lawyer', entity_id: id, description: `تحديث بيانات المحامي: ${form.full_name}` }, supabase)
    router.push('/admin/lawyers')
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    const supabase = createClient()
    const ext = file.name.split('.').pop() ?? 'bin'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const filePath = `${id}/${safeName}`
    const { error: uploadErr } = await supabase.storage.from('lawyer-files').upload(filePath, file, { contentType: file.type })
    if (uploadErr) { setError(`فشل رفع الملف: ${uploadErr.message}`); setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; return }
    const { data: newRow } = await supabase.from('lawyer_attachments').insert({ lawyer_id: id, file_name: file.name, file_path: filePath, file_size: file.size, mime_type: file.type, description: uploadDesc || null }).select().single()
    await logActivity({ action: 'upload_lawyer_file', entity_type: 'lawyer', entity_id: id, description: `رفع مستمسك محامي: ${file.name}` }, supabase)
    if (newRow) setAttachments(prev => [newRow as Attachment, ...prev])
    setUploadDesc(''); setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function openFile(att: Attachment) {
    setOpeningId(att.id)
    try {
      const res = await fetch('/api/admin/lawyer-file-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: att.file_path }) })
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch { alert('فشل في فتح الملف') }
    finally { setOpeningId(null) }
  }

  async function deleteFile(att: Attachment) {
    if (!confirm(`هل تريد حذف هذا الملف؟\n"${att.file_name}"`)) return
    setDeletingId(att.id)
    try {
      const res = await fetch('/api/admin/delete-lawyer-file', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: att.id, filePath: att.file_path, fileName: att.file_name }) })
      if (!res.ok) { const { error: err } = await res.json(); setError(`فشل حذف الملف: ${err ?? 'خطأ غير معروف'}`) }
      else setAttachments(prev => prev.filter(a => a.id !== att.id))
    } catch { setError('حدث خطأ أثناء حذف الملف') }
    finally { setDeletingId(null) }
  }

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-20">
      <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      <p className="text-sm text-slate-400">جارٍ التحميل...</p>
    </div>
  )

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="تعديل بيانات المستخدم"
        breadcrumb={[{ label: 'المستخدمون', href: '/admin/lawyers' }, { label: 'تعديل' }]}
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader title="البيانات الأساسية" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} required className={INP} />
            </Field>
            <Field label="اسم المستخدم">
              <input type="text" value={form.username}
                onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                minLength={3} maxLength={50} className={INP} dir="ltr" placeholder="مثال: ali_lawyer" />
              {!form.username && <p className="text-xs text-[#2C8780] mt-1 font-semibold">⚠ لا يوجد اسم مستخدم — لن يتمكن المستخدم من الدخول</p>}
            </Field>
            <Field label="رقم الهاتف">
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <PremiumSelect
              value={form.role}
              onChange={v => set('role', v)}
              options={ROLES.map(r => ({ value: r, label: USER_ROLE_LABELS[r] }))}
              fieldLabel="الدور"
              headerTitle="اختر الدور"
              searchable={false}
            />
            <div className="flex items-center gap-2.5">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="w-4 h-4 rounded accent-[#2C8780]" />
              <label htmlFor="is_active" className="text-sm font-semibold text-slate-700 select-none cursor-pointer">الحساب فعال</label>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="بيانات الهوية" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {form.role === 'lawyer' ? (
              <Field label="الفرع / المحافظة">
                <input type="text" value={form.governorate || branchName || '—'} readOnly className={`${INP} bg-slate-50 text-slate-600`} />
              </Field>
            ) : (
              <Field label="المحافظة">
                <input type="text" value={form.governorate} onChange={e => set('governorate', e.target.value)} className={INP} placeholder="مثال: بغداد" />
              </Field>
            )}
            <Field label="نوع الهوية">
              <input type="text" value={form.identity_type} onChange={e => set('identity_type', e.target.value)} className={INP} placeholder="جواز / هوية وطنية / نقابة" />
            </Field>
            <Field label="رقم الهوية">
              <input type="text" value={form.identity_number} onChange={e => set('identity_number', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <Field label="فئة الهوية">
              <input type="text" value={form.identity_category} onChange={e => set('identity_category', e.target.value)} className={INP} placeholder="محامي مرافع / مستشار..." />
            </Field>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" variant="primary" loading={saving}>حفظ التعديلات</Button>
          <Link href="/admin/lawyers"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>

      {/* Attachments */}
      <Card>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">مستمسكات المحامي ({attachments.length})</h3>
          <label className="cursor-pointer">
            <input ref={fileInputRef} type="file" accept="application/pdf,image/*" onChange={handleFileUpload} disabled={uploading} className="hidden" />
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${uploading ? 'bg-slate-100 text-slate-400' : 'bg-[#2C8780] hover:bg-[#1D6365] text-white cursor-pointer'}`}>
              {uploading ? 'جارٍ الرفع...' : '+ رفع مستمسك'}
            </span>
          </label>
        </div>
        <div className="px-5 pt-4 pb-3">
          <input type="text" value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
            placeholder="وصف الملف القادم (اختياري) — هوية، نقابة، وكالة..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 bg-white" />
        </div>
        {attachments.length === 0 ? (
          <div className="pb-8 text-center text-slate-400 text-sm">لا توجد مستمسكات مرفوعة بعد</div>
        ) : (
          <div className="divide-y divide-slate-100 pb-2">
            {attachments.map(att => (
              <div key={att.id} className="flex items-center gap-3 px-5 py-3">
                <span className="text-xl shrink-0">{att.mime_type === 'application/pdf' ? '📄' : '🖼️'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{att.file_name}</p>
                  <p className="text-xs text-slate-400">
                    {[att.description, formatSize(att.file_size), fmtDate(att.created_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => openFile(att)} disabled={openingId === att.id}
                  className="text-xs text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0">
                  {openingId === att.id ? '...' : 'فتح'}
                </button>
                <button onClick={() => deleteFile(att)} disabled={deletingId === att.id}
                  className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0">
                  {deletingId === att.id ? '...' : 'حذف'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}