'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import { DEBTOR_SEARCH_PLACEHOLDER } from '@/lib/debtor-search'
import { getDaysUntilHearing, getHearingDateStatus } from '@/lib/hearing-date-utils'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'
import type { ReceiptsPrepRow } from '@/lib/receipts-prep'

function HearingMeta({ date }: { date: string | null }) {
  const status = getHearingDateStatus(date)
  const days = getDaysUntilHearing(date)
  if (!date) {
    return <p className="text-xs font-bold text-[#767676]">بدون تاريخ</p>
  }
  return (
    <>
      <p className={`text-xs font-bold ${status === 'gray' ? 'text-gray-500' : 'text-[#231F20]'}`} dir="ltr">
        {fmtDate(date)}
      </p>
      <p className={`text-[10px] font-bold ${
        status === 'red' ? 'text-red-700'
          : status === 'yellow' ? 'text-yellow-700'
            : status === 'gray' ? 'text-gray-500'
              : 'text-[#2C8780]'
      }`}>
        {days == null
          ? '—'
          : days < 0
            ? `مضى منذ ${Math.abs(days)} يوم`
            : days === 0
              ? 'اليوم'
              : `متبقٍ ${days} يوم`}
      </p>
    </>
  )
}

export default function ReceiptsPrepCard({
  branchId,
  viewAllBranches,
  listId = null,
  caseType = null,
}: {
  branchId: string | null
  viewAllBranches: boolean
  listId?: string | null
  caseType?: 'civil' | 'criminal' | null
}) {
  const [rows, setRows] = useState<ReceiptsPrepRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!branchId && !viewAllBranches) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (viewAllBranches) params.set('viewAll', '1')
    else if (branchId) params.set('branchId', branchId)
    if (listId) params.set('listId', listId)
    if (caseType) params.set('caseType', caseType)
    try {
      const res = await fetch(`/api/admin/receipts-prep?${params}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'فشل تحميل الأسماء')
      }
      setRows(Array.isArray(data.rows) ? data.rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحميل الأسماء')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [branchId, viewAllBranches, listId, caseType])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => {
      const hay = [
        r.debtorName,
        r.phone,
        r.receiptNumber,
        r.courtName,
        r.branchListName,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search])

  async function togglePrepared(row: ReceiptsPrepRow, prepared: boolean) {
    if (savingId) return
    const prev = row.receiptsPrepared
    setSavingId(row.debtorId)
    setRows(list => list.map(r => r.debtorId === row.debtorId ? { ...r, receiptsPrepared: prepared } : r))
    try {
      const res = await fetch('/api/admin/receipts-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId: row.debtorId, prepared }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'فشل حفظ التأشير')
      }
      setRows(list => list.map(r =>
        r.debtorId === row.debtorId
          ? { ...r, receiptsPrepared: Boolean(data.receiptsPrepared) }
          : r,
      ))
      invalidateDashboardCounts()
    } catch (e) {
      setRows(list => list.map(r => r.debtorId === row.debtorId ? { ...r, receiptsPrepared: prev } : r))
      setError(e instanceof Error ? e.message : 'فشل حفظ التأشير')
    } finally {
      setSavingId(null)
    }
  }

  if (!branchId && !viewAllBranches) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
        اختر فرعاً من القائمة العلوية أو اختر «الكل».
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={DEBTOR_SEARCH_PLACEHOLDER}
          className="flex-1 min-w-[14rem] rounded-xl border border-[rgba(118,118,118,0.25)] px-3 py-2 text-sm"
        />
        <span className="text-xs font-bold text-[#767676] tabular-nums">
          {loading ? '...' : `${filtered.length} اسم`}
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[rgba(118,118,118,0.15)] bg-white px-4 py-8 text-center text-sm text-[#767676]">
          جارٍ التحميل...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[rgba(118,118,118,0.15)] bg-white px-4 py-8 text-center text-sm text-[#767676]">
          لا توجد أسماء في مرحلة المرافعات لتجهيز الوصولات
        </div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.1)] rounded-2xl border border-[rgba(118,118,118,0.15)] bg-white overflow-hidden">
          {filtered.map(row => {
            const primary =
              row.files.find(f => f.url && f.mimeType === 'application/pdf')
              ?? row.files.find(f => f.url)
              ?? row.files[0]
              ?? null
            const saving = savingId === row.debtorId
            return (
              <div
                key={row.debtorId}
                className={`flex flex-wrap items-center gap-3 px-4 py-4 transition-colors ${
                  row.receiptsPrepared
                    ? 'bg-emerald-50 hover:bg-emerald-100/70'
                    : 'hover:bg-[#F8F7F8]'
                }`}
              >
                <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.receiptsPrepared}
                    disabled={saving}
                    onChange={e => void togglePrepared(row, e.target.checked)}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span className={`text-[11px] font-bold ${row.receiptsPrepared ? 'text-emerald-800' : 'text-[#767676]'}`}>
                    {row.receiptsPrepared ? 'تم التجهيز' : 'تجهيز الوصل'}
                  </span>
                </label>

                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <span className="text-emerald-800 font-black text-sm">{row.debtorName.charAt(0)}</span>
                </div>

                <div className="flex-1 min-w-[12rem]">
                  <Link
                    href={`/admin/debtors/${row.debtorId}/account`}
                    className="text-sm font-bold text-[#231F20] hover:text-[#2C8780] transition-colors"
                  >
                    {row.debtorName}
                  </Link>
                  {(row.courtName || row.executionOffice) && (
                    <div className="mt-1 text-sm font-semibold text-[#1D6365]">
                      {[
                        row.courtName ? `🏛 المحكمة: ${row.courtName}` : null,
                        row.executionOffice ? `⚖️ التنفيذ: ${row.executionOffice}` : null,
                      ].filter(Boolean).join('   |   ')}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {row.phone && <span className="text-[11px] text-[#767676]" dir="ltr">{row.phone}</span>}
                    {row.branchListName && (
                      <span className="text-[11px] text-[#767676]">القائمة: {row.branchListName}</span>
                    )}
                    {row.receiptType && (
                      <span className="text-[11px] text-[#767676]">
                        {RECEIPT_TYPE_LABELS[row.receiptType] ?? row.receiptType}
                      </span>
                    )}
                    {row.receiptNumber && (
                      <span className="text-[11px] text-[#767676]" dir="ltr">{row.receiptNumber}</span>
                    )}
                    {viewAllBranches && row.branchName && (
                      <span className="text-[11px] text-[#767676]">{row.branchName}</span>
                    )}
                  </div>
                </div>

                {row.remaining > 0 && (
                  <span className="text-xs font-bold text-[#2C8780] tabular-nums shrink-0" dir="ltr">
                    {fmtMoney(row.remaining)}
                  </span>
                )}

                <div className="min-w-[7.5rem] shrink-0 text-center">
                  <p className="text-[10px] font-bold text-[#767676]">تاريخ المرافعة</p>
                  <HearingMeta date={row.firstHearingDate} />
                </div>

                <div className="min-w-[7rem] shrink-0 text-left">
                  {primary?.url ? (
                    <a
                      href={primary.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-bold text-[#2C8780] hover:underline"
                    >
                      فتح الملف
                    </a>
                  ) : (
                    <span className="text-[11px] text-[#767676]">لا يوجد ملف</span>
                  )}
                  {row.files.length > 1 && (
                    <p className="text-[10px] text-[#767676] mt-0.5">{row.files.length} ملفات</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
