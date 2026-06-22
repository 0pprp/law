'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { TaskType, RequiredField } from '@/lib/types'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { logActivity } from '@/lib/activity-log'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'

// ─── Completion Data viewer ────────────────────────────────────────────────────
function CompletionDataCard({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data).filter(([, v]) => v)
  if (!entries.length) return null

  const FIELD_LABELS: Record<string, string> = {
    note: 'ملاحظة',
    legal_result: 'النتيجة القانونية',
    decision_number: 'رقم القرار',
    case_number: 'رقم الدعوى',
    date: 'التاريخ',
    gps: 'موقع GPS',
    image: 'صورة',
    pdf: 'ملف PDF',
    receipt: 'وصل الصرف',
  }

  return (
    <div className="border border-[rgba(118,118,118,0.15)] rounded-xl overflow-hidden">
      <div className="bg-[#F3F1F2] px-4 py-2.5 text-xs font-bold text-[#767676] uppercase tracking-wide">
        بيانات الإنجاز
      </div>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {entries.map(([key, val]) => (
          <div key={key} className="px-4 py-2.5 flex items-start gap-3">
            <span className="text-xs text-[#767676] shrink-0 min-w-[100px]">
              {FIELD_LABELS[key] ?? key}
            </span>
            <span className="text-xs font-semibold text-[#231F20] break-all">{val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Task Attachments viewer ───────────────────────────────────────────────────
function AttachmentsCard({ taskId }: { taskId: string }) {
  const [atts, setAtts] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at')
      .then(async ({ data }) => {
        const signed = await Promise.all(
          (data ?? []).map(async att => {
            const { data: u } = await supabase.storage.from('task-files').createSignedUrl(att.file_path, 3600)
            return { ...att, url: u?.signedUrl ?? null }
          })
        )
        setAtts(signed)
        setLoaded(true)
      })
  }, [taskId])

  if (!loaded) return <p className="text-xs text-[#767676]">جارٍ التحميل...</p>
  if (!atts.length) return <p className="text-xs text-[#767676] italic">لا توجد مرفقات</p>

  return (
    <div className="space-y-1.5">
      {atts.map(att => (
        <div key={att.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-[rgba(118,118,118,0.08)] last:border-0">
          <span className="text-xs text-[#231F20] truncate flex-1">{att.file_name}</span>
          {att.url
            ? <a href={att.url} target="_blank" rel="noreferrer" className="text-xs text-[#2C8780] font-bold shrink-0">فتح ↗</a>
            : <span className="text-xs text-[#767676] shrink-0">غير متاح</span>}
        </div>
      ))}
    </div>
  )
}

// ─── Review Modal ─────────────────────────────────────────────────────────────
function ReviewModal({ task, onClose, onDone }: { task: any; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const completionData = (task.completion_data ?? {}) as Record<string, string>

  async function approve() {
    setSaving(true)
    const supabase = createClient()
    // Approve the task — the DB trigger fn_task_mark_fee_pending_next will set fee_status automatically
    const { error: err } = await supabase.from('tasks').update({
      task_status: 'approved',
    } as any).eq('id', task.id)
    if (err) { setError(err.message); setSaving(false); return }

    // Also approve the pending payment receipt for this task
    await (supabase as any)
      .from('task_payment_receipts')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('task_id', task.id)
      .eq('status', 'pending')

    await logActivity({
      action: 'approve_task',
      entity_type: 'task',
      entity_id: task.id,
      description: `اعتماد إنجاز مهمة: ${TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type} — المحامي: ${task.lawyer?.full_name ?? '—'}`,
    }, supabase)

    onDone()
    onClose()
  }

  async function reject() {
    if (!rejectReason.trim()) { setError('يجب إدخال سبب الرفض'); return }
    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('tasks').update({
      task_status: 'rejected',
      admin_notes: rejectReason.trim(),
      fee_status: 'pending',
    } as any).eq('id', task.id)
    if (err) { setError(err.message); setSaving(false); return }

    await logActivity({
      action: 'reject_task',
      entity_type: 'task',
      entity_id: task.id,
      description: `رفض إنجاز مهمة: ${TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type} — السبب: ${rejectReason}`,
    }, supabase)

    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.6)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-[#231F20] text-base">
              {TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type}
            </h2>
            <p className="text-xs text-[#767676] mt-0.5">
              {task.debtors?.full_name ?? '—'} · {task.lawyer?.full_name ?? '—'}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Task info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#F3F1F2] rounded-xl p-3">
              <p className="text-[10px] text-[#767676] mb-1">المحكمة</p>
              <p className="text-sm font-bold text-[#231F20]">
                {task.courts?.name ?? task.court_name ?? '—'}
              </p>
            </div>
            <div className="bg-[#F3F1F2] rounded-xl p-3">
              <p className="text-[10px] text-[#767676] mb-1">تاريخ الإنجاز</p>
              <p className="text-sm font-bold text-[#231F20]" dir="ltr">
                {task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : '—'}
              </p>
            </div>
            <div className="bg-[#F3F1F2] rounded-xl p-3">
              <p className="text-[10px] text-[#767676] mb-1">الأتعاب</p>
              <p className="text-sm font-black text-[#2C8780]" dir="ltr">{fmtMoney(task.reward_amount)}</p>
            </div>
            <div className="bg-[#F3F1F2] rounded-xl p-3">
              <p className="text-[10px] text-[#767676] mb-1">ملاحظات المحامي</p>
              <p className="text-xs font-semibold text-[#231F20]">{task.lawyer_notes ?? '—'}</p>
            </div>
          </div>

          {/* Completion data */}
          {Object.keys(completionData).length > 0 && (
            <CompletionDataCard data={completionData} />
          )}

          {/* Attachments */}
          <div className="border border-[rgba(118,118,118,0.15)] rounded-xl overflow-hidden">
            <div className="bg-[#F3F1F2] px-4 py-2.5 text-xs font-bold text-[#767676] uppercase tracking-wide">
              المرفقات
            </div>
            <div className="px-4 py-3">
              <AttachmentsCard taskId={task.id} />
            </div>
          </div>

          {/* Action selection */}
          {!action && (
            <div className="flex gap-3">
              <button onClick={() => setAction('approve')}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                ✓ اعتماد الإنجاز
              </button>
              <button onClick={() => setAction('reject')}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors">
                ✗ رفض الإنجاز
              </button>
            </div>
          )}

          {/* Approve confirm */}
          {action === 'approve' && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-teal-800">
                سيتم اعتماد الإنجاز وتسجيل الأتعاب ({fmtMoney(task.reward_amount)}) كمبلغ معلق حتى تكليف المهمة التالية.
              </p>
              {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => setAction(null)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold bg-white border border-teal-200 text-teal-700">
                  إلغاء
                </button>
                <button onClick={approve} disabled={saving}
                  className="flex-1 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60 transition-opacity"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  {saving ? 'جارٍ الاعتماد...' : 'تأكيد الاعتماد'}
                </button>
              </div>
            </div>
          )}

          {/* Reject form */}
          {action === 'reject' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-red-800">سبب الرفض (سيظهر للمحامي)</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm bg-white border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                placeholder="اكتب سبب الرفض بوضوح..."
              />
              {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => setAction(null)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold bg-white border border-red-200 text-red-700">
                  إلغاء
                </button>
                <button onClick={reject} disabled={saving || !rejectReason.trim()}
                  className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 transition-colors">
                  {saving ? 'جارٍ الرفض...' : 'تأكيد الرفض'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function TaskReviewPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<any | null>(null)
  const [filterLawyer, setFilterLawyer] = useState('')
  const [lawyers, setLawyers] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [{ data: t }, { data: l }] = await Promise.all([
      supabase.from('tasks')
        .select(`
          *,
          debtors(full_name, phone, governorate),
          lawyer:profiles!tasks_assigned_to_fkey(id, full_name),
          courts(name),
          execution_departments(name)
        `)
        .eq('task_status', 'submitted')
        .order('completed_at', { ascending: true }),
      supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name'),
    ])
    setTasks(t ?? [])
    setLawyers(l ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = filterLawyer
    ? tasks.filter(t => t.lawyer?.id === filterLawyer)
    : tasks

  return (
    <div className="space-y-5">
      <PageHeader
        title="مراجعة الإنجازات"
        subtitle={`${filtered.length} مهمة بانتظار الاعتماد`}
      />

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm px-3 py-2 flex items-center gap-2 w-60">
          <svg className="w-4 h-4 text-[#767676] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <select value={filterLawyer} onChange={e => setFilterLawyer(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[#231F20] focus:outline-none">
            <option value="">كل المحامين</option>
            {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
          </select>
        </div>

        {/* Count badges */}
        <div className="flex items-center gap-2 text-xs text-[#767676]">
          <span className="bg-purple-100 text-purple-800 font-bold px-2.5 py-1 rounded-full">
            {filtered.length} بانتظار الاعتماد
          </span>
        </div>
      </div>

      {/* Tasks grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3">
          <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
        </div>
      ) : !filtered.length ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center text-2xl mx-auto mb-4">✓</div>
          <p className="text-base font-bold text-[#231F20]">لا توجد إنجازات بانتظار المراجعة</p>
          <p className="text-sm text-[#767676] mt-1">جميع الإنجازات تمت مراجعتها</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(task => {
            const completionData = (task.completion_data ?? {}) as Record<string, string>
            const hasData = Object.keys(completionData).length > 0
            const courtName = task.courts?.name ?? task.court_name
            return (
              <div key={task.id}
                className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">

                {/* Card header */}
                <div className="px-4 py-3 border-b border-[rgba(118,118,118,0.08)]" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-white font-bold text-sm leading-tight">
                        {TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type}
                      </p>
                      <p className="text-white/70 text-xs mt-0.5 truncate">
                        {task.debtors?.full_name ?? '—'}
                      </p>
                    </div>
                    <Badge variant="purple">بانتظار الاعتماد</Badge>
                  </div>
                </div>

                {/* Card body */}
                <div className="px-4 py-3 flex-1 space-y-2">
                  <InfoRow label="المحامي" value={task.lawyer?.full_name} />
                  <InfoRow label="المحكمة" value={courtName} />
                  <InfoRow label="المحافظة" value={task.debtors?.governorate} />
                  <InfoRow label="أُنجز في" value={task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : undefined} />
                  <InfoRow label="الأتعاب" value={fmtMoney(task.reward_amount)} accent />

                  {/* Completion data preview */}
                  {hasData && (
                    <div className="mt-2 bg-[#F3F1F2] rounded-lg px-3 py-2">
                      <p className="text-[10px] text-[#767676] font-bold mb-1">بيانات الإنجاز</p>
                      {Object.entries(completionData).slice(0, 2).map(([k, v]) => (
                        <p key={k} className="text-xs text-[#231F20] truncate">
                          <span className="text-[#767676]">{k}:</span> {v}
                        </p>
                      ))}
                      {Object.keys(completionData).length > 2 && (
                        <p className="text-[10px] text-[#767676] mt-0.5">
                          +{Object.keys(completionData).length - 2} حقول أخرى
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Card footer */}
                <div className="px-4 py-3 border-t border-[rgba(118,118,118,0.08)] bg-[#F3F1F2]/50">
                  <button onClick={() => setReviewing(task)}
                    className="w-full py-2 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                    مراجعة واتخاذ قرار
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reviewing && (
        <ReviewModal
          task={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); load() }}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-[rgba(118,118,118,0.06)] last:border-0">
      <span className="text-[10px] text-[#767676] shrink-0">{label}</span>
      <span className={`text-xs font-bold truncate ${accent ? 'text-[#2C8780]' : 'text-[#231F20]'}`}>{value}</span>
    </div>
  )
}
