/** فرز جداول الواجهة: تصاعدي → تنازلي → افتراضي */

export type SortDirection = 'asc' | 'desc'

export type SortValue = string | number | boolean | null | undefined | Date

export interface TableSortState {
  key: string | null
  direction: SortDirection | null
}

export function cycleTableSort(current: TableSortState, nextKey: string): TableSortState {
  if (current.key !== nextKey || !current.direction) {
    return { key: nextKey, direction: 'asc' }
  }
  if (current.direction === 'asc') {
    return { key: nextKey, direction: 'desc' }
  }
  return { key: null, direction: null }
}

function normalizeComparable(value: SortValue): string | number | boolean | null {
  if (value == null) return null
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  const s = String(value).trim()
  if (!s) return null
  // تاريخ ISO / YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s)
    if (Number.isFinite(t)) return t
  }
  // رقم مع فواصل
  const compact = s.replace(/,/g, '').replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)] ?? d)
  if (/^-?\d+(\.\d+)?$/.test(compact)) {
    const n = Number(compact)
    if (Number.isFinite(n)) return n
  }
  return s
}

export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const av = normalizeComparable(a)
  const bv = normalizeComparable(b)
  const emptyFirst = direction === 'asc' ? 1 : -1

  if (av == null && bv == null) return 0
  if (av == null) return emptyFirst
  if (bv == null) return -emptyFirst

  let cmp = 0
  if (typeof av === 'number' && typeof bv === 'number') {
    cmp = av - bv
  } else if (typeof av === 'boolean' && typeof bv === 'boolean') {
    cmp = Number(av) - Number(bv)
  } else {
    cmp = String(av).localeCompare(String(bv), 'ar', { numeric: true, sensitivity: 'base' })
  }
  return direction === 'asc' ? cmp : -cmp
}

export function sortRowsBy<T>(
  rows: readonly T[],
  getValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareSortValues(getValue(a.row), getValue(b.row), direction)
      return cmp !== 0 ? cmp : a.index - b.index
    })
    .map(x => x.row)
}
