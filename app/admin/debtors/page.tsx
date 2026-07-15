'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import Link from 'next/link'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { DEBTOR_SEARCH_PLACEHOLDER } from '@/lib/debtor-search'
import { RECEIPT_TYPE_LABEL, RECEIPT_NUMBER_LABEL } from '@/lib/ui-labels'
import DebtorImportModal from '@/components/DebtorImportModal'
import { BranchListFilterSelect } from '@/components/BranchListSelect'
import { useBranchLists } from '@/hooks/use-branch-lists'
import { useAdminRole } from '@/context/admin-role'
import { canAddDebtor, canAssignTasks, canDelete, canEditRecords, canImportDebtors, isLegalManager, PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { appConfirm } from '@/lib/app-dialog'
import { DEBTOR_LIST_PREVIEW_LIMIT, ShowMoreFooter } from '@/components/ui/show-more'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import { PremiumSelect } from '@/components/ui/premium-select'
import { CASE_TYPE_FILTER_OPTIONS, CASE_TYPE_LABELS, normalizeCaseType, type CaseType } from '@/lib/case-type'

const PAGE_SIZE = 50

function debtorListName(debtor: { branch_list?: { name?: string } | null }): string {
  return debtor.branch_list?.name?.trim() || '—'
}

function SearchIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
}

function SkeletonRow() {
  return (
    <TR>
      {[1,2,3,4,5,6,7,8,9].map(i => (
        <TD key={i}><div className="h-4 bg-[rgba(118,118,118,0.1)] rounded animate-pulse" style={{ width: `${50 + (i * 13) % 40}%` }} /></TD>
      ))}
    </TR>
  )
}

const INP = 'w-full pr-9 pl-4 py-2.5 text-sm bg-white border border-[rgba(118,118,118,0.2)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

