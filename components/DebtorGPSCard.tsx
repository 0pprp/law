'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'

interface Props {
  debtorId: string
  latitude: number | null
  longitude: number | null
  locationCapturedAt: string | null
  readOnly?: boolean
}

function fmtCoord(v: number | null) {
  if (v == null) return null
  return v.toFixed(6)
}

export default function DebtorGPSCard({ debtorId, latitude, longitude, locationCapturedAt, readOnly = false }: Props) {
  const [lat, setLat] = useState(latitude?.toString() ?? '')
  const [lng, setLng] = useState(longitude?.toString() ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [currentLat, setCurrentLat] = useState(latitude)
  const [currentLng, setCurrentLng] = useState(longitude)
  const [capturedAt, setCapturedAt] = useState(locationCapturedAt)

  const hasLocation = currentLat != null && currentLng != null
  const mapsUrl = hasLocation ? `https://www.google.com/maps?q=${currentLat},${currentLng}` : null

  async function save() {
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (isNaN(latNum) || latNum < -90 || latNum > 90) { setError('خط العرض غير صالح (−90 إلى 90)'); return }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) { setError('خط الطول غير صالح (−180 إلى 180)'); return }
    setSaving(true); setError('')
    const supabase = createClient()
    const now = new Date().toISOString()
    const { error: dbErr } = await supabase.from('debtors').update({
      latitude: latNum,
      longitude: lngNum,
      location_captured_at: now,
    }).eq('id', debtorId)
    if (dbErr) { setError(dbErr.message); setSaving(false); return }
    await logActivity({ action: 'update_debtor_gps', entity_type: 'debtor', entity_id: debtorId, description: `تحديث موقع المدين: ${latNum}, ${lngNum}` }, supabase)
    setCurrentLat(latNum); setCurrentLng(lngNum); setCapturedAt(now)
    setSaving(false); setEditing(false)
  }

  function getCurrentLocation() {
    if (!navigator.geolocation) { setError('المتصفح لا يدعم GPS'); return }
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)) },
      () => setError('تعذر الحصول على الموقع')
    )
  }

  return (
    <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-[rgba(118,118,118,0.08)] bg-[#F3F1F2]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h3 className="font-bold text-[#231F20] text-sm">موقع المدين</h3>
        </div>
        {!editing && !readOnly && (
          <button onClick={() => { setEditing(true); setLat(currentLat?.toString() ?? ''); setLng(currentLng?.toString() ?? ''); setError('') }}
            className="text-xs font-semibold text-[#2C8780] hover:underline">
            {hasLocation ? 'تحديث' : 'إضافة موقع'}
          </button>
        )}
      </div>

      <div className="p-4">
        {editing ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-[#767676] mb-1">خط العرض (Latitude)</label>
                <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)}
                  placeholder="33.3152"
                  className="w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]"
                  dir="ltr" />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] text-[#767676] mb-1">خط الطول (Longitude)</label>
                <input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)}
                  placeholder="44.3661"
                  className="w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]"
                  dir="ltr" />
              </div>
            </div>
            <button onClick={getCurrentLocation}
              className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 rounded-lg py-2 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              استخدام موقعي الحالي
            </button>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={saving}
                className="flex-1 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60 transition-colors"
                style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                {saving ? 'جارٍ الحفظ...' : 'حفظ الموقع'}
              </button>
              <button onClick={() => { setEditing(false); setError('') }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] hover:bg-slate-50">
                إلغاء
              </button>
            </div>
          </div>
        ) : hasLocation ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F3F1F2] rounded-lg p-3">
                <p className="text-[10px] text-[#767676] mb-1">خط العرض</p>
                <p className="text-sm font-black text-[#231F20] tabular-nums" dir="ltr">{fmtCoord(currentLat)}</p>
              </div>
              <div className="bg-[#F3F1F2] rounded-lg p-3">
                <p className="text-[10px] text-[#767676] mb-1">خط الطول</p>
                <p className="text-sm font-black text-[#231F20] tabular-nums" dir="ltr">{fmtCoord(currentLng)}</p>
              </div>
            </div>
            {capturedAt && (
              <p className="text-[10px] text-[#767676]">
                آخر تحديث: {new Date(capturedAt).toLocaleDateString('ar-IQ')}
              </p>
            )}
            <a href={mapsUrl!} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              فتح الموقع على خرائط Google
            </a>
          </div>
        ) : (
          <div className="py-4 text-center">
            <div className="w-10 h-10 bg-[#F3F1F2] rounded-xl flex items-center justify-center mx-auto mb-2">
              <svg className="w-5 h-5 text-[#767676]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
            </div>
            <p className="text-sm text-[#767676]">لم يُسجَّل موقع بعد</p>
          </div>
        )}
      </div>
    </div>
  )
}
