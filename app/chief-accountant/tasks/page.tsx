'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fmtDate } from '@/lib/utils'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { CASE_TYPE_LABELS } from '@/lib/case-type'
import { PageHeader } from '@/components/ui/page-header'
import { PremiumSelect } from '@/components/ui/premium-select'

type PrepDebtor = {
  id: string
  full_name: string
  branch_id: string | null
  case_type: 'civil' | 'criminal' | null
  created_at: string
  phone: string | null
  branch_name?: string | null
}

type AssignedBranch = { id: string; name: string }

export default function ChiefAccountantTasksPage() {
  const [rows, setRows] = useState<PrepDebtor[]>([])
  const [branches, setBranches] = useState<AssignedBranch[]>([])
  const [branchFilter, setBranchFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [completing, setCompleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('غير مصرح')
      setLoading(false)
      return
    }

    const [{ data: linkRows, error: linkErr }, { data, error: qErr }] = await Promise.all([
      supabase
        .from('chief_accountant_branches')
        .select('branch_id, branches:branches(id, name)')
        .eq('profile_id', user.id),
      supabase
        .from('debtors')
        .select('id, full_name, branch_id, case_type, created_at, phone')
        .eq('assigned_chief_accountant_id', user.id)
        .eq('file_preparation_status', 'preparing')
        .order('created_at', { ascending: true }),
    ])

    if (linkErr) {
      setError(
        linkErr.message.includes('chief_accountant_branches')
          ? 'جدول فروع المحاسب الرئيسي غير مفعّل بعد — طبّق الهجرة'
          : 'فشل تحميل المحافظات',
      )
      setBranches([])
    } else {
      const mapped: AssignedBranch[] = []
      for (const row of linkRows ?? []) {
        const b = Array.isArray(row.branches) ? row.branches[0] : row.branches
        if (b?.id && b?.name) mapped.push({ id: b.id, name: b.name })
      }
      mapped.sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      setBranches(mapped)
    }

    if (qErr) {
      setError(
        qErr.message.includes('file_preparation_status') || qErr.message.includes('assigned_chief')
          ? 'أعمدة التجهيز غير مفعّلة بعد — طبّق هجرة المحاسب الرئيسي'
          : 'فشل تحميل الأسماء',
      )
      setRows([])
      setLoading(false)
      return
    }

    const list = (data ?? []) as PrepDebtor[]
    const nameById = new Map<string, string>()
    for (const row of linkRows ?? []) {
      const b = Array.isArray(row.branches) ? row.branches[0] : row.branches
      if (b?.id && b?.name) nameById.set(b.id, b.name)
    }
    // أسماء فروع قد تظهر في المدينين حتى لو لم تُحمَّل من الربط (احتياط)
    const missingIds = [...new Set(
      list
        .map(d => d.branch_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && !nameById.has(id)),
    )]
    if (missingIds.length) {
      const { data: extra } = await supabase.from('branches').select('id, name').in('id', missingIds)
      for (const b of extra ?? []) nameById.set(b.id, b.name)
    }

    setRows(list.map(d => ({
      ...d,
      branch_name: d.branch_id ? nameById.get(d.branch_id) ?? null : null,
    })))
    setSelectedIds([])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const visibleRows = useMemo(() => {
    if (!branchFilter) return rows
    return rows.filter(r => r.branch_id === branchFilter)
  }, [rows, branchFilter])

  function toggleOne(id: string) {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    if (visibleRows.length > 0 && visibleRows.every(r => selectedIds.includes(r.id))) {
      setSelectedIds(prev => prev.filter(id => !visibleRows.some(r => r.id === id)))
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...visibleRows.map(r => r.id)])])
    }
  }

  async function completePreparation(ids: string[]) {
    if (!ids.length || completing) return
    const ok = await appConfirm({
      title: 'تم التجهيز',
      message: `تأكيد تجهيز ${ids.length} ملف وإنشاء مهمة إقامة دعوى لكل منهم؟`,
      confirmLabel: 'تم التجهيز',
    })
    if (!ok) return

    setCompleting(true)
    try {
      const res = await fetch('/api/chief-accountant/complete-preparation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: ids }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : 'فشل إتمام التجهيز'
        await appAlert({ title: 'تعذر الإتمام', message: msg })
        return
      }
      const updated: string[] = Array.isArray(data.updatedIds) ? data.updatedIds : []
      const failed: { name?: string; reason?: string }[] = Array.isArray(data.failed) ? data.failed : []
      const done = new Set(updated)
      setRows(prev => prev.filter(r => !done.has(r.id)))
      setSelectedIds([])
      if (failed.length) {
        await appAlert({
          title: 'إتمام جزئي',
          message: `تم ${updated.length}. تعذّر ${failed.length}:\n${failed.slice(0, 3).map(f => `«${f.name}»: ${f.reason}`).join('\n')}`,
        })
      }
    } catch {
      await appAlert({ title: 'خطأ', message: 'فشل الاتصال بالخادم' })
    } finally {
      setCompleting(false)
    }
  }

  const allSelected = visibleRows.length > 0 && visibleRows.every(r => selectedIds.includes(r.id))
  const someSelected = visibleRows.some(r => selectedIds.includes(r.id))

  const branchOptions = [
    { value: '', label: 'كل المحافظات' },
    ...branches.map(b => ({ value: b.id, label: b.name })),
  ]

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="تجهيز الملفات"
        subtitle="مدينون معيَّنون لك بانتظار إتمام التجهيز"
        actions={(
          <span className="inline-flex items-center justify-center min-w-[2.5rem] h-10 px-3 rounded-full bg-sky-100 text-sky-900 text-base font-black tabular-nums">
            {loading ? '—' : visibleRows.length}
          </span>
        )}
      />

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4 sm:p-5">
        <label className="block text-sm font-bold text-[#231F20] mb-2">المحافظة / الفرع</label>
        <div className="max-w-md">
          <PremiumSelect
            value={branchFilter}
            onChange={v => {
              setBranchFilter(v)
              setSelectedIds([])
            }}
            options={branchOptions}
            placeholder="كل المحافظات"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {!loading && visibleRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3.5">
          <label className="flex items-center gap-2.5 text-sm font-semibold text-[#231F20] cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => {
                if (el) el.indeterminate = someSelected && !allSelected
              }}
              onChange={toggleAll}
              className="w-5 h-5 accent-[#0369a1] cursor-pointer"
            />
            تحديد الكل المعروض ({visibleRows.length})
          </label>
          <button
            type="button"
            disabled={selectedIds.length === 0 || completing}
            onClick={() => void completePreparation(selectedIds)}
            className="text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl"
            style={{ background: 'linear-gradient(135deg,#0369a1,#0c4a6e)' }}
          >
            {completing ? 'جارٍ...' : `تم التجهيز${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-2xl border animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] px-4 py-14 text-center shadow-sm">
          <p className="text-base font-semibold text-[#231F20]">لا ملفات قيد التجهيز حالياً</p>
          <p className="text-sm text-[#767676] mt-2">عند إرسال أسماء من الإدارة ستظهر هنا</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] px-4 py-14 text-center shadow-sm">
          <p className="text-base font-semibold text-[#231F20]">لا أسماء في هذه المحافظة</p>
          <p className="text-sm text-[#767676] mt-2">جرّب «كل المحافظات» أو محافظة أخرى</p>
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-[#767676] border-b border-[rgba(118,118,118,0.1)] bg-[#FAFAFA]">
                  <th className="px-4 py-3.5 w-14 text-center font-semibold">تحديد</th>
                  <th className="px-4 py-3.5 font-semibold">الاسم</th>
                  <th className="px-4 py-3.5 font-semibold">النوع</th>
                  <th className="px-4 py-3.5 font-semibold">المحافظة</th>
                  <th className="px-4 py-3.5 font-semibold">الهاتف</th>
                  <th className="px-4 py-3.5 font-semibold">تاريخ الإضافة</th>
                  <th className="px-4 py-3.5 font-semibold text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
                {visibleRows.map(r => {
                  const checked = selectedIds.includes(r.id)
                  return (
                    <tr key={r.id} className={checked ? 'bg-sky-50/50' : 'hover:bg-[#FAFAFA]'}>
                      <td className="px-4 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(r.id)}
                          className="w-5 h-5 accent-[#0369a1] cursor-pointer"
                          aria-label={`تحديد ${r.full_name}`}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/chief-accountant/debtors/${r.id}`}
                          className="font-bold text-[#231F20] hover:text-[#0369a1] transition-colors"
                        >
                          {r.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-[#767676]">
                        {CASE_TYPE_LABELS[(r.case_type ?? 'civil') as 'civil' | 'criminal']}
                      </td>
                      <td className="px-4 py-3.5 text-[#767676]">{r.branch_name || '—'}</td>
                      <td className="px-4 py-3.5 text-[#767676] font-mono" dir="ltr">{r.phone || '—'}</td>
                      <td className="px-4 py-3.5 text-[#767676]" dir="ltr">{fmtDate(r.created_at)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          <Link
                            href={`/chief-accountant/debtors/${r.id}`}
                            className="text-xs font-bold text-[#0369a1] border border-sky-200 px-3 py-2 rounded-lg hover:bg-sky-50"
                          >
                            البروفايل
                          </Link>
                          <button
                            type="button"
                            disabled={completing}
                            onClick={() => void completePreparation([r.id])}
                            className="text-xs font-bold text-white px-3 py-2 rounded-lg disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg,#0369a1,#0c4a6e)' }}
                          >
                            تم التجهيز
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-3">
            {visibleRows.map(r => {
              const checked = selectedIds.includes(r.id)
              return (
                <li
                  key={r.id}
                  className={`bg-white rounded-2xl border p-4 shadow-sm ${checked ? 'border-sky-300 bg-sky-50/40' : 'border-[rgba(118,118,118,0.12)]'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(r.id)}
                      className="mt-1 w-5 h-5 accent-[#0369a1] cursor-pointer shrink-0"
                      aria-label={`تحديد ${r.full_name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/chief-accountant/debtors/${r.id}`}
                        className="font-bold text-base text-[#231F20] hover:text-[#0369a1] transition-colors"
                      >
                        {r.full_name}
                      </Link>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-[#767676]">
                        <span>{CASE_TYPE_LABELS[(r.case_type ?? 'civil') as 'civil' | 'criminal']}</span>
                        {r.branch_name && <span>🏢 {r.branch_name}</span>}
                        {r.phone && <span dir="ltr">{r.phone}</span>}
                        <span dir="ltr">📅 {fmtDate(r.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 mr-8">
                    <Link
                      href={`/chief-accountant/debtors/${r.id}`}
                      className="flex-1 text-center text-sm font-bold text-[#0369a1] border border-sky-200 px-3 py-2.5 rounded-xl hover:bg-sky-50"
                    >
                      البروفايل
                    </Link>
                    <button
                      type="button"
                      disabled={completing}
                      onClick={() => void completePreparation([r.id])}
                      className="flex-1 text-sm font-bold text-white px-3 py-2.5 rounded-xl disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg,#0369a1,#0c4a6e)' }}
                    >
                      تم التجهيز
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
