'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useBranchId, useBranch } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canCreateLawyerUser, isLegalManager } from '@/lib/permissions'
import { isMainBranchName } from '@/lib/branch-constants'
import { USER_ROLE_LABELS } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import { PremiumSelect } from '@/components/ui/premium-select'
import { LAWYER_TYPE_OPTIONS } from '@/lib/lawyer-type'
import { uploadLawyerAttachment } from '@/lib/lawyer-attachments'

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

const ALL_ROLE_OPTIONS = [
  { value: 'lawyer', label: USER_ROLE_LABELS.lawyer },
  { value: 'accountant', label: USER_ROLE_LABELS.accountant },
  { value: 'viewer', label: USER_ROLE_LABELS.viewer },
]

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
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const role = useAdminRole()
  const readOnly = !canCreateLawyerUser(role)
  const legalOfficerMode = isLegalManager(role)
  const roleOptions = legalOfficerMode
    ? [{ value: 'lawyer', label: USER_ROLE_LABELS.lawyer }]
    : ALL_ROLE_OPTIONS
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [userRole, setUserRole] = useState<'lawyer' | 'accountant' | 'viewer'>('lawyer')

  const [form, setForm] = useState({
    full_name: '', username: '', temporary_password: '',
    phone: '', identity_number: '', identity_category: '', is_active: true,
    lawyer_type: 'normal' as 'normal' | 'general',
  })

  const isLawyer = userRole === 'lawyer'
  const isViewerRole = userRole === 'viewer'

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
    if (readOnly) return
    if (!branchId || isMainBranchName(branchName)) {
      setError('يجب اختيار فرعاً رسمياً من القائمة العلوية قبل إضافة مستخدم')
      return
    }
    if (!form.phone.trim()) {
      setError('رقم الهاتف مطلوب')
      return
    }
    if (isLawyer) {
      if (!form.identity_number.trim()) {
        setError('رقم الهوية مطلوب')
        return
      }
      if (!form.identity_category.trim()) {
        setError('فئة الهوية مطلوبة')
        return
      }
      if (pendingFiles.length === 0) {
        setError('يجب إرفاق مستمسك واحد على الأقل')
        return
      }
    }
    setSaving(true); setError('')
    const res = await fetch('/api/admin/lawyers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name,
        username: form.username.trim().toLowerCase(),
        temporary_password: form.temporary_password,
        phone: form.phone.trim(),
        is_active: form.is_active,
        identity_number: isLawyer ? form.identity_number.trim() : undefined,
        identity_category: isLawyer ? form.identity_category.trim() : undefined,
        lawyer_type: isLawyer ? form.lawyer_type : undefined,
        branch_id: branchId,
        role: userRole,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'حدث خطأ غير متوقع'); setSaving(false); return }
    const userId: string = data.lawyerId
    if (isLawyer && pendingFiles.length > 0) {
      const uploadFailures: string[] = []
      for (const { file, description } of pendingFiles) {
        const result = await uploadLawyerAttachment(userId, file, description)
        if (!result.ok) uploadFailures.push(`${file.name}: ${result.error}`)
      }
      if (uploadFailures.length > 0) {
        setError(`تم إنشاء الحساب لكن فشل رفع بعض المستمسكات:\n${uploadFailures.join('\n')}`)
        setSaving(false)
        return
      }
    }
    await logActivity({
      action: userRole === 'accountant' ? 'create_accountant' : userRole === 'viewer' ? 'create_viewer' : 'create_lawyer',
      entity_type: 'profile',
      entity_id: userId,
      description: `إنشاء مستخدم (${USER_ROLE_LABELS[userRole as UserRole]}): ${form.full_name}`,
    }, createClient())
    router.push('/admin/lawyers')
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title={legalOfficerMode ? 'إضافة محامي جديد' : 'إضافة مستخدم جديد'}
        breadcrumb={[{ label: 'المستخدمون', href: '/admin/lawyers' }, { label: legalOfficerMode ? 'محامي جديد' : 'مستخدم جديد' }]}
      />

      {readOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          عرض البيانات فقط — لا تملك صلاحية إضافة مستخدمين.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {branchId && branchName && !isMainBranchName(branchName) ? (
          <p className="text-xs text-[#767676] bg-[#F3F1F2] rounded-lg px-3 py-2">
            الفرع / المحافظة: <span className="font-bold text-[#231F20]">{branchName}</span>
            {legalOfficerMode && (
              <span className="block mt-1 text-[#2C8780]">مسؤول القانونية يطلع على كل الفروع — يمكنه إضافة محامين فقط.</span>
            )}
            {userRole === 'accountant' && !legalOfficerMode && (
              <span className="block mt-1 text-[#2C8780]">سيُربط المحاسب تلقائياً بهذا الفرع فقط.</span>
            )}
            {isViewerRole && !legalOfficerMode && (
              <span className="block mt-1 text-[#2C8780]">مسؤول القانونية يطلع على كل الفروع — تكليف ومراجعة إنجازات بدون إعدادات أو حذف.</span>
            )}
          </p>
        ) : (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
            اختر فرعاً من القائمة العلوية قبل إضافة مستخدم.
          </div>
        )}

        <Card>
          <CardHeader title="نوع الحساب" />
          <div className="p-5">
            <Field label="الدور" required>
              <PremiumSelect
                value={userRole}
                onChange={v => setUserRole(v as 'lawyer' | 'accountant' | 'viewer')}
                options={roleOptions}
                disabled={legalOfficerMode}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="بيانات الحساب" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} required className={INP} placeholder={isLawyer ? 'اسم المحامي الكامل' : isViewerRole ? 'اسم مسؤول القانونية الكامل' : 'اسم المحاسب الكامل'} />
            </Field>
            <Field label="اسم المستخدم" required hint="أحرف إنجليزية صغيرة، أرقام، نقطة، شرطة سفلية فقط — يُستخدم لتسجيل الدخول">
              <input type="text" value={form.username}
                onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                required minLength={3} maxLength={50} pattern="[a-z0-9._]{3,50}" className={INP} dir="ltr" placeholder="مثال: ali_user" />
            </Field>
            <Field label="كلمة المرور" required hint="6 أحرف على الأقل">
              <input type="text" value={form.temporary_password} onChange={e => set('temporary_password', e.target.value)} required minLength={6} className={INP} dir="ltr" />
            </Field>
            <Field label="رقم الهاتف" required>
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} required className={INP} dir="ltr" placeholder="+964..." />
            </Field>
            <div className="flex items-center gap-2.5 pt-6">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="w-4 h-4 rounded accent-[#2C8780]" />
              <label htmlFor="is_active" className="text-sm font-semibold text-slate-700 select-none cursor-pointer">الحساب فعال</label>
            </div>
          </div>
        </Card>

        {isLawyer && (
          <>
            <Card>
              <CardHeader title="بيانات الهوية" />
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="نوع المحامي" required>
                  <PremiumSelect
                    value={form.lawyer_type}
                    onChange={v => set('lawyer_type', v)}
                    options={LAWYER_TYPE_OPTIONS}
                  />
                </Field>
                <Field label="رقم الهوية" required>
                  <input type="text" value={form.identity_number} onChange={e => set('identity_number', e.target.value)} required className={INP} dir="ltr" placeholder="رقم الهوية أو الإجازة" />
                </Field>
                <Field label="فئة الهوية" required>
                  <input type="text" value={form.identity_category} onChange={e => set('identity_category', e.target.value)} required className={INP} placeholder="محامي مرافع / مستشار..." />
                </Field>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">
                  مستمسكات المحامي <span className="text-red-500">*</span>
                </h3>
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
          </>
        )}

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving} disabled={readOnly}>إنشاء الحساب</Button>
          <Link href="/admin/lawyers"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>
    </div>
  )
}
