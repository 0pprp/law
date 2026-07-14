'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import { fetchSelectableBranches } from '@/lib/branches-cache'
import { isMainBranchName } from '@/lib/branch-constants'
import { PremiumSelect } from '@/components/ui/premium-select'

export const OPERATION_BRANCH_REQUIRED_MSG =
  'يرجى اختيار الفرع الذي ستُسجّل عليه العملية'

/** فرع فعّال للكتابة: الفرع المختار في الشريط، أو فرع يختاره المستخدم عند وضع «الكل». */
export function useOperationBranch() {
  const cookieBranchId = useBranchId()
  const { branchName, viewAllBranches } = useBranch()
  const [pickedId, setPickedId] = useState('')
  const [pickedName, setPickedName] = useState('')

  const needsPick = viewAllBranches || !cookieBranchId
  const effectiveBranchId = needsPick ? (pickedId || null) : cookieBranchId
  const effectiveBranchName = needsPick ? (pickedName || null) : branchName

  function setPickedBranch(id: string, name?: string) {
    setPickedId(id)
    if (name !== undefined) setPickedName(name)
  }

  function validateOperationBranch(): string | null {
    if (!effectiveBranchId || isMainBranchName(effectiveBranchName)) {
      return OPERATION_BRANCH_REQUIRED_MSG
    }
    return null
  }

  return {
    needsPick,
    viewAllBranches,
    effectiveBranchId,
    effectiveBranchName,
    pickedId,
    setPickedBranch,
    validateOperationBranch,
  }
}

type Props = {
  value: string
  onChange: (id: string, name: string) => void
  className?: string
}

/** قائمة فروع حقيقية للعمليات الإنشائية عند اختيار «الكل». */
export function OperationBranchSelect({ value, onChange, className }: Props) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    fetchSelectableBranches(createClient()).then(list => {
      setOptions(list.map(b => ({ value: b.id, label: b.name })))
    })
  }, [])

  return (
    <div className={className}>
      <label className="block text-sm font-semibold text-[#231F20] mb-1.5">
        الفرع <span className="text-red-500">*</span>
      </label>
      <PremiumSelect
        value={value}
        onChange={id => {
          const name = options.find(o => o.value === id)?.label ?? ''
          onChange(id, name)
        }}
        options={[
          { value: '', label: '— اختر الفرع —' },
          ...options,
        ]}
        placeholder="اختر الفرع"
      />
      <p className="text-xs text-[#767676] mt-1.5">
        وضع «الكل» للعرض فقط — يجب اختيار فرع حقيقي قبل الحفظ.
      </p>
    </div>
  )
}
