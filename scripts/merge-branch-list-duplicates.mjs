/**
 * Dry-run / merge duplicate branch_lists by normalized name (same branch).
 *
 *   node --env-file=.env.local scripts/merge-branch-list-duplicates.mjs
 *   node --env-file=.env.local scripts/merge-branch-list-duplicates.mjs --apply
 *
 * Does NOT delete debtors or delegates — only re-points FKs then deletes empty duplicate list rows.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const TATWEEL = /\u0640/g
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g
const EASTERN = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}
const WORD_NUM = [
  [/(?:^|\s)(واحد|الاول|الأول|الاولى|الأولى|اولى|أولى)\s*$/u, '1'],
  [/(?:^|\s)(اثنان|اثنين|اثنتان|اثنتين|الثاني|الثانية|ثاني|ثانية)\s*$/u, '2'],
  [/(?:^|\s)(ثلاثة|ثلاث|الثالث|الثالثة|ثالث|ثالثة)\s*$/u, '3'],
]

function collapse(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeBranchListName(raw) {
  let s = collapse(raw)
  if (!s) return ''
  s = s.replace(TATWEEL, '').replace(ARABIC_DIACRITICS, '')
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/\u0671/g, 'ا').replace(/ى/g, 'ي')
  s = s.replace(/[٠-٩۰-۹]/g, ch => EASTERN[ch] ?? ch)
  for (const [re, d] of WORD_NUM) {
    if (re.test(s)) { s = s.replace(re, ` ${d}`).trim(); break }
  }
  s = collapse(s)
  let key = s.replace(/[\s\-_/.,،]+/g, '')
  if (key.startsWith('ال') && key.length > 2) key = key.slice(2)
  return key
}

function preferDisplay(names) {
  const cleaned = names.map(collapse).filter(Boolean)
  if (!cleaned.length) return ''
  const scored = cleaned.map(name => {
    let score = 0
    if (/\s\d+$/.test(name)) score += 30
    if (/^[إأ]/.test(name)) score += 20
    if (name.includes(' ')) score += 5
    if (/\D\d+$/.test(name) && !/\s\d+$/.test(name)) score -= 10
    const key = normalizeBranchListName(name)
    if (cleaned.some(n => n.startsWith('ال')) && name.startsWith('ال')) score += 8
    if (key === 'اسكان' && name.startsWith('الإ')) score += 15
    if (key.startsWith('حبوبي') && !name.startsWith('ال') && /\s\d+$/.test(name)) score += 25
    if (key.startsWith('حبوبي') && name.startsWith('ال')) score -= 5
    return { name, score }
  })
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ar'))
  return scored[0].name
}

async function countDebtors(listId) {
  const { count } = await admin.from('debtors').select('id', { count: 'exact', head: true }).eq('branch_list_id', listId)
  return count ?? 0
}

async function countDelegates(listId) {
  let n = 0
  const a = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('branch_list_id', listId)
  if (!a.error) n += a.count ?? 0
  const b = await admin.from('profiles').select('id', { count: 'exact', head: true })
    .eq('identity_type', 'delegate_list').eq('identity_number', listId)
  if (!b.error) n += b.count ?? 0
  return n
}

async function mergeGroup(group) {
  const { canonical, duplicates, displayName, key } = group
  let debtorsMoved = 0
  let delegatesMoved = 0

  for (const dup of duplicates) {
    const { data: dRows, error: dErr } = await admin
      .from('debtors').update({ branch_list_id: canonical.id }).eq('branch_list_id', dup.id).select('id')
    if (dErr) throw new Error(`debtors→${dup.id}: ${dErr.message}`)
    debtorsMoved += dRows?.length ?? 0

    const { data: pRows, error: pErr } = await admin
      .from('profiles').update({ branch_list_id: canonical.id }).eq('branch_list_id', dup.id).select('id')
    if (pErr && !String(pErr.message).includes('branch_list_id')) throw new Error(`profiles→${dup.id}: ${pErr.message}`)
    delegatesMoved += pRows?.length ?? 0

    const { data: iRows } = await admin.from('profiles').update({
      identity_number: canonical.id,
      branch_list_id: canonical.id,
      identity_type: 'delegate_list',
    }).eq('identity_type', 'delegate_list').eq('identity_number', dup.id).select('id')
    delegatesMoved += iRows?.length ?? 0
  }

  // Delete duplicates first (FKs already moved), then rename canonical.
  // Renaming before delete can hit branch_lists_branch_name_unique.
  for (const dup of duplicates) {
    const left = await countDebtors(dup.id)
    if (left > 0) throw new Error(`refuse delete ${dup.id}: ${left} debtors still linked`)
    const { count: leftProf } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('branch_list_id', dup.id)
    if ((leftProf ?? 0) > 0) throw new Error(`refuse delete ${dup.id}: ${leftProf} profiles still linked`)
    const { error: delErr } = await admin.from('branch_lists').delete().eq('id', dup.id)
    if (delErr) throw new Error(`delete ${dup.id}: ${delErr.message}`)
  }

  const { error: nameErr } = await admin.from('branch_lists')
    .update({ name: displayName, normalized_name: key })
    .eq('id', canonical.id)
  if (nameErr && String(nameErr.message).includes('normalized_name')) {
    const { error: e2 } = await admin.from('branch_lists').update({ name: displayName }).eq('id', canonical.id)
    if (e2) throw e2
  } else if (nameErr) throw nameErr

  return { debtorsMoved, delegatesMoved }
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (no writes) ===')

  // Ensure column exists (best-effort; ignore if missing)
  try {
    await admin.rpc('noop')
  } catch { /* ignore */ }

  let listsRes = await admin
    .from('branch_lists')
    .select('id, name, branch_id, created_at, normalized_name')
    .order('created_at', { ascending: true })
  if (listsRes.error && String(listsRes.error.message || '').includes('normalized_name')) {
    console.warn('column branch_lists.normalized_name missing — continuing without it (JS normalize only)')
    listsRes = await admin
      .from('branch_lists')
      .select('id, name, branch_id, created_at')
      .order('created_at', { ascending: true })
  }
  const { data: lists, error } = listsRes
  if (error) throw error

  const { data: branches } = await admin.from('branches').select('id, name')
  const branchName = new Map((branches ?? []).map(b => [b.id, b.name]))

  const withCounts = []
  for (const list of lists ?? []) {
    const debtors = await countDebtors(list.id)
    const delegates = await countDelegates(list.id)
    const key = normalizeBranchListName(list.name)
    withCounts.push({ ...list, key, debtors, delegates })
  }

  /** @type {Map<string, typeof withCounts>} */
  const groups = new Map()
  for (const row of withCounts) {
    if (!row.key) continue
    const gkey = `${row.branch_id}::${row.key}`
    if (!groups.has(gkey)) groups.set(gkey, [])
    groups.get(gkey).push(row)
  }

  const duplicateGroups = []
  for (const [, rows] of groups) {
    if (rows.length < 2) continue
    rows.sort((a, b) =>
      (b.debtors - a.debtors)
      || (b.delegates - a.delegates)
      || String(a.created_at).localeCompare(String(b.created_at)),
    )
    const canonical = rows[0]
    const duplicates = rows.slice(1)
    const displayName = preferDisplay(rows.map(r => r.name))
    duplicateGroups.push({
      branch_id: canonical.branch_id,
      branch: branchName.get(canonical.branch_id) ?? canonical.branch_id,
      normalized_name: canonical.key,
      displayName,
      names: rows.map(r => r.name),
      ids: rows.map(r => r.id),
      canonical,
      duplicates,
      debtorsTotal: rows.reduce((s, r) => s + r.debtors, 0),
      delegatesTotal: rows.reduce((s, r) => s + r.delegates, 0),
      perList: rows.map(r => ({
        id: r.id,
        name: r.name,
        debtors: r.debtors,
        delegates: r.delegates,
        created_at: r.created_at,
      })),
    })
  }

  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    totalLists: withCounts.length,
    duplicateGroupCount: duplicateGroups.length,
    groups: duplicateGroups.map(g => ({
      branch: g.branch,
      normalized_name: g.normalized_name,
      displayName: g.displayName,
      canonicalId: g.canonical.id,
      canonicalName: g.canonical.name,
      names: g.names,
      ids: g.ids,
      debtorsTotal: g.debtorsTotal,
      delegatesTotal: g.delegatesTotal,
      perList: g.perList,
      relatedTables: ['debtors.branch_list_id', 'profiles.branch_list_id', 'profiles.identity_number (delegate_list)'],
    })),
    applyResults: [],
  }

  console.log(`\nFound ${duplicateGroups.length} duplicate group(s) across ${withCounts.length} lists.\n`)
  for (const g of duplicateGroups) {
    console.log(`— ${g.branch} | key=${g.normalized_name}`)
    console.log(`  names: ${g.names.join(' | ')}`)
    console.log(`  canonical: ${g.displayName} (${g.canonical.id}) [debtors=${g.canonical.debtors}, delegates=${g.canonical.delegates}]`)
    console.log(`  duplicates: ${g.duplicates.map(d => `${d.name}(${d.id})`).join(', ')}`)
    console.log(`  totals: debtors=${g.debtorsTotal}, delegates=${g.delegatesTotal}`)
  }

  if (APPLY) {
    let totalDebtors = 0
    let totalDelegates = 0
    for (const g of duplicateGroups) {
      try {
        const result = await mergeGroup({
          canonical: g.canonical,
          duplicates: g.duplicates,
          displayName: g.displayName,
          key: g.normalized_name,
        })
        totalDebtors += result.debtorsMoved
        totalDelegates += result.delegatesMoved
        report.applyResults.push({
          ok: true,
          branch: g.branch,
          displayName: g.displayName,
          ...result,
          deletedIds: g.duplicates.map(d => d.id),
        })
        console.log(`[MERGED] ${g.branch} → ${g.displayName} (debtors=${result.debtorsMoved}, delegates=${result.delegatesMoved})`)
      } catch (e) {
        report.applyResults.push({ ok: false, branch: g.branch, error: e.message })
        console.error(`[FAIL] ${g.branch}: ${e.message}`)
        console.error('Stopping further merges to avoid partial cascade across groups.')
        break
      }
    }

    // Backfill normalized_name for remaining singles
    for (const row of withCounts) {
      const key = normalizeBranchListName(row.name)
      if (!key) continue
      await admin.from('branch_lists').update({ normalized_name: key }).eq('id', row.id)
    }

    report.totalsMoved = { debtors: totalDebtors, delegates: totalDelegates }
    console.log(`\nMoved debtors=${totalDebtors}, delegates=${totalDelegates}`)
  } else {
    console.log('\nDry run only — re-run with --apply to merge.')
  }

  const out = resolve(__dirname, 'merge-branch-list-duplicates-report.json')
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nReport written: ${out}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
