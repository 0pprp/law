'use client'

import { useState } from 'react'
import { TASK_STATUS_LABELS, assigneePersonLabel } from '@/lib/types'
import type { TaskStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { resolveCompletionFieldLabel } from '@/lib/completion-field-labels'
import { parseGps } from '@/lib/task-approval'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

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
  assignedAt: string | null
  completedAt: string | null
  approvedAt: string | null
  isCurrent: boolean
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

async function fetchTaskFileUrl(path: string): Promise<string> {
  const res = await fetch('/api/admin/task-file-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'تعذر فتح الملف')
  }
  if (!data.url) throw new Error('رابط الملف غير متاح')
  return data.url as string
}

function OpenFileButton({
  id,
  filePath,
  label,
  compact = false,
}: {
  id: string
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
      const url = await fetchTaskFileUrl(filePath)
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

function CompletionFields({
  data,
  attachments,
}: {
  data: Record<string, string>
  attachments: DebtorTaskAttachment[]
}) {
  const entries = Object.entries(data).filter(([, v]) => v != null && String(v).trim() !== '')
  if (!entries.length) return null
  return (
    <div className="mt-3 pt-3 border-t border-[rgba(118,118,118,0.08)]">
      <p className="text-[10px] font-bold text-[#767676] mb-2">الحقول المُدخلة</p>
      <div className="space-y-2">
        {entries.map(([key, val]) => {
          const isGps = key === 'gps' || key.includes('gps')
          const gpsCoords = isGps ? parseGps(val) : null
          const label = resolveCompletionFieldLabel(key)
          const mediaAtt = isMediaCompletionField(key, val)
            ? findAttachmentForField(key, val, attachments)
            : null
          return (
            <div key={key} className="flex items-start gap-2 text-xs">
              <span className="text-[#767676] shrink-0">{label}:</span>
              {isGps && gpsCoords ? (
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
                <OpenFileButton id={`${key}-${mediaAtt.id}`} filePath={mediaAtt.file_path} label={String(val)} />
              ) : (
                <span className="font-semibold text-[#231F20] break-all">{String(val)}</span>
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
}: {
  rows: DebtorTaskHistoryRow[]
  fullArchive?: boolean
}) {
  const { visibleItems, expanded, toggle, hasMore, total } = useShowMore(rows, LOG_PREVIEW_LIMIT)

  if (rows.length === 0) {
    return <div className="py-10 text-center text-[#767676] text-sm">لا توجد مهام مسجّلة لهذا المدين</div>
  }

  return (
    <>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {visibleItems.map(row => (
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
            </div>

            {fullArchive && row.completionData && Object.keys(row.completionData).length > 0 && (
              <CompletionFields data={row.completionData} attachments={row.attachments} />
            )}

            {fullArchive && row.attachments.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[rgba(118,118,118,0.08)]">
                <p className="text-[10px] font-bold text-[#767676] mb-2">مرفقات المهمة ({row.attachments.length})</p>
                <div className="flex flex-wrap gap-2">
                  {row.attachments.map(att => (
                    att.file_path ? (
                      <OpenFileButton
                        key={att.id}
                        id={att.id}
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
        ))}
      </div>
      <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={total} />
    </>
  )
}
