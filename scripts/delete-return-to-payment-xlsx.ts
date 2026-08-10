/**
 * حذف تام لمدينين من 6 ملفات «يرجعون للتسديد».
 * التشغيل: npx tsx scripts/delete-return-to-payment-xlsx.ts --confirm
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const DIR = 'C:/Users/Marvel/Downloads/Telegram Desktop'
const FILES: { file: string; branchHints: string[] }[] = [
  { file: 'الموصل يرجعون للتسديد.xlsx', branchHints: ['الموصل'] },
  { file: 'الناصرية يرجع للتسديد.xlsx', branchHints: ['الناصرية'] },
  { file: 'النجف يرجع للتسديد.xlsx', branchHints: ['النجف', 'النجف الأشرف'] },
  { file: 'ديالى يرجعون للتسديد.xlsx', branchHints: ['ديالى'] },
  { file: 'كرخ- يرجعون للتسديد.xlsx', branchHints: ['الكرخ', 'كرخ'] },
  { file: 'كركوك يرجعون للتسديد.xlsx', branchHints: ['كركوك'] },
]

function loadEnv() {
  const p = resolve('.env.local')
  if (!existsSync(p)) return
  let raw = readFileSync(p, 'utf8')
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

function norm(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** اسم بدون لاحقة رقمية مثل " 3" أو "2" في نهاية الاسم */
function baseName(s: string): string {
  return norm(s).replace(/\s*\d+\s*$/, '').trim()
}

function extractName(row: Record<string, unknown>): string {
  const keys = Object.keys(row)
  for (const k of keys) {
    if (/اسم|عميل|full.?name/i.test(k)) {
      const v = norm(String(row[k] ?? ''))
      if (v) return v
    }
  }
  return ''
}

function readNamesFromFile(file: string): string[] {
  const full = join(DIR, file)
  const wb = XLSX.readFile(full)
  const names: string[] = []
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], {
      defval: '',
      raw: false,
    })
    for (const row of rows) {
      const n = extractName(row)
      if (n) names.push(n)
    }
  }
  return [...new Set(names)]
}

