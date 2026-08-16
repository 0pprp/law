/**
 * إرجاع معظم أسماء «تجهيز الملفات» إلى «تحت إسناد مهمة»،
 * مع الإبقاء على 18 في بغداد الرصافة و 5 في الديوانية.
 *
 * npx tsx --env-file=.env.local scripts/restore-prep-to-awaiting.ts
 * npx tsx --env-file=.env.local scripts/restore-prep-to-awaiting.ts --apply
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  let raw = readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

loadEnv()

const APPLY = process.argv.includes('--apply')

const KEEP: Record<string, number> = {
  'بغداد الرصافة': 18,
  الرصافة: 18,
  الديوانية: 5,
}

function keepLimit(branchName: string): number {
  const n = branchName.trim()
  if (KEEP[n] != null) return KEEP[n]!
  if (n.includes('الرصافة')) return 18
  if (n.includes('الديوانية')) return 5
  return 0
}

type Row = {
  id: string
  full_name: string | null
  branch_id: string | null
  created_at: string
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY مطلوبة')

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: branches, error: bErr } = await admin.from('branches').select('id, name')
  if (bErr) throw new Error(bErr.message)
  const nameById = new Map((branches ?? []).map(b => [b.id as string, String(b.name ?? '')]))

  const { data: preparing, error: pErr } = await admin
    .from('debtors')
    .select('id, full_name, branch_id, created_at')
    .eq('file_preparation_status', 'preparing')
    .order('created_at', { ascending: true })

  if (pErr) throw new Error(pErr.message)

  const rows = (preparing ?? []) as Row[]
  const byBranch = new Map<string, Row[]>()
  for (const r of rows) {
    const bid = r.branch_id ?? '__none__'
    const list = byBranch.get(bid) ?? []
    list.push(r)
    byBranch.set(bid, list)
  }

  const toRestore: string[] = []
  const keepIds: string[] = []

  console.log(`قيد التجهيز حالياً: ${rows.length}`)
  console.log(APPLY ? '--- APPLY ---' : '--- DRY RUN (أضف --apply للتنفيذ) ---')

  for (const [bid, list] of byBranch) {
    const bname = bid === '__none__' ? '(بلا فرع)' : (nameById.get(bid) ?? bid)
    const limit = bid === '__none__' ? 0 : keepLimit(bname)
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const keep = sorted.slice(0, limit)
    const rest = sorted.slice(limit)
    keepIds.push(...keep.map(r => r.id))
    toRestore.push(...rest.map(r => r.id))
    console.log(
      `${bname}: إجمالي ${list.length} → إبقاء ${keep.length} / إرجاع ${rest.length}`,
    )
  }

  console.log(`\nإبقاء في التجهيز: ${keepIds.length} (المطلوب ≈ 23)`)
  console.log(`إرجاع لإسناد المهمة: ${toRestore.length}`)

  if (!APPLY) {
    console.log('\nلم يُنفَّذ شيء. شغّل مع --apply للتطبيق.')
    return
  }

  if (!toRestore.length) {
    console.log('لا شيء للإرجاع.')
    return
  }

  const chunk = 200
  let updated = 0
  for (let i = 0; i < toRestore.length; i += chunk) {
    const ids = toRestore.slice(i, i + chunk)
    const { error } = await admin
      .from('debtors')
      .update({
        file_preparation_status: null,
        assigned_chief_accountant_id: null,
      })
      .in('id', ids)
    if (error) throw new Error(error.message)
    updated += ids.length
  }

  const { count: stillPrep } = await admin
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('file_preparation_status', 'preparing')

  console.log(`\nتم إرجاع ${updated} مدين إلى إسناد المهمة.`)
  console.log(`المتبقي قيد التجهيز: ${stillPrep ?? '?'}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
