'use client'

import { STATIONERY_WALLET_LABEL } from '@/lib/lawyer-stationery-wallet'

interface Props {
  stampsBalance: number
  compact?: boolean
}

export default function LawyerStationerySummary({ stampsBalance, compact }: Props) {
  if (compact) {
    return (
      <div className="bg-white border border-emerald-200 rounded-xl px-4 py-2.5 shadow-sm">
        <p className="text-[10px] text-slate-400 font-medium mb-0.5">{STATIONERY_WALLET_LABEL}</p>
        <p className="text-[10px] text-slate-400">رقم الطوابع</p>
        <p className="font-black text-sm text-emerald-700 tabular-nums">{stampsBalance}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-3xl border border-emerald-200 shadow-sm p-5 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-[#767676] mb-2">{STATIONERY_WALLET_LABEL}</p>
        <p className="text-[10px] text-slate-400 mb-0.5">رقم الطوابع</p>
        <p className="text-xl font-black text-emerald-700 leading-tight tabular-nums">{stampsBalance}</p>
        <p className="text-[10px] text-[#767676] mt-2">يُخصم تلقائياً عند اعتماد إنجاز إقامة دعوى</p>
      </div>
      <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
    </div>
  )
}
