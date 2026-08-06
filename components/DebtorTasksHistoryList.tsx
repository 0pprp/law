'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TASK_STATUS_LABELS, assigneePersonLabel } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { resolveCompletionFieldLabel } from '@/lib/completion-field-labels'
import { parseGps } from '@/lib/task-approval'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'
import { DatePicker } from '@/components/ui/date-picker'
import { useAdminRole } from '@/context/admin-role'
import { canApproveCompletions, canAssignTasks, canEditDebtor } from '@/lib/permissions'
import {
  extractHearingDateFromCompletion,
  isHearingDateFieldKey,
  normalizeHearingYmd,
  pickCanonicalHearingFieldKey,
  syncHearingDateInCompletion,
} from '@/lib/hearing-date-from-completion'

const STATUS_BADGE: Partial<Record<TaskStatus, 'default' | 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  draft: 'gray',
  waiting_assignment: 'warning',
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  pending_review: 'purple',
  approved: 'success',
  rejected: 'danger',
  needs_revision: 'danger',
  completed: 'success',
  new: 'info',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

export interface DebtorTaskAttachment {
  id: string
  file_name: string
  file_path: string
  description: string | null
}

export interface DebtorTaskHistoryRow {
  id: string
  label: string
  lawyerName: string
  assigneeRole: string | null
  task_status: string
  taskType?: string | null
  assignedAt: string | null
  completedAt: string | null
  approvedAt: string | null
  isCurrent: boolean
  /** تاريخ المرافعة/الجلسة المعروض على الكارد */
  hearingDate?: string | null
  /** هل يُسمح بتعديل تاريخ الجلسة على هذه المهمة (إقامة دعوى) */
  canEditHearingDate?: boolean
  completionData: Record<string, string> | null
  attachments: DebtorTaskAttachment[]
}

const MEDIA_KEY_RE = /(photo|image|video|file|pdf|attachment|receipt|صورة|مرفق|فيديو)/i
const MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|mp4|webm|mov|avi|pdf|heic)$/i

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return fmtDate(value.split('T')[0])
}

function isMediaCompletionField(key: string, val: string): boolean {
  return MEDIA_KEY_RE.test(key) || MEDIA_EXT_RE.test(val)
}

function findAttachmentForField(
  key: string,
  val: string,
  attachments: DebtorTaskAttachment[],
): DebtorTaskAttachment | null {
  const byDesc = attachments.find(a => a.description === key && a.file_path)
  if (byDesc) return byDesc
  const byName = attachments.find(a => a.file_name === val && a.file_path)
  if (byName) return byName
  return null
}

async function fetchTaskFileUrl(fileId: string, path: string): Promise<string> {
  const res = await fetch('/api/admin/task-file-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, path }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'تعذر فتح الملف')
  }
  if (!data.url) throw new Error('رابط الملف غير متاح')
  return data.url as string
}

