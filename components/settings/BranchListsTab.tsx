'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { fetchBranchLists, countDebtorsOnBranchList, unlinkDebtorsFromBranchList, findConflictingBranchList } from '@/lib/branch-lists'
import type { BranchList } from '@/lib/branch-lists'
import {
  normalizeBranchListName,
  sanitizeBranchListDisplayName,
} from '@/lib/branch-list-normalize'
import { useAdminRole } from '@/context/admin-role'
import { canAddBranchReferenceData, canModifyBranchReferenceData } from '@/lib/permissions'
import { appConfirm } from '@/lib/app-dialog'

const INP = 'w-full px-3 py-2 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] transition-all'

function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void
  children: React.ReactNode; footer: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <h2 className="font-bold text-[#231F20] text-sm">{title}</h2>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-lg bg-[#F3F1F2] text-[#767676] hover:bg-slate-200 flex items-center justify-center text-xl leading-none transition-colors">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">{children}</div>
        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] flex gap-3 bg-[#F8F7F8] shrink-0">{footer}</div>
      </div>
    </div>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
      {label}
    </button>
  )
}

export default function BranchListsTab() {
  const role = useAdminRole()
  const canAdd = canAddBranchReferenceData(role)
  const canModify = canModifyBranchReferenceData(role)
  const branchId = useBranchId()
  const [lists, setLists] = useState<BranchList[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<{ name: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState<BranchList | null>(null)
  const [deleteDebtorCount, setDeleteDebtorCount] = useState(0)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [mergeCandidate, setMergeCandidate] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    if (!branchId) {
      setLists([])
      setLoading(false)
      return
    }
    setLoading(true)
    const data = await fetchBranchLists(createClient(), branchId)
    setLists(data)
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  function openAdd() {
    if (!canAdd || !branchId) return
    setForm({ name: '' })
    setEditingId(null)
    setErr('')
  }

  function openEdit(item: BranchList) {
    if (!canModify) return
    setForm({ name: item.name })
    setEditingId(item.id)
    setErr('')
  }

  async function save() {
    if (!branchId) return
    if (!canAdd) return
    if (editingId && !canModify) return
    const name = sanitizeBranchListDisplayName(form?.name ?? '')
    if (!name) { setErr('اسم القائمة مطلوب'); return }

    const key = normalizeBranchListName(name)
    if (!key) { setErr('اسم القائمة غير صالح'); return }

    setSaving(true)
    setErr('')
    setMergeCandidate(null)
    const sb = createClient()

    const conflict = await findConflictingBranchList(sb, branchId, name, editingId ?? undefined)
    if (conflict) {
      if (!editingId) {
        setErr(`هذه القائمة موجودة مسبقاً باسم: ${conflict.name}`)
        setSaving(false)
        return
      }
      // تعديل إلى اسم يطابق قائمة أخرى — لا دمج تلقائي
      setMergeCandidate({ id: conflict.id, name: conflict.name })
      setErr(`يوجد اسم مطابق. هل تريد دمج القائمتين؟ القائمة الموجودة: «${conflict.name}»`)
      setSaving(false)
      return
    }

    const payload: Record<string, unknown> = { name, branch_id: branchId, normalized_name: key }
    const { error } = editingId
      ? await sb.from('branch_lists').update({ name, normalized_name: key }).eq('id', editingId)
      : await sb.from('branch_lists').insert(payload)

    if (error) {
      if (String(error.message ?? '').includes('normalized_name')) {
        const legacy = editingId
          ? await sb.from('branch_lists').update({ name }).eq('id', editingId)
          : await sb.from('branch_lists').insert({ name, branch_id: branchId })
        if (legacy.error) {
          setErr(legacy.error.code === '23505'
            ? `هذه القائمة موجودة مسبقاً`
            : legacy.error.message)
          setSaving(false)
          return
        }
      } else {
        setErr(error.code === '23505'
          ? `هذه القائمة موجودة مسبقاً باسم مطابق`
          : error.message)
        setSaving(false)
        return
      }
    }
    setForm(null)
    setSaving(false)
    load()
  }

  async function confirmMergeIntoExisting() {
    if (!editingId || !mergeCandidate || !canModify) return
    const ok = await appConfirm({
      title: 'دمج القائمتين؟',
      message: `سيتم نقل كل المدينين والمندوبين من القائمة الحالية إلى «${mergeCandidate.name}» ثم حذف القائمة الحالية.\nلا يمكن التراجع.`,
      confirmLabel: 'دمج',
      danger: true,
    })
    if (!ok) return

    setSaving(true)
    setErr('')
    try {
      const res = await fetch('/api/admin/merge-branch-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonicalId: mergeCandidate.id,
          duplicateIds: [editingId],
          displayName: mergeCandidate.name,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof json.error === 'string' ? json.error : 'فشل الدمج')
        setSaving(false)
        return
      }
      setForm(null)
      setMergeCandidate(null)
      setSaving(false)
      load()
    } catch {
      setErr('فشل الاتصال')
      setSaving(false)
    }
  }

  async function openDelete(item: BranchList) {
    if (!canModify) return
    setDeleteLoading(true)
    const count = await countDebtorsOnBranchList(createClient(), item.id)
    setDeleteDebtorCount(count)
    setDeleting(item)
    setDeleteLoading(false)
  }

  async function confirmDelete() {
    if (!deleting || !canModify) return
    setDeleteLoading(true)
    const sb = createClient()
    if (deleteDebtorCount > 0) {
      const unlink = await unlinkDebtorsFromBranchList(sb, deleting.id)
      if (!unlink.ok) {
        setErr(unlink.error ?? 'فشل إزالة الربط')
        setDeleteLoading(false)
        return
      }
    }
    const { error } = await sb.from('branch_lists').delete().eq('id', deleting.id)
    setDeleteLoading(false)
    if (error) {
      setErr(error.message)
      setDeleting(null)
      return
    }
    setDeleting(null)
    load()
  }

  if (!branchId) {
    return (
      <p className="text-sm text-[#767676] bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        حدّد الفرع لتتمكن من الوصول إلى هنا.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#767676]">قوائم التصنيف داخل الفرع — تُربط بالمدينين للفلترة والتكليف</p>
        {canAdd && <AddBtn label="إضافة قائمة" onClick={openAdd} />}
      </div>

      {err && !form && !deleting && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
      )}

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.1)] overflow-hidden">
        {loading ? (
          <div className="py-14 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
        ) : lists.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-semibold text-[#231F20]">لا توجد قوائم</p>
            <p className="text-xs text-[#767676] mt-1">أضف أول قائمة لهذا الفرع</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F3F1F2] border-b border-[rgba(118,118,118,0.08)]">
              <tr>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#767676]">اسم القائمة</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#767676] w-28">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
              {lists.map(item => (
                <tr key={item.id} className="hover:bg-[#F8F7F8] transition-colors">
                  <td className="px-4 py-3 font-semibold text-[#231F20]">{item.name}</td>
                  <td className="px-4 py-3">
                    {canModify && (
                      <div className="flex items-center justify-center gap-1.5">
                        <button type="button" onClick={() => openEdit(item)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[rgba(118,118,118,0.2)] text-[#231F20] hover:border-[#2C8780]/40 hover:text-[#2C8780] transition-colors">تعديل</button>
                        <button type="button" onClick={() => openDelete(item)} disabled={deleteLoading} className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">حذف</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form !== null && (
        <Modal
          title={editingId ? 'تعديل القائمة' : 'إضافة قائمة'}
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" onClick={() => { setForm(null); setMergeCandidate(null) }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676]">إلغاء</button>
              {mergeCandidate && editingId ? (
                <button type="button" onClick={() => void confirmMergeIntoExisting()} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60">
                  {saving ? 'جارٍ الدمج...' : 'دمج القائمتين'}
                </button>
              ) : (
                <button type="button" onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  {saving ? 'جارٍ الحفظ...' : editingId ? 'حفظ' : 'إضافة'}
                </button>
              )}
            </>
          )}
        >
          <div>
            <label className="block text-xs font-semibold text-[#767676] mb-1">اسم القائمة</label>
            <input
              value={form.name}
              onChange={e => setForm({ name: e.target.value })}
              className={INP}
              placeholder="مثال: السوق الاولى"
              autoFocus
            />
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </Modal>
      )}

      {deleting && (
        <Modal
          title="تأكيد حذف القائمة"
          onClose={() => setDeleting(null)}
          footer={(
            <>
              <button type="button" onClick={() => setDeleting(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676]">إلغاء</button>
              <button type="button" onClick={confirmDelete} disabled={deleteLoading} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">
                {deleteLoading ? 'جارٍ الحذف...' : 'حذف'}
              </button>
            </>
          )}
        >
          <p className="text-sm text-[#767676]">
            هل تريد حذف <span className="font-bold text-[#231F20]">"{deleting.name}"</span>؟
          </p>
          {deleteDebtorCount > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              يوجد {deleteDebtorCount} مدين مرتبط بهذه القائمة. سيتم نقلهم إلى «بدون قائمة» ثم حذف القائمة.
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
