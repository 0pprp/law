'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useBranchId, useBranch } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canManageDelegates } from '@/lib/permissions'
import { isMainBranchName } from '@/lib/branch-constants'

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

export default function NewDelegatePage() {
  const router = useRouter()
  const branchId = useBranchId()
  const { branchName } = useBranch()
  const role = useAdminRole()
  const canCreate = canManageDelegates(role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    username: '',
    temporary_password: '',
    phone: '',
    is_active: true,
  })

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!canCreate) return
    if (!branchId || isMainBranchName(branchName)) {
      setError('يجب اختيار فرعاً رسمياً من القائمة العلوية قبل إضافة مندوب')
      return
    }
    if (!form.phone.trim()) {
      setError('رقم الهاتف مطلوب')
      return
    }
    setSaving(true)
    setError('')

    const res = await fetch('/api/admin/delegates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name,
        username: form.username.trim().toLowerCase(),
        temporary_password: form.temporary_password,
        phone: form.phone.trim(),
        is_active: form.is_active,
        branch_id: branchId,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'حدث خطأ غير متوقع')
      setSaving(false)
      return
    }

    await logActivity({
      action: 'create_delegate',
      entity_type: 'profile',
      entity_id: data.delegateId,
      description: `إنشاء مندوب: ${form.full_name}`,
    }, createClient())

    router.push('/admin/delegates')
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="إضافة مندوب جديد"
        breadcrumb={[
          { label: 'المندوبون', href: '/admin/delegates' },
          { label: 'مندوب جديد' },
        ]}
      />

      {!canCreate && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          عرض البيانات فقط — لا تملك صلاحية إضافة مندوبين.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {branchId && branchName && !isMainBranchName(branchName) ? (
          <p className="text-xs text-[#767676] bg-[#F3F1F2] rounded-lg px-3 py-2">
            الفرع / المحافظة: <span className="font-bold text-[#231F20]">{branchName}</span>
            <span className="block mt-1 text-[#2C8780]">المندوب يُكلَّف فقط بمهام إيجاد العنوان في هذا الفرع.</span>
          </p>
        ) : (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
            اختر فرعاً من القائمة العلوية قبل إضافة مندوب.
          </div>
        )}

        <Card>
          <CardHeader title="بيانات الحساب" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <input
                type="text"
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
                required
                className={INP}
                placeholder="اسم المندوب الكامل"
              />
            </Field>
            <Field label="اسم المستخدم" required hint="أحرف إنجليزية صغيرة، أرقام، نقطة، شرطة سفلية فقط">
              <input
                type="text"
                value={form.username}
                onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                required
                minLength={3}
                maxLength={50}
                pattern="[a-z0-9._]{3,50}"
                className={INP}
                dir="ltr"
                placeholder="مثال: ali_delegate"
              />
            </Field>
            <Field label="كلمة المرور" required hint="6 أحرف على الأقل">
              <input
                type="text"
                value={form.temporary_password}
                onChange={e => set('temporary_password', e.target.value)}
                required
                minLength={6}
                className={INP}
                dir="ltr"
              />
            </Field>
            <Field label="رقم الهاتف" required>
              <input
                type="tel"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                required
                className={INP}
                dir="ltr"
                placeholder="+964..."
              />
            </Field>
            <div className="flex items-center gap-2.5 pt-6">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 rounded accent-[#2C8780]"
              />
              <label htmlFor="is_active" className="text-sm font-semibold text-slate-700 select-none cursor-pointer">
                الحساب فعال
              </label>
            </div>
          </div>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 whitespace-pre-line">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving} disabled={!canCreate}>
            إنشاء الحساب
          </Button>
          <Link href="/admin/delegates">
            <Button type="button" variant="outline">إلغاء</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
