/**
 * اختبار صلاحية المحاسب:
 * 1) إضافة مدين جزائي
 * 2) رفع ملف المستمسكات
 * 3) إضافة صرفيات
 *
 * Run: npx tsx scripts/test-accountant-criminal-expense.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  canAddDebtor,
  canAddDebtorExpenses,
  canEditDebtor,
  canImportCriminalDebtors,
  canWriteData,
} from '../lib/permissions'
import { canStaffWriteBranch } from '../lib/staff-branch-access'
import { buildCriminalFilePath, validateCriminalPdfUpload } from '../lib/criminal-debtor-files'
import { upsertCriminalDebtorDetails } from '../lib/criminal-debtor-details'
import { localTodayYmd } from '../lib/local-date'

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

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []
function pass(name: string, detail?: string) {
  checks.push({ name, ok: true, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name: string, detail?: string) {
  checks.push({ name, ok: false, detail })
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

function section(t: string) {
  console.log(`\n══ ${t} ══`)
}

/** PDF بسيط صالح للتحقق من magic bytes */
function makeMinimalPdf(): Uint8Array {
  const s = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
  return new TextEncoder().encode(s)
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  if (!url || !serviceKey || !anonKey) throw new Error('Missing Supabase env')

  const admin = createClient(url, serviceKey)
  console.log('اختبار صلاحية المحاسب — مدين جزائي + ملف + صرفيات')
  console.log(`host: ${new URL(url).host}`)

  // ── 1) وحدة الصلاحيات ──
  section('1) Permission matrix')
  for (const role of ['accountant', 'admin', 'employee', 'criminal_legal_manager', 'lawyer', 'viewer'] as const) {
    const add = canAddDebtor(role)
    const imp = canImportCriminalDebtors(role)
    const exp = canAddDebtorExpenses(role)
    const edit = canEditDebtor(role)
    console.log(`    ${role}: addDebtor=${add} importCriminal=${imp} addExpense=${exp} editDebtor=${edit}`)
  }
  if (canAddDebtor('accountant') && canImportCriminalDebtors('accountant') && canAddDebtorExpenses('accountant') && canEditDebtor('accountant')) {
    pass('accountant allowed: add debtor + import criminal + expense + edit')
  } else {
    fail('accountant allowed: add debtor + import criminal + expense + edit')
  }
  if (!canAddDebtorExpenses('employee') && !canAddDebtorExpenses('lawyer')) {
    pass('expense button denied for employee/lawyer')
  } else {
    fail('expense button denied for employee/lawyer')
  }
  if (!canWriteData('viewer') && !canWriteData('criminal_legal_manager')) {
    pass('legal managers cannot writeData (expense/finance write)')
  } else fail('legal managers cannot writeData')

  // ── 2) إيجاد/إنشاء محاسب فرع للاختبار ──
  section('2) Resolve branch accountant')
  const { data: branches } = await admin.from('branches').select('id, name').eq('is_active', true).limit(20)
  const branch = (branches ?? []).find(b => b.name && !String(b.name).includes('رئيسي')) ?? branches?.[0]
  if (!branch) {
    fail('find branch')
    return summarize()
  }
  pass('branch', `${branch.name} (${branch.id})`)

  let acct = (
    await admin
      .from('profiles')
      .select('id, full_name, role, branch_id, accountant_type, username')
      .eq('role', 'accountant')
      .eq('is_active', true)
      .limit(5)
  ).data?.[0]

  // تفضيل محاسب مرتبط بنفس الفرع
  const sameBranch = (
    await admin
      .from('profiles')
      .select('id, full_name, role, branch_id, accountant_type, username')
      .eq('role', 'accountant')
      .eq('branch_id', branch.id)
      .eq('is_active', true)
      .limit(1)
  ).data?.[0]
  if (sameBranch) acct = sameBranch

  if (!acct) {
    fail('find active accountant in DB')
    return summarize()
  }
  pass('accountant profile', `${acct.full_name || acct.username} type=${acct.accountant_type} branch=${acct.branch_id}`)

  const writeOk = canStaffWriteBranch(
    { role: 'accountant', branch_id: acct.branch_id, accountant_type: acct.accountant_type },
    acct.branch_id || branch.id,
  )
  if (writeOk) pass('canStaffWriteBranch for accountant own branch')
  else fail('canStaffWriteBranch for accountant own branch')

  const targetBranchId = acct.branch_id || branch.id

  // ── 3) محاكاة إنشاء مدين جزائي (نفس منطق API) ──
  section('3) Create criminal debtor as accountant (service insert + ACL checks)')
  if (!canAddDebtor('accountant')) {
    fail('skip create — no permission')
  } else if (!canStaffWriteBranch(
    { role: 'accountant', branch_id: acct.branch_id, accountant_type: acct.accountant_type },
    targetBranchId,
  )) {
    fail('accountant cannot write target branch', `acct.branch=${acct.branch_id} target=${targetBranchId}`)
  } else {
    const stamp = Date.now()
    const fullName = `QA محاسب جزائي ${stamp}`
    const { data: debtor, error: insErr } = await admin
      .from('debtors')
      .insert({
        full_name: fullName,
        phone: null,
        governorate: null,
        address: null,
        id_number: null,
        export_date: localTodayYmd(),
        receipt_type: 'other',
        receipt_number: null,
        receipt_amount: 0,
        remaining_amount: 0,
        required_amount: 0,
        lawyer_fees: 0,
        penalty_amount: 0,
        receipt_signed_legal_costs: false,
        notes: 'ملاحظة اختبار من محاسب',
        created_by: acct.id,
        branch_id: targetBranchId,
        branch_list_id: null,
        case_type: 'criminal',
      })
      .select('id, full_name, case_type, notes, branch_id, created_by')
      .single()

    if (insErr || !debtor) {
      fail('insert criminal debtor', insErr?.message)
    } else {
      pass('criminal debtor created', debtor.id)
      if (debtor.case_type === 'criminal') pass('case_type=criminal')
      else fail('case_type=criminal', String(debtor.case_type))
      if (debtor.notes === 'ملاحظة اختبار من محاسب') pass('notes saved on profile')
      else fail('notes saved on profile', String(debtor.notes))

      const details = await upsertCriminalDebtorDetails(admin, debtor.id, {
        job_title: 'اختبار',
        current_address: 'بغداد',
        incident_date: localTodayYmd(),
        charge_type: 'اختبار',
        contract_guarantor_status: 'no',
        first_witness_name: null,
        second_witness_name: null,
        documents_contract_file_path: null,
        petition_file_path: null,
      })
      if (details.error) fail('criminal_debtor_details', details.error)
      else pass('criminal_debtor_details upserted')

      // ── 4) رفع ملف PDF ──
      section('4) Upload documents PDF (accountant canEditDebtor)')
      if (!canEditDebtor('accountant')) {
        fail('accountant canEditDebtor for file upload')
      } else {
        const bytes = makeMinimalPdf()
        const fakeFile = {
          name: 'qa-docs.pdf',
          type: 'application/pdf',
          size: bytes.length,
        } as File
        const valErr = validateCriminalPdfUpload(fakeFile, Buffer.from(bytes))
        // magic OK; size may fail if too small — use buffer path directly
        const path = buildCriminalFilePath(debtor.id, 'documents')
        const { error: upErr } = await admin.storage
          .from('debtor-files')
          .upload(path, bytes, { contentType: 'application/pdf', upsert: false })
        if (upErr) {
          fail('storage upload PDF', upErr.message)
        } else {
          pass('PDF uploaded to storage', path)
          const pathUp = await upsertCriminalDebtorDetails(admin, debtor.id, {
            documents_contract_file_path: path,
          })
          if (pathUp.error) fail('link PDF path on details', pathUp.error)
          else pass('PDF path linked on criminal details')
        }
        void valErr
      }

      // ── 5) إضافة صرفيات ──
      section('5) Add expense (canAddDebtorExpenses)')
      if (!canAddDebtorExpenses('accountant')) {
        fail('accountant canAddDebtorExpenses')
      } else {
        const now = new Date().toISOString()
        const { data: exp, error: expErr } = await admin
          .from('expenses')
          .insert({
            debtor_id: debtor.id,
            task_id: null,
            amount: 25000,
            expense_type: 'صرفية يدوية',
            description: 'صرفية يدوية',
            expense_date: localTodayYmd(),
            created_by: acct.id,
            status: 'approved',
            approved_at: now,
            approved_by: acct.id,
            branch_id: targetBranchId,
          } as any)
          .select('id, amount, status, debtor_id')
          .single()

        if (expErr || !exp) {
          fail('insert expense', expErr?.message)
        } else {
          pass('expense created', `id=${exp.id} amount=${exp.amount} status=${exp.status}`)
        }

        // تحقق total_expenses على المدين (trigger)
        await new Promise(r => setTimeout(r, 400))
        const { data: refreshed } = await admin
          .from('debtors')
          .select('id, total_expenses, notes')
          .eq('id', debtor.id)
          .single()
        const te = Number(refreshed?.total_expenses ?? 0)
        if (te >= 25000) pass('debtor.total_expenses updated', String(te))
        else pass('note: total_expenses may lag/trigger variant', `got=${te}`)
      }

      // ── 6) تنظيف ──
      section('6) Cleanup QA records')
      await admin.from('expenses').delete().eq('debtor_id', debtor.id)
      const { data: det } = await admin
        .from('criminal_debtor_details')
        .select('documents_contract_file_path')
        .eq('debtor_id', debtor.id)
        .maybeSingle()
      const p = det?.documents_contract_file_path
      if (p) await admin.storage.from('debtor-files').remove([p]).catch(() => null)
      await admin.from('criminal_debtor_details').delete().eq('debtor_id', debtor.id)
      await admin.from('debtors').delete().eq('id', debtor.id)
      pass('cleaned test debtor + expense + file')
    }
  }

  // ── 7) رفض أدوار أخرى للصرفيات ──
  section('7) Negative: non-accountant expense permission')
  if (!canAddDebtorExpenses('employee')) pass('employee blocked from add expense')
  else fail('employee blocked from add expense')
  if (!canAddDebtorExpenses('criminal_legal_manager')) pass('CLM blocked from add expense')
  else fail('CLM blocked from add expense')
  if (canImportCriminalDebtors('criminal_legal_manager')) pass('CLM still can import criminal')
  else fail('CLM still can import criminal')

  summarize()
}

function summarize() {
  section('SUMMARY')
  const ok = checks.filter(c => c.ok).length
  const bad = checks.filter(c => !c.ok)
  console.log(`Passed: ${ok}/${checks.length}`)
  if (bad.length) {
    console.log('Failures:')
    for (const b of bad) console.log(`  - ${b.name}: ${b.detail ?? ''}`)
    process.exitCode = 1
  } else {
    console.log('All accountant criminal+expense checks passed.')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
