import { fmtMoney } from '@/lib/utils'
import { LAWYER_WALLET_LABELS } from '@/lib/types'

interface Props {
  feeBalance: number
  savingsBalance: number
  compact?: boolean
}

export default function LawyerWalletSummary({ feeBalance, savingsBalance, compact }: Props) {
  const feesAvailable = Math.max(0, feeBalance)
  const feesHint = feeBalance < 0
    ? `الرصيد الصافي سالب — وُجدت حركات صرف سابقة (${fmtMoney(feeBalance)})`
    : 'المتاح للصرف — من المهام المعتمدة'
  const feesColor = feeBalance < 0 ? 'text-red-600' : 'text-[#2C8780]'
  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-[#2C8780]/30 rounded-xl px-4 py-2.5 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium mb-0.5">{LAWYER_WALLET_LABELS.fees}</p>
          <p className={`font-black text-sm tabular-nums ${feesColor}`} dir="ltr">{fmtMoney(feesAvailable)}</p>
          {feeBalance < 0 && (
            <p className="text-[10px] text-red-500 tabular-nums" dir="ltr">صافي: {fmtMoney(feeBalance)}</p>
          )}
        </div>
        <div className="bg-white border border-sky-200 rounded-xl px-4 py-2.5 shadow-sm">
          <p className="text-[10px] text-slate-400 font-medium mb-0.5">{LAWYER_WALLET_LABELS.savings}</p>
          <p className="font-black text-sky-600 text-sm tabular-nums" dir="ltr">{fmtMoney(savingsBalance)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-white rounded-3xl border border-[#2C8780]/20 shadow-sm p-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[#767676] mb-1">{LAWYER_WALLET_LABELS.fees}</p>
          <p className={`text-xl font-black leading-tight tabular-nums truncate ${feesColor}`} dir="ltr">{fmtMoney(feesAvailable)}</p>
          {feeBalance < 0 && (
            <p className="text-[10px] text-red-500 tabular-nums" dir="ltr">صافي المحفظة: {fmtMoney(feeBalance)}</p>
          )}
          <p className="text-[10px] text-[#767676] mt-1">{feesHint}</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-[#2C8780]/10 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <div className="bg-white rounded-3xl border border-sky-200 shadow-sm p-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[#767676] mb-1">{LAWYER_WALLET_LABELS.savings}</p>
          <p className="text-xl font-black text-sky-600 leading-tight tabular-nums truncate" dir="ltr">{fmtMoney(savingsBalance)}</p>
          <p className="text-[10px] text-[#767676] mt-1">إضافة وسحب — منفصلة عن الأتعاب</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
      </div>
    </div>
  )
}
