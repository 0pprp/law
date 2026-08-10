'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { uploadDebtorPdfFile } from '@/lib/debtor-file-upload'
import { appAlert } from '@/lib/app-dialog'

export default function ChiefAccountantUploadButton({ debtorId }: { debtorId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function onPick(file: File | null) {
    if (!file) return
    setUploading(true)
    try {
      await uploadDebtorPdfFile(debtorId, file)
      router.refresh()
    } catch (e) {
      await appAlert({
        title: 'فشل الرفع',
        message: e instanceof Error ? e.message : 'تعذر رفع الملف',
      })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={e => void onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="text-xs font-bold text-[#0369a1] border border-sky-200 hover:bg-sky-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
      >
        {uploading ? 'جارٍ الرفع...' : '+ رفع PDF'}
      </button>
    </>
  )
}
