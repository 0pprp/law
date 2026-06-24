'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS, RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { TaskType, TaskStatus } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { useBranchId } from '@/context/branch'

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const ALL_TASK_TYPES: TaskType[] = [
  'file_lawsuit', 'notification', 'pleading', 'decision_ratification',
  'open_file', 'summons', 'inspection', 'forced_appearance',
  'arrest_warrant', 'arrest_warrant_broadcast', 'imprisonment_in_absentia',
  'imprisonment_broadcast', 'department_correspondence', 'newspaper_publication',
  'salary_seizure', 'first_registration', 'file_closure',
]
const ALL_TASK_STATUSES: TaskStatus[] = ['new', 'in_progress', 'completed', 'failed', 'postponed', 'needs_info', 'closed']
const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  new: 'info', in_progress: 'warning', completed: 'success', failed: 'danger', postponed: 'gray', needs_info: 'purple', closed: 'gray',
}

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#231F20] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function EditTaskPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const branchId = useBranchId()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [task, setTask] = useState<any>(null)
  const [lawyers, setLawyers] = useState<any[]>([])
  const [showAllLawyers, setShowAllLawyers] = useState(false)
  const [attachments, setAttachments] = useState<any[]>([])
  const [openingId, setOpeningId] = useState<string | null>(null)

  const [form, setForm] = useState({
    assigned_to: '', task_type: '' as TaskType, task_status: 'new' as TaskStatus,
    governorate: '', court_name: '', due_date: '', admin_notes: '',
  })

  useEffect(() => {
    const supabase = createClient()
    let lq = supabase.from('profiles').select('id, full_name, phone, governorate').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) lq = (lq as any).eq('branch_id', branchId)
    Promise.all([
      supabase.from('tasks').select('*, debtors(full_name, phone, governorate, receipt_type, receipt_number, remaining_amount, required_amount, has_contract)').eq('id', id).single(),
      lq,
      supabase.from('task_attachments').select('*').eq('task_id', id).order('created_at', { ascending: false }),
    ]).then(([{ data: t }, { data: l }, { data: a }]) => {
      if (t) {
        setTask(t)
        setForm({ assigned_to: t.assigned_to ?? '', task_type: t.task_type, task_status: t.task_status, governorate: t.governorate ?? '', court_name: t.court_name ?? '', due_date: t.due_date ?? '', admin_notes: t.admin_notes ?? '' })
      }
      setLawyers(l ?? []); setAttachments(a ?? [])
      setLoading(false)
    })
  }, [id, branchId])

  function set(field: string, value: unknown) { setForm(prev => ({ ...prev, [field]: value })) }

  const filteredLawyers = useMemo(() => {
    if (showAllLawyers || !form.governorate) return lawyers
    return lawyers.filter(l => l.governorate === form.governorate)
  }, [lawyers, form.governorate, showAllLawyers])

  const showLawyerEmptyState = !showAllLawyers && form.governorate && filteredLawyers.length === 0

  async function openFile(fileId: string, filePath: string) {
    setOpeningId(fileId)
    try {
      const res = await fetch('/api/admin/task-file-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: filePath }) })
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch { alert('فشل في فتح الملف') }
    finally { setOpeningId(null) }
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    setSaving(true); setError('')
    const supabase = createClient()
    const { error: dbError } = await supabase.from('tasks').update({
      assigned_to: form.assigned_to || null, task_type: form.task_type, task_status: form.task_status,
      governorate: form.governorate || null, court_name: form.court_name || null,
      due_date: form.due_date || null, admin_notes: form.admin_notes || null,
    }).eq('id', id)
    if (dbError) { setError(dbError.message); setSaving(false); return }
    await logActivity({ action: 'update_task', entity_type: 'task', entity_id: id, description: `تعديل المهمة: ${TASK_TYPE_LABELS[form.task_type as TaskType]} — ${TASK_STATUS_LABELS[form.task_status]}` }, supabase)
    router.push('/admin/tasks')
  }

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-20">
      <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
    </div>
  )
  if (!task) return <div className="py-20 text-center text-red-500 text-sm">المهمة غير موجودة</div>

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <PageHeader
            title="تعديل المهمة"
            breadcrumb={[{ label: 'المهام', href: '/admin/tasks' }, { label: 'تعديل' }]}
          />
        </div>
        <Badge variant={STATUS_BADGE[task.task_status as TaskStatus] ?? 'default'}>
          {TASK_STATUS_LABELS[task.task_status as TaskStatus]}
        </Badge>
      </div>

      {/* Debtor summary */}
      {task.debtors && (
        <div className="bg-[#2C8780]/5 border border-[#2C8780]/20 rounded-xl p-4 text-sm">
          <p className="font-bold text-[#231F20] mb-2">{task.debtors.full_name}</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[#231F20]">
            {task.debtors.governorate && <><span className="text-[#767676]">المحافظة</span><span>{task.debtors.governorate}</span></>}
            <span className="text-[#767676]">نوع الوثيقة</span>
            <span>{RECEIPT_TYPE_LABELS[task.debtors.receipt_type as keyof typeof RECEIPT_TYPE_LABELS] ?? task.debtors.receipt_type}</span>
            {task.debtors.receipt_number && <><span className="text-[#767676]">رقم الوثيقة</span><span className="font-mono" dir="ltr">{task.debtors.receipt_number}</span></>}
          </div>
        </div>
      )}

      {/* Lawyer feedback (read-only) */}
      {(task.lawyer_notes || task.legal_result) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm space-y-2">
          <p className="font-semibold text-blue-800">تحديثات المحامي</p>
          {task.lawyer_notes && <p className="text-[#231F20]">{task.lawyer_notes}</p>}
          {task.legal_result && <div><p className="text-xs text-[#767676] mb-0.5">نتيجة الإجراء</p><p className="font-semibold text-[#231F20]">{task.legal_result}</p></div>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
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
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">لا يوجد محامٍ فعال في هذه المحافظة.</div>
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
            <Field label="نوع المهمة">
              <select value={form.task_type} onChange={e => set('task_type', e.target.value)} className={INP}>
                {ALL_TASK_TYPES.map(t => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="حالة المهمة">
              <select value={form.task_status} onChange={e => set('task_status', e.target.value as TaskStatus)} className={INP}>
                {ALL_TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="محافظة المهمة">
              <input type="text" value={form.governorate} onChange={e => set('governorate', e.target.value)} className={INP} />
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

        <div className="flex gap-3">
          <Button type="submit" variant="primary" loading={saving}>حفظ التعديلات</Button>
          <Link href="/admin/tasks"><Button type="button" variant="outline">إلغاء</Button></Link>
        </div>
      </form>

      {/* Task completion files (read-only) */}
      <Card>
        <CardHeader title={`ملفات إنجاز المهمة (${attachments.length})`} />
        {!attachments.length ? (
          <div className="py-8 text-center text-[#767676] text-sm">لم يرفع المحامي أي ملفات بعد</div>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {attachments.map((att: any) => (
              <div key={att.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#231F20] truncate">{att.file_name ?? att.file_path}</p>
                  <p className="text-xs text-[#767676] mt-0.5">
                    {[att.mime_type === 'application/pdf' ? 'PDF' : att.mime_type?.startsWith('image/') ? 'صورة' : att.mime_type, formatSize(att.file_size), att.description].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono text-[#767676]" dir="ltr">{fmtDate(att.created_at)}</span>
                  <button type="button" onClick={() => openFile(att.id, att.file_path)} disabled={openingId === att.id}
                    className="text-xs text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
                    {openingId === att.id ? '...' : 'فتح'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}