/** رفع مستمسكات محامي عبر API (يتجاوز RLS بأمان) */
export async function uploadLawyerAttachment(
  lawyerId: string,
  file: File,
  description?: string | null,
): Promise<{ ok: true; attachment?: Record<string, unknown> } | { ok: false; error: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('lawyerId', lawyerId)
  if (description?.trim()) formData.append('description', description.trim())

  const res = await fetch('/api/admin/upload-lawyer-file', {
    method: 'POST',
    body: formData,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error ?? 'فشل رفع الملف' }
  }
  return { ok: true, attachment: (data as { attachment?: Record<string, unknown> }).attachment }
}
