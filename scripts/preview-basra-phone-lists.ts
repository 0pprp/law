/**
 * Preview only: Basra debtors whose branch_list name looks like a phone number.
 * Run: npx tsx scripts/preview-basra-phone-lists.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

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

/** رقم هاتف / أرقام فقط (مع مسافات أو + أو شرطات) */
function looksLikePhoneListName(name: string | null | undefined): boolean {
  const s = String(name ?? '').trim()
  if (!s) return false
  // أزل مسافات وشرطات وأقواس و+
  const digits = s.replace(/[\s\-+().]/g, '')
  if (!/^\d+$/.test(digits)) return false
  // هواتف عراقية عادة 7–15 رقم؛ نقبل أيضاً أرقام طويلة شائعة من الاستيراد الخاطئ
  return digits.length >= 7 && digits.length <= 15
}

async function main() {
  loadEnv()
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: branches, error: bErr } = await sb
    .from('branches')
    .select('id, name')
    .ilike('name', '%بصرة%')
  if (bErr) throw new Error(bErr.message)
  console.log('Basra branches:', branches)

  const branchIds = (branches ?? []).map(b => b.id)
  if (!branchIds.length) {
    console.log('No Basra branch found')
    return
  }

  const { data: lists, error: lErr } = await sb
    .from('branch_lists')
    .select('id, name, branch_id')
    .in('branch_id', branchIds)
  if (lErr) throw new Error(lErr.message)

  const phoneLists = (lists ?? []).filter(l => looksLikePhoneListName(l.name))
  console.log(`\nAll lists in Basra: ${(lists ?? []).length}`)
  console.log(`Phone-like lists: ${phoneLists.length}`)
  for (const l of phoneLists.slice(0, 50)) {
    console.log(`  list: ${l.name} id=${l.id}`)
  }
  if (phoneLists.length > 50) console.log(`  ... +${phoneLists.length - 50} more`)

  const listIds = phoneLists.map(l => l.id)
  if (!listIds.length) {
    console.log('Nothing to delete')
    return
  }

  // count debtors
  let debtorCount = 0
  const sample: { id: string; full_name: string; list: string }[] = []
  for (let i = 0; i < listIds.length; i += 100) {
    const chunk = listIds.slice(i, i + 100)
    const { data: debtors, error } = await sb
      .from('debtors')
      .select('id, full_name, branch_list_id')
      .in('branch_list_id', chunk)
    if (error) throw new Error(error.message)
    debtorCount += debtors?.length ?? 0
    for (const d of debtors ?? []) {
      if (sample.length < 20) {
        const listName = phoneLists.find(l => l.id === d.branch_list_id)?.name ?? '?'
        sample.push({ id: d.id, full_name: d.full_name, list: listName })
      }
    }
  }

  console.log(`\nDebtors on phone-like lists: ${debtorCount}`)
  console.log('Sample debtors:')
  for (const s of sample) console.log(`  ${s.full_name} | list=${s.list}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
