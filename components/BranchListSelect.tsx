'use client'

import { PremiumSelect } from '@/components/ui/premium-select'
import type { BranchList } from '@/lib/branch-lists'

interface Props {
  value: string
  onChange: (value: string) => void
  lists: BranchList[]
  placeholder?: string
  headerTitle?: string
  allowEmpty?: boolean
  emptyLabel?: string
  disabled?: boolean
  className?: string
}

export default function BranchListSelect({
  value,
  onChange,
  lists,
  placeholder = '— اختر القائمة —',
  headerTitle = 'القائمة',
  allowEmpty = true,
  emptyLabel = 'بدون قائمة',
  disabled,
  className,
}: Props) {
  const options = [
    ...(allowEmpty ? [{ value: '', label: emptyLabel }] : []),
    ...lists.map(l => ({ value: l.id, label: l.name })),
  ]

  return (
    <PremiumSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      headerTitle={headerTitle}
      searchPlaceholder="بحث..."
      disabled={disabled}
      className={className}
    />
  )
}

/** فلتر القائمة — يتضمن خيار «كل القوائم» + أسماء قوائم الفرع */
export function BranchListFilterSelect({
  value,
  onChange,
  lists,
  className,
}: Omit<Props, 'allowEmpty' | 'emptyLabel' | 'placeholder' | 'headerTitle'>) {
  const options = [
    { value: '', label: 'كل القوائم' },
    ...lists.map(l => ({ value: l.id, label: l.name })),
  ]

  return (
    <PremiumSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder="كل القوائم"
      fieldLabel="فلترة حسب القائمة"
      headerTitle="فلترة حسب القائمة"
      headerSubtitle={lists.length ? `${lists.length} قائمة في الفرع` : 'لا توجد قوائم — أضفها من إعدادات الفرع'}
      searchPlaceholder="بحث باسم القائمة..."
      searchable
      className={className}
    />
  )
}
