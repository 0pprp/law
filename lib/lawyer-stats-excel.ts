import { fmtDate } from '@/lib/utils'
import { achievementDate, achievementFee, achievementLabel } from '@/lib/achievement-report'
import { STATIONERY_ITEM_LABELS, type LawyerCompletedTaskRow, type LawyerExpenseRow } from '@/lib/admin-lawyer-stats'
import type { LawyerWalletRow } from '@/lib/lawyer-wallet'
import type { StationeryTxRow } from '@/lib/lawyer-stationery-wallet'
import type { LawyerWalletKind, WalletTransactionType } from '@/lib/types'
import { walletTransactionLabel } from '@/lib/wallet-transaction-display'

export const EXPORT_LIMIT = 5000

export const EXPORT_SECTIONS = [
  { key: 'tasks', label: 'المهام المنجزة', hint: 'كل المهام المنجزة مع المدين والأتعاب والتاريخ' },
  { key: 'fees', label: 'سجل الأتعاب', hint: 'حركات محفظة الأتعاب كاملة مع التواريخ' },
  { key: 'expenses', label: 'الصرفيات', hint: 'سجل الصرفيات + محفظة الصرفيات مع التواريخ' },
  { key: 'stationery', label: 'القرطاسية', hint: 'حركات الطوابع كاملة مع التواريخ' },
] as const

export type ExportSectionKey = (typeof EXPORT_SECTIONS)[number]['key']
export type ExportChoice = Record<ExportSectionKey, boolean>

export const DEFAULT_EXPORT_CHOICE: ExportChoice = { tasks: true, fees: true, expenses: true, stationery: true }

export const STATIONERY_TYPE_LABELS: Record<string, string> = {
  deposit: 'إيداع',
  withdrawal: 'سحب',
  lawsuit_deduction: 'خصم دعوى',
}

export function ymdOf(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.split('T')[0]
}

export function inExportDateRange(ymd: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && ymd < dateFrom) return false
  if (dateTo && ymd > dateTo) return false
  return true
}

export function safeExcelName(name: string, max = 31) {
  return name.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'ورقة'
}

export function lawyerTypeLabel(t: string | null | undefined) {
  if (t === 'general') return 'محامي عام'
  return 'محامي فرع'
}

export function caseTypeLabel(t: string | null | undefined) {
  if (t === 'criminal') return 'جزائي'
  if (t === 'civil') return 'مدني'
  return null
}

export function expenseStatusLabel(s: string | null | undefined) {
  const v = (s ?? 'approved').toLowerCase()
  if (v === 'pending' || v === 'pending_review' || v === 'pending_approval') return 'بانتظار'
  if (v === 'rejected') return 'مرفوضة'
  if (v === 'approved') return 'معتمدة'
  return s ?? '—'
}

export function lawyerInitials(name: string | null | undefined) {
  return (name || 'م').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')
}

export function walletTxRows(rows: LawyerWalletRow[]) {
  return rows.map(tx => {
    const amt = Number(tx.amount ?? 0)
    const wallet = (tx.wallet ?? 'fees') as LawyerWalletKind
    return {
      'المبلغ': amt,
      'النوع': walletTransactionLabel(tx.type as WalletTransactionType, wallet, amt),
      'ملاحظة': tx.notes ?? '—',
      'التاريخ': tx.created_at ? fmtDate(tx.created_at) : '—',
    }
  })
}

export function sheetOrEmpty(
  XLSX: typeof import('xlsx'),
  rows: Record<string, unknown>[],
  emptyNote: string,
) {
  if (rows.length) return XLSX.utils.json_to_sheet(rows)
  return XLSX.utils.json_to_sheet([{ 'ملاحظة': emptyNote }])
}

export function taskSheetRows(rows: LawyerCompletedTaskRow[], viewerRole?: string | null) {
  return rows.map(t => ({
    'المهمة': achievementLabel(t),
    'المدين': t.debtors?.full_name ?? '—',
    'رقم الوصل': t.debtors?.receipt_number ?? '—',
    'الأتعاب': achievementFee(t, viewerRole),
    'التاريخ': achievementDate(t) || '—',
  }))
}

export function expenseSheetRows(rows: LawyerExpenseRow[]) {
  return rows.map(e => ({
    'النوع': e.expense_type ?? '—',
    'المدين': e.debtors?.full_name ?? '—',
    'المبلغ': Number(e.amount ?? 0),
    'الحالة': expenseStatusLabel(e.status),
    'التاريخ': e.expense_date ? fmtDate(e.expense_date) : '—',
    'الوصف': e.description ?? '—',
    'المهمة': e.tasks?.task_definitions?.label ?? e.tasks?.task_type ?? '—',
  }))
}

export function stationerySheetRows(rows: StationeryTxRow[]) {
  return rows.map(tx => {
    const amt = Number(tx.amount ?? 0)
    const itemLabel = STATIONERY_ITEM_LABELS[tx.item] ?? tx.item
    const typeLabel = STATIONERY_TYPE_LABELS[tx.type] ?? tx.type
    return {
      'التاريخ': tx.created_at ? fmtDate(tx.created_at) : '—',
      'الكمية/الصنف': `${amt > 0 ? '+' : ''}${amt} ${itemLabel}`.trim(),
      'الكمية': amt,
      'الصنف': itemLabel,
      'النوع': typeLabel,
      'البيان': [typeLabel, tx.notes].filter(Boolean).join(' — ') || '—',
    }
  })
}
