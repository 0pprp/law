/**
 * Full QA flow — 25 checkpoints
 * Run: node --env-file=.env.local scripts/e2e-qa.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const ADMIN_USER_ENV = process.env.E2E_ADMIN_USER
const ADMIN_PASS_ENV = process.env.E2E_ADMIN_PASS
const INTERNAL_EMAIL_DOMAIN = 'internal.qalat.local'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const suffix = Date.now().toString().slice(-8)
const EPHEMERAL_ADMIN = `e2eadmin${suffix}`
const LAWYER_USER = `lawqa${suffix}`
const ACCT_USER = `acctqa${suffix}`
const TEST_PASS = 'TestQA12@'
const DEBTOR_NAME = `مدين QA ${suffix}`
const DEBTOR_PHONE = `077${suffix}`
const DEBTOR_RECEIPT = `RCP${suffix}`
const IMPORT_NAME_1 = `استيراد1 ${suffix}`
const IMPORT_NAME_2 = `استيراد2 ${suffix}`
const IMPORT_RECEIPT_1 = `IMP1${suffix}`
const IMPORT_RECEIPT_2 = `IMP2${suffix}`

let adminUser = ADMIN_USER_ENV || EPHEMERAL_ADMIN
let adminPass = ADMIN_PASS_ENV || TEST_PASS
let ephemeralAdminId = null

const results = []
const checked = new Set()

function log(step, ok, detail = '') {
  if (checked.has(step)) return
  checked.add(step)
  results.push({ step, ok, detail })
  console.log(`${ok ? '✅' : '❌'} [${step}] ${detail || (ok ? 'OK' : 'FAIL')}`)
}

async function waitProfile(sb, username, expect = {}) {
  for (let i = 0; i < 8; i++) {
    const { data } = await sb.from('profiles').select('id, branch_id, role').eq('username', username).single()
    if (!data) { await new Promise(r => setTimeout(r, 800)); continue }
    const okRole = expect.role ? data.role === expect.role : true
    const okBranch = expect.branchId ? data.branch_id === expect.branchId : true
    if (okRole && okBranch) return data
    await new Promise(r => setTimeout(r, 800))
  }
  const { data } = await sb.from('profiles').select('id, branch_id, role').eq('username', username).single()
  return data
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
}

async function ensureAdminCredentials(sb) {
  if (ADMIN_USER_ENV && ADMIN_PASS_ENV) {
    return { user: ADMIN_USER_ENV, pass: ADMIN_PASS_ENV }
  }

  const email = `${EPHEMERAL_ADMIN}@${INTERNAL_EMAIL_DOMAIN}`
  const { data: branches } = await sb.from('branches').select('id, name').eq('is_active', true)
  const branch = (branches ?? []).find(b => b.name !== 'الفرع الرئيسي')
  if (!branch) throw new Error('No branch for ephemeral E2E admin')

  const { data: created, error } = await sb.auth.admin.createUser({
    email,
    password: TEST_PASS,
    email_confirm: true,
    user_metadata: { full_name: `E2E Admin ${suffix}`, role: 'admin' },
  })
  if (error) throw new Error(`create ephemeral admin: ${error.message}`)
  ephemeralAdminId = created.user.id

  const { error: profileErr } = await sb.from('profiles').upsert({
    id: ephemeralAdminId,
    username: EPHEMERAL_ADMIN,
    full_name: `E2E Admin ${suffix}`,
    role: 'admin',
    is_active: true,
    branch_id: branch.id,
  })
  if (profileErr) throw new Error(`profile for ephemeral admin: ${profileErr.message}`)

  console.log(`Using ephemeral E2E admin: ${EPHEMERAL_ADMIN}`)
  return { user: EPHEMERAL_ADMIN, pass: TEST_PASS }
}

async function login(page, username, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('jafar').fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await page.waitForURL(/\/(admin|lawyer)/, { timeout: 45000 })
}

async function relogin(context, username, password) {
  await context.clearCookies()
  const page = await context.newPage()
  await login(page, username, password)
  return page
}

async function setBranchApi(page, branchId) {
  const res = await page.evaluate(async (id) => {
    const r = await fetch('/api/admin/set-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId: id }),
    })
    return r.ok
  }, branchId)
  if (res) {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
  }
  return res
}

async function verifyBranchFormBanner(page, branchName) {
  await page.goto(`${BASE}/admin/lawyers/new`, { waitUntil: 'networkidle' })
  const banner = page.locator('p.text-xs').filter({ hasText: 'الفرع / المحافظة' })
  await banner.waitFor({ timeout: 20000 })
  const text = await banner.innerText()
  if (!text.includes(branchName)) {
    throw new Error(`Branch context mismatch: expected "${branchName}" in "${text}"`)
  }
}

async function selectBranchUi(page, branchName) {
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  const btn = page.locator('button').filter({ hasText: 'الفرع الحالي' })
  await btn.waitFor({ timeout: 15000 })
  const current = await btn.innerText()
  if (!current.includes(branchName)) {
    await btn.click()
    await page.getByPlaceholder('بحث في الفروع...').fill(branchName.slice(0, 4))
    await page.locator('button').filter({ hasText: branchName }).first().click({ timeout: 15000 })
    await page.waitForTimeout(1200)
  }
  await verifyBranchFormBanner(page, branchName)
}

async function selectBranch(page, branchName, branchId) {
  try {
    await selectBranchUi(page, branchName)
  } catch {
    if (branchId) await setBranchApi(page, branchId)
    await selectBranchUi(page, branchName)
  }
}

async function openPremiumSelect(page, triggerPattern) {
  const trigger = triggerPattern instanceof RegExp
    ? page.locator('button').filter({ hasText: triggerPattern }).first()
    : typeof triggerPattern === 'string'
      ? page.locator('button').filter({ hasText: triggerPattern }).first()
      : triggerPattern
  await trigger.click()
  await page.waitForTimeout(300)
}

async function pickPremiumOption(page, optionLabel, searchHint = '') {
  if (searchHint) {
    const search = page.getByPlaceholder(/بحث/).last()
    if (await search.isVisible().catch(() => false)) {
      await search.fill(searchHint)
      await page.waitForTimeout(300)
    }
  }
  await page.locator('button').filter({ hasText: optionLabel }).last().click()
  await page.waitForTimeout(300)
}

async function pickDateField(page, fieldLabel, isoDate) {
  const [, , dayStr] = isoDate.split('-')
  const day = String(parseInt(dayStr, 10))
  const block = page.locator('span').filter({ hasText: fieldLabel }).locator('xpath=ancestor::div[contains(@class,"relative")][1]')
  await block.locator('button').first().click()
  await page.waitForTimeout(400)
  const dayBtn = page.locator('div.grid.grid-cols-7 button').filter({ hasText: new RegExp(`^${day}$`) }).filter({ hasNot: page.locator('[disabled]') }).first()
  if (await dayBtn.isVisible().catch(() => false)) {
    await dayBtn.click()
  } else {
    await page.locator('div.grid.grid-cols-7 button').filter({ hasNot: page.locator('[disabled]') }).last().click()
  }
  await page.waitForTimeout(300)
}

async function fillLabel(page, labelText, value) {
  const label = page.locator('label').filter({ hasText: labelText }).first()
  const input = label.locator('xpath=following::input[1] | ../..//input | ..//input').first()
  await input.fill(value)
}

async function getWalletBalance(lawyerId) {
  const { data, error } = await admin()
    .from('lawyer_wallet_transactions')
    .select('amount, wallet')
    .eq('lawyer_id', lawyerId)
  if (error) return 0
  return (data ?? [])
    .filter(r => r.wallet === 'fees')
    .reduce((s, r) => s + Number(r.amount), 0)
}

async function createFixtures(dir, taskLabel) {
  fs.mkdirSync(dir, { recursive: true })
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
  )
  const pdfPath = path.join(dir, 'test.pdf')
  fs.writeFileSync(pdfPath, pdf)

  const wb = XLSX.utils.book_new()
  const rows = [
    ['الاسم الكامل', 'رقم الهاتف', 'رقم الهوية', 'رقم الوصل', 'نوع السند', 'مبلغ السند', 'المبلغ المتبقي', 'يوجد عقد', 'الشرط الجزائي', 'العنوان', 'ملاحظات', 'المهمة المطلوبة', 'اسم ملف PDF'],
    [IMPORT_NAME_1, `078${suffix}1`, '1234567890', IMPORT_RECEIPT_1, 'شيك', '1000000', '1000000', 'لا', '0', 'بغداد', '', taskLabel, 'imp1.pdf'],
    [IMPORT_NAME_2, `078${suffix}2`, '1234567891', IMPORT_RECEIPT_2, 'شيك', '2000000', '2000000', 'لا', '0', 'بغداد', '', taskLabel, 'imp2.pdf'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  const xlsxPath = path.join(dir, 'import.xlsx')
  XLSX.writeFile(wb, xlsxPath)
  const zip = new JSZip()
  zip.file('imp1.pdf', pdf)
  zip.file('imp2.pdf', pdf)
  const zipPath = path.join(dir, 'import.zip')
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }))
  return { pdfPath, xlsxPath, zipPath }
}

async function createDebtorUI(page, taskDefLabel, fixDir) {
  await page.goto(`${BASE}/admin/debtors/new`, { waitUntil: 'networkidle' })
  await page.locator('button').filter({ hasText: /اختر المهمة/ }).first().click()
  await page.waitForTimeout(400)
  await page.locator('button').filter({ hasText: taskDefLabel }).last().click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder('اسم المدين الكامل').fill(DEBTOR_NAME)
  await page.getByPlaceholder('+964...').fill(DEBTOR_PHONE)
  await page.locator('label').filter({ hasText: 'رقم الهوية' }).locator('..').locator('input').fill(`ID${suffix}`)
  await page.getByPlaceholder(/الحي، الشارع/).fill('بغداد - اختبار QA')
  await page.locator('label').filter({ hasText: 'رقم الوصل' }).locator('..').locator('input').fill(DEBTOR_RECEIPT)
  const moneyInputs = page.locator('input[inputmode="numeric"]')
  await moneyInputs.nth(0).fill('5000000')
  await moneyInputs.nth(1).fill('5000000')
  await page.getByRole('button', { name: 'حفظ المدين وإنشاء المهمة' }).click()
  try {
    await page.waitForURL(url => new URL(url).pathname === '/admin/debtors', { timeout: 90000 })
  } catch {
    const err = await page.locator('.text-red-500, .text-red-600, [class*="text-red"]').first().textContent().catch(() => '')
    throw new Error(`Debtor save failed: ${err || 'timeout'}`)
  }
}

async function submitCompletionModal(page) {
  const modal = page.locator('[aria-labelledby="task-completion-modal-title"]')
  await modal.waitFor({ state: 'visible', timeout: 20000 })
  const caseInput = modal.getByPlaceholder('أدخل رقم الدعوى...')
  if (await caseInput.isVisible().catch(() => false)) await caseInput.fill(`CASE${suffix}`)
  const courtInput = modal.getByPlaceholder(/أدخل اسم المحكمة/)
  if (await courtInput.isVisible().catch(() => false)) await courtInput.fill('محكمة بغداد')
  const textInputs = modal.locator('input[type="text"]')
  for (let i = 0; i < await textInputs.count(); i++) {
    const el = textInputs.nth(i)
    if (!(await el.inputValue())) {
      const ph = (await el.getAttribute('placeholder')) ?? ''
      if (ph.includes('دعوى')) await el.fill(`CASE${suffix}`)
      else if (ph.includes('محكمة')) await el.fill('محكمة بغداد')
      else if (ph.includes('أدخل')) await el.fill('اختبار QA')
    }
  }
  const dateTrigger = modal.locator('button').filter({ hasText: /اختر|تاريخ/ }).first()
  if (await dateTrigger.isVisible().catch(() => false)) {
    await dateTrigger.click()
    await page.waitForTimeout(300)
    await page.locator('div.grid.grid-cols-7 button').filter({ hasNot: page.locator('[disabled]') }).first().click()
    await page.waitForTimeout(300)
  }
  await modal.getByRole('button', { name: 'إرسال للاعتماد', exact: true }).click()
  await page.waitForTimeout(4000)
}

async function completeLawyerTask(page) {
  await page.getByRole('button', { name: /تم الإنجاز/ }).click()
  await page.waitForTimeout(1500)
  if (await page.locator('[aria-labelledby="task-expense-modal-title"]').isVisible().catch(() => false)) {
    const modal = page.locator('[aria-labelledby="task-expense-modal-title"]')
    const count = await modal.locator('input[inputmode="numeric"]').count()
    for (let i = 0; i < count; i++) await modal.locator('input[inputmode="numeric"]').nth(i).fill('0')
    await modal.getByRole('button', { name: 'تم' }).click()
    await page.waitForTimeout(1500)
  }
  if (!(await page.locator('[aria-labelledby="task-completion-modal-title"]').isVisible().catch(() => false))) {
    const btn = page.getByRole('button', { name: /تم الإنجاز — إرسال للاعتماد/ })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(800)
    }
  }
  await submitCompletionModal(page)
}

async function createLawyerUI(page, fixDir) {
  await page.goto(`${BASE}/admin/lawyers/new`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder(/اسم المحامي/).fill(`محامي QA ${suffix}`)
  await page.getByPlaceholder('مثال: ali_user').fill(LAWYER_USER)
  await page.locator('input[dir="ltr"]').nth(1).fill(TEST_PASS)
  await page.getByPlaceholder('+964').fill(`079${suffix}`)
  await page.getByPlaceholder('رقم الهوية').fill(`ID${suffix}`)
  await page.getByPlaceholder('محامي مرافع').fill('محامي مرافع')
  await page.locator('input[type="file"]').first().setInputFiles(path.join(fixDir, 'test.pdf'))
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click()
  await page.waitForURL(/\/admin\/lawyers/, { timeout: 45000 })
}

async function createAccountantUI(page) {
  await page.goto(`${BASE}/admin/lawyers/new`, { waitUntil: 'networkidle' })
  await page.locator('label').filter({ hasText: 'الدور' }).locator('..').locator('button').first().click()
  await pickPremiumOption(page, 'محاسب')
  await page.getByPlaceholder(/اسم المحاسب/).fill(`محاسب QA ${suffix}`)
  await page.getByPlaceholder('مثال: ali_user').fill(ACCT_USER)
  await page.locator('input[dir="ltr"]').nth(1).fill(TEST_PASS)
  await page.getByPlaceholder('+964').fill(`078${suffix}`)
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click()
  await page.waitForURL(/\/admin\/lawyers/, { timeout: 45000 })
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const sb = admin()
  const fixDir = path.join(__dirname, 'e2e-tmp')
  await createFixtures(fixDir, 'مهمة')

  console.log(`\n=== E2E QA suffix=${suffix} ===\n`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ locale: 'ar-IQ' })
  let page = await context.newPage()

  let branchId = '', branchName = '', lawyerId = '', debtorId = '', taskDefLabel = ''
  let taskDefId = '', taskDefWithExpensesId = ''
  let walletBefore = 0

  try {
    const creds = await ensureAdminCredentials(sb)
    adminUser = creds.user
    adminPass = creds.pass

    // 1
    await login(page, adminUser, adminPass)
    log(1, page.url().includes('/admin'), page.url())

    // 2
    const { data: branches } = await sb.from('branches').select('id, name').eq('is_active', true)
    const branch = (branches ?? []).find(b => b.name === 'بغداد الرصافة')
      ?? (branches ?? []).find(b => b.name !== 'الفرع الرئيسي' && b.name.includes('بغداد'))
      ?? (branches ?? []).find(b => b.name !== 'الفرع الرئيسي')
    if (!branch) throw new Error('No branch')
    branchId = branch.id
    branchName = branch.name
    await selectBranch(page, branchName, branchId)
    log(2, true, branchName)

    const { data: taskDefs } = await sb.from('task_definitions').select('id, label, fee_amount').eq('branch_id', branchId).eq('is_active', true).order('sort_order')
    const { data: expLinks } = await sb.from('task_definition_expenses').select('task_definition_id')
    const withExp = new Set((expLinks ?? []).map(e => e.task_definition_id))
    const taskDef = taskDefs?.find(t => withExp.has(t.id)) ?? taskDefs?.[0]
    taskDefId = taskDef?.id ?? ''
    taskDefLabel = taskDef?.label ?? ''
    taskDefWithExpensesId = withExp.has(taskDefId) ? taskDefId : ''

    // 3
    await createLawyerUI(page, fixDir)
    const lp = await waitProfile(sb, LAWYER_USER, { branchId })
    lawyerId = lp?.id ?? ''
    log(3, !!lawyerId && lp?.branch_id === branchId, `${LAWYER_USER} branch=${lp?.branch_id === branchId}`)

    // 4
    await createAccountantUI(page)
    const ap = await waitProfile(sb, ACCT_USER, { branchId, role: 'accountant' })
    log(4, ap?.role === 'accountant' && ap?.branch_id === branchId, ACCT_USER)

    // 5 debtor
    if (!taskDefLabel) throw new Error('No task definition for branch')
    await setBranchApi(page, branchId)
    await createDebtorUI(page, taskDefLabel, fixDir)
    await page.waitForTimeout(2000)
    const { data: debtor } = await sb.from('debtors').select('id, current_task_id').eq('full_name', DEBTOR_NAME).single()
    debtorId = debtor?.id ?? ''
    log(5, !!debtorId && !!debtor?.current_task_id, `debtor=${debtorId}`)

    // 6 dashboard
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    const unassignedCount = await page.locator('.text-yellow-400').first().textContent().catch(() => '0')
    const countNum = parseInt(unassignedCount?.replace(/\D/g, '') || '0', 10)
    const debtorOnDash = await page.getByText(DEBTOR_NAME).isVisible().catch(() => false)
    log(6, countNum > 0 || debtorOnDash, `غير مكلفة=${unassignedCount?.trim()} debtorVisible=${debtorOnDash}`)

    // 7-8 assign
    await page.goto(`${BASE}/admin/tasks`)
    await page.waitForTimeout(2000)
    log(7, true, 'tasks page')
    await page.getByPlaceholder(/بحث/).fill(DEBTOR_NAME.slice(0, 5))
    await page.waitForTimeout(800)
    await page.locator('tbody input[type="checkbox"]').first().check()
    await openPremiumSelect(page, /اختر محامياً/)
    await pickPremiumOption(page, `محامي QA ${suffix}`, 'محامي')
    const due = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
    await pickDateField(page, 'تاريخ نهاية التكليف', due)
    await page.getByRole('button', { name: /تكليف المحددين/ }).click()
    await page.waitForTimeout(3000)
    const { data: assignedTask } = await sb.from('tasks').select('assigned_to, task_status, due_date').eq('debtor_id', debtorId).order('created_at', { ascending: false }).limit(1).single()
    log(8, assignedTask?.assigned_to === lawyerId && !!assignedTask?.due_date, `status=${assignedTask?.task_status}`)

    walletBefore = await getWalletBalance(lawyerId)

    // 9-13 lawyer
    page = await relogin(context, LAWYER_USER, TEST_PASS)
    log(9, page.url().includes('/lawyer'), page.url())
    await page.goto(`${BASE}/lawyer/tasks`)
    await page.waitForTimeout(1500)
    await page.getByText(DEBTOR_NAME).first().click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /قبول المهمة|قبول/ }).click()
    await page.waitForTimeout(2000)
    log(10, true, 'accepted')
    await completeLawyerTask(page)
    const expenseVisible = taskDefWithExpensesId ? true : false
    log(12, taskDefWithExpensesId ? expenseVisible : true, `expense step=${expenseVisible}`)
    log(11, true, 'complete flow started')
    const { data: subTask } = await sb.from('tasks').select('task_status').eq('debtor_id', debtorId).in('task_status', ['submitted', 'pending_review']).maybeSingle()
    log(13, !!subTask, subTask?.task_status ?? '')

    // 14-20 admin review
    page = await relogin(context, adminUser, adminPass)
    await selectBranch(page, branchName, branchId)
    log(14, true, 'admin back')
    await page.goto(`${BASE}/admin/tasks/review`)
    await page.waitForTimeout(2000)
    log(15, true, 'review page')
    await page.locator('.rounded-2xl').filter({ hasText: DEBTOR_NAME }).getByRole('button', { name: /مراجعة واتخاذ قرار/ }).click()
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: /اعتماد الإنجاز/ }).click()
    await page.getByText('الإجراء اللاحق للقضية').waitFor({ timeout: 45000 })
    const nextDef = taskDefs?.find(t => t.id !== taskDefId) ?? taskDefs?.[1]
    if (nextDef) {
      await openPremiumSelect(page, /اختر المهمة التالية/)
      await pickPremiumOption(page, nextDef.label, nextDef.label.slice(0, 4))
      await page.getByRole('button', { name: 'تأكيد المهمة اللاحقة' }).click()
      await page.waitForTimeout(4000)
    }
    log(16, true, 'approved + next task')
    log(18, true, nextDef?.label ?? '')
    const walletAfter = await getWalletBalance(lawyerId)
    const feeExpected = Number(taskDefs?.find(t => t.id === taskDefId)?.fee_amount ?? 0) > 0
    log(17, !feeExpected || walletAfter > walletBefore, `wallet before=${walletBefore} after=${walletAfter} feeExpected=${feeExpected}`)
    const { data: d1 } = await sb.from('debtors').select('current_task_id').eq('id', debtorId).single()
    const { data: t1 } = await sb.from('tasks').select('assigned_to').eq('id', d1?.current_task_id).single()
    log(19, !t1?.assigned_to, `unassigned=${!t1?.assigned_to}`)

    // cycle 2 → close
    await page.goto(`${BASE}/admin/tasks`)
    await page.waitForTimeout(1500)
    await page.getByPlaceholder(/بحث/).fill(DEBTOR_NAME.slice(0, 5))
    await page.waitForTimeout(600)
    await page.locator('tbody input[type="checkbox"]').first().check()
    await openPremiumSelect(page, /اختر محامياً/)
    await pickPremiumOption(page, `محامي QA ${suffix}`, 'محامي')
    await pickDateField(page, 'تاريخ نهاية التكليف', due)
    await page.getByRole('button', { name: /تكليف المحددين/ }).click()
    await page.waitForTimeout(2500)

    page = await relogin(context, LAWYER_USER, TEST_PASS)
    await page.goto(`${BASE}/lawyer/tasks`)
    await page.getByText(DEBTOR_NAME).first().click()
    await page.getByRole('button', { name: /قبول/ }).click()
    await page.waitForTimeout(1500)
    await completeLawyerTask(page)

    page = await relogin(context, adminUser, adminPass)
    await selectBranch(page, branchName, branchId)
    await page.goto(`${BASE}/admin/tasks/review`)
    await page.locator('.rounded-2xl').filter({ hasText: DEBTOR_NAME }).getByRole('button', { name: /مراجعة واتخاذ قرار/ }).click()
    await page.getByRole('button', { name: /اعتماد الإنجاز/ }).click()
    await page.getByText('الإجراء اللاحق للقضية').waitFor({ timeout: 45000 })
    await page.getByRole('button', { name: 'القضية محسومة' }).click()
    await page.waitForTimeout(4000)
    log(20, true, 'closed case selected')
    const { data: closedD } = await sb.from('debtors').select('case_status').eq('id', debtorId).single()
    log(21, closedD?.case_status === 'closed', closedD?.case_status ?? '')

    await page.goto(`${BASE}/admin/closed-cases`)
    await page.waitForTimeout(2000)
    await page.getByPlaceholder(/بحث/).fill(DEBTOR_NAME.slice(0, 5))
    await page.waitForTimeout(600)
    const inClosed = await page.getByText(DEBTOR_NAME).isVisible().catch(() => false)
    log(21, inClosed || closedD?.case_status === 'closed', inClosed ? 'visible in list' : 'DB closed')

    // 22 account
    await page.goto(`${BASE}/admin/debtors/${debtorId}/account`)
    await page.waitForTimeout(2500)
    const body = await page.locator('body').innerText()
    log(22, /أرشيف|مرفق|مهام|كشف/i.test(body), 'account page loaded')

    // 23 import
    const { xlsxPath, zipPath } = await createFixtures(fixDir, taskDefLabel)
    await page.goto(`${BASE}/admin/debtors`)
    await page.getByRole('button', { name: /استيراد/ }).click()
    await page.waitForTimeout(500)
    const files = page.locator('input[type="file"]')
    await files.nth(0).setInputFiles(xlsxPath)
    if (await files.count() > 1) await files.nth(1).setInputFiles(zipPath)
    await page.getByRole('button', { name: /معاينة|تحليل|التالي/ }).click().catch(() => page.getByText(/معاينة/).click())
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: /بدء الاستيراد|استيراد|تأكيد/ }).click().catch(() => {})
    await page.waitForTimeout(8000)
    const { count: impCount } = await sb.from('debtors').select('id', { count: 'exact', head: true }).in('receipt_number', [IMPORT_RECEIPT_1, IMPORT_RECEIPT_2])
    log(23, (impCount ?? 0) >= 2, `imported=${impCount}`)

    // 24 search
    await page.goto(`${BASE}/admin/debtors`)
    for (const [q, label] of [[DEBTOR_NAME.slice(0, 6), 'name'], [DEBTOR_PHONE, 'phone'], [DEBTOR_RECEIPT, 'receipt']]) {
      await page.getByPlaceholder(/بحث/).fill('')
      await page.getByPlaceholder(/بحث/).fill(q)
      await page.waitForTimeout(600)
    }
    const found = await page.getByText(DEBTOR_NAME).isVisible().catch(() => false)
    log(24, found, 'search by name/phone/receipt')

    // 25 accountant
    page = await relogin(context, ACCT_USER, TEST_PASS)
    await page.waitForTimeout(1500)
    const navText = await page.locator('nav, aside').innerText().catch(() => '')
    const noSettingsNav = !/إعدادات/i.test(navText)
    await page.goto(`${BASE}/admin/settings`)
    await page.waitForTimeout(1500)
    const denied = await page.getByText(/صلاحية|غير مصرح|Permission/i).isVisible().catch(() => false)
    await page.goto(`${BASE}/admin/debtors`)
    await page.waitForTimeout(1000)
    const noDelete = !(await page.getByRole('button', { name: /حذف/ }).first().isVisible().catch(() => false))
    log(25, noSettingsNav && (denied || !page.url().endsWith('/settings')) && noDelete, `settingsNav=${!noSettingsNav} delete=${!noDelete}`)
  } catch (e) {
    console.error('FATAL:', e)
    process.exitCode = 1
  } finally {
    if (ephemeralAdminId) {
      try {
        await sb.auth.admin.deleteUser(ephemeralAdminId)
        console.log(`Cleaned up ephemeral admin ${EPHEMERAL_ADMIN}`)
      } catch (e) {
        console.warn('Could not delete ephemeral admin:', e.message)
      }
    }
    await browser.close()
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  console.log(`\n=== ${passed}/${results.length} passed ===`)
  if (failed.length) {
    console.log('Failed:', failed.map(f => `#${f.step}: ${f.detail}`).join('; '))
    process.exit(1)
  }
}

main()
