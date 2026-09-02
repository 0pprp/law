'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useBranch } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { fmtDate, fmtMoney } from '@/lib/utils'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'
import { cacheGet, cacheSWR, CACHE_TTL, cacheInvalidatePrefix } from '@/lib/query-cache'
import { useCaseScope } from '@/hooks/use-case-scope'
import type { ExperimentalDebtorRow, ExperimentalQueue } from '@/lib/experimental-queues'
import { TRANSACTION_NUMBER_LABEL, SALE_DATE_LABEL, RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'
import { canViewInstantCases } from '@/lib/permissions'
import { fetchDeduped } from '@/lib/inflight-fetch'
import { withReturnTo } from '@/lib/safe-return-to'
import { Table, THead, TBody, TH, TD } from '@/components/ui/data-table'

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
  const { branchName, branchId, viewAllBranches, listId } = useBranch()
  const { caseTypeFilter } = useCaseScope()
  const role = useAdminRole()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ctParam = searchParams.get('ct')
  const caseType =
    ctParam === 'civil' || ctParam === 'criminal' ? ctParam : caseTypeFilter
  const allowed = Boolean(branchId || viewAllBranches)
  const cacheKey = `exp-queue:${queue}:${branchId ?? 'all'}:${listId ?? 'all'}:${caseType ?? 'both'}:v6`
  const returnTo = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const showInstantMove = queue === 'recent' && canViewInstantCases(role) && caseType !== 'criminal'

  const [q, setQ] = useState('')
  const listCacheKey = `${cacheKey}:${q.trim()}`
  const [rows, setRows] = useState<ExperimentalDebtorRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [noteDebtor, setNoteDebtor] = useState<ExperimentalDebtorRow | null>(null)
  const [expBranchId, setExpBranchId] = useState<string | null>(branchId)

  const title = queue === 'archive' ? 'أرشيف القانونية' : 'الأسماء المضافة مؤخراً'

  const load = useCallback(async (opts?: { soft?: boolean; force?: boolean }) => {
    if (!allowed) return
    if (!opts?.soft) setLoading(true)
    try {
      const result = await cacheSWR({
        key: listCacheKey,
        ttlMs: CACHE_TTL.list,
        force: opts?.force === true,
        fetcher: async () => {
          const params = new URLSearchParams({ queue, limit: '120' })
          if (viewAllBranches) params.set('viewAll', '1')
          else if (branchId) params.set('branchId', branchId)
          if (listId && caseType !== 'criminal') params.set('listId', listId)
          if (caseType) params.set('caseType', caseType)
          if (q.trim()) params.set('q', q.trim())
          if (opts?.force) params.set('_', String(Date.now()))
          const res = await fetchDeduped(`/api/admin/experimental-queues?${params}`)
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json.error || 'فشل التحميل')
          return {
            rows: (json.rows ?? []) as ExperimentalDebtorRow[],
            total: Number(json.total ?? 0),
            branchId: typeof json.branchId === 'string' ? json.branchId : null,
          }
        },
      })
      setRows(result.value.rows)
      setTotal(result.value.total)
      if (result.value.branchId) setExpBranchId(result.value.branchId)
    } catch (e) {
      if (!opts?.soft) await appAlert(e instanceof Error ? e.message : 'فشل التحميل')
    } finally {
      setLoading(false)
    }
  }, [allowed, queue, q, listCacheKey, branchId, viewAllBranches, listId, caseType])

  useEffect(() => {
    const hit = cacheGet<{ rows: ExperimentalDebtorRow[]; total: number; branchId?: string | null }>(listCacheKey, { allowStale: true })
    if (hit) {
      setRows(hit.rows)
      setTotal(hit.total)
      if (hit.branchId) setExpBranchId(hit.branchId)
      void load({ soft: true, force: true })
      return
    }
    void load({ force: true })
  }, [load, listCacheKey])

  useEffect(() => {
    const refresh = () => { void load({ soft: true, force: true }) }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [load])

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
      await load({ force: true })
      await appAlert(`تم نقل ${json.updated ?? selectedIds.length} اسم إلى الأرشيف`)
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'فشل النقل')
    } finally {
      setBusy(false)
    }
  }

  async function moveToInstant(ids: string[]) {
    if (!ids.length) return
    const ok = await appConfirm(`تحويل ${ids.length} اسم إلى الدعاوى الفورية؟`)
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/experimental-queues/move-to-instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: ids }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'فشل التحويل')
      setSelected(new Set())
      cacheInvalidatePrefix('exp-queue:')
      invalidateDashboardCounts()
      await load({ force: true })
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

  async function moveToRecent(ids: string[]) {
    if (!ids.length) return
    const ok = await appConfirm(`إرجاع ${ids.length} اسم إلى الأسماء المضافة مؤخراً؟`)
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/experimental-queues/move-to-recent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: ids }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'فشل الإرجاع')
      setSelected(new Set())
      cacheInvalidatePrefix('exp-queue:')
      invalidateDashboardCounts()
      await load({ force: true })
      const failed = Array.isArray(json.failed) ? json.failed.length : 0
      await appAlert(
        failed
          ? `تم إرجاع ${json.updated ?? 0}. تعذّر ${failed}.`
          : `تم إرجاع ${json.updated ?? ids.length} إلى الأسماء المضافة مؤخراً`,
      )
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'فشل الإرجاع')
    } finally {
      setBusy(false)
    }
  }

  async function openDebtorFile(row: ExperimentalDebtorRow) {
    const file = row.primary_file
    if (!file?.file_path) {
      await appAlert('لا يوجد ملف')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/debtor-file-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id, path: file.file_path }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(typeof json.error === 'string' ? json.error : 'تعذر فتح الملف')
      window.open(String(json.url), '_blank', 'noopener,noreferrer')
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'تعذر فتح الملف')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div className="bg-white rounded-2xl border p-8 text-center">
        <p className="text-sm font-semibold text-[#231F20]">اختر فرعاً من القائمة العلوية أو اختر «الكل».</p>
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
          <p className="text-xs text-[#767676] mt-1">{total.toLocaleString('en-US')} اسم{branchName ? ` · ${branchName}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void load({ force: true })
            }}
            placeholder="بحث بالاسم / الهاتف / الوصل"
            className="rounded-xl border px-3 py-2 text-sm min-w-[200px]"
          />
          <button
            type="button"
            onClick={() => void load({ force: true })}
            className="px-3 py-2 text-sm rounded-xl border font-semibold"
          >
            بحث
          </button>
        </div>
      </div>

      {queue === 'recent' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-[#F7F7F5] px-3 py-2.5">
          <span className="text-xs font-bold text-[#231F20]">
            {selectedIds.length > 0 ? `محدّد: ${selectedIds.length}` : 'حدّد أسماء ثم حوّل'}
          </span>
          <button
            type="button"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void moveToArchive()}
            className="px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}
          >
            تحويل إلى أرشيف القانونية
          </button>
          {showInstantMove && (
            <button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void moveToInstant(selectedIds)}
              className="px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#c2410c,#9a3412)' }}
            >
              تحويل إلى الدعاوى الفورية
            </button>
          )}
          {selectedIds.length > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-[#767676] hover:underline">
              إلغاء التحديد
            </button>
          )}
        </div>
      )}

      {queue === 'archive' && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-[#F7F7F5] px-3 py-2">
          <span className="text-xs font-bold text-[#231F20]">محدّد: {selectedIds.length}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void moveToRecent(selectedIds)}
            className="px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            إرجاع إلى الأسماء المضافة مؤخراً
          </button>
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
          <Table minWidthClassName="min-w-[1180px]">
            <THead>
              <tr>
                <TH className="w-12 text-center">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="تحديد الكل" />
                </TH>
                <TH>الاسم</TH>
                <TH>{TRANSACTION_NUMBER_LABEL}</TH>
                <TH>{SALE_DATE_LABEL}</TH>
                <TH>{RECEIPT_AMOUNT_LABEL}</TH>
                <TH>الهاتف</TH>
                <TH>تاريخ الإضافة</TH>
                <TH>المهمة</TH>
                <TH>ملاحظة</TH>
                <TH>إجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-[rgba(118,118,118,0.08)] hover:bg-[#FAFAF8]">
                  <TD className="text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`تحديد ${row.full_name}`}
                    />
                  </TD>
                  <TD className="text-right">
                    <Link href={`/admin/debtors/${row.id}/account`} className="hover:text-[#2C8780] hover:underline">
                      {row.full_name}
                    </Link>
                  </TD>
                  <TD className="text-right">
                    <span className="font-mono text-xs" dir="ltr">{row.transaction_number || '—'}</span>
                  </TD>
                  <TD className="text-right text-xs">
                    {row.sale_date ? fmtDate(row.sale_date) : '—'}
                  </TD>
                  <TD className="text-right">
                    <span className="text-xs font-semibold tabular-nums" dir="ltr">
                      {row.receipt_amount != null && Number(row.receipt_amount) > 0 ? fmtMoney(row.receipt_amount) : '—'}
                    </span>
                  </TD>
                  <TD className="text-right">
                    <span className="text-xs" dir="ltr">{row.phone || '—'}</span>
                  </TD>
                  <TD className="text-right text-xs">{row.created_at ? fmtDate(row.created_at) : '—'}</TD>
                  <TD className="text-right text-xs">{row.current_task_label || '—'}</TD>
                  <TD className="text-right text-xs max-w-[180px] truncate" title={row.assignment_note ?? ''}>
                    {row.assignment_note || '—'}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                      {queue === 'archive' && (
                        <ChangeDebtorTaskButton
                          debtorId={row.id}
                          branchId={expBranchId ?? row.branch_id}
                          currentLabel={row.current_task_label}
                          compact
                          buttonLabel="إسناد مهمة"
                          onChanged={() => {
                            cacheInvalidatePrefix('exp-queue:')
                            void load({ soft: true, force: true })
                          }}
                        />
                      )}
                      {queue === 'archive' && (
                        row.primary_file?.file_path ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void openDebtorFile(row)}
                            className="text-xs font-bold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/10 px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-60"
                          >
                            فتح ملف المدين
                          </button>
                        ) : (
                          <span className="text-xs text-[#767676] border border-[rgba(118,118,118,0.18)] px-3 py-1.5 rounded-lg whitespace-nowrap">
                            لا يوجد ملف
                          </span>
                        )
                      )}
                      {queue === 'archive' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void moveToRecent([row.id])}
                          className="text-xs font-bold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/10 px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-60"
                        >
                          إرجاع
                        </button>
                      )}
                      {queue === 'archive' && (
                        <button
                          type="button"
                          onClick={() => setNoteDebtor(row)}
                          className="text-xs font-bold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/10 px-3 py-1.5 rounded-lg whitespace-nowrap"
                        >
                          ملاحظة
                        </button>
                      )}
                      {queue === 'recent' && (
                        <Link
                          href={withReturnTo(`/admin/debtors/${row.id}/edit`, returnTo)}
                          className="text-xs font-bold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/10 px-3 py-1.5 rounded-lg whitespace-nowrap"
                        >
                          تعديل
                        </Link>
                      )}
                      {queue === 'recent' && (
                        row.primary_file?.file_path ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void openDebtorFile(row)}
                            className="text-xs font-bold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/10 px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-60"
                          >
                            فتح ملف المدين
                          </button>
                        ) : (
                          <span className="text-xs text-[#767676] border border-[rgba(118,118,118,0.18)] px-3 py-1.5 rounded-lg whitespace-nowrap">
                            لا يوجد ملف
                          </span>
                        )
                      )}
                      {showInstantMove && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void moveToInstant([row.id])}
                          className="text-xs font-bold text-white px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-60"
                          style={{ background: 'linear-gradient(135deg,#c2410c,#9a3412)' }}
                        >
                          دعوى فورية
                        </button>
                      )}
                    </div>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
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