function OpenFileButton({
  fileId,
  filePath,
  label,
  compact = false,
}: {
  fileId: string
  filePath: string
  label: string
  compact?: boolean
}) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  async function open() {
    if (!filePath || opening) return
    setOpening(true)
    setError('')
    try {
      const url = await fetchTaskFileUrl(fileId, filePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر فتح الملف')
    } finally {
      setOpening(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5 min-w-0">
      <button
        type="button"
        onClick={open}
        disabled={opening || !filePath}
        className={
          compact
            ? 'text-xs bg-[rgba(44,135,128,0.1)] text-[#2C8780] hover:bg-[rgba(44,135,128,0.18)] px-2.5 py-1 rounded-lg font-semibold transition-colors disabled:opacity-60'
            : 'font-semibold text-[#2C8780] hover:underline break-all text-right disabled:opacity-60'
        }
        title="فتح الملف"
      >
        {opening ? 'جارٍ الفتح...' : compact ? `فتح · ${label}` : `${label} ↗`}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </span>
  )
}

function HearingDateEditor({
  taskId,
  debtorId,
  fieldKey,
  initialDate,
  onSaved,
}: {
  taskId: string
  debtorId: string
  fieldKey: string
  initialDate: string
  onSaved: (date: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const ymd = normalizeHearingYmd(value)
    if (!ymd) {
      setError('تاريخ غير صالح')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data: task, error: loadErr } = await supabase
      .from('tasks')
      .select('completion_data')
      .eq('id', taskId)
      .single()
    if (loadErr || !task) {
      setError(loadErr?.message ?? 'تعذر تحميل المهمة')
      setSaving(false)
      return
    }
    const prev = (task.completion_data ?? {}) as Record<string, unknown>
    // وحّد date + hearing_date وأي مفتاح جلسة قديم حتى لا يظهر تاريخان
    const nextData = syncHearingDateInCompletion(prev, ymd, [fieldKey])
    const { error: taskErr } = await supabase
      .from('tasks')
      .update({ completion_data: nextData } as any)
      .eq('id', taskId)
    if (taskErr) {
      setError(taskErr.message)
      setSaving(false)
      return
    }
    const { error: debtorErr } = await supabase
      .from('debtors')
      .update({ first_hearing_date: ymd } as any)
      .eq('id', debtorId)
    if (debtorErr) {
      setError(debtorErr.message)
      setSaving(false)
      return
    }
    setSaving(false)
    setEditing(false)
    onSaved(ymd)
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className="font-semibold text-[#231F20] break-all" dir="ltr">{value || '—'}</span>
        <button
          type="button"
          onClick={() => { setValue(initialDate); setEditing(true); setError('') }}
          className="text-[10px] font-bold text-[#2C8780] hover:underline shrink-0"
        >
          تعديل
        </button>
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-2 min-w-0 w-full max-w-xs">
      <DatePicker
        value={value}
        onChange={setValue}
        fieldLabel="تاريخ الجلسة"
        headerTitle="تاريخ الجلسة / المرافعة"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !value}
          className="text-[11px] font-bold text-white px-2.5 py-1 rounded-lg disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
        >
          {saving ? 'جارٍ الحفظ...' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError('') }}
          disabled={saving}
          className="text-[11px] font-bold text-[#767676] px-2 py-1"
        >
          إلغاء
        </button>
      </div>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  )
}

function CompletionFields({
  data,
  attachments,
  taskId,
  debtorId,
  canEditHearing,
  onHearingSaved,
}: {
  data: Record<string, string>
  attachments: DebtorTaskAttachment[]
  taskId: string
  debtorId: string
  canEditHearing: boolean
  onHearingSaved: (date: string) => void
}) {
  const entries = Object.entries(data).filter(([, v]) => v != null && String(v).trim() !== '')
  if (!entries.length) return null
  const extractedHearing = extractHearingDateFromCompletion(data)
  const hearingFieldKeys = new Set(
    entries
      .filter(([key, val]) => {
        if (isHearingDateFieldKey(key)) return true
        const label = resolveCompletionFieldLabel(key)
        if ((label.includes('جلسة') || label.includes('مرافعة')) && normalizeHearingYmd(val) != null) return true
        // field_N_date الوحيد أو المطابق للمستخرج = تاريخ الجلسة
        if (canEditHearing && extractedHearing && normalizeHearingYmd(val) === extractedHearing) return true
        return false
      })
      .map(([key]) => key),
  )
  // إن وُجد تاريخ مستخرج ولم يُعرَف مفتاحه — نستخدم أول حقل date أو hearing_date
  let fallbackHearingKey: string | null = null
  if (canEditHearing && extractedHearing && hearingFieldKeys.size === 0) {
    fallbackHearingKey =
      entries.find(([k]) => isHearingDateFieldKey(k))?.[0]
      ?? entries.find(([, v]) => normalizeHearingYmd(v) === extractedHearing)?.[0]
      ?? 'hearing_date'
    hearingFieldKeys.add(fallbackHearingKey)
  }
  // عرض صف واحد فقط لتاريخ المرافعة حتى لو وُجد date و hearing_date معاً
  const canonicalHearingKey = hearingFieldKeys.size > 0
    ? pickCanonicalHearingFieldKey(hearingFieldKeys)
    : null
  const visibleEntries = entries.filter(([key]) => {
    if (!hearingFieldKeys.has(key)) return true
    return key === canonicalHearingKey
  })
  return (
    <div className="mt-3 pt-3 border-t border-[rgba(118,118,118,0.08)]">
      <p className="text-[10px] font-bold text-[#767676] mb-2">الحقول المُدخلة</p>
      <div className="space-y-2">
        {canEditHearing && fallbackHearingKey === 'hearing_date' && !entries.some(([k]) => isHearingDateFieldKey(k)) && extractedHearing && (
          <div className="flex items-start gap-2 text-xs">
            <span className="text-[#767676] shrink-0">تاريخ المرافعة:</span>
            <HearingDateEditor
              taskId={taskId}
              debtorId={debtorId}
              fieldKey="hearing_date"
              initialDate={extractedHearing}
              onSaved={onHearingSaved}
            />
          </div>
        )}
        {visibleEntries.map(([key, val]) => {
          const isGps = key === 'gps' || key.includes('gps')
          const gpsCoords = isGps ? parseGps(val) : null
          const label = resolveCompletionFieldLabel(key)
          const mediaAtt = isMediaCompletionField(key, val)
            ? findAttachmentForField(key, val, attachments)
            : null
          const isHearing = canonicalHearingKey === key
          const hearingValue = isHearing
            ? (extractedHearing ?? normalizeHearingYmd(val) ?? String(val).slice(0, 10))
            : val
          return (
            <div key={key} className="flex items-start gap-2 text-xs">
              <span className="text-[#767676] shrink-0">{label}:</span>
              {isHearing && canEditHearing ? (
                <HearingDateEditor
                  taskId={taskId}
                  debtorId={debtorId}
                  fieldKey={key}
                  initialDate={hearingValue}
                  onSaved={onHearingSaved}
                />
              ) : isGps && gpsCoords ? (
                <a
                  href={`https://www.google.com/maps?q=${gpsCoords.lat},${gpsCoords.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[#2C8780] hover:underline break-all"
                  dir="ltr"
                >
                  {val} 🗺️
                </a>
              ) : mediaAtt?.file_path ? (
                <OpenFileButton fileId={mediaAtt.id} filePath={mediaAtt.file_path} label={String(val)} />
              ) : (
                <span className="font-semibold text-[#231F20] break-all" dir={isHearing ? 'ltr' : undefined}>
                  {String(isHearing ? hearingValue : val)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DebtorTasksHistoryList({
  rows,
  fullArchive = false,
  debtorId,
}: {
  rows: DebtorTaskHistoryRow[]
  fullArchive?: boolean
  debtorId: string
}) {
  const router = useRouter()
  const role = useAdminRole()
  const allowEditHearing = canEditDebtor(role) || canAssignTasks(role) || canApproveCompletions(role)
  const { visibleItems, expanded, toggle, hasMore, total } = useShowMore(rows, LOG_PREVIEW_LIMIT)
  const [localHearingByTask, setLocalHearingByTask] = useState<Record<string, string>>({})
  const [pleadingHearing, setPleadingHearing] = useState<string | null>(null)

  if (rows.length === 0) {
    return <div className="py-10 text-center text-[#767676] text-sm">لا توجد مهام مسجّلة لهذا المدين</div>
  }

  return (
    <>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {visibleItems.map(row => {
          const fromRow = localHearingByTask[row.id] ?? row.hearingDate ?? null
          const showPleadingHearing =
            row.taskType === 'pleading'
            || row.label.includes('مرافع')
            || Boolean(row.isCurrent && (pleadingHearing || row.hearingDate))
          const hearingDate = showPleadingHearing
            ? (pleadingHearing ?? fromRow)
            : fromRow
          return (
            <div key={row.id} className={`px-5 py-4 ${row.isCurrent ? 'bg-[#2C8780]/5' : ''}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-[#231F20]">{row.label}</p>
                    {row.isCurrent ? (
                      <span className="text-[9px] font-bold text-white bg-[#2C8780] rounded px-1.5 py-0.5">المهمة الحالية</span>
                    ) : (
                      <span className="text-[9px] font-bold text-[#767676] bg-slate-100 rounded px-1.5 py-0.5">مهمة سابقة</span>
                    )}
                  </div>
                  <p className="text-xs text-[#767676] mt-1">
                    {assigneePersonLabel(row.assigneeRole)}: <span className="font-semibold text-[#231F20]">{row.lawyerName}</span>
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[row.task_status as TaskStatus] ?? 'default'}>
                  {TASK_STATUS_LABELS[row.task_status as TaskStatus] ?? row.task_status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                <div>
                  <span className="text-[#767676] block mb-0.5">تاريخ التكليف</span>
                  <span className="font-mono text-[#231F20] font-semibold" dir="ltr">{formatDate(row.assignedAt)}</span>
                </div>
                <div>
                  <span className="text-[#767676] block mb-0.5">تاريخ الإنجاز</span>
                  <span className="font-mono text-[#231F20] font-semibold" dir="ltr">{formatDate(row.completedAt)}</span>
                </div>
                <div>
                  <span className="text-[#767676] block mb-0.5">تاريخ الاعتماد</span>
                  <span className="font-mono text-[#231F20] font-semibold" dir="ltr">{formatDate(row.approvedAt)}</span>
                </div>
                {showPleadingHearing && (
                  <div className="col-span-2 sm:col-span-3 rounded-lg bg-[#2C8780]/8 border border-[#2C8780]/20 px-3 py-2">
                    <span className="text-[#767676] block mb-0.5">تاريخ المرافعة</span>
                    <span className="font-mono text-[#2C8780] font-bold text-sm" dir="ltr">
                      {hearingDate ? formatDate(hearingDate) : '—'}
                    </span>
                  </div>
                )}
              </div>

              {fullArchive && row.completionData && Object.keys(row.completionData).length > 0 && (
                <CompletionFields
                  data={
                    localHearingByTask[row.id]
                      ? syncHearingDateInCompletion(
                          row.completionData as Record<string, unknown>,
                          localHearingByTask[row.id],
                        ) as Record<string, string>
                      : row.completionData
                  }
                  attachments={row.attachments}
                  taskId={row.id}
                  debtorId={debtorId}
                  canEditHearing={
                    allowEditHearing
                    && (Boolean(row.canEditHearingDate) || row.label.includes('إقامة دعوى') || row.taskType === 'file_lawsuit')
                  }
                  onHearingSaved={(date) => {
                    setLocalHearingByTask(prev => ({ ...prev, [row.id]: date }))
                    setPleadingHearing(date)
                    router.refresh()
                  }}
                />
              )}

              {fullArchive && row.attachments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[rgba(118,118,118,0.08)]">
                  <p className="text-[10px] font-bold text-[#767676] mb-2">مرفقات المهمة ({row.attachments.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {row.attachments.map(att => (
                      att.file_path ? (
                        <OpenFileButton
                          key={att.id}
                          fileId={att.id}
                          filePath={att.file_path}
                          label={att.file_name}
                          compact
                        />
                      ) : (
                        <span key={att.id} className="text-xs bg-slate-100 text-[#231F20] px-2 py-1 rounded-lg">
                          {att.file_name}
                        </span>
                      )
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={total} />
    </>
  )
}
