'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtDate } from '@/lib/utils'

const INP = 'w-full pr-9 pl-4 py-2.5 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

function SearchIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
}

export default function DebtorsPage() {
  const [debtors, setDebtors] = useState<any[]>([])
  const [filtered, setFiltered] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('debtors').select('*').order('created_at', { ascending: false })
    setDebtors(data ?? [])
    setFiltered(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!search.trim()) { setFiltered(debtors); return }
    const q = search.toLowerCase()
    setFiltered(debtors.filter(d =>
      d.full_name?.toLowerCase().includes(q) ||
      d.id_number?.toLowerCase().includes(q) ||
      d.phone?.includes(q) ||
      d.receipt_number?.toLowerCase().includes(q)
    ))
  }, [search, debtors])

  async function deleteDebtor(id: string, name: string) {
    if (!confirm(`هل أنت متأكد من حذف المدين "${name}"؟\nسيتم حذف جميع البيانات المرتبطة به.`)) return
    setDeletingId(id)
    setError('')
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('debtors').delete().eq('id', id)
    if (dbErr) { setError(`فشل الحذف: ${dbErr.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_debtor', entity_type: 'debtor', entity_id: id, description: `حذف مدين: ${name}` }, supabase)
    setDeletingId(null)
    load()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="المدينون"
        subtitle={`${debtors.length} مدين مسجّل في النظام`}
        actions={
          <Link href="/admin/debtors/new">
            <Button variant="primary" size="sm">+ إضافة مدين</Button>
          </Link>
        }
      />

      {/* Search bar */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="relative max-w-sm">
          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-[#767676]">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالاسم، رقم الهوية، الهاتف، أو رقم الوصل..."
            className={INP}
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState
            title={search ? 'لا نتائج للبحث' : 'لا يوجد مدينون مسجلون بعد'}
            description={search ? 'جرّب كلمات بحث مختلفة' : 'ابدأ بإضافة أول مدين في النظام'}
            action={!search ? (
              <Link href="/admin/debtors/new"><Button variant="primary" size="sm">+ إضافة مدين</Button></Link>
            ) : undefined}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>الاسم</TH>
                    <TH>رقم الهوية</TH>
                    <TH>نوع الصك</TH>
                    <TH>المبلغ المطلوب</TH>
                    <TH>المتبقي</TH>
                    <TH>تاريخ الإضافة</TH>
                    <TH className="text-center">الإجراءات</TH>
                  </tr>
                </THead>
                <TBody>
                  {filtered.map(debtor => (
                    <TR key={debtor.id}>
                      <TD>
                        <div>
                          <Link href={`/admin/debtors/${debtor.id}/account`} className="font-semibold text-[#231F20] hover:text-[#2C8780] transition-colors">
                            {debtor.full_name}
                          </Link>
                          {debtor.phone && (
                            <p className="text-[11px] text-[#767676] mt-0.5 font-mono" dir="ltr">{debtor.phone}</p>
                          )}
                        </div>
                      </TD>
                      <TD><span className="font-mono text-xs" dir="ltr">{debtor.id_number ?? '—'}</span></TD>
                      <TD>
                        <Badge variant="default">{RECEIPT_TYPE_LABELS[debtor.receipt_type as keyof typeof RECEIPT_TYPE_LABELS] ?? debtor.receipt_type}</Badge>
                      </TD>
                      <TD><span className="font-semibold tabular-nums" dir="ltr">{fmtMoney(debtor.required_amount)}</span></TD>
                      <TD>
                        <span className={`font-semibold tabular-nums ${Number(debtor.remaining_amount) > 0 ? 'text-red-600' : 'text-green-600'}`} dir="ltr">
                          {fmtMoney(debtor.remaining_amount)}
                        </span>
                      </TD>
                      <TD><span className="text-xs" dir="ltr">{fmtDate(debtor.created_at)}</span></TD>
                      <TD>
                        <div className="flex items-center justify-center gap-2">
                          <Link href={`/admin/debtors/${debtor.id}/account`} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap">كشف الحساب</Link>
                          <Link href={`/admin/debtors/${debtor.id}/edit`} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</Link>
                          <button
                            onClick={() => deleteDebtor(debtor.id, debtor.full_name)}
                            disabled={deletingId === debtor.id}
                            className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {deletingId === debtor.id ? '...' : 'حذف'}
                          </button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {filtered.map(debtor => (
                <div key={debtor.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Link href={`/admin/debtors/${debtor.id}/account`} className="font-semibold text-[#231F20]">{debtor.full_name}</Link>
                    <Badge variant="default" className="shrink-0">{RECEIPT_TYPE_LABELS[debtor.receipt_type as keyof typeof RECEIPT_TYPE_LABELS]}</Badge>
                  </div>
                  {debtor.id_number && <p className="text-xs text-[#767676] font-mono mb-2" dir="ltr">{debtor.id_number}</p>}
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <p className="text-[10px] text-[#767676] mb-0.5">المطلوب</p>
                      <p className="font-semibold text-xs" dir="ltr">{fmtMoney(debtor.required_amount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#767676] mb-0.5">المتبقي</p>
                      <p className={`font-semibold text-xs ${Number(debtor.remaining_amount) > 0 ? 'text-red-600' : 'text-green-600'}`} dir="ltr">{fmtMoney(debtor.remaining_amount)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/debtors/${debtor.id}/account`} className="flex-1 text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg">كشف الحساب</Link>
                    <Link href={`/admin/debtors/${debtor.id}/edit`} className="flex-1 text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg">تعديل</Link>
                    <button
                      onClick={() => deleteDebtor(debtor.id, debtor.full_name)}
                      disabled={deletingId === debtor.id}
                      className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {deletingId === debtor.id ? '...' : 'حذف'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-[#767676] text-center">عرض {filtered.length} من {debtors.length} مدين</p>
      )}
    </div>
  )
}