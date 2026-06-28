/** Local calendar date helpers (avoids UTC off-by-one in Iraq / UTC+3). */

export function localTodayYmd(from: Date = new Date()): string {
  const y = from.getFullYear()
  const m = String(from.getMonth() + 1).padStart(2, '0')
  const d = String(from.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999)
}

export function endOfNextLocalDay(from: Date = new Date()): Date {
  const expires = new Date(from)
  expires.setDate(expires.getDate() + 1)
  expires.setHours(23, 59, 59, 999)
  return expires
}

/** True only after the due calendar day has passed (last day is still valid). */
export function isTaskOverdue(dueYmd: string | null | undefined): boolean {
  if (!dueYmd) return false
  return dueYmd < localTodayYmd()
}

export function isTaskDueToday(dueYmd: string | null | undefined): boolean {
  if (!dueYmd) return false
  return dueYmd === localTodayYmd()
}

export function formatLocalDeadlineFromIso(iso: string): string {
  const d = new Date(iso)
  const ymd = localTodayYmd(d)
  const [y, m, day] = ymd.split('-').map(Number)
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ]
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `نهاية يوم ${day} ${months[m - 1]} ${y} (${hours}:${minutes})`
}
