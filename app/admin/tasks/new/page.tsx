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
import { fmtMoney } from '@/lib/utils'
import { useBranchId } from '@/context/branch'
import { ACTIVE_CASE_BLOCK_MSG, hasActiveCurrentTask } from '@/lib/debtor-current-task'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DebtorSearchPicker } from '@/components/ui/debtor-search-picker'
import { FormFlow, FormFlowStep, FormField, formInputClass } from '@/components/ui/form-flow'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { DEBTOR_TASK_SELECT, type DebtorSearchRow } from '@/lib/debtor-search'

const ALL_TASK_TYPES: TaskType[] = [
  'file_lawsuit', 'notification', 'pleading', 'decision_ratification',
  'open_file', 'summons', 'inspection', 'forced_appearance',
  'arrest_warrant', 'arrest_warrant_broadcast', 'imprisonment_in_absentia',
  'imprisonment_broadcast', 'department_correspondence', 'newspaper_publication',
  'salary_seizure', 'first_registration', 'file_closure',
]
const ALL_TASK_STATUSES: TaskStatus[] = ['new', 'in_progress', 'completed', 'failed', 'postponed', 'needs_info', 'closed']

export default function NewTaskPage() {
  const router = useRouter()
  const branchId = useBranchId()
  const [lawyers, setLawyers] = useState<any[]>([])
  const [selectedDebtor, setSelectedDebtor] = useState<DebtorSearchRow | null>(null)
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
    let lq = supabase.from('profiles').select('id, full_name, phone, governorate').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) lq = (lq as any).eq('branch_id', branchId)
    lq.then(({ data: l }) => setLawyers(l ?? []))
  }, [branchId])

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  function handleDebtorChange(id: string, debtor: DebtorSearchRow | null) {
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

    const debtor = selectedDebtor
    if (debtor && hasActiveCurrentTask(debtor)) {
      setError(ACTIVE_CASE_BLOCK_MSG)
      return
    }

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
      branch_id: branchId,
    }).select('id').single()
    if (dbError || !newTask) { setError(dbError?.message ?? 'فشل إنشاء المهمة'); setSaving(false); return }
    await supabase.from('debtors').update({ current_task_id: newTask.id }).eq('id', form.debtor_id)
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
        <FormFlow>
          <FormFlowStep step={1} title="المدين / الزبون" subtitle="ابحث بالاسم أو الهاتف أو رقم الوصل">
            <FormField label="اختر المدين" required hint="اكتب للبحث — لا تُحمّل كل المدينين">
              <DebtorSearchPicker
                value={form.debtor_id}
                onChange={handleDebtorChange}
                branchId={branchId}
                select={DEBTOR_TASK_SELECT}
                disabled={!branchId}
              />
            </FormField>
            {selectedDebtor && (
              <div className="mt-3 bg-[#2C8780]/5 border border-[#2C8780]/20 rounded-xl p-4">
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
          </FormFlowStep>

          <FormFlowStep step={2} title="المحامي المكلف" subtitle="اختياري — يمكن التكليف لاحقاً">
            <div className="space-y-4">
              <label className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-[rgba(118,118,118,0.12)] bg-[#FAFAFA] hover:bg-[#F3F1F2] transition-colors">
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
                <FormField label="المحامي">
                  <PremiumSelect
                    value={form.assigned_to}
                    onChange={v => set('assigned_to', v)}
                    options={[
                      { value: '', label: '— بدون تكليف —' },
                      ...filteredLawyers.map(l => ({
                        value: l.id,
                        label: l.full_name,
                        hint: [l.governorate, l.phone].filter(Boolean).join(' · ') || undefined,
                      })),
                    ]}
                    placeholder="— بدون تكليف —"
                    headerTitle="اختر المحامي"
                    searchPlaceholder="بحث بالاسم..."
                    disabled={!selectedDebtor}
                  />
                </FormField>
              )}
            </div>
          </FormFlowStep>

          <FormFlowStep step={3} title="تفاصيل المهمة" subtitle="نوع المهمة وحالتها" isLast>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="نوع المهمة" required>
                <PremiumSelect
                  value={form.task_type}
                  onChange={v => set('task_type', v)}
                  options={ALL_TASK_TYPES.map(t => ({ value: t, label: TASK_TYPE_LABELS[t] }))}
                  placeholder="— اختر النوع —"
                  headerTitle="نوع المهمة"
                  searchPlaceholder="بحث في أنواع المهام..."
                />
              </FormField>
              <FormField label="حالة المهمة">
                <PremiumSelect
                  value={form.task_status}
                  onChange={v => set('task_status', v as TaskStatus)}
                  options={ALL_TASK_STATUSES.map(s => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
                  headerTitle="حالة المهمة"
                  searchable={false}
                />
              </FormField>
              <FormField label="محافظة المهمة">
                <input type="text" value={form.governorate} onChange={e => set('governorate', e.target.value)} className={formInputClass} placeholder="تُملأ تلقائياً من المدين" />
              </FormField>
              <FormField label="اسم المحكمة">
                <input type="text" value={form.court_name} onChange={e => set('court_name', e.target.value)} className={formInputClass} placeholder="مثال: محكمة بداءة بغداد" />
              </FormField>
              <FormField label="تاريخ نهاية التكليف">
                <DatePicker
                  value={form.due_date}
                  onChange={v => set('due_date', v)}
                  headerTitle="تاريخ نهاية التكليف"
                  placeholder="اختر التاريخ"
                  minDate={new Date().toISOString().split('T')[0]}
                />
              </FormField>
              <FormField label="ملاحظات الإدارة" className="md:col-span-2">
                <textarea value={form.admin_notes} onChange={e => set('admin_notes', e.target.value)} className={cn(formInputClass, 'resize-none')} rows={3} placeholder="ملاحظات اختيارية للمحامي..." />
              </FormField>
            </div>
          </FormFlowStep>
        </FormFlow>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving}>تكليف المهمة</Button>
          <Link href="/admin/tasks"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>
    </div>
  )
}