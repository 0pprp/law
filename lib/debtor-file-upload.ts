/** رفع PDF مدين عبر API الإدارة (يتجاوز RLS للتخزين). */
export async function uploadDebtorPdfFile(
  debtorId: string,
  file: File,
): Promise<{ filePath: string; attachmentId: string }> {
  const form = new FormData()
  form.append('debtorId', debtorId)
  form.append('file', file)

  const res = await fetch('/api/admin/upload-debtor-file', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'فشل رفع ملف PDF')
  }
  return {
    filePath: data.filePath as string,
    attachmentId: data.attachment?.id as string,
  }
}
