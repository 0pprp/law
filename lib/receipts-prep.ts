import { resolveDebtorCourtName, resolveExecutionOffice } from '@/lib/awaiting-assignment'
import { isFileLawsuitTask } from '@/lib/default-next-task'
import { extractHearingDateFromCompletion } from '@/lib/hearing-date-from-completion'
import { OVERDUE_TERMINAL_STATUSES } from '@/lib/local-date'
import { storedFileUrl } from '@/lib/stored-file-url'
import type { ReceiptType } from '@/lib/types'

type AdminClient = { from: (table: string) => any }

const TERMINAL_FILTER = `(${OVERDUE_TERMINAL_STATUSES.join(',')})`
const LIST_LIMIT = 500

export const RECEIPTS_PREPARED_NOTE = 'تم تجهيز الوصل'

export type ReceiptsPrepFile = {
  id: string
  fileName: string
  filePath: string
  mimeType: string | null
  url: string
}

export type ReceiptsPrepRow = {
  debtorId: string
  debtorName: string
  phone: string | null
  receiptType: ReceiptType | null
  receiptNumber: string | null
  transactionNumber: string | null
  saleDate: string | null
  remaining: number
  firstHearingDate: string | null
  courtName: string | null
  executionOffice: string | null
  branchId: string | null
  branchName: string | null
  branchListName: string | null
  caseType: 'civil' | 'criminal'
  currentTaskLabel: string
  receiptsPrepared: boolean
  files: ReceiptsPrepFile[]
}

export type FetchReceiptsPrepParams = {
  branchId: string | null
  branchListId?: string | null
  caseType?: 'civil' | 'criminal' | null
  countOnly?: boolean
}

export type FetchReceiptsPrepResult = {
  rows: ReceiptsPrepRow[]
  total: number
  columnMissing: boolean
}

function isMissingReceiptsPreparedColumn(err: { message?: string; details?: string; hint?: string; code?: string } | string | null | undefined): boolean {
  const blob = typeof err === 'string'
    ? err
    : `${err?.message ?? ''} ${err?.details ?? ''} ${err?.hint ?? ''} ${err?.code ?? ''}`
  return blob.toLowerCase().includes('receipts_prepared')
}

function pgErrorMessage(err: { message?: string; details?: string; hint?: string; code?: string } | null | undefined): string {
  return err?.message || err?.details || err?.hint || err?.code || 'فشل الاستعلام'
}

type ReceiptsPrepDefIds = { lawsuitIds: string[] }

async function receiptsPrepDefinitionIds(
  admin: AdminClient,
  params: FetchReceiptsPrepParams,
): Promise<ReceiptsPrepDefIds> {
  let q = admin
    .from('task_definitions')
    .select('id, task_type, label, case_type, branch_id')
    .eq('is_active', true)
  if (params.caseType) q = q.eq('case_type', params.caseType)
  const { data, error } = await q
  if (error) throw new Error(pgErrorMessage(error))
  return {
    lawsuitIds: (data ?? [])
      .filter((d: { task_type?: string | null; label?: string | null }) => isFileLawsuitTask(d))
      .map((d: { id: string }) => d.id),
  }
}

const DEBTOR_COLS =
  `id, full_name, phone, receipt_type, receipt_number, first_hearing_date, branch_id, branch_list_id,
   remaining_amount, case_status, case_type, current_task_id, court_name,
   branch_list:branch_lists(name, court_name, execution_office)`

const IN_CHUNK = 120

function applyReceiptsPrepFilters(
  q: any,
  params: FetchReceiptsPrepParams,
  defIds: string[],
): any {
  let next = q
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)
    .is('special_status_id', null)
    .in('current_task.task_definition_id', defIds)
    .not('current_task.task_status', 'in', TERMINAL_FILTER)
    .not('current_task.assigned_to', 'is', null)
  if (params.branchId) next = next.eq('branch_id', params.branchId)
  if (params.caseType) next = next.eq('case_type', params.caseType)
  const listId = params.branchListId?.trim() || null
  if (listId && params.caseType !== 'criminal') {
    next = next.eq('branch_list_id', listId)
  }
  return next
}

