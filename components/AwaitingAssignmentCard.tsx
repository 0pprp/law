'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, canManageSpecialStatuses, canSendToFilePreparation, isAdmin, isLegalManager } from '@/lib/permissions'
import { fmtDate } from '@/lib/utils'
import { CASE_TYPE_LABELS } from '@/lib/case-type'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import BranchListBox from '@/components/BranchListBox'
import SpecialStatusBadge from '@/components/SpecialStatusBadge'
import MoveToMonitoringModal from '@/components/MoveToMonitoringModal'
import { SortableTH } from '@/components/ui/data-table'
import { useTableSort } from '@/hooks/use-table-sort'
import {
  fetchAwaitingAssignmentBranchSummaries,
  fetchAwaitingAssignmentDebtors,
  type AwaitingAssignmentDebtor,
  type AwaitingBranchSummary,
} from '@/lib/awaiting-assignment'
import { useCaseScope } from '@/hooks/use-case-scope'
import { preserveScrollDuring } from '@/lib/preserve-scroll'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'

const PAGE_SIZE = 20

function courtExecutionLine(row: AwaitingAssignmentDebtor): string | null {
  const parts: string[] = []
  const court = row.court_name?.trim()
  const execution = row.execution_office?.trim()
  if (court) parts.push(`🏛 المحكمة: ${court}`)
  if (execution) parts.push(`⚖️ التنفيذ: ${execution}`)
  return parts.length ? parts.join(' | ') : null
}

interface Props {
  branchId: string | null
  viewAllBranches: boolean
  listId?: string | null
  onAssigned?: () => void
  hideHeader?: boolean
  /** فلتر من لوحة التحكم عبر ?ct= — يتجاوز نطاق الدور عند التمرير */
  caseType?: 'civil' | 'criminal' | null
  /** awaiting = تحت إسناد · preparing = تجهيز الملفات */
  mode?: 'awaiting' | 'preparing'
}

