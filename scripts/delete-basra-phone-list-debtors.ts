/**
 * حذف مديني البصرة الذين قوائمهم أرقام هواتف + حذف تلك القوائم فقط.
 * لا يعدّل أي شيء آخر.
 *
 * Run: npx tsx scripts/delete-basra-phone-list-debtors.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}

function looksLikePhoneListName(name: string | null | undefined): boolean {
  const s = String(name ?? '').trim()
  if (!s) return false
  const digits = s.replace(/[\s\-+().]/g, '')
  if (!/^\d+$/.test(digits)) return false
  return digits.length >= 7 && digits.length <= 15
}

async function hardDeleteDebtor(admin: SupabaseClient, debtorId: string): Promise<string | null> {
  // فك ارتباط المهمة الحالية
  await admin.from('debtors').update({ current_task_id: null }).eq('id', debtorId)

  const { data: tasks } = await admin.from('tasks').select('id').eq('debtor_id', debtorId)
  const taskIds = (tasks ?? []).map(t => t.id)

  if (taskIds.length) {
    await admin.from('task_attachments').delete().in('task_id', taskIds)
    await admin.from('expenses').delete().in('task_id', taskIds)
    // حركات محفظة مرتبطة بمهام إن وُجدت
    await admin.from('lawyer_wallet_transactions').delete().in('reference_id', taskIds)
    await admin.from('tasks').delete().in('id', taskIds)
  }

  await admin.from('expenses').delete().eq('debtor_id', debtorId)
  await admin.from('debtor_payments').delete().eq('debtor_id', debtorId)
  await admin.from('debtor_notes').delete().eq('debtor_id', debtorId)

  const { data: atts } = await admin
    .from('debtor_attachments')
    .select('id, file_path')
    .eq('debtor_id', debtorId)
  const attPaths = (atts ?? []).map(a => a.file_path).filter(Boolean) as string[]
  if (attPaths.length) {
    await admin.storage.from('debtor-files').remove(attPaths).catch(() => null)
  }
  await admin.from('debtor_attachments').delete().eq('debtor_id', debtorId)

  const { data: details } = await admin
    .from('criminal_debtor_details')
    .select('documents_contract_file_path, petition_file_path')
    .eq('debtor_id', debtorId)
    .maybeSingle()
  const crimPaths = [
    details?.documents_contract_file_path,
    details?.petition_file_path,
  ].filter((p): p is string => Boolean(p && String(p).trim()))
  if (crimPaths.length) {
    await admin.storage.from('debtor-files').remove(crimPaths).catch(() => null)
  }
  await admin.from('criminal_debtor_details').delete().eq('debtor_id', debtorId)

  const { error } = await admin.from('debtors').delete().eq('id', debtorId)
  return error?.message ?? null
}

async function main() {
  loadEnv()
  const confirm = process.argv.includes('--confirm')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: branches, error: bErr } = await admin
    .from('branches')
    .select('id, name')
    .eq('name', 'البصرة')
  if (bErr) throw new Error(bErr.message)
  const branch = branches?.[0]
  if (!branch) {
    console.log('فرع البصرة غير موجود')
    return
  }
  console.log(`Branch: ${branch.name} (${branch.id})`)

  const { data: lists, error: lErr } = await admin
    .from('branch_lists')
    .select('id, name, branch_id')
    .eq('branch_id', branch.id)
  if (lErr) throw new Error(lErr.message)

  const phoneLists = (lists ?? []).filter(l => looksLikePhoneListName(l.name))
  console.log(`Phone-like lists: ${phoneLists.length}`)
  const listIds = phoneLists.map(l => l.id)

  const debtors: { id: string; full_name: string; branch_list_id: string | null }[] = []
  for (let i = 0; i < listIds.length; i += 80) {
    const chunk = listIds.slice(i, i + 80)
    const { data, error } = await admin
      .from('debtors')
      .select('id, full_name, branch_list_id')
      .eq('branch_id', branch.id)
      .in('branch_list_id', chunk)
    if (error) throw new Error(error.message)
    debtors.push(...(data ?? []))
  }

  console.log(`Debtors to delete: ${debtors.length}`)
  for (const d of debtors) {
    const listName = phoneLists.find(l => l.id === d.branch_list_id)?.name ?? '?'
    console.log(`  - ${d.full_name} | list=${listName}`)
  }

  if (!confirm) {
    console.log('\nDry-run only. Re-run with --confirm to delete.')
    return
  }

  let deletedDebtors = 0
  const failDebtors: { name: string; error: string }[] = []
  for (const d of debtors) {
    const err = await hardDeleteDebtor(admin, d.id)
    if (err) {
      failDebtors.push({ name: d.full_name, error: err })
      console.log(`  FAIL debtor ${d.full_name}: ${err}`)
    } else {
      deletedDebtors += 1
      console.log(`  deleted debtor: ${d.full_name}`)
    }
  }

  let deletedLists = 0
  const failLists: { name: string; error: string }[] = []
  for (const l of phoneLists) {
    // تأكد لا يوجد مدينون متبقون على القائمة
    const { count } = await admin
      .from('debtors')
      .select('id', { count: 'exact', head: true })
      .eq('branch_list_id', l.id)
    if ((count ?? 0) > 0) {
      failLists.push({ name: l.name, error: `still has ${count} debtors` })
      continue
    }
    const { error } = await admin.from('branch_lists').delete().eq('id', l.id)
    if (error) {
      failLists.push({ name: l.name, error: error.message })
      console.log(`  FAIL list ${l.name}: ${error.message}`)
    } else {
      deletedLists += 1
      console.log(`  deleted list: ${l.name}`)
    }
  }

  console.log('\n=== DONE ===')
  console.log(`Debtors deleted: ${deletedDebtors}/${debtors.length}`)
  console.log(`Lists deleted: ${deletedLists}/${phoneLists.length}`)
  if (failDebtors.length) console.log('Debtor failures:', failDebtors)
  if (failLists.length) console.log('List failures:', failLists)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
