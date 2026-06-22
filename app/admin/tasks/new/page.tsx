'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS, RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { TaskType, TaskStatus } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { fmtMoney } from '@/lib/utils'

const ALL_TASK_TYPES: TaskType[] = [
  'file_lawsuit', 'notification', 'pleading', 'decision_ratification',
  'open_file', 'summons', 'inspection', 'forced_appearance',
  'arrest_warrant', 'arrest_warrant_broadcast', 'imprisonment_in_absentia',
  'imprisonment_broadcast', 'department_correspondence', 'newspaper_publication',
  'salary_seizure', 'first_registration', 'file_closure',
]
const ALL_TASK_STATUSES: TaskStatus[] = ['new', 'in_progress', 'completed', 'failed', 'postponed', 'needs_info', 'closed']

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

export default function NewTaskPage() {
  const router = useRouter()
  const [debtors, setDebtors] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [selectedDebtor, setSelectedDebtor] = useState<any>(null)
  const [showAllLawyers, setShowAllLawyers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    debtor_id: '',
    assigned_to: '',
    task_type: '' as TaskType | '',
    task_status: 'new' as TaskStatus,
    governorate: '',
    court_name: '',
    due_date: '',
    admin_notes: '',
  })

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('debtors').select('id, full_name, phone, governorate, receipt_type, receipt_number, remaining_amount, required_amount, has_contract').order('full_name'),
      supabase.from('profiles').select('id, full_name, phone, governorate').eq('role', 'lawyer').eq('is_active', true).order('full_name'),
    ]).then(([{ data: d }, { data: l }]) => { setDebtors(d ?? []); setLawyers(l ?? []) })
  }, [])

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  function handleDebtorChange(id: string) {
    const debtor = debtors.find(d => d.id === id) ?? null
    setSelectedDebtor(debtor)
    setForm(prev => ({ ...prev, debtor_id: id, governorate: debtor?.governorate ?? '', assigned_to: '' }))
  }

  const filteredLawyers = useMemo(() => {
    if (!selectedDebtor || showAllLawyers || !selectedDebtor.governorate) return lawyers
    return lawyers.filter(l => l.governorate === selectedDebtor.governorate)
  }, [lawyers, selectedDebtor, showAllLawyers])

  const showLawyerEmptyState = selectedDebtor && selectedDebtor.governorate && !showAllLawyers && filteredLawyers.length === 0

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!form.debtor_id || !form.task_type) { setError('يرجى اختيار المدين ونوع المهمة'); return }
    setSaving(true); setError('')
    const supabase = createClient()
    const { data: newTask, error: dbError } = await supabase.from('tasks').insert({
      debtor_id: form.debtor_id,
      assigned_to: form.assigned_to || null,
      task_type: form.task_type,
      task_status: form.task_status,
      governorate: form.governorate || null,
      court_name: form.court_name || null,
      due_date: form.due_date || null,
      admin_notes: form.admin_notes || null,
      case_id: null,
    }).select('id').single()
    if (dbError) { setError(dbError.message); setSaving(false); return }
    await logActivity({ action: 'assign_task', entity_type: 'task', entity_id: newTask?.id, description: `تكليف مهمة: ${TASK_TYPE_LABELS[form.task_type as TaskType]}` }, supabase)
    router.push('/admin/tasks')
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="تكليف مهمة جديدة"
        breadcrumb={[{ label: 'المهام', href: '/admin/tasks' }, { label: 'مهمة جديدة' }]}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader title="المدين / الزبون" />
          <div className="p-5 space-y-4">
            <Field label="اختر المدين" required>
              <select value={form.debtor_id} onChange={e => handleDebtorChange(e.target.value)} className={INP} required>
                <option value="">-- اختر المدين --</option>
                {debtors.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}{d.governorate ? ` | ${d.governorate}` : ''}{d.receipt_number ? ` | ${d.receipt_number}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {selectedDebtor && (
              <div className="bg-[#2C8780]/5 border border-[#2C8780]/20 rounded-xl p-4">
                <p className="font-bold text-[#231F20] mb-3">{selectedDebtor.full_name}</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {selectedDebtor.phone && <><span className="text-[#767676]">الهاتف</span><span className="font-mono" dir="ltr">{selectedDebtor.phone}</span></>}
                  {selectedDebtor.governorate && <><span className="text-[#767676]">المحافظة</span><span>{selectedDebtor.governorate}</span></>}
                  <span className="text-[#767676]">نوع الوثيقة</span><span>{RECEIPT_TYPE_LABELS[selectedDebtor.receipt_type as keyof typeof RECEIPT_TYPE_LABELS] ?? selectedDebtor.receipt_type}</span>
                  {selectedDebtor.receipt_number && <><span className="text-[#767676]">رقم الوثيقة</span><span className="font-mono" dir="ltr">{selectedDebtor.receipt_number}</span></>}
                  <span className="text-[#767676]">المبلغ المتبقي</span><span className="font-bold text-red-600" dir="ltr">{fmtMoney(selectedDebtor.remaining_amount)}</span>
                  <span className="text-[#767676]">المبلغ المطلوب</span><span className="font-bold text-[#2C8780]" dir="ltr">{fmtMoney(selectedDebtor.required_amount)}</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="المحامي المكلف" />
          <div className="p-5 space-y-4">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" id="showAll" checked={showAllLawyers}
                onChange={e => { setShowAllLawyers(e.target.checked); set('assigned_to', '') }}
                className="w-4 h-4 rounded accent-[#2C8780]" />
              <span className="text-sm font-medium text-[#231F20]">عرض كل المحامين (بغض النظر عن المحافظة)</span>
            </label>
            {showLawyerEmptyState ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
                لا يوجد محامٍ فعال في محافظة المدين. فعّل خيار عرض كل المحامين أو أضف محامياً لهذه المحافظة.
              </div>
            ) : (
              <Field label="المحامي">
                <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} className={INP}>
                  <option value="">-- بدون تكليف --</option>
                  {filteredLawyers.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.full_name}{l.governorate ? ` | ${l.governorate}` : ''}{l.phone ? ` | ${l.phone}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="تفاصيل المهمة" />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="نوع المهمة" required>
              <select value={form.task_type} onChange={e => set('task_type', e.target.value)} className={INP} required>
                <option value="">-- اختر النوع --</option>
                {ALL_TASK_TYPES.map(t => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="حالة المهمة">
              <select value={form.task_status} onChange={e => set('task_status', e.target.value as TaskStatus)} className={INP}>
                {ALL_TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="محافظة المهمة">
              <input type="text" value={form.governorate} onChange={e => set('governorate', e.target.value)} className={INP} placeholder="تُملأ تلقائياً من المدين" />
            </Field>
            <Field label="اسم المحكمة">
              <input type="text" value={form.court_name} onChange={e => set('court_name', e.target.value)} className={INP} placeholder="مثال: محكمة بداءة بغداد" />
            </Field>
            <Field label="تاريخ الاستحقاق">
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={INP} dir="ltr" />
            </Field>
            <div className="md:col-span-2">
              <Field label="ملاحظات الإدارة">
                <textarea value={form.admin_notes} onChange={e => set('admin_notes', e.target.value)} className={`${INP} resize-none`} rows={3} placeholder="ملاحظات اختيارية للمحامي..." />
              </Field>
            </div>
          </div>
        </Card>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving}>تكليف المهمة</Button>
          <Link href="/admin/tasks"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>
    </div>
  )
}