async function fillMissingHearingDates(
  admin: AdminClient,
  rows: ReceiptsPrepRow[],
): Promise<void> {
  const missing = rows.filter(r => !r.firstHearingDate)
  if (!missing.length) return
  const ids = missing.map(r => r.debtorId)
  const { data: priorTasks } = await admin
    .from('tasks')
    .select('debtor_id, completion_data, created_at')
    .in('debtor_id', ids)
    .eq('task_type', 'file_lawsuit')
    .not('completion_data', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(ids.length * 2, 400))

  const hearingByDebtor = new Map<string, string>()
  for (const row of priorTasks ?? []) {
    const debtorId = row.debtor_id as string
    if (hearingByDebtor.has(debtorId)) continue
    const ymd = extractHearingDateFromCompletion(
      (row.completion_data ?? null) as Record<string, unknown> | null,
    )
    if (ymd) hearingByDebtor.set(debtorId, ymd)
  }
  for (const row of rows) {
    if (row.firstHearingDate) continue
    const ymd = hearingByDebtor.get(row.debtorId)
    if (ymd) row.firstHearingDate = ymd
  }
}

async function attachFiles(
  admin: AdminClient,
  rows: ReceiptsPrepRow[],
): Promise<void> {
  if (!rows.length) return
  const ids = rows.map(r => r.debtorId)
  const { data } = await admin
    .from('debtor_attachments')
    .select('id, debtor_id, file_name, file_path, mime_type, created_at')
    .in('debtor_id', ids)
    .order('created_at', { ascending: false })

  const byDebtor = new Map<string, ReceiptsPrepFile[]>()
  for (const att of data ?? []) {
    const debtorId = att.debtor_id as string
    const filePath = String(att.file_path ?? '')
    const file: ReceiptsPrepFile = {
      id: att.id,
      fileName: att.file_name || 'ملف',
      filePath,
      mimeType: att.mime_type ?? null,
      url: storedFileUrl('debtor-files', filePath),
    }
    const list = byDebtor.get(debtorId) ?? []
    list.push(file)
    byDebtor.set(debtorId, list)
  }
  for (const row of rows) {
    row.files = byDebtor.get(row.debtorId) ?? []
  }
}

async function attachTransactionSale(admin: AdminClient, rows: ReceiptsPrepRow[]): Promise<void> {
  if (!rows.length) return
  const { data, error } = await admin
    .from('debtors')
    .select('id, transaction_number, sale_date')
    .in('id', rows.map(r => r.debtorId))
  if (error) return
  const map = new Map<string, { transactionNumber: string | null; saleDate: string | null }>(
    (data ?? []).map((d: { id: string; transaction_number?: string | null; sale_date?: string | null }) => [
      d.id,
      {
        transactionNumber: d.transaction_number ?? null,
        saleDate: d.sale_date ? String(d.sale_date).slice(0, 10) : null,
      },
    ]),
  )
  for (const row of rows) {
    const extra = map.get(row.debtorId)
    row.transactionNumber = extra?.transactionNumber ?? row.transactionNumber ?? null
    row.saleDate = extra?.saleDate ?? row.saleDate ?? null
  }
}

function mapRow(
  d: any,
  branchNames: Map<string, string>,
  includePrepared: boolean,
): ReceiptsPrepRow | null {
  if (!d?.id || !d.current_task_id) return null
  const bl = Array.isArray(d.branch_list) ? d.branch_list[0] : d.branch_list
  const bId = (d.branch_id ?? null) as string | null
  return {
    debtorId: d.id,
    debtorName: d.full_name ?? '—',
    phone: d.phone ?? null,
    receiptType: d.receipt_type ?? null,
    receiptNumber: d.receipt_number ?? null,
    transactionNumber: d.transaction_number ?? null,
    saleDate: d.sale_date ? String(d.sale_date).slice(0, 10) : null,
    remaining: Number(d.remaining_amount ?? 0),
    firstHearingDate: d.first_hearing_date ? String(d.first_hearing_date).slice(0, 10) : null,
    courtName: resolveDebtorCourtName(d),
    executionOffice: resolveExecutionOffice(d.branch_list),
    branchId: bId,
    branchName: bId ? branchNames.get(bId) ?? 'فرع' : 'بدون فرع',
    branchListName: bl?.name?.trim() ?? null,
    caseType: d.case_type === 'criminal' ? 'criminal' : 'civil',
    currentTaskLabel: 'إقامة دعوى',
    receiptsPrepared: includePrepared ? Boolean(d.receipts_prepared) : false,
    files: [],
  }
}

/**
 * أسماء كارد «تجهيز الوصولات»: إقامة دعوى مكلفة فقط.
 * يغادر القائمة عند انتقال المهمة الحالية عن إقامة دعوى المكلفة.
 */
