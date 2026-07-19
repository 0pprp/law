'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import { canAssignTasks, isAdmin, isLegalManager } from '@/lib/permissions'
import { fmtDate } from '@/lib/utils'
import { CASE_TYPE_LABELS } from '@/lib/case-type'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import {
  fetchAwaitingAssignmentDebtors,
  type AwaitingAssignmentDebtor,
} from '@/lib/awaiting-assignment'

const PAGE_SIZE = 20

interface Props {
  branchId: string | null
  viewAllBranches: boolean
  /** يُستدعى بعد إسناد مهمة بنجاح لتحديث بقية إحصائيات اللوحة */
  onAssigned?: () => void
  /** إخفاء ترويسة الكارد عند استخدامه داخل صفحة لها PageHeader */
  hideHeader?: boolean
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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl border border-[rgba(118,118,118,0.2)]"
          >
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

/** كارد «الأسماء التي تحت إسناد مهمة» — مدينون بلا مهمة مطلوبة إطلاقاً */
export default function AwaitingAssignmentCard({ branchId, viewAllBranches, onAssigned, hideHeader }: Props) {
  const role = useAdminRole()
  // الملاحظة: المدير ومسؤول القانونية فقط — الإسناد: من يملك canAssignTasks
  const allowNote = isAdmin(role) || isLegalManager(role)
  const allowAssign = canAssignTasks(role)

  const [rows, setRows] = useState<AwaitingAssignmentDebtor[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [noteMissing, setNoteMissing] = useState(false)
  const [search, setSearch] = useState('')
  const [noteFor, setNoteFor] = useState<AwaitingAssignmentDebtor | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scopeBranchId = viewAllBranches ? null : branchId

  const load = useCallback(async (term: string, offset = 0, append = false) => {
    if (!branchId && !viewAllBranches) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return
    }
    if (append) setLoadingMore(true)
    else setLoading(true)
    const res = await fetchAwaitingAssignmentDebtors(createClient(), scopeBranchId, {
      search: term,
      offset,
      limit: PAGE_SIZE,
    })
    if (res.error) {
      setError('فشل تحميل الأسماء التي تحت إسناد مهمة')
      if (!append) { setRows([]); setTotal(0) }
    } else {
      setError('')
      setNoteMissing(res.noteColumnMissing)
      setRows(prev => append ? [...prev, ...res.rows] : res.rows)
      setTotal(res.total)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [branchId, viewAllBranches, scopeBranchId])

  useEffect(() => { void load('') }, [load])

  function handleSearch(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void load(val) }, 300)
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
    setTotal(prev => Math.max(0, prev - 1))
    onAssigned?.()
  }

  function updateNote(id: string, note: string | null) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, assignment_note: note } : r)))
  }

  if (!branchId && !viewAllBranches) return null

  const hasMore = rows.length < total

  return (
    <div>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">الأسماء التي تحت إسناد مهمة</h2>
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-amber-100 text-amber-800 text-sm font-black tabular-nums">
              {loading ? '—' : total}
            </span>
          </div>
          <span className="hidden sm:inline text-sm text-[#454042] font-medium">مدينون بلا مهمة مطلوبة — الأقدم أولاً</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        <div className="px-4 pt-4">
          <div className="relative max-w-sm">
            <input
              type="text"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="بحث بالاسم..."
              className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3.5 py-2.5 focus:outline-none focus:border-[#2C8780]"
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
        </div>

        {error && (
          <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
        )}
        {noteMissing && !error && (
          <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl px-4 py-2.5">
            خانة الملاحظة غير مفعّلة بعد في قاعدة البيانات — شغّل supabase/scripts/apply-debtor-assignment-note.sql
          </div>
        )}

        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-[rgba(118,118,118,0.07)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[#231F20]">
              {search ? 'لا نتائج للبحث' : 'لا توجد أسماء تحت إسناد مهمة حالياً'}
            </p>
            <p className="text-xs text-[#767676] mt-1.5">
              {search ? 'جرّب كلمات بحث مختلفة' : 'كل المدينين المفتوحين لديهم مهمة مطلوبة'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-xs text-[#767676] border-b border-[rgba(118,118,118,0.1)]">
                    <th className="px-4 py-2.5 font-semibold">الاسم</th>
                    <th className="px-4 py-2.5 font-semibold">نوع الدعوى</th>
                    {viewAllBranches && <th className="px-4 py-2.5 font-semibold">الفرع</th>}
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
                      {viewAllBranches && (
                        <td className="px-4 py-3">
                          <span className="text-xs text-[#767676]">{r.branch_name ?? '—'}</span>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className="text-xs tabular-nums" dir="ltr">{fmtDate(r.created_at)}</span>
                      </td>
                      <td className="px-4 py-3 max-w-[16rem]">
                        <span className="text-xs text-[#454042] whitespace-pre-wrap break-words">
                          {r.assignment_note || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {allowNote && !noteMissing && (
                            <button
                              type="button"
                              onClick={() => setNoteFor(r)}
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
                              onChanged={() => removeRow(r.id)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)] mt-3">
              {rows.map(r => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Link href={`/admin/debtors/${r.id}/account`} className="font-semibold text-[#231F20]">
                      {r.full_name}
                    </Link>
                    <span className="text-[10px] text-[#767676] shrink-0 tabular-nums" dir="ltr">{fmtDate(r.created_at)}</span>
                  </div>
                  <p className="text-xs text-[#767676] mb-1">{CASE_TYPE_LABELS[r.case_type]}</p>
                  {viewAllBranches && r.branch_name && (
                    <p className="text-xs text-[#2C8780] mb-1">{r.branch_name}</p>
                  )}
                  <p className="text-xs text-[#454042] whitespace-pre-wrap break-words mb-3">
                    الملاحظة: {r.assignment_note || '—'}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {allowNote && !noteMissing && (
                      <button
                        type="button"
                        onClick={() => setNoteFor(r)}
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
                        onChanged={() => removeRow(r.id)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-[rgba(118,118,118,0.08)]">
              <p className="text-xs text-[#767676]">عرض {rows.length} من {total}</p>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => void load(search, rows.length, true)}
                  disabled={loadingMore}
                  className="text-xs font-semibold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  {loadingMore ? 'جارٍ التحميل...' : `عرض المزيد (${total - rows.length} متبقٍ)`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {noteFor && (
        <NoteModal
          debtor={noteFor}
          onClose={() => setNoteFor(null)}
          onSaved={note => updateNote(noteFor.id, note)}
        />
      )}
    </div>
  )
}
