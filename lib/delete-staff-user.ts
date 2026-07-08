import type { SupabaseClient } from '@supabase/supabase-js'
import { formatErrorMessage } from '@/lib/format-error'

async function nullifyColumn(
  admin: SupabaseClient,
  table: string,
  column: string,
  userId: string,
) {
  await admin.from(table).update({ [column]: null }).eq(column, userId)
}

/** فك كل المراجع المعروفة لملف المستخدم قبل الحذف */
async function detachUserReferences(admin: SupabaseClient, userId: string) {
  await admin.from('tasks').update({ assigned_to: null }).eq('assigned_to', userId)
  await admin.from('tasks').update({ assignment_rejected_by: null }).eq('assignment_rejected_by', userId)
  await nullifyColumn(admin, 'tasks', 'created_by', userId)

  await admin.from('lawyer_attachments').delete().eq('lawyer_id', userId)
  await nullifyColumn(admin, 'lawyer_attachments', 'uploaded_by', userId)

  await admin.from('lawyer_wallet_transactions').delete().eq('lawyer_id', userId)
  await nullifyColumn(admin, 'lawyer_wallet_transactions', 'created_by', userId)

  await admin.from('delegate_wallet_transactions').delete().eq('delegate_id', userId)
  await nullifyColumn(admin, 'delegate_wallet_transactions', 'created_by', userId)

  await nullifyColumn(admin, 'expenses', 'created_by', userId)
  await nullifyColumn(admin, 'lawyer_payout_requests', 'reviewed_by', userId)

  // سجل النشاط يمنع حذف profiles — نحتفظ بالسجلات ونفك user_id إن أمكن
  const { error: logNullErr } = await admin
    .from('activity_logs')
    .update({ user_id: null })
    .eq('user_id', userId)
  if (logNullErr) {
    const { error: logDelErr } = await admin.from('activity_logs').delete().eq('user_id', userId)
    if (logDelErr) {
      throw new Error(formatErrorMessage(logDelErr))
    }
  }
}

/** إزالة ارتباطات المستخدم ثم حذف الملف والحساب — profile أولاً ثم auth */
export async function deleteStaffUserAccount(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await detachUserReferences(admin, userId)
  } catch (e) {
    return { ok: false, error: formatErrorMessage(e) }
  }

  const { error: profileErr } = await admin.from('profiles').delete().eq('id', userId)
  if (profileErr) {
    return { ok: false, error: formatErrorMessage(profileErr) }
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(userId)
  if (authErr) {
    const msg = formatErrorMessage(authErr)
    if (/not found|user not found/i.test(msg)) {
      return { ok: true }
    }
    return { ok: false, error: msg || 'فشل حذف حساب الدخول' }
  }

  return { ok: true }
}
