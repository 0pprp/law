/** Safe user-facing message from unknown errors (Supabase, Error, plain objects). */
export function formatErrorMessage(error: unknown): string {
  if (error == null) return 'حدث خطأ غير معروف'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || 'حدث خطأ غير معروف'

  const o = error as { message?: string; error_description?: string; details?: string; hint?: string }
  if (typeof o.message === 'string' && o.message.trim()) return o.message
  if (typeof o.error_description === 'string' && o.error_description.trim()) return o.error_description
  if (typeof o.details === 'string' && o.details.trim()) return o.details

  try {
    const json = JSON.stringify(error)
    if (json && json !== '{}') return json
  } catch {
    /* ignore */
  }
  return 'حدث خطأ غير معروف'
}
