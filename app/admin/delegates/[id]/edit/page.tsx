'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useAdminRole } from '@/context/admin-role'
import { canManageDelegates } from '@/lib/permissions'

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

export default function EditDelegatePage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const role = useAdminRole()
  const canEdit = canManageDelegates(role)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    username: '',
    temporary_password: '',
    phone: '',
    is_active: true,
  })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('profiles')
        .select('full_name, username, phone, is_active, role')
        .eq('id', id)
        .maybeSingle()
      if (!data || data.role !== 'delegate') {
        setError('المندوب غير موجود')
        setLoading(false)
        return
      }
      setForm({
        full_name: data.full_name ?? '',
        username: data.username ?? '',
        temporary_password: '',
        phone: data.phone ?? '',
        is_active: data.is_active !== false,
      })
      setLoading(false)
    }
    void load()
  }, [id])

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!canEdit) return
    setSaving(true)
    setError('')

    const res = await fetch('/api/admin/delegates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegateId: id,
        full_name: form.full_name,
        username: form.username.trim().toLowerCase(),
        phone: form.phone.trim(),
        is_active: form.is_active,
        temporary_password: form.temporary_password.trim() || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'حدث خطأ غير متوقع')
      setSaving(false)
      return
    }

    await logActivity({
      action: 'update_delegate',
      entity_type: 'profile',
      entity_id: id,
      description: `تعديل مندوب: ${form.full_name}`,
    }, createClient())

    router.push('/admin/delegates')
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="تعديل مندوب"
        breadcrumb={[
          { label: 'المندوبون', href: '/admin/delegates' },
          { label: 'تعديل' },
        ]}
      />

      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          لا تملك صلاحية تعديل المندوبين.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset disabled={!canEdit} className="space-y-5 border-0 p-0 m-0 min-w-0">
          <Card>
            <CardHeader title="بيانات المندوب" />
            <div className="p-4 space-y-4">
              <Field label="الاسم الكامل" required>
                <input className={INP} value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
              </Field>
              <Field label="اسم المستخدم" required hint="أحرف إنجليزية وأرقام فقط">
                <input className={INP} value={form.username} onChange={e => set('username', e.target.value)} required dir="ltr" />
              </Field>
              <Field label="رقم الهاتف" required>
                <input className={INP} value={form.phone} onChange={e => set('phone', e.target.value)} required dir="ltr" />
              </Field>
              <Field label="كلمة مرور جديدة" hint="اتركها فارغة للإبقاء على كلمة المرور الحالية">
                <input
                  type="password"
                  className={INP}
                  value={form.temporary_password}
                  onChange={e => set('temporary_password', e.target.value)}
                  dir="ltr"
                  autoComplete="new-password"
                />
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => set('is_active', e.target.checked)}
                  className="w-4 h-4 accent-[#2C8780]"
                />
                <span className="text-sm font-semibold text-slate-700">الحساب نشط</span>
              </label>
            </div>
          </Card>
        </fieldset>

        <div className="flex gap-3">
          <Link href="/admin/delegates" className="flex-1">
            <Button type="button" variant="outline" className="w-full">إلغاء</Button>
          </Link>
          {canEdit && (
            <Button type="submit" variant="primary" loading={saving} className="flex-1">حفظ التعديلات</Button>
          )}
        </div>
      </form>
    </div>
  )
}
