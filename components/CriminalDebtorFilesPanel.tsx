'use client'

import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'

type FileKind = 'documents' | 'petition'

type Props = {
  debtorId: string
  documentsPath: string | null
  petitionPath: string | null
  canEdit: boolean
}

async function fetchSignedUrl(debtorId: string, kind: FileKind): Promise<{ url?: string; error?: string; missing?: boolean }> {
  try {
    const res = await fetch(`/api/admin/debtors/${debtorId}/criminal-file?kind=${kind}`)
    const data = await res.json().catch(() => ({}))
    if (res.status === 404 || data.missing) return { missing: true }
    if (!res.ok) return { error: typeof data.error === 'string' ? data.error : 'تعذر تحميل الملف' }
    if (!data.url) return { error: 'تعذر تحميل الملف' }
    return { url: data.url as string }
  } catch {
    return { error: 'تعذر تحميل الملف' }
  }
}

function FileRow({
  title,
  kind,
  hasFile,
  debtorId,
  canEdit,
  emptyLabel,
  onReplaced,
}: {
  title: string
  kind: FileKind
  hasFile: boolean
  debtorId: string
  canEdit: boolean
  emptyLabel: string
  onReplaced: (kind: FileKind, path: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const openOrDownload = useCallback(async (download: boolean) => {
    setError('')
    setSuccess('')
    setBusy(true)
    setProgress('جاري تجهيز الرابط…')
    const result = await fetchSignedUrl(debtorId, kind)
    setBusy(false)
    setProgress('')
    if (result.missing) {
      setError(emptyLabel)
      return
    }
    if (result.error || !result.url) {
      setError(result.error ?? 'تعذر تحميل الملف')
      return
    }
    if (download) {
      const a = document.createElement('a')
      a.href = result.url
      a.download = kind === 'petition' ? 'petition.pdf' : 'documents.pdf'
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    } else {
      window.open(result.url, '_blank', 'noopener,noreferrer')
    }
  }, [debtorId, kind, emptyLabel])

  const upload = useCallback(async (file: File | null) => {
    if (!file || busy) return
    setError('')
    setSuccess('')
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      setError('يجب أن يكون الملف بصيغة PDF فقط')
      return
    }
    setBusy(true)
    setProgress('جاري الرفع…')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch(`/api/admin/debtors/${debtorId}/criminal-file`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل رفع الملف')
        return
      }
      onReplaced(kind, String(data.filePath ?? ''))
      setSuccess(hasFile ? 'تم استبدال الملف بنجاح' : 'تم رفع الملف بنجاح')
    } catch {
      setError('فشل رفع الملف — يمكنك إعادة المحاولة')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }, [busy, debtorId, kind, hasFile, onReplaced])

  return (
    <div className="rounded-xl border border-[rgba(118,118,118,0.12)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#231F20]">{title}</h3>
        <span className="text-xs text-[#767676]">{hasFile ? 'مرفوع' : 'غير مرفوع'}</span>
      </div>
      {!hasFile && <p className="text-xs text-[#767676]">{emptyLabel}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy || !hasFile} onClick={() => openOrDownload(false)}>
          عرض
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy || !hasFile} onClick={() => openOrDownload(true)}>
          تنزيل
        </Button>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={e => {
                const f = e.target.files?.[0] ?? null
                e.target.value = ''
                void upload(f)
              }}
            />
            <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
              {hasFile ? 'استبدال' : 'رفع'}
            </Button>
          </>
        )}
        {error && canEdit && (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            إعادة المحاولة
          </Button>
        )}
      </div>
      {progress && <p className="text-xs text-[#2C8780]">{progress}</p>}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      {success && <p className="text-xs text-emerald-600">{success}</p>}
    </div>
  )
}

/** قسم ملفات القضية الجزائية — لا يكسر الصفحة عند فشل التحميل */
export default function CriminalDebtorFilesPanel({
  debtorId,
  documentsPath: initialDocs,
  petitionPath: initialPetition,
  canEdit,
}: Props) {
  const [documentsPath, setDocumentsPath] = useState(initialDocs)
  const [petitionPath, setPetitionPath] = useState(initialPetition)

  function onReplaced(kind: FileKind, path: string) {
    if (kind === 'petition') setPetitionPath(path || petitionPath)
    else setDocumentsPath(path || documentsPath)
  }

  return (
    <Card>
      <CardHeader title="ملفات القضية الجزائية" />
      <div className="p-4 space-y-4">
        <FileRow
          title="المستمسكات والعقد"
          kind="documents"
          hasFile={Boolean(documentsPath)}
          debtorId={debtorId}
          canEdit={canEdit}
          emptyLabel="لم يتم رفع المستمسكات والعقد بعد."
          onReplaced={onReplaced}
        />
        <FileRow
          title="عريضة الدعوى"
          kind="petition"
          hasFile={Boolean(petitionPath)}
          debtorId={debtorId}
          canEdit={canEdit}
          emptyLabel="لم يتم رفع عريضة الدعوى بعد."
          onReplaced={onReplaced}
        />
      </div>
    </Card>
  )
}
