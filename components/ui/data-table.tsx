import { cn } from '@/lib/utils'
import { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import type { SortDirection } from '@/lib/table-sort'

function SortIndicator({ direction }: { direction: SortDirection | null | undefined }) {
  if (direction === 'asc') {
    return (
      <span className="inline-flex flex-col leading-none text-[9px] text-[#2C8780]" aria-hidden>
        <span>▲</span>
      </span>
    )
  }
  if (direction === 'desc') {
    return (
      <span className="inline-flex flex-col leading-none text-[9px] text-[#2C8780]" aria-hidden>
        <span>▼</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col leading-none text-[9px] text-[#767676]/45" aria-hidden>
      <span>▲</span>
      <span className="-mt-0.5">▼</span>
    </span>
  )
}

export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm min-w-[640px]', className)} {...props}>
        {children}
      </table>
    </div>
  )
}

export function THead({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('border-b border-[rgba(118,118,118,0.12)]', className)} {...props}>
      {children}
    </thead>
  )
}

export function TBody({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn('divide-y divide-[rgba(118,118,118,0.08)]', className)} {...props}>
      {children}
    </tbody>
  )
}

export function TR({ className, children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('hover:bg-[rgba(44,135,128,0.03)] transition-colors', className)} {...props}>
      {children}
    </tr>
  )
}

export function TH({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('text-right px-5 py-3.5 text-xs font-bold text-[#454042] bg-[rgba(118,118,118,0.05)] whitespace-nowrap', className)} {...props}>
      {children}
    </th>
  )
}

interface SortableTHProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> {
  /** مفتاح العمود للفرز */
  sortKey: string
  activeKey?: string | null
  direction?: SortDirection | null
  onCycle: (key: string) => void
  /** plain = جداول العمليات ذات الرأس الرمادي الفاتح */
  variant?: 'default' | 'plain'
}

/** رأس عمود قابل للفرز: ضغطة تصاعدي، ثانية تنازلي، ثالثة افتراضي */
export function SortableTH({
  sortKey,
  activeKey,
  direction,
  onCycle,
  variant = 'default',
  className,
  children,
  ...props
}: SortableTHProps) {
  const active = activeKey === sortKey ? direction ?? null : null
  const ariaSort = active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'

  return (
    <th
      {...props}
      aria-sort={ariaSort}
      className={cn(
        variant === 'default'
          ? 'text-right px-5 py-3.5 text-xs font-bold text-[#454042] bg-[rgba(118,118,118,0.05)] whitespace-nowrap'
          : 'px-4 py-2.5 font-semibold whitespace-nowrap',
        'cursor-pointer select-none hover:text-[#2C8780] transition-colors',
        className,
      )}
      onClick={() => onCycle(sortKey)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCycle(sortKey)
        }
      }}
      tabIndex={0}
      role="columnheader"
      title="فرز: تصاعدي ← تنازلي ← افتراضي"
    >
      <span className="inline-flex items-center gap-1.5">
        <span>{children}</span>
        <SortIndicator direction={active} />
      </span>
    </th>
  )
}

export function TD({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-5 py-4 text-sm text-[#231F20] font-medium', className)} {...props}>
      {children}
    </td>
  )
}

interface DataTableProps {
  columns: { key: string; label: string; className?: string }[]
  rows: React.ReactNode[]
  loading?: boolean
  empty?: React.ReactNode
  className?: string
}

export function DataTable({ columns, rows, loading, empty, className }: DataTableProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden', className)}>
      <Table>
        <THead>
          <tr>
            {columns.map(col => (
              <TH key={col.key} className={col.className}>{col.label}</TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-sm text-[#454042]">جارٍ التحميل...</p>
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : rows}
        </TBody>
      </Table>
    </div>
  )
}
