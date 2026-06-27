import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReceiptStatus } from '@/lib/types'
import { fetchLawyerWalletBalance, payoutLawyerFees } from '@/lib/lawyer-wallet'

export interface LawyerPayoutRequest {
  id: string
  lawyer_id: string
  branch_id: string | null
  title: string
  amount: number
  status: ReceiptStatus
  notes: string | null
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  lawyer?: { full_name: string; username?: string | null } | null
  reviewer?: { full_name: string } | null
}

/** Wallet balance minus amounts already reserved in pending payout requests. */
export async function fetchLawyerAvailablePayoutBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const balance = await fetchLawyerWalletBalance(supabase, lawyerId)
  const { data: pending } = await supabase
    .from('lawyer_payout_requests')
    .select('amount')
    .eq('lawyer_id', lawyerId)
    .eq('status', 'pending')

  const reserved = (pending ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
  return Math.max(0, balance - reserved)
}

export async function fetchLawyerPayoutRequests(
  supabase: SupabaseClient,
  lawyerId: string,
  limit = 50,
): Promise<LawyerPayoutRequest[]> {
  const { data, error } = await supabase
    .from('lawyer_payout_requests')
    .select('*')
    .eq('lawyer_id', lawyerId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[fetchLawyerPayoutRequests]', error.message)
    return []
  }
  return (data ?? []) as LawyerPayoutRequest[]
}

export async function fetchBranchPayoutRequests(
  supabase: SupabaseClient,
  lawyerIds: string[],
  status?: ReceiptStatus | 'all',
): Promise<LawyerPayoutRequest[]> {
  if (!lawyerIds.length) return []

  let q = supabase
    .from('lawyer_payout_requests')
    .select('*')
    .in('lawyer_id', lawyerIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status && status !== 'all') q = q.eq('status', status)

  const { data, error } = await q
  if (error) {
    console.error('[fetchBranchPayoutRequests]', error.message)
    return []
  }
  return (data ?? []) as LawyerPayoutRequest[]
}

export async function submitLawyerPayoutRequest(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    branchId: string | null
    title: string
    amount: number
    notes?: string | null
  },
): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const title = params.title.trim()
  if (!title) return { ok: false, error: 'اسم الطلب مطلوب' }
  if (!params.amount || params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  const available = await fetchLawyerAvailablePayoutBalance(supabase, params.lawyerId)
  if (params.amount > available) {
    return {
      ok: false,
      error: `المبلغ يتجاوز الرصيد المتاح — المتاح: ${available.toLocaleString('en-US')} د.ع`,
    }
  }

  const { data, error } = await supabase
    .from('lawyer_payout_requests')
    .insert({
      lawyer_id: params.lawyerId,
      branch_id: params.branchId,
      title,
      amount: params.amount,
      notes: params.notes?.trim() || null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, requestId: data.id }
}

export async function reviewLawyerPayoutRequest(
  supabase: SupabaseClient,
  params: {
    requestId: string
    action: 'approved' | 'rejected'
    reviewerId: string
    reviewNotes?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: req, error: fetchErr } = await supabase
    .from('lawyer_payout_requests')
    .select('*')
    .eq('id', params.requestId)
    .single()

  if (fetchErr || !req) return { ok: false, error: 'الطلب غير موجود' }
  if (req.status !== 'pending') return { ok: false, error: 'تمت معالجة هذا الطلب مسبقاً' }

  if (params.action === 'rejected') {
    const { error } = await supabase
      .from('lawyer_payout_requests')
      .update({
        status: 'rejected',
        review_notes: params.reviewNotes?.trim() || null,
        reviewed_by: params.reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', params.requestId)
      .eq('status', 'pending')
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const amount = Number(req.amount)
  const available = await fetchLawyerWalletBalance(supabase, req.lawyer_id)
  if (amount > available) {
    return {
      ok: false,
      error: `رصيد المحامي غير كافٍ الآن — المتاح: ${available.toLocaleString('en-US')} د.ع`,
    }
  }

  const payout = await payoutLawyerFees(supabase, {
    lawyerId: req.lawyer_id,
    amount,
    notes: `طلب صرف: ${req.title}`,
    createdBy: params.reviewerId,
  })
  if (!payout.ok) return { ok: false, error: payout.error }

  const { error: updateErr } = await supabase
    .from('lawyer_payout_requests')
    .update({
      status: 'approved',
      review_notes: params.reviewNotes?.trim() || null,
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', params.requestId)
    .eq('status', 'pending')

  if (updateErr) return { ok: false, error: updateErr.message }
  return { ok: true }
}