export default function DebtorsPage() {
  const branchId = useBranchId()
  const { viewAllBranches } = useBranch()
  const role = useAdminRole()
  const allowDelete = canDelete(role)
  const allowEdit = canEditRecords(role)
  const allowAdd = canAddDebtor(role)
  const allowImport = canImportDebtors(role)
  const allowChangeTask = canAddDebtor(role) || canAssignTasks(role)
  const showEditLink = allowEdit || isLegalManager(role)
  const showDeleteBtn = allowDelete
  const showAddBtn = allowAdd
  const showImportBtn = allowImport
  const [debtors, setDebtors] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterListId, setFilterListId] = useState('')
  const [filterCaseType, setFilterCaseType] = useState<'' | CaseType>('')
  const [importOpen, setImportOpen] = useState(false)
  const { lists: branchLists } = useBranchLists(branchId)

  useEffect(() => {
    setFilterListId('')
    setFilterCaseType('')
    setSearch('')
  }, [branchId, viewAllBranches])
  const [showAllDebtors, setShowAllDebtors] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Server-side fetch with optional search (via admin API لتجاوز قيود RLS على المحاسب العام)
  const fetchDebtors = useCallback(async (searchTerm: string, listId: string, caseType: '' | CaseType = '', offset = 0, append = false) => {
    if (!branchId && !viewAllBranches) {
      setDebtors([])
      setTotal(0)
      setLoading(false)
      setLoadingMore(false)
      return
    }
    if (offset === 0 && !append) setLoading(true)
    else setLoadingMore(true)

    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE_SIZE),
      })
      if (viewAllBranches) params.set('viewAll', '1')
      else if (branchId) params.set('branchId', branchId)
      if (listId) params.set('listId', listId)
      if (caseType) params.set('caseType', caseType)
      if (searchTerm.trim()) params.set('search', searchTerm.trim())

      const res = await fetch(`/api/admin/debtors?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل تحميل المدينين')
        if (!append) setDebtors([])
        setTotal(0)
      } else {
        setError('')
        const rows = json.debtors ?? []
        if (append) setDebtors(prev => [...prev, ...rows])
        else setDebtors(rows)
        setTotal(json.total ?? 0)
      }
    } catch {
      setError('فشل تحميل المدينين')
      if (!append) setDebtors([])
      setTotal(0)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [branchId, viewAllBranches])

  useEffect(() => {
    fetchDebtors(search, filterListId, filterCaseType)
  }, [fetchDebtors, filterListId, filterCaseType])

  function handleSearch(val: string) {
    setSearch(val)
    setShowAllDebtors(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchDebtors(val, filterListId, filterCaseType)
    }, 300)
  }

  function loadMore() {
    fetchDebtors(search, filterListId, filterCaseType, debtors.length, true)
  }

  async function deleteDebtor(id: string, name: string) {
    if (!allowDelete) { setError(PERMISSION_DENIED_MSG); return }
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `هل أنت متأكد من حذف المدين «${name}»؟\nسيتم حذف جميع البيانات المرتبطة به.`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return
    setDeletingId(id)
    setError('')
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('debtors').delete().eq('id', id)
    if (dbErr) { setError(`فشل الحذف: ${dbErr.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_debtor', entity_type: 'debtor', entity_id: id, description: `حذف مدين: ${name}` }, supabase)
    setDeletingId(null)
    fetchDebtors(search, filterListId, filterCaseType)
  }

  const hasMore = debtors.length < total
  const visibleDebtors = showAllDebtors ? debtors : debtors.slice(0, DEBTOR_LIST_PREVIEW_LIMIT)
  const canShowAllDebtors = debtors.length > DEBTOR_LIST_PREVIEW_LIMIT

  return (
    <div className="space-y-5">
      <PageHeader
        title="المدينون"
        subtitle={viewAllBranches ? `${total} مدين في كل الفروع` : `${total} مدين مسجّل في النظام`}
        actions={showAddBtn || showImportBtn ? (
          <div className="flex items-center gap-2">
            {showImportBtn && (
              <Button variant="outline" size="sm" onClick={() => allowImport ? setImportOpen(true) : setError(PERMISSION_DENIED_MSG)} disabled={!branchId || !allowImport}>
                استيراد من Excel
              </Button>
            )}
            {showAddBtn && (
              <Link href="/admin/debtors/new">
                <Button variant="primary" size="sm">+ إضافة مدين</Button>
              </Link>
            )}
          </div>
        ) : undefined}
      />

      {!branchId && !viewAllBranches && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية لعرض المدينين، أو اختر «الكل».
        </div>
      )}

      {viewAllBranches && (
        <div className="bg-[#2C8780]/8 border border-[#2C8780]/20 text-[#1D6365] text-sm rounded-xl px-4 py-3">
          عرض كل الفروع — للإضافة أو الاستيراد اختر فرعاً محدداً أو حدّد الفرع داخل نموذج الإضافة.
        </div>
      )}

      {/* Search bar */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className={`grid grid-cols-1 gap-3 ${viewAllBranches ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
          <div className="relative">
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
          <PremiumSelect
            value={filterCaseType}
            onChange={v => setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')}
            options={CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            placeholder="كل أنواع الدعاوى"
            fieldLabel="نوع الدعوى"
            headerTitle="تصفية حسب نوع الدعوى"
            searchable={false}
          />
          {!viewAllBranches && (
            <BranchListFilterSelect
              value={filterListId}
              onChange={setFilterListId}
              lists={branchLists}
            />
          )}
        </div>
        {(search || filterListId || filterCaseType) && !loading && (
          <p className="text-xs text-[#767676] mt-2">
            {total === 0 ? 'لا نتائج' : `${total} نتيجة`}
            {search ? ` للبحث عن "${search}"` : ''}
            {filterCaseType ? ` · ${CASE_TYPE_LABELS[filterCaseType]}` : ''}
            {filterListId ? ' ضمن القائمة المحددة' : ''}
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
                    <TH>الاسم</TH>
                    <TH>نوع الدعوى</TH>
                    {viewAllBranches && <TH>الفرع</TH>}
                    <TH>القائمة</TH><TH>رقم الهوية</TH><TH>{RECEIPT_NUMBER_LABEL}</TH><TH>{RECEIPT_TYPE_LABEL}</TH>
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
            action={!search && showAddBtn ? (
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
                    <TH>نوع الدعوى</TH>
                    {viewAllBranches && <TH>الفرع</TH>}
                    <TH>القائمة</TH>
                    <TH>رقم الهوية</TH>
                    <TH>{RECEIPT_NUMBER_LABEL}</TH>
                    <TH>{RECEIPT_TYPE_LABEL}</TH>
                    <TH>المبلغ المطلوب</TH>
                    <TH>المتبقي</TH>
                    <TH>تاريخ الإضافة</TH>
                    <TH className="text-center">الإجراءات</TH>
                  </tr>
                </THead>
                <TBody>
                  {visibleDebtors.map(debtor => (
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
                      <TD>
                        <span className="text-xs text-[#767676]">
                          {CASE_TYPE_LABELS[normalizeCaseType(debtor.case_type)]}
                        </span>
                      </TD>
                      {viewAllBranches && (
                        <TD><span className="text-xs text-[#767676]">{debtor.branch_name ?? '—'}</span></TD>
                      )}
                      <TD><span className="text-xs text-[#767676]">{debtorListName(debtor)}</span></TD>
                      <TD><span className="font-mono text-xs" dir="ltr">{debtor.id_number ?? '—'}</span></TD>
                      <TD><span className="font-mono text-xs" dir="ltr">{debtor.receipt_number ?? '—'}</span></TD>
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
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <Link href={`/admin/debtors/${debtor.id}/account`} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap">كشف الحساب</Link>
                          {allowChangeTask && (
                            <ChangeDebtorTaskButton
                              debtorId={debtor.id}
                              branchId={debtor.branch_id ?? branchId}
                              compact
                            />
                          )}
                          {showEditLink && (
                            <Link href={`/admin/debtors/${debtor.id}/edit`} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</Link>
                          )}
                          {showDeleteBtn && (
                          <button
                            onClick={() => deleteDebtor(debtor.id, debtor.full_name)}
                            disabled={!allowDelete || deletingId === debtor.id}
                            title={!allowDelete ? PERMISSION_DENIED_MSG : undefined}
                            className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              {visibleDebtors.map(debtor => (
                <div key={debtor.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Link href={`/admin/debtors/${debtor.id}/account`} className="font-semibold text-[#231F20]">{debtor.full_name}</Link>
                    <Badge variant="default" className="shrink-0">{RECEIPT_TYPE_LABELS[debtor.receipt_type as keyof typeof RECEIPT_TYPE_LABELS]}</Badge>
                  </div>
                  {viewAllBranches && debtor.branch_name && (
                    <p className="text-xs text-[#2C8780] mb-1">{debtor.branch_name}</p>
                  )}
                  <p className="text-xs text-[#767676] mb-1">
                    نوع الدعوى: {CASE_TYPE_LABELS[normalizeCaseType(debtor.case_type)]}
                  </p>
                  {debtor.id_number && <p className="text-xs text-[#767676] font-mono mb-1" dir="ltr">{debtor.id_number}</p>}
                  <p className="text-xs text-[#767676] mb-1">القائمة: {debtorListName(debtor)}</p>
                  {debtor.receipt_number && <p className="text-xs text-[#767676] font-mono mb-2" dir="ltr">{RECEIPT_NUMBER_LABEL}: {debtor.receipt_number}</p>}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/admin/debtors/${debtor.id}/account`} className="flex-1 text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg">كشف الحساب</Link>
                    {allowChangeTask && (
                      <ChangeDebtorTaskButton debtorId={debtor.id} branchId={debtor.branch_id ?? branchId} compact />
                    )}
                    {showEditLink && (
                      <Link href={`/admin/debtors/${debtor.id}/edit`} className="flex-1 text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg">تعديل</Link>
                    )}
                    {showDeleteBtn && (
                    <button
                      onClick={() => deleteDebtor(debtor.id, debtor.full_name)}
                      disabled={!allowDelete || deletingId === debtor.id}
                      title={!allowDelete ? PERMISSION_DENIED_MSG : undefined}
                      className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deletingId === debtor.id ? '...' : 'حذف'}
                    </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {canShowAllDebtors && (
              <ShowMoreFooter
                hasMore={canShowAllDebtors}
                expanded={showAllDebtors}
                onToggle={() => setShowAllDebtors(v => !v)}
                total={debtors.length}
              />
            )}
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
        onComplete={() => fetchDebtors(search, filterListId, filterCaseType)}
      />
    </div>
  )
}