export async function fetchReceiptsPrep(
  admin: AdminClient,
  params: FetchReceiptsPrepParams,
): Promise<FetchReceiptsPrepResult> {
  const { lawsuitIds } = await receiptsPrepDefinitionIds(admin, params)
  if (!lawsuitIds.length) return { rows: [], total: 0, columnMissing: false }

  const withFlag = `${DEBTOR_COLS}, receipts_prepared`
  const inner = ', current_task:tasks!current_task_id!inner(id, task_status, task_definition_id, assigned_to, task_type)'

  if (params.countOnly) {
    let total = 0
    for (let i = 0; i < lawsuitIds.length; i += IN_CHUNK) {
      const chunk = lawsuitIds.slice(i, i + IN_CHUNK)
      let q = admin
        .from('debtors')
        .select('id, current_task:tasks!current_task_id!inner(id, assigned_to)', { count: 'exact', head: true })
      q = applyReceiptsPrepFilters(q, params, chunk)
      const { count, error } = await q
      if (error) throw new Error(pgErrorMessage(error))
      total += count ?? 0
    }
    return { rows: [], total, columnMissing: false }
  }

  const raw: any[] = []
  let includePrepared = true
  for (let i = 0; i < lawsuitIds.length; i += IN_CHUNK) {
    const chunk = lawsuitIds.slice(i, i + IN_CHUNK)
    const run = async (cols: string) => {
      let q = admin.from('debtors').select(cols + inner)
      q = applyReceiptsPrepFilters(q, params, chunk)
      return q.order('full_name').order('id').limit(LIST_LIMIT)
    }
    let res = await run(includePrepared ? withFlag : DEBTOR_COLS)
    if (res.error && includePrepared && isMissingReceiptsPreparedColumn(res.error)) {
      includePrepared = false
      res = await run(DEBTOR_COLS)
    }
    if (res.error) throw new Error(pgErrorMessage(res.error))
    raw.push(...(res.data ?? []))
    if (raw.length >= LIST_LIMIT) break
  }
  const branchIds = [...new Set(raw.map((d: { branch_id?: string | null }) => d.branch_id).filter(Boolean))] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await admin.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }

  const rows: ReceiptsPrepRow[] = []
  const seen = new Set<string>()
  for (const d of raw) {
    if (seen.has(d.id)) continue
    const mapped = mapRow(d, branchNames, includePrepared)
    if (!mapped) continue
    seen.add(d.id)
    rows.push(mapped)
  }

  await Promise.all([
    fillMissingHearingDates(admin, rows),
    attachFiles(admin, rows),
    attachTransactionSale(admin, rows),
  ])

  rows.sort((a, b) => a.debtorName.localeCompare(b.debtorName, 'ar'))

  return {
    rows,
    total: rows.length,
    columnMissing: !includePrepared,
  }
}

export async function setReceiptsPrepared(
  admin: AdminClient,
  params: {
    debtorId: string
    prepared: boolean
    actorId: string
  },
): Promise<{ ok: true; receiptsPrepared: boolean; noteWritten: boolean } | { ok: false; error: string; status: number }> {
  const { data: debtor, error: fetchErr } = await admin
    .from('debtors')
    .select('id, receipts_prepared')
    .eq('id', params.debtorId)
    .maybeSingle()

  if (fetchErr) {
    if (isMissingReceiptsPreparedColumn(fetchErr)) {
      return {
        ok: false,
        error: 'عمود تجهيز الوصولات غير مطبّق بعد — نفّذ سكربت apply-debtor-receipts-prepared.sql',
        status: 500,
      }
    }
    return { ok: false, error: fetchErr.message, status: 500 }
  }
  if (!debtor) return { ok: false, error: 'المدين غير موجود', status: 404 }

  const already = Boolean(debtor.receipts_prepared)
  if (already === params.prepared) {
    return { ok: true, receiptsPrepared: already, noteWritten: false }
  }

  const patch = params.prepared
    ? {
        receipts_prepared: true,
        receipts_prepared_at: new Date().toISOString(),
        receipts_prepared_by: params.actorId,
      }
    : {
        receipts_prepared: false,
        receipts_prepared_at: null,
        receipts_prepared_by: null,
      }

  const { error: updErr } = await admin.from('debtors').update(patch).eq('id', params.debtorId)
  if (updErr) return { ok: false, error: updErr.message, status: 500 }

  let noteWritten = false
  if (params.prepared) {
    const { error: noteErr } = await admin.from('debtor_notes').insert({
      debtor_id: params.debtorId,
      user_id: params.actorId,
      message: RECEIPTS_PREPARED_NOTE,
    })
    if (noteErr) {
      console.warn('[receipts-prep:note]', noteErr.message)
    } else {
      noteWritten = true
    }
  }

  return { ok: true, receiptsPrepared: params.prepared, noteWritten }
}
