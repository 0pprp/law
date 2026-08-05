/** طلب «إرسال بدون إنجاز» — يراجع في /admin/tasks/incomplete */

export const INCOMPLETE_REQUEST_FLAG = 'incomplete_without_completion'
export const INCOMPLETE_REASON_KEY = 'incomplete_reason'

export function isIncompleteCompletionRequest(
  task: {
    incomplete_request?: boolean | null
    completion_data?: Record<string, unknown> | null
  } | null | undefined,
): boolean {
  if (!task) return false
  if (task.incomplete_request === true) return true
  const data = task.completion_data
  if (!data || typeof data !== 'object') return false
  const flag = data[INCOMPLETE_REQUEST_FLAG]
  return flag === true || flag === '1' || flag === 'true' || flag === 1
}

export function readIncompleteReason(
  task: {
    incomplete_reason?: string | null
    lawyer_notes?: string | null
    completion_data?: Record<string, unknown> | null
  } | null | undefined,
): string {
  if (!task) return ''
  const fromCol = typeof task.incomplete_reason === 'string' ? task.incomplete_reason.trim() : ''
  if (fromCol) return fromCol
  const data = task.completion_data
  if (data && typeof data === 'object') {
    const raw = data[INCOMPLETE_REASON_KEY]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  const notes = typeof task.lawyer_notes === 'string' ? task.lawyer_notes.trim() : ''
  return notes
}

export function buildIncompleteCompletionData(reason: string): Record<string, string> {
  return {
    [INCOMPLETE_REQUEST_FLAG]: '1',
    [INCOMPLETE_REASON_KEY]: reason.trim(),
  }
}
