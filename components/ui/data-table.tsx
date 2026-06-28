import { cn } from '@/lib/utils'
import { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'

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