async function hardDeleteDebtor(admin: SupabaseClient, debtorId: string): Promise<string | null> {
  await admin.from('debtors').update({
    current_task_id: null,
    last_task_id: null,
    special_status_id: null,
  } as any).eq('id', debtorId)

  const { data: tasks } = await admin.from('tasks').select('id').eq('debtor_id', debtorId)
  const taskIds = (tasks ?? []).map(t => t.id)

  if (taskIds.length) {
    await admin.from('task_attachments').delete().in('task_id', taskIds)
    await admin.from('expenses').delete().in('task_id', taskIds)
    await admin.from('lawyer_wallet_transactions').delete().in('reference_id', taskIds)
    await admin.from('lawyer_stationery_transactions').delete().in('reference_id', taskIds)
    await admin.from('tasks').delete().in('id', taskIds)
  }

  await admin.from('expenses').delete().eq('debtor_id', debtorId)
  await admin.from('debtor_payments').delete().eq('debtor_id', debtorId)
  await admin.from('debtor_notes').delete().eq('debtor_id', debtorId)
  await admin.from('activity_logs').delete().eq('entity_id', debtorId)

  try {
    await admin.from('payment_noncompliance').delete().eq('debtor_id', debtorId)
  } catch {
    /* الجدول قد لا يوجد */
  }

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

type Match = {
  id: string
  full_name: string
  branch_id: string | null
  branch_name: string
  sourceFile: string
  excelName: string
}

async function main() {
  loadEnv()
  const confirm = process.argv.includes('--confirm')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: branches } = await admin.from('branches').select('id, name')
  const branchById = new Map((branches ?? []).map(b => [b.id, b.name]))

  function resolveBranchIds(hints: string[]): string[] {
    const ids: string[] = []
    for (const b of branches ?? []) {
      if (hints.some(h => b.name.includes(h) || h.includes(b.name))) ids.push(b.id)
    }
    return ids
  }

  const allMatches: Match[] = []
  const notFound: { file: string; name: string }[] = []
  const ambiguous: { file: string; name: string; hits: string[] }[] = []

  for (const src of FILES) {
    const names = readNamesFromFile(src.file)
    const branchIds = resolveBranchIds(src.branchHints)
    console.log(`\n[${src.file}] أسماء=${names.length} فروع مطابقة=${branchIds.map(id => branchById.get(id)).join(',') || '—'}`)

    for (const excelName of names) {
      const n = norm(excelName)
      const base = baseName(excelName)

      const { data: fuzzy } = await admin
        .from('debtors')
        .select('id, full_name, branch_id')
        .ilike('full_name', `%${(base.split(' ')[0] ?? base).slice(0, 40)}%`)
        .limit(100)

      let hits = (fuzzy ?? []).filter(d => {
        const dn = norm(d.full_name)
        const db = baseName(d.full_name)
        return dn === n || db === base || dn === base || db === n
      })

      if (branchIds.length) {
        const inBranch = hits.filter(d => d.branch_id && branchIds.includes(d.branch_id))
        if (inBranch.length) hits = inBranch
      }

      if (!hits.length) {
        notFound.push({ file: src.file, name: excelName })
        console.log(`  ✗ غير موجود: ${excelName}`)
        continue
      }

      // إن بقي أكثر من واحد بنفس الاسم في نفس الفرع — احذف الكل المطابق للاسم
      for (const h of hits) {
        allMatches.push({
          id: h.id,
          full_name: h.full_name,
          branch_id: h.branch_id,
          branch_name: branchById.get(h.branch_id ?? '') ?? '—',
          sourceFile: src.file,
          excelName,
        })
      }
      if (hits.length > 1) {
        ambiguous.push({
          file: src.file,
          name: excelName,
          hits: hits.map(h => `${h.full_name} (${h.id.slice(0, 8)})`),
        })
        console.log(`  ~ مطابقات متعددة (${hits.length}): ${excelName}`)
      } else {
        console.log(`  ✓ ${hits[0].full_name} | ${branchById.get(hits[0].branch_id ?? '')}`)
      }
    }
  }

  // فريد حسب id
  const unique = new Map<string, Match>()
  for (const m of allMatches) unique.set(m.id, m)
  const targets = [...unique.values()]

  console.log(`\n=== ملخص ===`)
  console.log(`أسماء الإكسل المطابقة لسجلات: ${targets.length}`)
  console.log(`غير موجود: ${notFound.length}`)
  console.log(`أسماء بعدة سجلات: ${ambiguous.length}`)

  if (!confirm) {
    console.log('\nDry-run. أعد التشغيل مع --confirm للحذف.')
    return
  }

  const deleted: Match[] = []
  const failed: { match: Match; error: string }[] = []

  for (const m of targets) {
    const err = await hardDeleteDebtor(admin, m.id)
    if (err) {
      failed.push({ match: m, error: err })
      console.log(`  FAIL ${m.full_name}: ${err}`)
    } else {
      deleted.push(m)
      console.log(`  deleted: ${m.full_name} | ${m.branch_name}`)
    }
  }

  // تحقق عدم بقاء
  const remaining: string[] = []
  for (const m of deleted) {
    const { data } = await admin.from('debtors').select('id').eq('id', m.id).maybeSingle()
    if (data) remaining.push(m.full_name)
  }

  const report = {
    startedAt: new Date().toISOString(),
    files: FILES.map(f => f.file),
    excelNameCount: FILES.reduce((s, f) => s + readNamesFromFile(f.file).length, 0),
    matchedDebtors: targets.length,
    deleted: deleted.length,
    failed: failed.map(f => ({ name: f.match.full_name, error: f.error })),
    notFound,
    ambiguous,
    remainingAfterDelete: remaining,
    deletedNames: deleted.map(d => ({
      name: d.full_name,
      branch: d.branch_name,
      file: d.sourceFile,
      id: d.id,
    })),
  }

  const out = resolve('scripts/delete-return-to-payment-report.json')
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')

  console.log('\n==============================')
  console.log(`حُذف: ${deleted.length}/${targets.length}`)
  console.log(`فشل: ${failed.length}`)
  console.log(`غير موجود في النظام: ${notFound.length}`)
  console.log(`متبقٍ بعد الحذف: ${remaining.length}`)
  console.log('التقرير:', out)
  console.log('==============================')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
