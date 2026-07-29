'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

function DebtorTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  showBranch,
}: {
  rows: SpecialStatusDebtor[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  showBranch: boolean
}) {
  const allOn = rows.length > 0 && rows.every(r => selected.has(r.id))
  if (!rows.length) {
    return <div className="px-4 py-8 text-center text-sm text-[#767676]">لا يوجد مدينون في هذه الصفة</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[rgba(118,118,118,0.1)] bg-[#FAFAFA]">
            <th className="px-3 py-2.5 w-10">
              <input type="checkbox" checked={allOn} onChange={onToggleAll} className="w-4 h-4 accent-[#2C8780]" />
            </th>
            <th className="px-3 py-2.5 text-right font-semibold">الاسم</th>
            <th className="px-3 py-2.5 text-right font-semibold">الهاتف</th>
            {showBranch && <th className="px-3 py-2.5 text-right font-semibold">الفرع</th>}
            <th className="px-3 py-2.5 text-right font-semibold">القائمة</th>
            <th className="px-3 py-2.5 text-right font-semibold">المحكمة</th>
            <th className="px-3 py-2.5 text-right font-semibold">آخر ملاحظة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(118,118,118,0.08)]">
          {rows.map(r => (
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
              <td className="px-3 py-3 text-xs text-[#454042] max-w-[14rem] truncate">{r.last_note || '—'}</td>
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
      const [stRes, dRes] = await Promise.all([
        fetch(`/api/admin/special-statuses?${params}`),
        fetch(`/api/admin/special-statuses/debtors?${params}`),
      ])
      const stJson = await stRes.json().catch(() => ({}))
      const dJson = await dRes.json().catch(() => ({}))
      if (!stRes.ok) throw new Error(stJson.error ?? 'فشل تحميل الصفات')
      if (!dRes.ok) throw new Error(dJson.error ?? 'فشل تحميل المدينين')
      setStatuses(stJson.statuses ?? [])
      setDebtors(dJson.debtors ?? [])
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل التحميل')
      setStatuses([])
      setDebtors([])
    } finally {
      setLoading(false)
    }
  }, [branchId, viewAllBranches])

  useEffect(() => { void load() }, [load])

  const activeStatuses = useMemo(
    () => statuses.filter(s => s.is_active !== false),
    [statuses],
  )

  // عند «كل الفروع» الصفة الواحدة لها نسخة بكل فرع — التجميع بالاسم بدل المعرّف
  const groupKeyOf = useCallback(
    (status: Pick<SpecialStatus, 'id' | 'name'>) => (viewAllBranches ? status.name.trim() : status.id),
    [viewAllBranches],
  )

  const debtorsByStatus = useMemo(() => {
    const map = new Map<string, SpecialStatusDebtor[]>()
    const unassigned: SpecialStatusDebtor[] = []
    for (const d of debtors) {
      if (!d.special_status_id) {
        unassigned.push(d)
        continue
      }
      const key = viewAllBranches ? (d.special_status_name ?? '').trim() : d.special_status_id
      const prev = map.get(key) ?? []
      prev.push(d)
      map.set(key, prev)
    }
    return { map, unassigned }
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
      setSuccess(statusId ? `تم تعيين الصفة لـ ${ids.length} مدين` : `تمت إزالة الصفة عن ${ids.length} مدين`)
      setSelected(new Set())
      setAssignStatusId('')
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="الحالات الخاصة"
        subtitle="تصنيف المدينين بصفات مخصصة لكل فرع"
        breadcrumb={[
          { label: 'لوحة التحكم', href: '/admin/dashboard' },
          { label: 'الحالات الخاصة' },
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
          اختر فرعاً من القائمة العلوية أو «الكل» لعرض الحالات الخاصة.
        </div>
      )}

      {success && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 font-semibold">{success}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm p-4">
        <h2 className="text-sm font-black text-[#231F20] mb-3">إدارة الصفات</h2>
        {loading ? (
          <div className="py-8 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
        ) : !statuses.length ? (
          <EmptyState title="لا توجد صفات بعد" description="أضف أول صفة خاصة للفرع المحدد" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {statuses.map(s => {
              const opt = specialStatusColorOption(s.color)
              return (
                <div key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${opt.cardBorder} ${opt.cardBg}`}>
                  <span className={`w-3 h-3 rounded-full ${opt.bar}`} />
                  <SpecialStatusBadge name={s.name} color={s.color} />
                  <span className="text-[11px] text-[#767676] tabular-nums">({s.debtor_count ?? 0})</span>
                  <button type="button" onClick={() => openEdit(s)} className="text-[11px] font-semibold text-[#2C8780] hover:underline">تعديل</button>
                  {allowDelete && (
                    <button type="button" onClick={() => void deleteStatus(s)} className="text-[11px] font-semibold text-red-600 hover:underline">حذف</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

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
            >
              إزالة الصفة
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-semibold text-[#767676]">إلغاء التحديد</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-40 bg-white rounded-2xl border animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {activeStatuses.map(status => {
            const rows = debtorsByStatus.map.get(groupKeyOf(status)) ?? []
            const opt = specialStatusColorOption(status.color)
            const ids = rows.map(r => r.id)
            return (
              <div key={status.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${opt.cardBorder}`}>
                <div className={`px-4 py-3 border-b flex items-center gap-3 ${opt.cardBg}`}>
                  <span className={`w-1.5 h-8 rounded-full ${opt.bar}`} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-black text-[#231F20]">{status.name}</h3>
                    <p className="text-xs text-[#767676]">{rows.length} مدين</p>
                  </div>
                  <SpecialStatusBadge name={status.name} color={status.color} />
                </div>
                <DebtorTable
                  rows={rows}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={() => toggleMany(ids)}
                  showBranch={showBranchCol}
                />
              </div>
            )
          })}

          <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-[#231F20]">بدون صفة</h3>
                <p className="text-xs text-[#767676]">{debtorsByStatus.unassigned.length} مدين</p>
              </div>
              {selectedCount > 0 && (
                <button
                  type="button"
                  disabled={busy || !assignStatusId}
                  onClick={() => void applyStatus(assignStatusId)}
                  className="text-xs font-bold text-white px-3 py-2 rounded-lg disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                >
                  تعيين صفة للمحددين
                </button>
              )}
            </div>
            <DebtorTable
              rows={debtorsByStatus.unassigned}
              selected={selected}
              onToggle={toggle}
              onToggleAll={() => toggleMany(debtorsByStatus.unassigned.map(r => r.id))}
              showBranch={showBranchCol}
            />
          </div>
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
    </div>
  )
}
