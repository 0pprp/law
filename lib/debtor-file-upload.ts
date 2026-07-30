/** رفع PDF مدين مباشرة إلى R2 عبر رابط مؤقت، ثم تثبيت المرفق عبر API الإدارة. */
export async function uploadDebtorPdfFile(
  debtorId: string,
  file: File,
): Promise<{ filePath: string; attachmentId: string }> {
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('يجب أن يكون الملف بصيغة PDF فقط')
  }

  // تحت 4MB: الرفع عبر الخادم أكثر توافقاً مع بيئات الإنتاج ولا يحتاج CORS.
  if (file.size <= 4 * 1024 * 1024) {
    const form = new FormData()
    form.append('debtorId', debtorId)
    form.append('file', file)
    const res = await fetch('/api/admin/upload-debtor-file', {
      method: 'POST',
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : `فشل رفع ملف PDF (${res.status})`)
    }
    return {
      filePath: data.filePath as string,
      attachmentId: data.attachment?.id as string,
    }
  }

  const prepareRes = await fetch('/api/admin/upload-debtor-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'prepare',
      debtorId,
      fileName: file.name,
      fileSize: file.size,
    }),
  })
  const prepare = await prepareRes.json().catch(() => ({}))
  if (!prepareRes.ok || !prepare.uploadUrl || !prepare.filePath) {
    throw new Error(typeof prepare.error === 'string' ? prepare.error : 'تعذر تجهيز رفع الملف')
  }

  const uploadRes = await fetch(String(prepare.uploadUrl), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  })
  if (!uploadRes.ok) {
    const responseText = await uploadRes.text().catch(() => '')
    console.error('[uploadDebtorPdfFile:direct-r2] Upload failed', {
      status: uploadRes.status,
      statusText: uploadRes.statusText,
      response: responseText.slice(0, 1000),
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    })
    throw new Error(
      `فشل رفع الملف مباشرة إلى R2 (${uploadRes.status}${uploadRes.statusText ? ` ${uploadRes.statusText}` : ''}). تحقق من CORS الخاص بالباكت.`,
    )
  }

  const commitRes = await fetch('/api/admin/upload-debtor-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'commit',
      debtorId,
      fileName: file.name,
      fileSize: file.size,
      filePath: prepare.filePath,
    }),
  })
  const data = await commitRes.json().catch(() => ({}))
  if (!commitRes.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'فشل تثبيت ملف PDF')
  }

  return {
    filePath: data.filePath as string,
    attachmentId: data.attachment?.id as string,
  }
}
