/**
 * استيراد حسابات المندوبين من Excel
 *
 *   node --env-file=.env.local scripts/import-delegates-from-excel.mjs --dry-run
 *   node --env-file=.env.local scripts/import-delegates-from-excel.mjs --confirm
 *   node --env-file=.env.local scripts/import-delegates-from-excel.mjs --confirm --file "c:/path/file.xlsx"
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import XLSX from 'xlsx'

const DEFAULT_FILE = 'c:/Users/Marvel/Desktop/حسابات المندوبين.xlsx'
const SKIP_SHEETS = new Set(['الفهرس'])
const PHONE_DEFAULT = '07800000000'

const SHEET_BRANCH_MAP = {
  الرصافة: 'بغداد الرصافة',
  النجف: 'النجف الأشرف',
  الكرخ: 'بغداد الكرخ',
  كربلاء: 'كربلاء',
  الحلة: 'الحلة',
  الديوانية: 'الديوانية',
  الكوت: 'الكوت',
  الناصرية: 'الناصرية',
  البصرة: 'البصرة',
  المثنى: 'السماوة',
  ديالى: 'ديالى',
  الموصل: 'الموصل',
  كركوك: 'كركوك',
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')
const fileArg = process.argv.find((a, i) => process.argv[i - 1] === '--file')
const excelPath = fileArg || DEFAULT_FILE

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!dryRun && !confirm) {
  console.error('Use --dry-run or --confirm')
  process.exit(1)
}
if (!existsSync(excelPath)) {
  console.error('File not found:', excelPath)
  process.exit(1)
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function usernameToInternalEmail(username) {
  return `${String(username).trim().toLowerCase()}@internal.qalat.local`
}

function normName(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

async function loadBranches() {
  const { data, error } = await admin.from('branches').select('id, name, is_active')
  if (error) throw new Error(error.message)
  const map = new Map()
  for (const b of data ?? []) map.set(normName(b.name), b)
  return map
}

async function findOrCreateBranch(branchName) {
  const name = normName(branchName)
  const { data: existing } = await admin.from('branches').select('id, name').eq('name', name).maybeSingle()
  if (existing) return existing

  if (dryRun) return { id: 'dry-branch', name }

  const { data: created, error } = await admin
    .from('branches')
    .insert({ name, is_active: true })
    .select('id, name')
    .single()
  if (error) throw new Error(`create branch ${name}: ${error.message}`)
  console.log(`  [branch] created: ${name}`)
  return created
}

async function resolveBranchList(branchId, listName) {
  const name = normName(listName)
  const { data: lists } = await admin
    .from('branch_lists')
    .select('id, name')
    .eq('branch_id', branchId)

  const exact = (lists ?? []).find(l => normName(l.name) === name)
  if (exact) return exact

  const ci = (lists ?? []).find(l => normName(l.name).toLowerCase() === name.toLowerCase())
  if (ci) return ci

  if (dryRun) return { id: 'dry-list', name }

  const { data: created, error } = await admin
    .from('branch_lists')
    .insert({ branch_id: branchId, name })
    .select('id, name')
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: retry } = await admin
        .from('branch_lists')
        .select('id, name')
        .eq('branch_id', branchId)
        .eq('name', name)
        .maybeSingle()
      return retry
    }
    throw new Error(`create list ${name}: ${error.message}`)
  }
  console.log(`  [list] created: ${name}`)
  return created
}

async function createDelegate(row) {
  const username = String(row.username).trim().toLowerCase()
  const password = String(row.password)
  const fullName = normName(row.fullName)
  const phone = normName(row.phone) || PHONE_DEFAULT

  const { data: existing } = await admin.from('profiles').select('id, username, branch_list_id, identity_type, identity_number').eq('username', username).maybeSingle()
  if (existing) {
    const listId = row.branchListId
    const needsListLink =
      (existing.branch_list_id && existing.branch_list_id !== listId)
      || (existing.identity_type !== 'delegate_list' || existing.identity_number !== listId)
    if (needsListLink) {
      if (!dryRun) {
        const patch = {
          branch_list_id: listId,
          identity_type: 'delegate_list',
          identity_number: listId,
          branch_id: row.branchId,
          role: 'delegate',
          full_name: fullName,
          phone,
        }
        let { error } = await admin.from('profiles').update(patch).eq('id', existing.id)
        if (error?.message?.includes('branch_list_id')) {
          const { branch_list_id: _b, ...rest } = patch
          ;({ error } = await admin.from('profiles').update(rest).eq('id', existing.id))
        }
        if (error) throw new Error(error.message)
      }
      return { status: 'updated', username }
    }
    return { status: 'skipped', username }
  }

  if (dryRun) return { status: 'would_create', username }

  const email = usernameToInternalEmail(username)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'delegate' },
  })
  if (authError || !authData.user) {
    throw new Error(`${username}: ${authError?.message ?? 'auth failed'}`)
  }

  const profile = {
    username,
    full_name: fullName,
    phone,
    role: 'delegate',
    is_active: true,
    governorate: row.branchName,
    branch_id: row.branchId,
    identity_type: 'delegate_list',
    identity_number: row.branchListId,
    identity_category: null,
    lawyer_type: 'normal',
    accountant_type: 'branch',
    branch_list_id: row.branchListId,
  }

  let { error: profileError } = await admin.from('profiles').update(profile).eq('id', authData.user.id)
  if (profileError?.message?.includes('accountant_type')) {
    const { accountant_type: _a, ...rest } = profile
    ;({ error: profileError } = await admin.from('profiles').update(rest).eq('id', authData.user.id))
  }
  if (profileError?.message?.includes('branch_list_id')) {
    const { branch_list_id: _b, ...rest } = profile
    ;({ error: profileError } = await admin.from('profiles').update(rest).eq('id', authData.user.id))
  }
  if (profileError) {
    await admin.from('profiles').upsert({ id: authData.user.id, ...profile })
  }

  await admin.from('delegate_wallets').upsert(
    { delegate_id: authData.user.id },
    { onConflict: 'delegate_id', ignoreDuplicates: true },
  )

  return { status: 'created', username }
}

function parseRows(wb) {
  const rows = []
  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName)) continue
    const branchKey = SHEET_BRANCH_MAP[sheetName] ?? sheetName
    const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
    for (const r of sheetRows) {
      const listName = normName(r['اسم القائمة'])
      const username = String(r['اليوزر'] ?? '').trim().toLowerCase()
      const password = String(r['الباسوورد'] ?? '').trim()
      if (!listName || !username || !password) continue
      rows.push({
        sheetName,
        branchKey,
        listName,
        fullName: normName(r['اسم حساب المندوب']) || `مندوب ${listName}`,
        username,
        password,
        phone: normName(r['رقم الهاتف']) || PHONE_DEFAULT,
      })
    }
  }
  return rows
}

async function main() {
  console.log(dryRun ? '\n=== DRY RUN ===' : '\n=== IMPORT DELEGATES ===')
  console.log('File:', excelPath)

  const wb = XLSX.read(readFileSync(excelPath))
  const rows = parseRows(wb)
  console.log(`Rows to process: ${rows.length}`)

  const branchCache = await loadBranches()
  const stats = { created: 0, skipped: 0, updated: 0, errors: [] }

  for (const row of rows) {
    try {
      let branch = branchCache.get(normName(row.branchKey))
      if (!branch) {
        branch = await findOrCreateBranch(row.branchKey)
        branchCache.set(normName(branch.name), branch)
      }

      const list = await resolveBranchList(branch.id, row.listName)
      if (!list) throw new Error(`list not found: ${row.listName}`)

      const result = await createDelegate({
        ...row,
        branchId: branch.id,
        branchName: branch.name,
        branchListId: list.id,
      })

      stats[result.status === 'would_create' ? 'created' : result.status]++
      const tag = result.status === 'would_create' ? 'CREATE' : result.status.toUpperCase()
      console.log(`[${tag}] ${row.username} — ${row.fullName} — ${branch.name} / ${list.name}`)
    } catch (e) {
      stats.errors.push(`${row.username}: ${e.message}`)
      console.error(`[ERROR] ${row.username}: ${e.message}`)
    }
  }

  console.log('\n========== SUMMARY ==========')
  console.log(JSON.stringify(stats, null, 2))
  if (stats.errors.length) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
