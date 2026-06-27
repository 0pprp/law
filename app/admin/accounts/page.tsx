'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney } from '@/lib/utils'
import { debtorSearchOrFilter, DEBTOR_SEARCH_PLACEHOLDER } from '@/lib/debtor-search'
import { PremiumSelect } from '@/components/ui/premium-select'

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'
const ACCOUNT_COLS = 'id, full_name, governorate, phone, receipt_number, remaining_amount, penalty_amount, total_expenses, lawyer_fees, total_payments, required_amount'

export default function AccountsPage() {
  const branchId = useBranchId()
  const [debtors, setDebtors] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterGov, setFilterGov] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const fetchDebtors = useCallback(async (term: string) => {
    if (!term.trim()) {
      setDebtors([])
      setLoading(false)
      return
    }
    setLoading(true)
    const supabase = createClient()
    let q = supabase
      .from('debtors')
      .select(ACCOUNT_COLS)
      .or(debtorSearchOrFilter(term.trim()))
      .order('full_name')
      .limit(100)

    if (branchId) q = (q as any).eq('branch_id', branchId)

    const { data } = await q
    setDebtors(data ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { fetchDebtors(debouncedSearch) }, [fetchDebtors, debouncedSearch])

  const governorates = useMemo(() => {
    const s = new Set<string>()
    debtors.forEach(d => { if (d.governorate) s.add(d.governorate) })
    return [...s].sort()
  }, [debtors])

  const filtered = useMemo(() => debtors.filter(d => {
    if (filterGov && d.governorate !== filterGov) return false
    return true
  }), [debtors, filterGov])

  const totalRequired = filtered.reduce((s, d) => s + Number(d.required_amount ?? 0), 0)
  const totalPayments = filtered.reduce((s, d) => s + Number(d.total_payments ?? 0), 0)
  const totalRemaining = filtered.reduce((s, d) => s + Number(d.remaining_amount ?? 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="الحسابات"
        subtitle={debouncedSearch.trim() ? `${filtered.length} نتيجة` : 'ابحث عن مدين لعرض حسابه'}
        actions={
          <Link href="/admin/payments">
            <Button variant="primary" size="sm">+ تسجيل تسديد</Button>
          </Link>
        }
      />

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] p-4 shadow-sm">
            <p className="text-[10px] text-[#767676] mb-1">إجمالي المطلوب</p>
            <p className="text-lg font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(totalRequired)}</p>
          </div>
          <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-sm">
            <p className="text-[10px] text-[#767676] mb-1">إجمالي التسديدات</p>
            <p className="text-lg font-black text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(totalPayments)}</p>
          </div>
          <div className="bg-white rounded-xl border border-red-200 p-4 shadow-sm">
            <p className="text-[10px] text-[#767676] mb-1">إجمالي المتبقي</p>
            <p className="text-lg font-black text-red-600 tabular-nums" dir="ltr">{fmtMoney(totalRemaining)}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="search"
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={SEL}
          />
          <PremiumSelect
            value={filterGov}
            onChange={setFilterGov}
            disabled={!debouncedSearch.trim()}
            options={[
              { value: '', label: 'كل المحافظات' },
              ...governorates.map(g => ({ value: g, label: g })),
            ]}
            placeholder="كل المحافظات"
            headerTitle="تصفية حسب المحافظة"
            searchPlaceholder="بحث في المحافظات..."
            searchable={governorates.length > 4}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <p className="text-sm text-[#767676]">جارٍ البحث...</p>
          </div>
        ) : !debouncedSearch.trim() ? (
          <EmptyState title="ابحث عن مدين" description="اكتب الاسم أو الهاتف أو رقم الوصل لعرض كشف الحساب" />
        ) : !filtered.length ? (
          <EmptyState title="لا توجد نتائج" description="جرّب كلمات بحث مختلفة" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المدين</TH>
                <TH>المحافظة</TH>
                <TH>المتبقي</TH>
                <TH>الشرط الجزائي</TH>
                <TH>الصرفيات</TH>
                <TH>الأتعاب</TH>
                <TH className="text-emerald-700">التسديدات</TH>
                <TH className="bg-[#2C8780]/5 text-[#2C8780]">المطلوب</TH>
                <TH className="text-center">الإجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((d: any) => {
                const pct = Number(d.required_amount) > 0 ? Math.round((Number(d.total_payments) / Number(d.required_amount)) * 100) : 0
                const remaining = Number(d.remaining_amount)
                return (
                  <TR key={d.id}>
                    <TD>
                      <Link href={`/admin/debtors/${d.id}/account`} className="font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors">
                        {d.full_name}
                      </Link>
                      <div className="mt-1.5 h-1 bg-[rgba(118,118,118,0.1)] rounded-full overflow-hidden w-24">
                        <div className="h-1 bg-emerald-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </TD>
                    <TD className="text-[#767676] text-xs">{d.governorate ?? '—'}</TD>
                    <TD>
                      <span className={`font-semibold tabular-nums text-xs ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`} dir="ltr">
                        {fmtMoney(remaining)}
                      </span>
                    </TD>
                    <TD><span className="text-xs text-[#767676] tabular-nums" dir="ltr">{fmtMoney(d.penalty_amount)}</span></TD>
                    <TD><span className="text-xs text-[#767676] tabular-nums" dir="ltr">{fmtMoney(d.total_expenses)}</span></TD>
                    <TD><span className="text-xs text-[#2C8780] font-semibold tabular-nums" dir="ltr">{fmtMoney(d.lawyer_fees)}</span></TD>
                    <TD><span className="font-semibold text-emerald-700 tabular-nums text-xs" dir="ltr">{fmtMoney(d.total_payments)}</span></TD>
                    <TD className="bg-[#2C8780]/5">
                      <span className="font-black text-[#2C8780] tabular-nums text-sm" dir="ltr">{fmtMoney(d.required_amount)}</span>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-center gap-2">
                        <Link href={`/admin/debtors/${d.id}/account`} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap">كشف الحساب</Link>
                        <Link href="/admin/payments" className="text-xs text-white px-2.5 py-1.5 rounded-lg transition-colors hover:opacity-90" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>تسديد</Link>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}
