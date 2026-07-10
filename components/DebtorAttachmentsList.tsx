'use client'

import { useState } from 'react'
import { fmtDate } from '@/lib/utils'

export interface DebtorAttachmentItem {
  id: string
  file_name: string
  file_path: string
  file_size?: number | null
  mime_type?: string | null
  created_at: string
}

async function fetchDebtorFileUrl(file: DebtorAttachmentItem): Promise<string> {
  const res = await fetch('/api/admin/debtor-file-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: file.id, path: file.file_path }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'تعذر فتح الملف')
  }
  if (!data.url) throw new Error('رابط الملف غير متاح')
  return data.url as string
}

function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DebtorAttachmentsList({ files }: { files: DebtorAttachmentItem[] }) {
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function openFile(file: DebtorAttachmentItem) {
    setOpeningId(file.id)
    setError('')
    try {
      const url = await fetchDebtorFileUrl(file)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر فتح الملف')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div>
      {error && (
        <div className="mx-5 mt-3 mb-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {files.map(file => {
          const sizeLabel = formatFileSize(file.file_size)
          const opening = openingId === file.id
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => openFile(file)}
              disabled={opening}
              className="w-full px-5 py-3 flex items-center justify-between gap-3 text-right hover:bg-[#2C8780]/5 transition-colors disabled:opacity-60 group"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-8 h-8 bg-[rgba(44,135,128,0.1)] rounded-lg flex items-center justify-center shrink-0 group-hover:bg-[rgba(44,135,128,0.18)] transition-colors">
                  {opening ? (
                    <svg className="w-4 h-4 text-[#2C8780] animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-sm font-semibold text-[#231F20] truncate group-hover:text-[#2C8780] transition-colors">
                    {file.file_name}
                  </p>
                  <p className="text-[11px] text-[#767676] mt-0.5">
                    {opening ? 'جارٍ التحميل...' : 'اضغط للفتح'}
                    {sizeLabel ? ` · ${sizeLabel}` : ''}
                  </p>
                </div>
              </div>
              <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">
                {fmtDate(file.created_at)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
