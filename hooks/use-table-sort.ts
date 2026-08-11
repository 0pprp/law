'use client'

import { useMemo, useRef, useState } from 'react'
import {
  cycleTableSort,
  sortRowsBy,
  type SortDirection,
  type SortValue,
  type TableSortState,
} from '@/lib/table-sort'

export type TableSortAccessors<T> = Record<string, (row: T) => SortValue>

export function useTableSort<T>(rows: readonly T[], accessors: TableSortAccessors<T>) {
  const [state, setState] = useState<TableSortState>({ key: null, direction: null })
  const accessorsRef = useRef(accessors)
  accessorsRef.current = accessors

  const sortedRows = useMemo(() => {
    if (!state.key || !state.direction) return rows as T[]
    const getValue = accessorsRef.current[state.key]
    if (!getValue) return rows as T[]
    return sortRowsBy(rows, getValue, state.direction)
  }, [rows, state.key, state.direction])

  function cycleSort(key: string) {
    setState(prev => cycleTableSort(prev, key))
  }

  return {
    rows: sortedRows,
    sortKey: state.key,
    sortDirection: state.direction as SortDirection | null,
    cycleSort,
    isSorted: Boolean(state.key && state.direction),
  }
}
