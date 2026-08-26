'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useBranch } from '@/context/branch'
import { isExperimentalBranch } from '@/lib/branch-constants'
import { fmtDate } from '@/lib/utils'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'
import { cacheGet, cacheSet, CACHE_TTL, cacheInvalidatePrefix } from '@/lib/query-cache'
import type { ExperimentalDebtorRow, ExperimentalQueue } from '@/lib/experimental-queues'

type Props = {
  queue: ExperimentalQueue
}

function NoteModal({
  debtor,
  onClose,
  onSaved,
}: {
  debtor: ExperimentalDebtorRow
  onClose: () => void
  onSaved: (note: string | null) => void
}) {
  const [text, setText] = useState(debtor.assignment_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/debtors/assignment-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId: debtor.id, note: text }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل حفظ الملاحظة')
        setSaving(false)
        return
      }
      onSaved(typeof json.note === 'string' ? json.note : null)
      onClose()
    } catch {
      setError('فشل الاتصال')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#231F20]">إضافة ملاحظة</h3>
            <p className="text-xs text-[#767676] mt-1">{debtor.full_name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#767676] hover:text-[#231F20] text-lg leading-none">×</button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-[rgba(118,118,118,0.25)] px-3 py-2 text-sm"
          placeholder="اكتب الملاحظة…"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border">إلغاء</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg text-white font-bold disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {saving ? 'جاري الحفظ…' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ExperimentalQueuePanel({ queue }: Props) {
  const { branchName, branchId } = useBranch()
  const allowed = isExperimentalBranch(branchName)
  const cacheKey = `exp-queue:${queue}:v1`

  const cached = cacheGet<{ rows: ExperimentalDebtorRow[]; total: number }>(cacheKey, { allowStale: true })
  const [rows, setRows] = useState<ExperimentalDebtorRow[]>(cached?.rows ?? [])
  const [total, setTotal] = useState(cached?.total ?? 0)
  const [loading, setLoading] = useState(!cached)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [noteDebtor, setNoteDebtor] = useState<ExperimentalDebtorRow | null>(null)
  const [expBranchId, setExpBranchId] = useState<string | null>(branchId)

  const title = queue === 'archive' ? 'أرشيف القانونية' : 'الأسماء المضافة مؤخراً'

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (!allowed) return
    if (!opts?.soft) setLoading(true)
    try {
      const params = new URLSearchParams({ queue, limit: '120' })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/experimental-queues?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'فشل التحميل')
      const nextRows = (json.rows ?? []) as ExperimentalDebtorRow[]
      const nextTotal = Number(json.total ?? 0)
      setRows(nextRows)
      setTotal(nextTotal)
      if (json.branchId) setExpBranchId(json.branchId)
      cacheSet(cacheKey, { rows: nextRows, total: nextTotal }, CACHE_TTL.list)
    } catch (e) {
      if (!opts?.soft) await appAlert(e instanceof Error ? e.message : 'فشل التحميل')
    } finally {
      setLoading(false)
    }
  }, [allowed, queue, q, cacheKey])

  useEffect(() => {
    void load({ soft: Boolean(cached) })
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const selectedIds = useMemo(() => [...selected], [selected])

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rows.map(r => r.id)))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function moveToArchive() {
    if (!selectedIds.length) return
    const ok = await appConfirm(`نقل ${selectedIds.length} اسم إلى أرشيف القانونية؟`)
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/experimental-queues/move-to-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: selectedIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'فشل النقل')
      setSelected(new Set())
      cacheInvalidatePrefix('exp-queue:')
      invalidateDashboardCounts()
      await load()
      await appAlert(`تم نقل ${json.updated ?? selectedIds.length} اسم إلى الأرشيف`)
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'فشل النقل')
    } finally {
      setBusy(false)
    }
  }

  async function moveToInstant() {
    if (!selectedIds.length) return
    const ok = await appConfirm(`تحويل ${selectedIds.length} اسم إلى الدعاوى الفورية؟`)
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/experimental-queues/move-to-instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: selectedIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'فشل التحويل')
      setSelected(new Set())
      cacheInvalidatePrefix('exp-queue:')
      invalidateDashboardCounts()
      await load()
      const failed = Array.isArray(json.failed) ? json.failed.length : 0
      await appAlert(
        failed
          ? `تم تحويل ${json.moved ?? 0}. تعذّر ${failed}.`
          : `تم تحويل ${json.moved ?? 0} إلى الدعاوى الفورية`,
      )
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'فشل التحويل')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div className="bg-white rounded-2xl border p-8 text-center">
        <p className="text-sm font-semibold text-[#231F20]">هذه الصفحة لفرع «تجريبي» فقط</p>
        <Link href="/admin/dashboard" className="inline-flex mt-3 text-xs font-semibold text-[#2C8780] hover:underline">
          العودة للوحة التحكم ←
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h2 className="font-black text-[#231F20] text-lg">{title}</h2>
          <p className="text-xs text-[#767676] mt-1">{total.toLocaleString('en-US')} اسم · فرع تجريبي</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void load()
            }}
            placeholder="بحث بالاسم / الهاتف / الوصل"
            className="rounded-xl border px-3 py-2 text-sm min-w-[200px]"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 text-sm rounded-xl border font-semibold"
          >
            بحث
          </button>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-[#F7F7F5] px-3 py-2">
          <span className="text-xs font-bold text-[#231F20]">محدّد: {selectedIds.length}</span>
          {queue === 'recent' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void moveToArchive()}
              className="px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}
            >
              تحويل إلى أرشيف القانونية
            </button>
          )}
          {queue === 'archive' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void moveToInstant()}
              className="px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#c2410c,#9a3412)' }}
            >
              تحويل إلى الدعاوى الفورية
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-[#767676] hover:underline">
            إلغاء التحديد
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#767676]">جاري التحميل…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#767676]">لا توجد أسماء</div>
        ) : (
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-[#F7F7F5] text-[#454042]">
                <tr>
                  <th className="p-3 w-10 whitespace-nowrap">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="تحديد الكل" />
                  </th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">الاسم</th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">الهاتف</th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">تاريخ الإضافة</th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">المهمة</th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">ملاحظة</th>
                  <th className="p-3 text-right font-bold whitespace-nowrap">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-t border-[rgba(118,118,118,0.12)] hover:bg-[#FAFAF8]">
                    <td className="p-3 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={`تحديد ${row.full_name}`}
                      />
                    </td>
                    <td className="p-3 font-semibold text-[#231F20] whitespace-nowrap">
                      <Link href={`/admin/debtors/${row.id}`} className="hover:text-[#2C8780] hover:underline">
                        {row.full_name}
                      </Link>
                    </td>
                    <td className="p-3 text-[#454042] whitespace-nowrap" dir="ltr">{row.phone || '—'}</td>
                    <td className="p-3 text-[#454042] whitespace-nowrap">{row.created_at ? fmtDate(row.created_at) : '—'}</td>
                    <td className="p-3 text-[#454042] whitespace-nowrap">{row.current_task_label || '—'}</td>
                    <td className="p-3 text-[#454042] max-w-[180px] truncate" title={row.assignment_note ?? ''}>
                      {row.assignment_note || '—'}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex flex-nowrap gap-2">
                        {queue === 'archive' && (
                          <ChangeDebtorTaskButton
                            debtorId={row.id}
                            branchId={expBranchId ?? row.branch_id}
                            currentLabel={row.current_task_label}
                            compact
                            buttonLabel="إسناد مهمة"
                            onChanged={() => {
                              cacheInvalidatePrefix('exp-queue:')
                              void load({ soft: true })
                            }}
                          />
                        )}
                        {queue === 'archive' && (
                          <button
                            type="button"
                            onClick={() => setNoteDebtor(row)}
                            className="text-xs font-bold text-[#2C8780] hover:underline"
                          >
                            ملاحظة
                          </button>
                        )}
                        {queue === 'recent' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(new Set([row.id]))
                            }}
                            className="text-xs font-bold text-blue-700 hover:underline"
                          >
                            تحديد للنقل
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {noteDebtor && (
        <NoteModal
          debtor={noteDebtor}
          onClose={() => setNoteDebtor(null)}
          onSaved={note => {
            setRows(prev => prev.map(r => (r.id === noteDebtor.id ? { ...r, assignment_note: note } : r)))
            cacheInvalidatePrefix('exp-queue:')
          }}
        />
      )}
    </div>
  )
}
