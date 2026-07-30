export type HearingStatus = 'red' | 'yellow' | 'gray' | null

function calendarDayUtc(value: string | Date): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim().slice(0, 10))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = Date.UTC(year, month - 1, day)
  const parsed = new Date(utc)
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null
  }
  return utc
}

/** الأيام المتبقية حتى الموعد؛ 0 = اليوم، والسالب يعني أن الموعد مضى. */
export function getDaysUntilHearing(date: string | Date | null | undefined): number | null {
  if (date == null) return null
  const hearingDay = calendarDayUtc(date)
  if (hearingDay == null) return null

  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((hearingDay - today) / 86_400_000)
}

/**
 * حالة التحذير — عامة لأي مهمة فيها تاريخ جلسة/مرافعة.
 * gray = مضى الموعد | red = يومان أو أقل | yellow = 3 أيام | null = بعيد/فارغ
 */
export function getHearingDateStatus(date: string | Date | null | undefined): HearingStatus {
  const days = getDaysUntilHearing(date)
  if (days == null) return null
  if (days < 0) return 'gray'
  if (days <= 2) return 'red'
  if (days <= 3) return 'yellow'
  return null
}
