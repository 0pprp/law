/**
 * Repository لجدول criminal_debtor_details — بدون SQL مكرر في الصفحات.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const CONTRACT_GUARANTOR_STATUSES = ['yes', 'no', 'contract_only'] as const
export type ContractGuarantorStatus = (typeof CONTRACT_GUARANTOR_STATUSES)[number]

export const CONTRACT_GUARANTOR_STATUS_LABELS: Record<ContractGuarantorStatus, string> = {
  yes: 'نعم',
  no: 'لا',
  contract_only: 'فقط عقد',
}

export interface CriminalDebtorDetails {
  debtor_id: string
  job_title: string | null
  current_address: string | null
  incident_date: string | null
  charge_type: string | null
  /** المبلغ الذي بذمته — نص حر */
  amount_owed: string | null
  /** نص حر (سابقاً yes/no/contract_only فقط) */
  contract_guarantor_status: string | null
  first_witness_name: string | null
  second_witness_name: string | null
  documents_contract_file_path: string | null
  petition_file_path: string | null
  created_at: string
  updated_at: string
}

export type CriminalDebtorDetailsInput = {
  job_title?: string | null
  current_address?: string | null
  incident_date?: string | null
  charge_type?: string | null
  amount_owed?: string | null
  contract_guarantor_status?: string | null
  first_witness_name?: string | null
  second_witness_name?: string | null
  documents_contract_file_path?: string | null
  petition_file_path?: string | null
}

const SELECT_COLS =
  'debtor_id, job_title, current_address, incident_date, charge_type, amount_owed, contract_guarantor_status, first_witness_name, second_witness_name, documents_contract_file_path, petition_file_path, created_at, updated_at'

export function isContractGuarantorStatus(v: unknown): v is ContractGuarantorStatus {
  return typeof v === 'string' && (CONTRACT_GUARANTOR_STATUSES as readonly string[]).includes(v)
}

export function sanitizeCriminalDebtorDetailsInput(
  input: CriminalDebtorDetailsInput,
): Required<Pick<
  CriminalDebtorDetailsInput,
  | 'job_title'
  | 'current_address'
  | 'incident_date'
  | 'charge_type'
  | 'amount_owed'
  | 'contract_guarantor_status'
  | 'first_witness_name'
  | 'second_witness_name'
  | 'documents_contract_file_path'
  | 'petition_file_path'
>> {
  return {
    job_title: trimOrNull(input.job_title),
    current_address: trimOrNull(input.current_address),
    incident_date: trimOrNull(input.incident_date),
    charge_type: trimOrNull(input.charge_type),
    amount_owed: trimOrNull(input.amount_owed),
    contract_guarantor_status: trimOrNull(input.contract_guarantor_status),
    first_witness_name: trimOrNull(input.first_witness_name),
    second_witness_name: trimOrNull(input.second_witness_name),
    documents_contract_file_path: trimOrNull(input.documents_contract_file_path),
    petition_file_path: trimOrNull(input.petition_file_path),
  }
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t || null
}

/** عرض مبلغ جزائي كنص حر — بدون toLocaleString */
export function displayCriminalAmountText(
  amountOwed: string | null | undefined,
  ...fallbacks: Array<string | number | null | undefined>
): string {
  const primary = trimOrNull(amountOwed)
  if (primary) return primary
  for (const raw of fallbacks) {
    if (raw == null || raw === '') continue
    const text = String(raw).trim()
    if (text) return text
  }
  return '—'
}

/**
 * للأعمدة numeric فقط: رقم صالح → يُحفظ كما هو؛
 * فارغ أو نص غير رقمي → null (لا يكسر قاعدة البيانات).
 */
export function optionalNumericAmountOrNull(value: unknown): number | null {
  if (value == null) return null
  const raw = String(value).trim().replace(/,/g, '')
  if (!raw) return null
  if (!/^\d+(\.\d+)?$/.test(raw)) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function fetchCriminalDebtorDetails(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<CriminalDebtorDetails | null> {
  if (!debtorId) return null
  const { data, error } = await supabase
    .from('criminal_debtor_details')
    .select(SELECT_COLS)
    .eq('debtor_id', debtorId)
    .maybeSingle()
  if (error) {
    // الجدول غير مفعّل بعد — لا نكسر الصفحة
    if (error.message?.includes('criminal_debtor_details') || error.code === '42P01') {
      return null
    }
    // عمود amount_owed غير مطبّق بعد — أعد بدون العمود
    if (error.message?.includes('amount_owed') || error.code === '42703' || error.code === 'PGRST204') {
      const { data: fallback, error: fbErr } = await supabase
        .from('criminal_debtor_details')
        .select(
          'debtor_id, job_title, current_address, incident_date, charge_type, contract_guarantor_status, first_witness_name, second_witness_name, documents_contract_file_path, petition_file_path, created_at, updated_at',
        )
        .eq('debtor_id', debtorId)
        .maybeSingle()
      if (fbErr) {
        console.error('[fetchCriminalDebtorDetails]', fbErr.message)
        return null
      }
      return fallback
        ? ({ ...fallback, amount_owed: null } as CriminalDebtorDetails)
        : null
    }
    console.error('[fetchCriminalDebtorDetails]', error.message)
    return null
  }
  return (data as CriminalDebtorDetails | null) ?? null
}

export async function upsertCriminalDebtorDetails(
  supabase: SupabaseClient,
  debtorId: string,
  input: CriminalDebtorDetailsInput,
): Promise<{ data: CriminalDebtorDetails | null; error: string | null }> {
  if (!debtorId) return { data: null, error: 'معرّف المدين مطلوب' }
  let payload: ReturnType<typeof sanitizeCriminalDebtorDetailsInput>
  try {
    payload = sanitizeCriminalDebtorDetailsInput(input)
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'بيانات غير صالحة' }
  }

  const { data, error } = await supabase
    .from('criminal_debtor_details')
    .upsert(
      {
        debtor_id: debtorId,
        ...payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'debtor_id' },
    )
    .select(SELECT_COLS)
    .maybeSingle()

  if (error) {
    // إن كان العمود ما زال numeric في بعض البيئات: احفظ الرقم فقط أو null
    const msg = error.message ?? ''
    if (/invalid input syntax for type numeric|22P02/i.test(msg) || error.code === '22P02') {
      const numericValue = optionalNumericAmountOrNull(payload.amount_owed)
      const retry = await supabase
        .from('criminal_debtor_details')
        .upsert(
          {
            debtor_id: debtorId,
            ...payload,
            amount_owed: numericValue as unknown as string | null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'debtor_id' },
        )
        .select(SELECT_COLS)
        .maybeSingle()
      if (retry.error) return { data: null, error: retry.error.message }
      return { data: (retry.data as CriminalDebtorDetails | null) ?? null, error: null }
    }
    return { data: null, error: error.message }
  }
  return { data: (data as CriminalDebtorDetails | null) ?? null, error: null }
}

export async function deleteCriminalDebtorDetails(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<{ error: string | null }> {
  if (!debtorId) return { error: null }
  const { error } = await supabase
    .from('criminal_debtor_details')
    .delete()
    .eq('debtor_id', debtorId)
  if (error && error.code !== '42P01') {
    return { error: error.message }
  }
  return { error: null }
}
