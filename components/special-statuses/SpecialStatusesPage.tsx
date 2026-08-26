'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canDeleteSpecialStatuses } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { PremiumSelect } from '@/components/ui/premium-select'
import { EmptyState } from '@/components/ui/empty-state'
import SpecialStatusBadge from '@/components/SpecialStatusBadge'
import {
  SPECIAL_STATUS_COLOR_OPTIONS,
  type SpecialStatus,
  specialStatusColorOption,
} from '@/lib/special-statuses'
import { appConfirm } from '@/lib/app-dialog'
import { SortableTH } from '@/components/ui/data-table'
import { useTableSort } from '@/hooks/use-table-sort'

interface SpecialStatusDebtor {
  id: string
  full_name: string
  phone: string | null
  branch_id: string | null
  branch_name: string | null
  branch_list_name: string | null
  court_name: string | null
  special_status_id: string | null
  special_status_name: string | null
  special_status_color: string | null
  return_task_id?: string | null
  return_task_label?: string | null
  last_note: string
}

function StatusModal({
  open,
  initialName,
  initialColor,
  title,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  initialName: string
  initialColor: string
  title: string
  saving: boolean
  error: string
  onClose: () => void
  onSave: (name: string, color: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setColor(initialColor)
    }
  }, [open, initialName, initialColor])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-[#231F20]">{title}</h3>
          <button type="button" onClick={onClose} className="text-[#767676] hover:text-[#231F20] text-lg leading-none">×</button>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div>
          <label className="block text-xs font-semibold text-[#767676] mb-1.5">اسم الصفة</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3 py-2.5 focus:outline-none focus:border-[#2C8780]"
            placeholder="مثال: متعثر، VIP، تحت المتابعة..."
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#767676] mb-2">اللون</label>
          <div className="flex flex-wrap gap-2">
            {SPECIAL_STATUS_COLOR_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setColor(opt.value)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  color === opt.value ? 'border-[#2C8780] ring-2 ring-[#2C8780]/25' : 'border-[rgba(118,118,118,0.2)]'
                }`}
              >
                <span className={`w-4 h-4 rounded-full ${opt.swatch}`} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#767676] rounded-lg border">إلغاء</button>
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => onSave(name.trim(), color)}
            className="px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {saving ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DebtorNoteModal({
  debtor,
  onClose,
  onSaved,
}: {
  debtor: SpecialStatusDebtor
  onClose: () => void
  onSaved: (lastNote: string) => void
}) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const note = text.trim()
    if (!note || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/debtors/monitoring-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId: debtor.id, note }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'فشل حفظ الملاحظة')
      onSaved(typeof json.lastNote === 'string' ? json.lastNote : note)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل حفظ الملاحظة')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-[#231F20]">إضافة ملاحظة</h3>
            <p className="mt-1 text-xs text-[#767676]">{debtor.full_name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="text-xl leading-none text-[#767676] disabled:opacity-50">×</button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          autoFocus
          placeholder="اكتب ملاحظة المتابعة..."
          className="w-full resize-none rounded-xl border border-[rgba(118,118,118,0.2)] px-3 py-2.5 text-sm focus:border-[#2C8780] focus:outline-none"
        />
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">إلغاء</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !text.trim()}
            className="rounded-xl bg-[#2C8780] px-4 py-2 text-sm font-bold text-white hover:bg-[#1D6365] disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ...' : 'حفظ الملاحظة'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DebtorTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  showBranch,
  onAddNote,
}: {
  rows: SpecialStatusDebtor[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  showBranch: boolean
  onAddNote: (debtor: SpecialStatusDebtor) => void
}) {
  const {
    rows: sortedRows,
    sortKey,
    sortDirection,
    cycleSort,
  } = useTableSort(rows, {
    name: r => r.full_name,
    phone: r => r.phone,
    branch: r => r.branch_name,
    list: r => r.branch_list_name,
    court: r => r.court_name,
    returnTask: r => r.return_task_label,
    lastNote: r => r.last_note,
  })
  const allOn = sortedRows.length > 0 && sortedRows.every(r => selected.has(r.id))
  if (!rows.length) {
    return <div className="px-4 py-8 text-center text-sm text-[#767676]">لا يوجد مدينون في هذه الصفة</div>
  }
  return (
    <div className="w-full max-w-full overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-[rgba(118,118,118,0.1)] bg-[#FAFAFA]">
            <th className="px-3 py-2.5 w-10">
              <input type="checkbox" checked={allOn} onChange={onToggleAll} className="w-4 h-4 accent-[#2C8780]" />
            </th>
            <SortableTH variant="plain" sortKey="name" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">الاسم</SortableTH>
            <SortableTH variant="plain" sortKey="phone" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">الهاتف</SortableTH>
            {showBranch && (
              <SortableTH variant="plain" sortKey="branch" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">الفرع</SortableTH>
            )}
            <SortableTH variant="plain" sortKey="list" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">القائمة</SortableTH>
            <SortableTH variant="plain" sortKey="court" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">المحكمة</SortableTH>
            <SortableTH variant="plain" sortKey="returnTask" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">المهمة المرتبطة</SortableTH>
            <SortableTH variant="plain" sortKey="lastNote" activeKey={sortKey} direction={sortDirection} onCycle={cycleSort} className="px-3 py-2.5 text-right">آخر ملاحظة</SortableTH>
            <th className="px-3 py-2.5 text-center font-semibold">الإجراء</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(118,118,118,0.08)]">
          {sortedRows.map(r => (
            <tr key={r.id} className="hover:bg-[#F8F7F8]">
              <td className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => onToggle(r.id)}
                  className="w-4 h-4 accent-[#2C8780]"
                />
              </td>
              <td className="px-3 py-3">
                <Link href={`/admin/debtors/${r.id}/account`} className="font-semibold text-[#231F20] hover:text-[#2C8780]">
                  {r.full_name}
                </Link>
              </td>
              <td className="px-3 py-3 text-xs text-[#767676]" dir="ltr">{r.phone ?? '—'}</td>
              {showBranch && <td className="px-3 py-3 text-xs text-[#767676]">{r.branch_name ?? '—'}</td>}
              <td className="px-3 py-3 text-xs text-[#767676]">{r.branch_list_name ?? '—'}</td>
              <td className="px-3 py-3 text-xs text-[#767676]">{r.court_name ?? '—'}</td>
              <td className="px-3 py-3 text-xs font-semibold text-[#1D6365]">{r.return_task_label ?? '—'}</td>
              <td className="px-3 py-3 text-xs text-[#454042] max-w-[14rem] truncate">{r.last_note || '—'}</td>
              <td className="px-3 py-3 text-center">
                <button
                  type="button"
                  onClick={() => onAddNote(r)}
                  className="whitespace-nowrap rounded-lg border border-[#2C8780]/30 bg-[#2C8780]/5 px-3 py-1.5 text-xs font-bold text-[#1D6365] hover:bg-[#2C8780]/10"
                >
                  + إضافة ملاحظة
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SpecialStatusesPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()
  const allowDelete = canDeleteSpecialStatuses(role)
  const [statuses, setStatuses] = useState<SpecialStatus[]>([])
  const [debtors, setDebtors] = useState<SpecialStatusDebtor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignStatusId, setAssignStatusId] = useState('')
  const [busy, setBusy] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingStatus, setEditingStatus] = useState<SpecialStatus | null>(null)
  const [modalError, setModalError] = useState('')
  const [modalSaving, setModalSaving] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [noteDebtor, setNoteDebtor] = useState<SpecialStatusDebtor | null>(null)
  const [debtorsLoadingKey, setDebtorsLoadingKey] = useState<string | null>(null)
  const debtorsCacheRef = useRef<Map<string, SpecialStatusDebtor[]>>(new Map())

  const load = useCallback(async () => {
    if (!branchId && !viewAllBranches) {
      setStatuses([])
      setDebtors([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (viewAllBranches) params.set('viewAll', '1')
    else if (branchId) params.set('branchId', branchId)

    try {
      // الكروت فقط أولاً — بدون تحميل كل المدينين
      const stRes = await fetch(`/api/admin/special-statuses?${params}`)
      const stJson = await stRes.json().catch(() => ({}))
      if (!stRes.ok) throw new Error(stJson.error ?? 'فشل تحميل الصفات')
      setStatuses(stJson.statuses ?? [])
      setDebtors([])
      debtorsCacheRef.current.clear()
      setSelected(new Set())
      setExpandedKey(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل التحميل')
      setStatuses([])
      setDebtors([])
    } finally {
      setLoading(false)
    }
  }, [branchId, viewAllBranches])

  useEffect(() => { void load() }, [load])

  // عند «كل الفروع» الصفة الواحدة لها نسخة بكل فرع — التجميع بالاسم بدل المعرّف
  const groupKeyOf = useCallback(
    (status: Pick<SpecialStatus, 'id' | 'name'>) => (viewAllBranches ? status.name.trim() : status.id),
    [viewAllBranches],
  )

  const loadDebtorsForStatus = useCallback(async (status: SpecialStatus, key: string) => {
    if (debtorsCacheRef.current.has(key)) {
      setDebtors(debtorsCacheRef.current.get(key) ?? [])
      return
    }
    setDebtorsLoadingKey(key)
    setError('')
    const params = new URLSearchParams()
    if (viewAllBranches) {
      params.set('viewAll', '1')
      params.set('statusName', status.name)
      if (status.ids?.length) params.set('statusIds', status.ids.join(','))
    } else {
      if (branchId) params.set('branchId', branchId)
      params.set('statusId', status.id)
    }
    try {
      const res = await fetch(`/api/admin/special-statuses/debtors?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'فشل تحميل الأسماء')
      const rows = (json.debtors ?? []) as SpecialStatusDebtor[]
      debtorsCacheRef.current.set(key, rows)
      setDebtors(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحميل الأسماء')
      setDebtors([])
    } finally {
      setDebtorsLoadingKey(null)
    }
  }, [branchId, viewAllBranches])

  async function toggleExpand(status: SpecialStatus) {
    const key = groupKeyOf(status)
    if (expandedKey === key) {
      setExpandedKey(null)
      return
    }
    setExpandedKey(key)
    if (!debtorsCacheRef.current.has(key)) setDebtors([])
    await loadDebtorsForStatus(status, key)
  }

  const activeStatuses = useMemo(
    () => statuses.filter(s => s.is_active !== false),
    [statuses],
  )

  const debtorsByStatus = useMemo(() => {
    const map = new Map<string, SpecialStatusDebtor[]>()
    for (const d of debtors) {
      if (!d.special_status_id) continue
      const key = viewAllBranches ? (d.special_status_name ?? '').trim() : d.special_status_id
      const prev = map.get(key) ?? []
      prev.push(d)
      map.set(key, prev)
    }
    return map
  }, [debtors, viewAllBranches])

  const statusOptions = useMemo(() => [
    { value: '', label: '— اختر صفة —' },
    ...statuses.map(s => ({ value: s.id, label: s.name })),
  ], [statuses])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleMany(ids: string[]) {
    const allOn = ids.length > 0 && ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allOn) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  async function applyStatus(statusId: string | null) {
    const ids = Array.from(selected)
    if (!ids.length) return
    if (!statusId) {
      const ok = await appConfirm({
        title: 'إرجاع للمهام',
        message: `سيتم إرجاع ${ids.length} مدين إلى المهام المرتبطة بهم وإزالتهم من تبويب المراقبة. هل تريد المتابعة؟`,
        confirmLabel: 'إرجاع للمهام',
      })
      if (!ok) return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/admin/debtors/set-special-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: ids, statusId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'فشل تحديث الصفة')
      setSuccess(statusId
        ? `تم تعيين الصفة لـ ${ids.length} مدين`
        : `تم إرجاع ${ids.length} مدين للمهام المرتبطة بهم`)
      setSelected(new Set())
      setAssignStatusId('')
      debtorsCacheRef.current.clear()
      setDebtors([])
      setExpandedKey(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل التحديث')
    } finally {
      setBusy(false)
    }
  }

  function openCreate() {
    setModalMode('create')
    setEditingStatus(null)
    setModalError('')
    setModalOpen(true)
  }

  function openEdit(status: SpecialStatus) {
    setModalMode('edit')
    setEditingStatus(status)
    setModalError('')
    setModalOpen(true)
  }

  async function saveStatus(name: string, color: string) {
    setModalSaving(true)
    setModalError('')
    try {
      if (modalMode === 'create') {
        const res = await fetch('/api/admin/special-statuses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            color,
            branchId,
            viewAll: viewAllBranches,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? 'فشل الإضافة')
        setSuccess('تمت إضافة الصفة')
      } else if (editingStatus) {
        const res = await fetch('/api/admin/special-statuses', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingStatus.id, name, color, viewAll: viewAllBranches }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? 'فشل التعديل')
        setSuccess('تم تعديل الصفة')
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'فشل الحفظ')
    } finally {
      setModalSaving(false)
    }
  }

  async function deleteStatus(status: SpecialStatus) {
    const ok = await appConfirm({
      title: 'حذف الصفة',
      message: viewAllBranches
        ? `هل تريد حذف صفة «${status.name}» من كل الفروع؟`
        : `هل تريد حذف صفة «${status.name}»؟`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/special-statuses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: status.id, viewAll: viewAllBranches }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'فشل الحذف')
      setSuccess('تم حذف الصفة')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل الحذف')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = selected.size
  const showBranchCol = viewAllBranches

  const expandedStatus = useMemo(
    () => activeStatuses.find(status => groupKeyOf(status) === expandedKey) ?? null,
    [activeStatuses, expandedKey, groupKeyOf],
  )
  const expandedRows = expandedKey ? (debtorsByStatus.get(expandedKey) ?? []) : []

  return (
    <div className="space-y-5">
      <PageHeader
        title="الأسماء التي تحتاج مراقبة"
        subtitle="تصنيف المدينين الذين يحتاجون متابعة خاصة لكل فرع"
        breadcrumb={[
          { label: 'لوحة التحكم', href: '/admin/dashboard' },
          { label: 'الأسماء التي تحتاج مراقبة' },
        ]}
        actions={
          <button
            type="button"
            onClick={openCreate}
            disabled={!branchId && !viewAllBranches}
            className="px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            + إضافة صفة
          </button>
        }
      />

      {!branchId && !viewAllBranches && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو «الكل» لعرض الأسماء التي تحتاج مراقبة.
        </div>
      )}

      {success && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 font-semibold">{success}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

      {selectedCount > 0 && (
        <div className="sticky top-2 z-20 bg-[#2C8780]/8 border border-[#2C8780]/25 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-[#1D6365]">تم تحديد {selectedCount} مدين</p>
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[12rem]">
            <PremiumSelect
              value={assignStatusId}
              onChange={setAssignStatusId}
              options={statusOptions}
              placeholder="— اختر صفة —"
              fieldLabel="تغيير الصفة"
              headerTitle="تغيير الصفة"
              searchable
              className="min-w-[12rem] flex-1"
            />
            <button
              type="button"
              disabled={busy || !assignStatusId}
              onClick={() => void applyStatus(assignStatusId)}
              className="text-xs font-bold text-white px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
            >
              تغيير الصفة
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void applyStatus(null)}
              className="text-xs font-bold text-orange-700 bg-orange-50 border border-orange-200 px-3 py-2 rounded-lg disabled:opacity-50"
              title="يرجع المدين للمهمة التي كان عليها عند التحويل"
            >
              إرجاع للمهام
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-semibold text-[#767676]">إلغاء التحديد</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-36 bg-white rounded-xl border animate-pulse" />)}
        </div>
      ) : !activeStatuses.length ? (
        <EmptyState title="لا توجد صفات بعد" description="أضف أول تصنيف للأسماء التي تحتاج مراقبة للفرع المحدد" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {activeStatuses.map(status => {
              const key = groupKeyOf(status)
              const rows = debtorsByStatus.get(key) ?? []
              const count = Number(status.debtor_count ?? 0) || rows.length
              const opt = specialStatusColorOption(status.color)
              const selectedHere = rows.filter(r => selected.has(r.id)).length
              const isOpen = expandedKey === key
              const isLoadingRows = debtorsLoadingKey === key
              return (
                <div
                  key={status.id}
                  className={`bg-white rounded-xl border p-5 sm:p-6 shadow-sm transition-all hover:shadow-md ${opt.cardBorder} ${isOpen ? 'ring-2 ring-[#2C8780]/30' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => void toggleExpand(status)}
                    className="w-full text-right"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-semibold text-[#454042] mb-2 truncate">{status.name}</p>
                        <p className="text-2xl sm:text-3xl font-black leading-none tabular-nums text-[#231F20]" dir="ltr">{count}</p>
                        <p className="text-sm text-[#454042] mt-2 font-medium">
                          {count} اسم يحتاج مراقبة
                          {selectedHere > 0 ? ` · محدد ${selectedHere}` : ''}
                        </p>
                      </div>
                      <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${opt.swatch}`}>
                        <span className="text-white text-lg font-black">{status.name.charAt(0)}</span>
                      </div>
                    </div>
                  </button>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleExpand(status)}
                      className="text-xs font-bold text-white px-3 py-1.5 rounded-lg"
                      style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                    >
                      {isLoadingRows ? 'جارٍ التحميل...' : isOpen ? 'إخفاء الأسماء' : 'عرض الأسماء'}
                    </button>
                    <button type="button" onClick={() => openEdit(status)} className="text-xs font-semibold text-[#2C8780] hover:underline">
                      تعديل
                    </button>
                    {allowDelete && (
                      <button type="button" onClick={() => void deleteStatus(status)} className="text-xs font-semibold text-red-600 hover:underline">
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {expandedStatus && (
            <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${specialStatusColorOption(expandedStatus.color).cardBorder}`}>
              <div className={`px-4 py-3 border-b flex items-center gap-3 ${specialStatusColorOption(expandedStatus.color).cardBg}`}>
                <span className={`w-1.5 h-8 rounded-full ${specialStatusColorOption(expandedStatus.color).bar}`} />
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-black text-[#231F20]">{expandedStatus.name}</h3>
                  <p className="text-xs text-[#767676]">
                    {debtorsLoadingKey === expandedKey ? 'جارٍ تحميل الأسماء...' : `${expandedRows.length} مدين`}
                  </p>
                </div>
                <SpecialStatusBadge name={expandedStatus.name} color={expandedStatus.color} />
                <button
                  type="button"
                  onClick={() => setExpandedKey(null)}
                  className="text-xs font-semibold text-[#767676] hover:text-[#231F20]"
                >
                  إغلاق
                </button>
              </div>
              {debtorsLoadingKey === expandedKey ? (
                <div className="px-4 py-10 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
              ) : (
              <DebtorTable
                rows={expandedRows}
                selected={selected}
                onToggle={toggle}
                onToggleAll={() => toggleMany(expandedRows.map(r => r.id))}
                showBranch={showBranchCol}
                onAddNote={setNoteDebtor}
              />
              )}
            </div>
          )}
        </div>
      )}

      <StatusModal
        open={modalOpen}
        initialName={editingStatus?.name ?? ''}
        initialColor={editingStatus?.color ?? 'gray'}
        title={modalMode === 'create' ? 'إضافة صفة' : 'تعديل صفة'}
        saving={modalSaving}
        error={modalError}
        onClose={() => setModalOpen(false)}
        onSave={saveStatus}
      />
      {noteDebtor && (
        <DebtorNoteModal
          debtor={noteDebtor}
          onClose={() => setNoteDebtor(null)}
          onSaved={lastNote => {
            setDebtors(prev => prev.map(d => (d.id === noteDebtor.id ? { ...d, last_note: lastNote } : d)))
            setSuccess(`تمت إضافة ملاحظة لـ ${noteDebtor.full_name}`)
          }}
        />
      )}
    </div>
  )
}
