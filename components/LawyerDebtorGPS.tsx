'use client'

import { useState } from 'react'

interface Props {
  latitude: number | null
  longitude: number | null
  locationCapturedAt?: string | null
}

function fmtCoord(v: number | null) {
  if (v == null) return null
  return v.toFixed(6)
}

export default function LawyerDebtorGPS({ latitude, longitude, locationCapturedAt }: Props) {
  const [copied, setCopied] = useState(false)
  const hasLocation = latitude != null && longitude != null
  const mapsUrl = hasLocation ? `https://www.google.com/maps?q=${latitude},${longitude}` : null

  async function copyLink() {
    if (!mapsUrl) return
    try {
      await navigator.clipboard.writeText(mapsUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.1)]">
        <h2 className="font-bold text-slate-700 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          موقع المدين
        </h2>
      </div>
      <div className="p-4">
        {hasLocation ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-50 rounded-lg p-2.5">
                <p className="text-[10px] text-slate-400 mb-0.5">خط العرض</p>
                <p className="text-sm font-bold text-slate-800 tabular-nums" dir="ltr">{fmtCoord(latitude)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2.5">
                <p className="text-[10px] text-slate-400 mb-0.5">خط الطول</p>
                <p className="text-sm font-bold text-slate-800 tabular-nums" dir="ltr">{fmtCoord(longitude)}</p>
              </div>
            </div>
            {locationCapturedAt && (
              <p className="text-[10px] text-slate-400">
                آخر تحديث: {new Date(locationCapturedAt).toLocaleDateString('ar-IQ')}
              </p>
            )}
            <div className="flex gap-2">
              <a
                href={mapsUrl!}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
              >
                فتح في الخريطة
              </a>
              <button
                type="button"
                onClick={copyLink}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 transition-colors"
              >
                {copied ? 'تم النسخ' : 'نسخ الرابط'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-3">لم يُسجَّل موقع بعد</p>
        )}
      </div>
    </div>
  )
}
