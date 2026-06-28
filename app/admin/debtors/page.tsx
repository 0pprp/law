'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { debtorSearchOrFilter, DEBTOR_SEARCH_PLACEHOLDER } from '@/lib/debtor-search'
import { RECEIPT_TYPE_LABEL } from '@/lib/ui-labels'
import DebtorImportModal from '@/components/DebtorImportModal'
import { useAdminRole } from '@/context/admin-role'
import { canAddDebtor, canDelete, canEditRecords, canImportDebtors, PERMISSION_DENIED_MSG } from '@/lib/permissions'

const PAGE_SIZE = 50
const COLS = 'id, full_name, phone, id_number, receipt_type, receipt_number, required_amount, remaining_amount, created_at, case_status'

function SearchIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
}

function SkeletonRow() {
  return (
    <TR>
      {[1,2,3,4,5,6,7].map(i => (
        <TD key={i}><div className="h-4 bg-[rgba(118,118,118,0.1)] rounded animate-pulse" style={{ width: `${50 + (i * 13) % 40}%` }} /></TD>
      ))}
    </TR>
  )
}

const INP = 'w-full pr-9 pl-4 py-2.5 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

export default function DebtorsPage() {
  const branchId = useBranchId()
  const role = useAdminRole()
  const allowDelete = canDelete(role)
  const allowEdit = canEditRecords(role)
  const allowAdd = canAddDebtor(role)
  const allowImport = canImportDebtors(role)
  const [debtors, setDebtors] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Server-side fetch with optional search
  const fetchDebtors = useCallback(async (searchTerm: string, offset = 0, append = false) => {
    if (offset === 0 && !append) setLoading(true)
    else setLoadingMore(true)

    const supabase = createClient()
    let q = supabase
      .from('debtors')
      .select(COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (branchId) q = (q as any).eq('branch_id', branchId)

    if (searchTerm.trim()) {
      const s = searchTerm.trim()
      // ilike uses the trigram index for fast Arabic search
      q = (q as any).or(debtorSearchOrFilter(s))
    }

    const { data, count } = await q
    if (append) {
      setDebtors(prev => [...prev, ...(data ?? [])])
    } else {
      setDebtors(data ?? [])
    }
    setTotal(count ?? 0)
    setLoading(false)
    setLoadingMore(false)
  }, [branchId])

  // Initial load + branch change
  useEffect(() => {
    fetchDebtors('')
  }, [fetchDebtors])

  // Debounced search — 300ms
  function handleSearch(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchDebtors(val)
    }, 300)
  }

  function loadMore() {
    fetchDebtors(search, debtors.length, true)
  }

  async function deleteDebtor(id: string, name: string) {
    if (!allowDelete) { setError(PERMISSION_DENIED_MSG); return }
    if (!confirm(`هل أنت متأكد من حذف المدين "${name}"؟\nسيتم حذف جميع البيانات المرتبطة به.`)) return
    setDeletingId(id)
    setError('')
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('debtors').delete().eq('id', id)
    if (dbErr) { setError(`فشل الحذف: ${dbErr.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_debtor', entity_type: 'debtor', entity_id: id, description: `حذف مدين: ${name}` }, supabase)
    setDeletingId(null)
    fetchDebtors(search)
  }

  const hasMore = debtors.length < total

  return (
    <div className="space-y-5">
      <PageHeader
        title="المدينون"
        subtitle={`${total} مدين مسجّل في النظام`}
        actions={allowAdd || allowImport ? (
          <div className="flex items-center gap-2">
            {allowImport && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={!branchId}>
                استيراد من Excel
              </Button>
            )}
            {allowAdd && (
              <Link href="/admin/debtors/new">
                <Button variant="primary" size="sm">+ إضافة مدين</Button>
              </Link>
            )}
          </div>
        ) : undefined}
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
            onChange={e => handleSearch(e.target.value)}
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            className={INP}
          />
          {search && (
            <button onClick={() => handleSearch('')}
              className="absolute inset-y-0 left-3 text-[#767676] hover:text-[#231F20] text-lg leading-none">
              ×
            </button>
          )}
        </div>
        {search && !loading && (
          <p className="text-xs text-[#767676] mt-2">
            {total === 0 ? 'لا نتائج' : `${total} نتيجة`} للبحث عن "{search}"
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <>
            {/* Desktop skeleton */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>الاسم</TH><TH>رقم الهوية</TH><TH>{RECEIPT_TYPE_LABEL}</TH>
                    <TH>المبلغ المطلوب</TH><TH>المتبقي</TH><TH>تاريخ الإضافة</TH><TH className="text-center">الإجراءات</TH>
                  </tr>
                </THead>
                <TBody>{[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}</TBody>
              </Table>
            </div>
            {/* Mobile skeleton */}
            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="p-4 space-y-2 animate-pulse">
                  <div className="h-4 bg-[rgba(118,118,118,0.1)] rounded w-1/2" />
                  <div className="h-3 bg-[rgba(118,118,118,0.08)] rounded w-1/3" />
                </div>
              ))}
            </div>
          </>
        ) : !debtors.length ? (
          <EmptyState
            title={search ? 'لا نتائج للبحث' : 'لا يوجد مدينون مسجلون بعد'}
            description={search ? 'جرّب كلمات بحث مختلفة' : 'ابدأ بإضافة أول مدين في النظام'}
            action={!search && allowAdd ? (
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
                    <TH>{RECEIPT_TYPE_LABEL}</TH>
                    <TH>المبلغ المطلوب</TH>
                    <TH>المتبقي</TH>
                    <TH>تاريخ الإضافة</TH>
                    <TH className="text-center">الإجراءات</TH>
                  </tr>
                </THead>
                <TBody>
                  {debtors.map(debtor => (
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
                          {allowEdit && (
                            <Link href={`/admin/debtors/${debtor.id}/edit`} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</Link>
                          )}
                          {allowDelete && (
                          <button
                            onClick={() => deleteDebtor(debtor.id, debtor.full_name)}
                            disabled={deletingId === debtor.id}
                            className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {deletingId === debtor.id ? '...' : 'حذف'}
                          </button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {debtors.map(debtor => (
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
                    {allowEdit && (
                      <Link href={`/admin/debtors/${debtor.id}/edit`} className="flex-1 text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg">تعديل</Link>
                    )}
                    {allowDelete && (
                    <button
                      onClick={() => deleteDebtor(debtor.id, debtor.full_name)}
                      disabled={deletingId === debtor.id}
                      className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {deletingId === debtor.id ? '...' : 'حذف'}
                    </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Pagination footer */}
      {!loading && debtors.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#767676]">
            عرض {debtors.length} من {total} مدين
          </p>
          {hasMore && (
            <button onClick={loadMore} disabled={loadingMore}
              className="text-xs font-semibold text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 px-4 py-2 rounded-lg transition-colors disabled:opacity-60">
              {loadingMore ? 'جارٍ التحميل...' : `عرض المزيد (${total - debtors.length} متبقٍ)`}
            </button>
          )}
        </div>
      )}
      <DebtorImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => fetchDebtors(search)}
      />
    </div>
  )
}
