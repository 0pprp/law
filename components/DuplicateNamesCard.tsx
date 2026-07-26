'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isLegalManager } from '@/lib/permissions'
import { fmtDate } from '@/lib/utils'
import { CASE_TYPE_LABELS } from '@/lib/case-type'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import AssignmentNoteModal from '@/components/AssignmentNoteModal'
import BranchListBox from '@/components/BranchListBox'
import {
  type AwaitingAssignmentDebtor,
  type AwaitingBranchSummary,
} from '@/lib/awaiting-assignment'
import {
  fetchDuplicateNamesBranchSummaries,
  fetchDuplicateNamesDebtors,
} from '@/lib/duplicate-names'
import { useCaseScope } from '@/hooks/use-case-scope'
import { preserveScrollDuring } from '@/lib/preserve-scroll'

const PAGE_SIZE = 20

interface Props {
  branchId: string | null
  viewAllBranches: boolean
  listId?: string | null
  onAssigned?: () => void
  hideHeader?: boolean
  /** فلتر من لوحة التحكم عبر ?ct= — يتجاوز نطاق الدور عند التمرير */
  caseType?: 'civil' | 'criminal' | null
}

function DebtorRowsTable({
  rows,
  allowNote,
  allowAssign,
  allowUnmark,
  noteMissing,
  onNote,
  onRemoved,
  unmarkingId,
  onUnmark,
}: {
  rows: AwaitingAssignmentDebtor[]
  allowNote: boolean
  allowAssign: boolean
  allowUnmark: boolean
  noteMissing: boolean
  onNote: (r: AwaitingAssignmentDebtor) => void
  onRemoved: (id: string) => void
  unmarkingId: string | null
  onUnmark: (id: string) => void
}) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-xs text-[#767676] border-b border-[rgba(118,118,118,0.1)]">
              <th className="px-4 py-2.5 font-semibold">الاسم</th>
              <th className="px-4 py-2.5 font-semibold">نوع الدعوى</th>
              <th className="px-4 py-2.5 font-semibold">القائمة</th>
              <th className="px-4 py-2.5 font-semibold">تاريخ الإضافة</th>
              <th className="px-4 py-2.5 font-semibold">الملاحظة</th>
              <th className="px-4 py-2.5 font-semibold text-center">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-[#FAFAFA] transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/debtors/${r.id}/account`}
                    className="font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors"
                  >
                    {r.full_name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#767676]">{CASE_TYPE_LABELS[r.case_type]}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[#767676] break-words">{r.branch_list_name?.trim() || '—'}</span>
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
                    {allowUnmark && (
                      <button
                        type="button"
                        onClick={() => onUnmark(r.id)}
                        disabled={unmarkingId === r.id}
                        className="text-xs text-amber-800 hover:text-amber-950 border border-amber-200 hover:bg-amber-50 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                      >
                        {unmarkingId === r.id ? '...' : 'تراجع'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
        {rows.map(r => (
          <div key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-2 mb-1">
              <Link href={`/admin/debtors/${r.id}/account`} className="font-semibold text-[#231F20]">
                {r.full_name}
              </Link>
              <span className="text-[10px] text-[#767676] shrink-0 tabular-nums" dir="ltr">{fmtDate(r.created_at)}</span>
            </div>
            <p className="text-xs text-[#767676] mb-1">{CASE_TYPE_LABELS[r.case_type]}</p>
            <p className="text-xs text-[#767676] mb-1 break-words">القائمة: {r.branch_list_name?.trim() || '—'}</p>
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
              {allowUnmark && (
                <button
                  type="button"
                  onClick={() => onUnmark(r.id)}
                  disabled={unmarkingId === r.id}
                  className="flex-1 text-center text-xs text-amber-800 border border-amber-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {unmarkingId === r.id ? '...' : 'تراجع'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function BranchDuplicateBox({
  summary,
  search,
  caseTypeFilter,
  initialListId,
  allowNote,
  allowAssign,
  allowUnmark,
  onAssigned,
  onNote,
  notePatch,
}: {
  summary: AwaitingBranchSummary
  search: string
  caseTypeFilter: 'civil' | 'criminal' | null
  initialListId: string
  allowNote: boolean
  allowAssign: boolean
  allowUnmark: boolean
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
  const [unmarkingId, setUnmarkingId] = useState<string | null>(null)

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
    const res = await fetchDuplicateNamesDebtors(createClient(), summary.branchId, {
      search,
      offset,
      limit: fetchLimit ?? PAGE_SIZE,
      branchListId: listId || null,
      caseType: caseTypeFilter,
    })
    if (res.error) {
      setError(res.error.includes('عمود') ? res.error : 'فشل تحميل الأسماء')
      if (!append) { setRows([]); setTotal(0) }
    } else {
      setError('')
      setNoteMissing(res.noteColumnMissing)
      setRows(prev => (append ? [...prev, ...res.rows] : res.rows))
      setTotal(res.total)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [summary.branchId, search, listId, caseTypeFilter])

  useEffect(() => { void load(0, false) }, [load])

  async function loadAll() {
    const remaining = Math.max(0, total - rows.length)
    if (remaining <= 0) return
    await load(rows.length, true, remaining)
  }

  function removeRow(id: string) {
    preserveScrollDuring(() => {
      setRows(prev => prev.filter(r => r.id !== id))
      setTotal(prev => Math.max(0, prev - 1))
    })
    onAssigned?.()
  }

  async function handleUnmark(id: string) {
    if (unmarkingId) return
    setUnmarkingId(id)
    setError('')
    try {
      const res = await fetch('/api/admin/debtors/unmark-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: [id] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل التراجع')
        setUnmarkingId(null)
        return
      }
      const updatedIds: string[] = Array.isArray(json.updatedIds) ? json.updatedIds.map(String) : []
      if (updatedIds.includes(id) || Number(json.updatedCount) > 0) {
        removeRow(id)
      } else {
        setError('لم يتم التراجع عن هذا الاسم')
      }
    } catch {
      setError('فشل الاتصال')
    } finally {
      setUnmarkingId(null)
    }
  }

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
          <DebtorRowsTable
            rows={rows}
            allowNote={allowNote}
            allowAssign={allowAssign}
            allowUnmark={allowUnmark}
            noteMissing={noteMissing}
            onNote={onNote}
            onRemoved={removeRow}
            unmarkingId={unmarkingId}
            onUnmark={id => void handleUnmark(id)}
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
        </>
      )}
    </BranchListBox>
  )
}

/** كارد «الأسماء المكررة» — بوكسات حسب الفرع + فلتر قوائم لكل فرع */
export default function DuplicateNamesCard({
  branchId,
  viewAllBranches,
  listId = null,
  onAssigned,
  hideHeader,
  caseType,
}: Props) {
  const role = useAdminRole()
  const allowNote = isAdmin(role) || isLegalManager(role)
  const allowAssign = canAssignTasks(role)
  const allowUnmark = canAssignTasks(role)
  const { caseTypeFilter: roleCaseType } = useCaseScope()
  const caseTypeFilter = caseType !== undefined ? caseType : roleCaseType

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
    const res = await fetchDuplicateNamesBranchSummaries(createClient(), scopeBranchId, {
      search: term,
      caseType: caseTypeFilter,
    })
    if (res.error) {
      if (!soft) {
        setError('فشل تحميل الفروع')
        setBranches([])
        setGrandTotal(0)
      }
    } else {
      setError('')
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
    setLoading(false)
  }, [branchId, viewAllBranches, scopeBranchId, caseTypeFilter])

  useEffect(() => { void loadSummaries(debouncedSearch) }, [loadSummaries, debouncedSearch])

  function handleSearch(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  if (!branchId && !viewAllBranches) return null

  const initialListForBox = viewAllBranches ? '' : (listId ?? '')

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">الأسماء المكررة</h2>
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-violet-100 text-violet-800 text-sm font-black tabular-nums">
              {loading ? '—' : grandTotal}
            </span>
          </div>
          <span className="hidden sm:inline text-sm text-[#454042] font-medium">مدينون محوّلون من تحت إسناد مهمة</span>
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
            {debouncedSearch ? 'لا نتائج للبحث' : 'لا توجد أسماء مكررة حالياً'}
          </p>
          <p className="text-xs text-[#767676] mt-1.5">
            {debouncedSearch ? 'جرّب كلمات بحث مختلفة' : 'لم يُحوَّل أي مدين من تحت إسناد مهمة بعد'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {branches.map(b => (
            <BranchDuplicateBox
              key={b.branchId}
              summary={b}
              search={debouncedSearch}
              caseTypeFilter={caseTypeFilter}
              initialListId={initialListForBox}
              allowNote={allowNote}
              allowAssign={allowAssign}
              allowUnmark={allowUnmark}
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
        <AssignmentNoteModal
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
