import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReceiptStatus, LawyerWalletKind } from '@/lib/types'
import { formatMoney } from '@/lib/money-input'
import {
  fetchLawyerWalletBalance,
  fetchLawyerSavingsBalance,
  payoutLawyerFees,
  withdrawLawyerSavings,
  payoutLegalManagerWallet,
} from '@/lib/lawyer-wallet'

export interface LawyerPayoutRequest {
  id: string
  lawyer_id: string
  branch_id: string | null
  title: string
  amount: number
  status: ReceiptStatus
  wallet_kind?: LawyerWalletKind
  notes: string | null
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  lawyer?: { full_name: string; username?: string | null } | null
  reviewer?: { full_name: string } | null
}

function balanceForWalletKind(
  supabase: SupabaseClient,
  lawyerId: string,
  walletKind: LawyerWalletKind,
): Promise<number> {
  if (walletKind === 'savings') return fetchLawyerSavingsBalance(supabase, lawyerId)
  if (walletKind === 'legal_manager') return fetchLawyerWalletBalance(supabase, lawyerId, 'legal_manager')
  return fetchLawyerWalletBalance(supabase, lawyerId, 'fees')
}

/** Wallet balance minus amounts already reserved in pending payout requests for the same wallet. */
export async function fetchLawyerAvailablePayoutBalance(
  supabase: SupabaseClient,
  lawyerId: string,
  walletKind: LawyerWalletKind = 'fees',
): Promise<number> {
  const balance = await balanceForWalletKind(supabase, lawyerId, walletKind)
  const { data: pending } = await supabase
    .from('lawyer_payout_requests')
    .select('amount, wallet_kind')
    .eq('lawyer_id', lawyerId)
    .eq('status', 'pending')

  const reserved = (pending ?? [])
    .filter(r => (r.wallet_kind ?? 'fees') === walletKind)
    .reduce((s, r) => s + Number(r.amount ?? 0), 0)
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
    walletKind?: LawyerWalletKind
  },
): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const walletKind = params.walletKind ?? 'fees'
  const title = params.title.trim()
  if (!title) return { ok: false, error: 'اسم الطلب مطلوب' }
  if (!params.amount || params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  if (walletKind === 'savings' && !params.notes?.trim()) {
    return { ok: false, error: 'ملاحظة السحب مطلوبة لطلبات الصرفيات' }
  }

  const available = await fetchLawyerAvailablePayoutBalance(supabase, params.lawyerId, walletKind)
  if (params.amount > available) {
    return {
      ok: false,
      error: `المبلغ يتجاوز الرصيد المتاح — المتاح: ${formatMoney(available)}`,
    }
  }

  const row: Record<string, unknown> = {
    lawyer_id: params.lawyerId,
    branch_id: params.branchId,
    title,
    amount: params.amount,
    notes: params.notes?.trim() || null,
    status: 'pending',
    wallet_kind: walletKind,
  }

  const { data, error } = await supabase
    .from('lawyer_payout_requests')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    if (error.message.includes('wallet_kind')) {
      delete row.wallet_kind
      const retry = await supabase.from('lawyer_payout_requests').insert(row).select('id').single()
      if (retry.error) return { ok: false, error: retry.error.message }
      return { ok: true, requestId: retry.data.id }
    }
    return { ok: false, error: error.message }
  }
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
    const { data: rejected, error } = await supabase
      .from('lawyer_payout_requests')
      .update({
        status: 'rejected',
        review_notes: params.reviewNotes?.trim() || null,
        reviewed_by: params.reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', params.requestId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!rejected) return { ok: false, error: 'تمت معالجة هذا الطلب مسبقاً' }
    return { ok: true }
  }

  const walletKind = (req.wallet_kind ?? 'fees') as LawyerWalletKind
  const amount = Number(req.amount)
  const available = await balanceForWalletKind(supabase, req.lawyer_id, walletKind)
  if (amount > available) {
    const who = walletKind === 'legal_manager' ? 'مدير القانونية' : 'المحامي'
    return {
      ok: false,
      error: `رصيد ${who} غير كافٍ الآن — المتاح: ${formatMoney(available)}`,
    }
  }

  // Claim first (status pending → approved) to prevent double-pay races.
  const reviewedAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from('lawyer_payout_requests')
    .update({
      status: 'approved',
      review_notes: params.reviewNotes?.trim() || null,
      reviewed_by: params.reviewerId,
      reviewed_at: reviewedAt,
    })
    .eq('id', params.requestId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (claimErr) return { ok: false, error: claimErr.message }
  if (!claimed) return { ok: false, error: 'تمت معالجة هذا الطلب مسبقاً' }

  const payout = walletKind === 'savings'
    ? await withdrawLawyerSavings(supabase, {
        lawyerId: req.lawyer_id,
        amount,
        notes: req.notes?.trim() || `طلب صرفيات: ${req.title}`,
        createdBy: params.reviewerId,
      })
    : walletKind === 'legal_manager'
      ? await payoutLegalManagerWallet(supabase, {
          legalManagerUserId: req.lawyer_id,
          amount,
          notes: req.notes?.trim() || `طلب سحب: ${req.title}`,
          createdBy: params.reviewerId,
        })
      : await payoutLawyerFees(supabase, {
          lawyerId: req.lawyer_id,
          amount,
          notes: `طلب صرف: ${req.title}`,
          createdBy: params.reviewerId,
        })

  if (!payout.ok) {
    await supabase
      .from('lawyer_payout_requests')
      .update({
        status: 'pending',
        review_notes: null,
        reviewed_by: null,
        reviewed_at: null,
      })
      .eq('id', params.requestId)
      .eq('status', 'approved')
      .eq('reviewed_at', reviewedAt)
    return { ok: false, error: payout.error }
  }

  return { ok: true }
}
