/** الأسماء التي تحتاج مراقبة — صفات المدينين (special_statuses) */

export type SpecialStatusColor = 'red' | 'yellow' | 'green' | 'purple' | 'blue' | 'gray'

export interface SpecialStatus {
  id: string
  branch_id: string
  name: string
  color: SpecialStatusColor | string
  sort_order: number
  is_active: boolean
  created_at?: string
  updated_at?: string
  debtor_count?: number
  /** عند «كل الفروع»: معرّفات نسخ الصفة بنفس الاسم في كل الفروع */
  ids?: string[]
}

export const SPECIAL_STATUS_DEBTOR_COLS =
  ', special_status_id, special_status:special_statuses(id, name, color)'

export const SPECIAL_STATUS_COLOR_OPTIONS: {
  value: SpecialStatusColor
  label: string
  swatch: string
  badge: string
  bar: string
  cardBorder: string
  cardBg: string
}[] = [
  { value: 'red', label: 'أحمر', swatch: 'bg-red-500', badge: 'bg-red-100 text-red-800 border-red-200', bar: 'bg-red-500', cardBorder: 'border-red-200', cardBg: 'bg-red-50/60' },
  { value: 'yellow', label: 'أصفر', swatch: 'bg-amber-400', badge: 'bg-amber-100 text-amber-900 border-amber-200', bar: 'bg-amber-400', cardBorder: 'border-amber-200', cardBg: 'bg-amber-50/60' },
  { value: 'green', label: 'أخضر', swatch: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500', cardBorder: 'border-emerald-200', cardBg: 'bg-emerald-50/60' },
  { value: 'purple', label: 'بنفسجي', swatch: 'bg-purple-500', badge: 'bg-purple-100 text-purple-800 border-purple-200', bar: 'bg-purple-500', cardBorder: 'border-purple-200', cardBg: 'bg-purple-50/60' },
  { value: 'blue', label: 'أزرق', swatch: 'bg-blue-500', badge: 'bg-blue-100 text-blue-800 border-blue-200', bar: 'bg-blue-500', cardBorder: 'border-blue-200', cardBg: 'bg-blue-50/60' },
  { value: 'gray', label: 'رمادي', swatch: 'bg-slate-400', badge: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-slate-400', cardBorder: 'border-slate-200', cardBg: 'bg-slate-50/60' },
]

const COLOR_MAP = new Map(SPECIAL_STATUS_COLOR_OPTIONS.map(o => [o.value, o]))

export function normalizeSpecialStatusColor(color: string | null | undefined): SpecialStatusColor {
  const v = String(color ?? '').trim().toLowerCase()
  if (COLOR_MAP.has(v as SpecialStatusColor)) return v as SpecialStatusColor
  return 'gray'
}

export function specialStatusColorOption(color: string | null | undefined) {
  return COLOR_MAP.get(normalizeSpecialStatusColor(color)) ?? COLOR_MAP.get('gray')!
}

type EmbedRow = { id?: string; name?: string | null; color?: string | null } | null | undefined

function embedRow(embed: EmbedRow | EmbedRow[]): EmbedRow {
  if (!embed) return null
  return Array.isArray(embed) ? embed[0] : embed
}

export function resolveSpecialStatus(embed: EmbedRow | EmbedRow[] | null | undefined): {
  id: string | null
  name: string | null
  color: string | null
} {
  const row = embedRow(embed as EmbedRow | EmbedRow[])
  if (!row) return { id: null, name: null, color: null }
  const name = row.name?.trim() || null
  const color = row.color?.trim() || null
  return { id: row.id ?? null, name, color }
}

export function isValidSpecialStatusColor(color: unknown): color is SpecialStatusColor {
  return typeof color === 'string' && COLOR_MAP.has(color as SpecialStatusColor)
}
