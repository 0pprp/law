'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '@/lib/types'
import type { TaskType, TaskStatus } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtDate } from '@/lib/utils'
import { useBranch, useBranchId } from '@/context/branch'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { useCaseScope } from '@/hooks/use-case-scope'

function formatSize(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileTypeLabel(mime: string | null) {
  if (!mime) return '—'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return 'صورة'
  return mime.split('/')[1] ?? mime
}

const ALL_TYPES = Object.keys(TASK_TYPE_LABELS) as TaskType[]
const ALL_STATUSES = Object.keys(TASK_STATUS_LABELS) as TaskStatus[]

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  new: 'info', in_progress: 'warning', completed: 'success', failed: 'danger', postponed: 'gray', needs_info: 'purple', closed: 'gray',
}

const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

export default function TaskFilesPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const { caseTypeFilter } = useCaseScope()
  const [files, setFiles] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterLawyer, setFilterLawyer] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMime, setFilterMime] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const scopeListId = (!viewAllBranches && listId) ? listId : null
    let lq = supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) lq = (lq as any).eq('branch_id', branchId)

    let debtorIds: string[] | null = null
    if (debouncedSearch.trim()) {
      debtorIds = await resolveDebtorIdsBySearch(supabase, debouncedSearch, branchId, 200, scopeListId, caseTypeFilter)
      if (!debtorIds?.length) {
        setFiles([])
        const { data: l } = await lq
        setLawyers(l ?? [])
        setLoading(false)
        return
      }
    } else if (scopeListId || caseTypeFilter) {
      let dq = supabase.from('debtors').select('id')
      if (scopeListId) dq = dq.eq('branch_list_id', scopeListId)
      if (caseTypeFilter) dq = dq.eq('case_type', caseTypeFilter)
      if (branchId) dq = dq.eq('branch_id', branchId)
      const { data: listDebtors } = await dq
      debtorIds = (listDebtors ?? []).map(d => d.id)
      if (!debtorIds.length) {
        setFiles([])
        const { data: l } = await lq
        setLawyers(l ?? [])
        setLoading(false)
        return
      }
    }

    let fq = supabase.from('task_attachments').select(`*, task:tasks!task_attachments_task_id_fkey(task_type, task_status, governorate, branch_id, assigned_to, debtor_id, debtor:debtors!tasks_debtor_id_fkey(full_name, governorate, phone, receipt_number, branch_list_id), lawyer:profiles!tasks_assigned_to_fkey(id, full_name))`).order('created_at', { ascending: false }).limit(500)

    const [{ data: f }, { data: l }] = await Promise.all([fq, lq])
    let fileRows = branchId
      ? (f ?? []).filter((row: any) => row.task?.branch_id === branchId)
      : (f ?? [])
    if (debtorIds) {
      const idSet = new Set(debtorIds)
      fileRows = fileRows.filter((row: any) => idSet.has(row.task?.debtor_id))
    }
    setFiles(fileRows)
    setLawyers(l ?? [])
    setLoading(false)
  }, [branchId, viewAllBranches, listId, debouncedSearch, caseTypeFilter])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => files.filter(f => {
    if (filterLawyer && f.task?.lawyer?.id !== filterLawyer) return false
    if (filterType && f.task?.task_type !== filterType) return false
    if (filterStatus && f.task?.task_status !== filterStatus) return false
    if (filterMime === 'pdf' && f.mime_type !== 'application/pdf') return false
    if (filterMime === 'image' && !f.mime_type?.startsWith('image/')) return false
    const date = f.created_at?.split('T')[0]
    if (dateFrom && date < dateFrom) return false
    if (dateTo && date > dateTo) return false
    return true
  }), [files, filterLawyer, filterType, filterStatus, filterMime, dateFrom, dateTo])

  async function openFile(fileId: string, filePath: string) {
    setOpeningId(fileId)
    try {
      const res = await fetch('/api/admin/task-file-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: filePath }) })
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch { await appAlert({ message: 'فشل في فتح الملف. يرجى المحاولة مجدداً.', variant: 'error' }) }
    finally { setOpeningId(null) }
  }

  async function deleteFile(fileId: string, filePath: string, fileName: string) {
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `هل تريد حذف هذا الملف؟\n«${fileName}»`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return
    setDeletingId(fileId)
    try {
      const res = await fetch('/api/admin/delete-task-file', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, filePath, fileName }) })
      if (!res.ok) { const { error } = await res.json(); await appAlert({ message: `فشل الحذف: ${error ?? 'خطأ غير معروف'}`, variant: 'error' }) }
      else load()
    } catch { await appAlert({ message: 'حدث خطأ أثناء حذف الملف', variant: 'error' }) }
    finally { setDeletingId(null) }
  }

  function resetFilters() { setSearch(''); setFilterLawyer(''); setFilterType(''); setFilterStatus(''); setFilterMime(''); setDateFrom(''); setDateTo('') }
  const hasFilters = search || filterLawyer || filterType || filterStatus || filterMime || dateFrom || dateTo

  return (
    <div className="space-y-5">
      <PageHeader title="ملفات المهام" subtitle={`${filtered.length} ملف مرفوع`} />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input type="search" placeholder={DEBTOR_SEARCH_PLACEHOLDER} value={search} onChange={e => setSearch(e.target.value)} className={SEL} />
          <PremiumSelect
            value={filterLawyer}
            onChange={setFilterLawyer}
            options={[
              { value: '', label: 'كل المحامين' },
              ...lawyers.map(l => ({ value: l.id, label: l.full_name })),
            ]}
            placeholder="كل المحامين"
            headerTitle="تصفية حسب المحامي"
            searchPlaceholder="بحث بالاسم..."
            searchable
          />
          <PremiumSelect
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: '', label: 'كل أنواع المهام' },
              ...ALL_TYPES.map(t => ({ value: t, label: TASK_TYPE_LABELS[t] })),
            ]}
            placeholder="كل أنواع المهام"
            headerTitle="تصفية حسب نوع المهمة"
            searchPlaceholder="بحث في أنواع المهام..."
            searchable={ALL_TYPES.length > 4}
          />
          <PremiumSelect
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: '', label: 'كل الحالات' },
              ...ALL_STATUSES.map(s => ({ value: s, label: TASK_STATUS_LABELS[s] })),
            ]}
            placeholder="كل الحالات"
            headerTitle="تصفية حسب الحالة"
            searchPlaceholder="بحث في الحالات..."
            searchable={ALL_STATUSES.length > 4}
          />
          <PremiumSelect
            value={filterMime}
            onChange={setFilterMime}
            options={[
              { value: '', label: 'كل أنواع الملفات' },
              { value: 'pdf', label: 'PDF فقط' },
              { value: 'image', label: 'صور فقط' },
            ]}
            placeholder="كل أنواع الملفات"
            headerTitle="تصفية حسب نوع الملف"
            searchable={false}
          />
          <div className="col-span-2 md:col-span-2">
            <DateRangePicker
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t) }}
            />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-[#767676]">{filtered.length} من {files.length} ملف</p>
            <button onClick={resetFilters} className="text-xs text-[#2C8780] hover:underline">إلغاء التصفية</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState title="لا توجد ملفات" description="لم يرفع المحامون أي ملفات للمهام حتى الآن" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المدين</TH>
                <TH>المحامي</TH>
                <TH>المحافظة</TH>
                <TH>نوع المهمة</TH>
                <TH>حالة المهمة</TH>
                <TH>اسم الملف</TH>
                <TH>النوع</TH>
                <TH>الحجم</TH>
                <TH>تاريخ الرفع</TH>
                <TH className="text-center">الإجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((f: any) => (
                <TR key={f.id}>
                  <TD className="font-semibold text-[#231F20] whitespace-nowrap">{f.task?.debtor?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs whitespace-nowrap">{f.task?.lawyer?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs whitespace-nowrap">{f.task?.governorate ?? f.task?.debtor?.governorate ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs whitespace-nowrap">{f.task?.task_type ? TASK_TYPE_LABELS[f.task.task_type as TaskType] : '—'}</TD>
                  <TD>
                    {f.task?.task_status
                      ? <Badge variant={STATUS_BADGE[f.task.task_status as TaskStatus] ?? 'default'}>{TASK_STATUS_LABELS[f.task.task_status as TaskStatus]}</Badge>
                      : <span className="text-[rgba(118,118,118,0.3)]">—</span>}
                  </TD>
                  <TD className="max-w-[160px]">
                    <span className="text-xs text-[#231F20] line-clamp-1">{f.file_name ?? '—'}</span>
                  </TD>
                  <TD>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${f.mime_type === 'application/pdf' ? 'text-red-600 bg-red-50' : f.mime_type?.startsWith('image/') ? 'text-blue-600 bg-blue-50' : 'text-[#767676] bg-[rgba(118,118,118,0.08)]'}`}>
                      {fileTypeLabel(f.mime_type)}
                    </span>
                  </TD>
                  <TD className="text-xs text-[#767676]">{formatSize(f.file_size)}</TD>
                  <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{fmtDate(f.created_at)}</span></TD>
                  <TD>
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openFile(f.id, f.file_path)} disabled={openingId === f.id} className="text-xs text-[#2C8780] border border-[#2C8780]/30 hover:bg-[#2C8780]/5 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        {openingId === f.id ? '...' : 'فتح'}
                      </button>
                      <button onClick={() => deleteFile(f.id, f.file_path, f.file_name ?? f.file_path)} disabled={deletingId === f.id} className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        {deletingId === f.id ? '...' : 'حذف'}
                      </button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}