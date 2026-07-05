'use client'

import { useState } from 'react'
import DebtorPaymentModal from '@/components/DebtorPaymentModal'

interface Props {
  debtorId: string
  debtorName: string
  receiptNumber: string | null
  remainingAmount: number
  branchId?: string | null
}

export default function DebtorAccountPaymentButton({
  debtorId,
  debtorName,
  receiptNumber,
  remainingAmount,
  branchId,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-white px-3 py-1.5 rounded-lg transition-colors font-semibold hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
      >
        + تسجيل تسديد
      </button>
      <DebtorPaymentModal
        open={open}
        onClose={() => setOpen(false)}
        debtorId={debtorId}
        debtorName={debtorName}
        receiptNumber={receiptNumber}
        remainingAmount={remainingAmount}
        branchId={branchId}
      />
    </>
  )
}