function NoteModal({
  debtor,
  onClose,
  onSaved,
}: {
  debtor: AwaitingAssignmentDebtor
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
            <h3 className="text-base font-bold text-[#231F20]">ملاحظة إسناد المهمة</h3>
            <p className="text-xs text-[#767676] mt-1">{debtor.full_name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#767676] hover:text-[#231F20] text-lg leading-none">×</button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="سبب التأخير أو أي ملاحظة إدارية... (اتركها فارغة لمسح الملاحظة)"
          className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3 py-2.5 focus:outline-none focus:border-[#2C8780] resize-none"
        />
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-[rgba(118,118,118,0.2)]">
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-xl text-white font-bold bg-[#2C8780] hover:bg-[#1D6365] disabled:opacity-50"
          >
            {saving ? '...' : 'حفظ الملاحظة'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DebtorRowsTable({
  rows,
  allowNote,
  allowAssign,
  allowSelect,
  noteMissing,
  onNote,
  onRemoved,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  rows: AwaitingAssignmentDebtor[]
  allowNote: boolean
  allowAssign: boolean
  allowSelect: boolean
  noteMissing: boolean
  onNote: (r: AwaitingAssignmentDebtor) => void
  onRemoved: (id: string) => void
  selectedIds: string[]
  onToggle: (id: string) => void
  onToggleAll: () => void
}) {
  const {
    rows: sortedRows,
    sortKey,
    sortDirection,
    cycleSort,
  } = useTableSort(rows, {
    name: r => r.full_name,
    caseType: r => CASE_TYPE_LABELS[r.case_type] ?? r.case_type,
    list: r => r.branch_list_name,
    court: r => r.court_name,
    execution: r => r.execution_office,
    createdAt: r => r.created_at,
    note: r => r.last_note,
  })
  const allSelected = sortedRows.length > 0 && sortedRows.every(r => selectedIds.includes(r.id))
  const someSelected = sortedRows.some(r => selectedIds.includes(r.id))

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="text-right text-xs text-[#767676] border-b border-[rgba(118,118,118,0.1)]">
              {allowSelect && (
                <th className="px-3 py-2.5 w-14 text-center font-semibold text-[#1D6365]">تحديد</th>
              )}
              <SortableTH variant="plain" sortKey="name" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الاسم</SortableTH>
              <SortableTH variant="plain" sortKey="caseType" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>نوع الدعوى</SortableTH>
              <SortableTH variant="plain" sortKey="list" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>القائمة</SortableTH>
              <SortableTH variant="plain" sortKey="court" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>🏛 المحكمة</SortableTH>
              <SortableTH variant="plain" sortKey="execution" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>⚖️ دائرة التنفيذ</SortableTH>
              <SortableTH variant="plain" sortKey="createdAt" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>تاريخ الإضافة</SortableTH>
              <SortableTH variant="plain" sortKey="note" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort}>الملاحظة</SortableTH>
              <th className="px-4 py-2.5 font-semibold text-center">الإجراءات</th>
            </tr>
            {allowSelect && (
              <tr className="bg-[#2C8780]/5 border-b border-[#2C8780]/15">
                <th className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => {
                      if (el) el.indeterminate = someSelected && !allSelected
                    }}
                    onChange={onToggleAll}
                    aria-label="تحديد الكل"
                    className="accent-[#2C8780] w-5 h-5 cursor-pointer"
                  />
                </th>
                <th colSpan={8} className="px-4 py-2 text-right text-[11px] font-medium text-[#1D6365]">
                  تحديد الكل المعروض — ثم التحويل إلى متابعة القانونية
                </th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
            {sortedRows.map(r => {
              const checked = selectedIds.includes(r.id)
              return (
              <tr
                key={r.id}
                className={`transition-colors ${checked ? 'bg-[#2C8780]/5' : 'hover:bg-[#FAFAFA]'}`}
              >
                {allowSelect && (
                  <td className="px-3 py-3 text-center align-middle">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(r.id)}
                      onClick={e => e.stopPropagation()}
                      aria-label={`تحديد ${r.full_name}`}
                      className="accent-[#2C8780] w-5 h-5 cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/debtors/${r.id}/account`}
                      className="font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors"
                    >
                      {r.full_name}
                    </Link>
                    {r.special_status_name && (
                      <SpecialStatusBadge name={r.special_status_name} color={r.special_status_color} />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#767676]">{CASE_TYPE_LABELS[r.case_type]}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#767676] break-words">{r.branch_list_name?.trim() || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#767676] break-words">{r.court_name?.trim() || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#767676] break-words">{r.execution_office?.trim() || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs tabular-nums" dir="ltr">{fmtDate(r.created_at)}</span>
                </td>
                <td className="px-4 py-3 max-w-[16rem]">
                  <span className="text-xs text-[#454042] whitespace-pre-wrap break-words">
                    {r.last_note || '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {allowNote && !noteMissing && (
                      <button
                        type="button"
                        onClick={() => onNote(r)}
                        className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {r.assignment_note ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}
                      </button>
                    )}
                    {allowAssign && (
                      <ChangeDebtorTaskButton
                        debtorId={r.id}
                        branchId={r.branch_id}
                        compact
                        buttonLabel="إسناد المهمة"
                        onChanged={() => onRemoved(r.id)}
                      />
                    )}
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
        {allowSelect && sortedRows.length > 0 && (
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-[rgba(118,118,118,0.08)] bg-[#2C8780]/5">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => {
                if (el) el.indeterminate = someSelected && !allSelected
              }}
              onChange={onToggleAll}
              aria-label="تحديد الكل"
              className="accent-[#2C8780] w-4 h-4 cursor-pointer"
            />
            <span className="text-xs text-[#767676] font-semibold">تحديد الكل ({sortedRows.length})</span>
          </div>
        )}
        {sortedRows.map(r => {
          const checked = selectedIds.includes(r.id)
          return (
          <div key={r.id} className={`p-4 ${checked ? 'bg-[#2C8780]/5' : ''}`}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-start gap-2.5 min-w-0">
                {allowSelect && (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(r.id)}
                    aria-label={`تحديد ${r.full_name}`}
                    className="accent-[#2C8780] w-5 h-5 mt-0.5 shrink-0 cursor-pointer"
                  />
                )}
                <Link href={`/admin/debtors/${r.id}/account`} className="font-semibold text-[#231F20]">
                  {r.full_name}
                </Link>
                {r.special_status_name && (
                  <SpecialStatusBadge name={r.special_status_name} color={r.special_status_color} />
                )}
              </div>
              <span className="text-[10px] text-[#767676] shrink-0 tabular-nums" dir="ltr">{fmtDate(r.created_at)}</span>
            </div>
            <p className="text-xs text-[#767676] mb-1">{CASE_TYPE_LABELS[r.case_type]}</p>
            <p className="text-xs text-[#767676] mb-1 break-words">القائمة: {r.branch_list_name?.trim() || '—'}</p>
            {courtExecutionLine(r) && (
              <p className="text-xs text-[#767676] mb-1 break-words">{courtExecutionLine(r)}</p>
            )}
            <p className="text-xs text-[#454042] whitespace-pre-wrap break-words mb-3">
              الملاحظة: {r.last_note || '—'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {allowNote && !noteMissing && (
                <button
                  type="button"
                  onClick={() => onNote(r)}
                  className="flex-1 text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg"
                >
                  {r.assignment_note ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}
                </button>
              )}
              {allowAssign && (
                <ChangeDebtorTaskButton
                  debtorId={r.id}
                  branchId={r.branch_id}
                  compact
                  buttonLabel="إسناد المهمة"
                  onChanged={() => onRemoved(r.id)}
                />
              )}
            </div>
          </div>
          )
        })}
      </div>
    </>
  )
}

/** بوكس فرع واحد — فلتر قوائمه + أسماء تحت إسناد مهمة */
function BranchAwaitingBox({
  summary,
  search,
  caseTypeFilter,
  initialListId,
  mode,
  allowNote,
  allowAssign,
  allowMonitor,
  allowSendPrep,
  onAssigned,
  onNote,
  notePatch,
}: {
  summary: AwaitingBranchSummary
  search: string
  caseTypeFilter: 'civil' | 'criminal' | null
  initialListId: string
  mode: 'awaiting' | 'preparing'
  allowNote: boolean
  allowAssign: boolean
  allowMonitor: boolean
  allowSendPrep: boolean
  onAssigned?: () => void
  onNote: (r: AwaitingAssignmentDebtor) => void
  notePatch?: { id: string; note: string | null } | null
}) {
  const [listId, setListId] = useState(initialListId)
  const [rows, setRows] = useState<AwaitingAssignmentDebtor[]>([])
  const [total, setTotal] = useState(summary.count)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [noteMissing, setNoteMissing] = useState(false)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [monitorModalOpen, setMonitorModalOpen] = useState(false)
  const [monitorError, setMonitorError] = useState('')
  const [sendingPrep, setSendingPrep] = useState(false)
  const [prepError, setPrepError] = useState('')
  const allowSelect = (allowMonitor || allowSendPrep) && mode === 'awaiting'

  useEffect(() => {
    setListId(initialListId)
  }, [initialListId, summary.branchId])

  useEffect(() => {
    if (!notePatch) return
    setRows(prev => prev.map(r => (r.id === notePatch.id ? { ...r, assignment_note: notePatch.note } : r)))
  }, [notePatch])

  const load = useCallback(async (offset = 0, append = false, fetchLimit?: number) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    // الجزائي لا يستخدم قائمة الفرع — وإلا تُخفى الأسماء ذات branch_list_id = null
    const effectiveListId = caseTypeFilter === 'criminal' ? null : (listId || null)
    const res = await fetchAwaitingAssignmentDebtors(createClient(), summary.branchId, {
      search,
      offset,
      limit: fetchLimit ?? PAGE_SIZE,
      branchListId: effectiveListId,
      caseType: caseTypeFilter,
      mode,
    })
    if (res.error) {
      setError('فشل تحميل الأسماء')
      if (!append) {
        setRows([])
        setTotal(0)
        setSelectedIds([])
      }
    } else {
      setError('')
      setNoteMissing(res.noteColumnMissing)
      if (append) {
        setRows(prev => {
          const existing = new Set(prev.map(r => r.id))
          const added = res.rows.filter(r => r.id && !existing.has(r.id))
          const next = added.length ? [...prev, ...added] : prev
          const visible = new Set(next.map(r => r.id))
          setSelectedIds(prevSel => prevSel.filter(id => visible.has(id)))
          return next
        })
      } else {
        const seen = new Set<string>()
        setRows(res.rows.filter(r => {
          if (!r.id || seen.has(r.id)) return false
          seen.add(r.id)
          return true
        }))
        setSelectedIds([])
      }
      setTotal(res.total)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [summary.branchId, search, listId, caseTypeFilter, mode])

  useEffect(() => { void load(0, false) }, [load])

  async function loadAll() {
    const remaining = Math.max(0, total - rows.length)
    if (remaining <= 0) return
    await load(rows.length, true, remaining)
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    const allSelected = rows.length > 0 && rows.every(r => selectedIds.includes(r.id))
    if (allSelected) setSelectedIds([])
    else setSelectedIds(rows.map(r => r.id))
  }

  async function sendToPreparation() {
    if (!selectedIds.length || sendingPrep) return
    setPrepError('')
    const ok = await appConfirm({
      title: 'إرسال للتجهيز',
      message: `إرسال ${selectedIds.length} اسم إلى المحاسب الرئيسي لتجهيز الملفات؟`,
      confirmLabel: 'إرسال',
    })
    if (!ok) return
    setSendingPrep(true)
    try {
      const res = await fetch('/api/admin/debtors/send-to-preparation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: selectedIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : Array.isArray(data?.failed) && data.failed[0]?.reason
            ? data.failed[0].reason
            : 'فشل الإرسال للتجهيز'
        setPrepError(msg)
        await appAlert({ title: 'تعذر الإرسال', message: msg })
        return
      }
      const updatedIds: string[] = Array.isArray(data.updatedIds) ? data.updatedIds : []
      const failed: { name?: string; reason?: string }[] = Array.isArray(data.failed) ? data.failed : []
      const moved = new Set(updatedIds)
      preserveScrollDuring(() => {
        setRows(prev => prev.filter(row => !moved.has(row.id)))
        setTotal(prev => Math.max(0, prev - moved.size))
        setSelectedIds([])
      })
      invalidateDashboardCounts()
      onAssigned?.()
      if (failed.length) {
        const sample = failed.slice(0, 3).map(f => `«${f.name}»: ${f.reason}`).join('\n')
        await appAlert({
          title: 'إرسال جزئي',
          message: `تم إرسال ${updatedIds.length} بنجاح.\nتعذّر ${failed.length}:\n${sample}`,
        })
      }
    } catch {
      setPrepError('فشل الاتصال بالخادم')
    } finally {
      setSendingPrep(false)
    }
  }

  // لا تعرض البوكس إن صارت القائمة فارغة بعد الفلتر (ما عدا أثناء التحميل الأول)
  if (!loading && total === 0 && !search && !listId) return null
  if (!loading && total === 0 && !search && listId) {
    return (
      <BranchListBox
        branchId={summary.branchId}
        branchName={summary.branchName}
        count={0}
        listId={listId}
        onListChange={setListId}
      >
        <div className="px-4 py-8 text-center text-sm text-[#767676]">لا أسماء في هذه القائمة</div>
      </BranchListBox>
    )
  }

  return (
    <BranchListBox
      branchId={summary.branchId}
      branchName={summary.branchName}
      count={total}
      listId={listId}
      onListChange={setListId}
      loadingCount={loading && rows.length === 0}
    >
      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      {noteMissing && !error && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl px-4 py-2.5">
          خانة الملاحظة غير مفعّلة بعد في قاعدة البيانات
        </div>
      )}
      {loading && rows.length === 0 ? (
        <div className="p-4 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-[rgba(118,118,118,0.07)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[#767676]">
          {search ? 'لا نتائج للبحث في هذا الفرع' : 'لا أسماء'}
        </div>
      ) : (
        <>
          {allowSelect && (
            <div className="mx-4 mt-3 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#2C8780]/25 bg-[#2C8780]/8 px-3 py-2.5">
              <p className="text-xs text-[#454042] font-medium">
                {selectedIds.length > 0
                  ? `محدَّد: ${selectedIds.length}`
                  : 'حدّد اسماً أو أكثر ثم اختر إجراءً'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {allowSendPrep && (
                  <button
                    type="button"
                    onClick={() => void sendToPreparation()}
                    disabled={selectedIds.length === 0 || sendingPrep}
                    className="text-xs font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed px-3.5 py-2 rounded-lg transition-colors"
                    style={{ background: 'linear-gradient(135deg,#0369a1,#0c4a6e)' }}
                  >
                    {sendingPrep
                      ? 'جارٍ الإرسال...'
                      : `إرسال للتجهيز${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
                  </button>
                )}
                {allowMonitor && (
                  <button
                    type="button"
                    onClick={() => {
                      setMonitorError('')
                      setMonitorModalOpen(true)
                    }}
                    disabled={selectedIds.length === 0}
                    className="text-xs font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed px-3.5 py-2 rounded-lg transition-colors"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                  >
                    تحويل إلى تبويب متابعة القانونية
                    {selectedIds.length ? ` (${selectedIds.length})` : ''}
                  </button>
                )}
              </div>
            </div>
          )}
          {(monitorError || prepError) && (
            <div className="mx-4 mt-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {prepError || monitorError}
            </div>
          )}
          <DebtorRowsTable
            rows={rows}
            allowNote={allowNote}
            allowAssign={allowAssign && mode === 'awaiting'}
            allowSelect={allowSelect}
            noteMissing={noteMissing}
            onNote={onNote}
            selectedIds={selectedIds}
            onToggle={toggleOne}
            onToggleAll={toggleAll}
            onRemoved={id => {
              preserveScrollDuring(() => {
                setRows(prev => prev.filter(r => r.id !== id))
                setTotal(prev => Math.max(0, prev - 1))
                setSelectedIds(prev => prev.filter(x => x !== id))
              })
              onAssigned?.()
            }}
          />
          <div className="flex items-center justify-between px-4 py-3 border-t border-[rgba(118,118,118,0.08)]">
            <p className="text-xs text-[#767676]">عرض {rows.length} من {total}</p>
            {rows.length < total && (
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loadingMore}
                className="text-xs font-semibold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
              >
                {loadingMore ? 'جارٍ التحميل...' : `عرض الكل (${total - rows.length} متبقٍ)`}
              </button>
            )}
          </div>
          {allowMonitor && mode === 'awaiting' && (
            <MoveToMonitoringModal
              open={monitorModalOpen}
              branchId={summary.branchId}
              debtorIds={selectedIds}
              onClose={() => setMonitorModalOpen(false)}
              onSuccess={(debtorIds) => {
                const moved = new Set(debtorIds)
                preserveScrollDuring(() => {
                  setRows(prev => prev.filter(row => !moved.has(row.id)))
                  setTotal(prev => Math.max(0, prev - moved.size))
                  setSelectedIds([])
                  setMonitorError('')
                })
                onAssigned?.()
              }}
            />
          )}
        </>
      )}
    </BranchListBox>
  )
}

/** كارد «الأسماء التي تحت إسناد مهمة» / «تجهيز الملفات» — بوكسات حسب الفرع */
export default function AwaitingAssignmentCard({
  branchId,
  viewAllBranches,
  listId = null,
  onAssigned,
  hideHeader,
  caseType,
  mode = 'awaiting',
}: Props) {
  const role = useAdminRole()
  const allowNote = isAdmin(role) || isLegalManager(role)
  const allowAssign = canAssignTasks(role)
  const allowMonitor = canManageSpecialStatuses(role) && mode === 'awaiting'
  const allowSendPrep = canSendToFilePreparation(role) && mode === 'awaiting'
  const { caseTypeFilter: roleCaseType } = useCaseScope()
  const caseTypeFilter = caseType !== undefined ? caseType : roleCaseType
  const isPrepMode = mode === 'preparing'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [branches, setBranches] = useState<AwaitingBranchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [noteFor, setNoteFor] = useState<AwaitingAssignmentDebtor | null>(null)
  const [notePatch, setNotePatch] = useState<{ id: string; note: string | null } | null>(null)
  const [grandTotal, setGrandTotal] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scopeBranchId = viewAllBranches ? null : branchId

  const loadSummaries = useCallback(async (term: string, opts?: { soft?: boolean }) => {
    if (!branchId && !viewAllBranches) {
      setBranches([])
      setGrandTotal(0)
      setLoading(false)
      return
    }
    const soft = Boolean(opts?.soft)
    if (!soft) setLoading(true)
    try {
      const res = await fetchAwaitingAssignmentBranchSummaries(createClient(), scopeBranchId, {
        search: term,
        caseType: caseTypeFilter,
        mode,
      })
      if (res.error) {
        if (!soft) {
          setError(res.error || 'فشل تحميل الفروع')
          setBranches([])
          setGrandTotal(0)
        }
      } else {
        setError('')
        // تحديث العدادات دون تفريغ القائمة أثناء soft (يحافظ على «عرض المزيد» وموضع التمرير)
        if (soft) {
          setBranches(prev => {
            const byId = new Map(res.branches.map(b => [b.branchId, b]))
            const next = prev
              .map(b => {
                const fresh = byId.get(b.branchId)
                return fresh ? { ...b, count: fresh.count } : b
              })
              .filter(b => b.count > 0 || byId.has(b.branchId))
            for (const b of res.branches) {
              if (!next.some(x => x.branchId === b.branchId)) next.push(b)
            }
            return next.filter(b => (byId.get(b.branchId)?.count ?? 0) > 0 || term)
          })
        } else {
          setBranches(res.branches)
        }
        setGrandTotal(res.branches.reduce((s, b) => s + b.count, 0))
      }
    } catch (e: unknown) {
      if (!soft) {
        setError(e instanceof Error ? e.message : 'فشل تحميل الفروع')
        setBranches([])
        setGrandTotal(0)
      }
    }
    setLoading(false)
  }, [branchId, viewAllBranches, scopeBranchId, caseTypeFilter, mode])

  useEffect(() => { void loadSummaries(debouncedSearch) }, [loadSummaries, debouncedSearch])

  function handleSearch(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  if (!branchId && !viewAllBranches) return null

  const initialListForBox = viewAllBranches || caseTypeFilter === 'criminal' ? '' : (listId ?? '')

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">
              {isPrepMode ? 'تجهيز الملفات' : 'الأسماء التي تحت إسناد مهمة'}
            </h2>
            <span className={`inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full text-sm font-black tabular-nums ${isPrepMode ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-800'}`}>
              {loading ? '—' : grandTotal}
            </span>
          </div>
          <span className="hidden sm:inline text-sm text-[#454042] font-medium">
            {isPrepMode ? 'مدينون قيد تجهيز الملف' : 'مدينون بانتظار إسناد مهمة — الأقدم أولاً'}
          </span>
        </div>
      )}

      <div className="relative max-w-sm">
        <input
          type="text"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="بحث بالاسم..."
          className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3.5 py-2.5 focus:outline-none focus:border-[#2C8780] bg-white"
        />
        {search && (
          <button
            type="button"
            onClick={() => handleSearch('')}
            className="absolute inset-y-0 left-3 text-[#767676] hover:text-[#231F20] text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading && branches.length === 0 ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-40 bg-white rounded-2xl border animate-pulse" />
          ))}
        </div>
      ) : branches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] px-4 py-10 text-center">
          <p className="text-sm font-semibold text-[#231F20]">
            {debouncedSearch
              ? 'لا نتائج للبحث'
              : isPrepMode
                ? 'لا توجد أسماء قيد تجهيز الملفات حالياً'
                : 'لا توجد أسماء تحت إسناد مهمة حالياً'}
          </p>
          <p className="text-xs text-[#767676] mt-1.5">
            {debouncedSearch
              ? 'جرّب كلمات بحث مختلفة'
              : isPrepMode
                ? 'أرسل أسماء من كارد تحت إسناد مهمة عبر «إرسال للتجهيز»'
                : 'كل المدينين المفتوحين لديهم مهمة مطلوبة'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {branches.map(b => (
            <BranchAwaitingBox
              key={b.branchId}
              summary={b}
              search={debouncedSearch}
              caseTypeFilter={caseTypeFilter}
              initialListId={initialListForBox}
              mode={mode}
              allowNote={allowNote}
              allowAssign={allowAssign}
              allowMonitor={allowMonitor}
              allowSendPrep={allowSendPrep}
              onAssigned={() => {
                onAssigned?.()
                preserveScrollDuring(() => {
                  void loadSummaries(debouncedSearch, { soft: true })
                })
              }}
              onNote={setNoteFor}
              notePatch={notePatch}
            />
          ))}
        </div>
      )}

      {noteFor && (
        <NoteModal
          debtor={noteFor}
          onClose={() => setNoteFor(null)}
          onSaved={note => {
            if (noteFor) setNotePatch({ id: noteFor.id, note })
          }}
        />
      )}
    </div>
  )
}
