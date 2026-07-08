/**
 * QA workflow smoke — run after qa-seed-users.mjs
 * node --env-file=.env.local scripts/qa-workflow.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.QA_PASSWORD ?? 'QaTest12'
const stats = { scenarios: 0, errors: [] }

function scenario(name, fn) {
  stats.scenarios++
  return fn().then(() => console.log(`  [OK] ${name}`)).catch(e => {
    stats.errors.push(`${name}: ${e.message}`)
    console.error(`  [FAIL] ${name}: ${e.message}`)
  })
}

async function login(page, user) {
  await page.context().clearCookies()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('jafar').fill(user)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

await scenario('lawyer wallet shows 500,000 savings', async () => {
  await login(page, 'qa_lawyer')
  await page.goto(`${BASE}/lawyer/account`, { waitUntil: 'networkidle' })
  const body = await page.content()
  if (!body.includes('500') && !body.includes('٥٠٠')) {
    throw new Error('Savings balance not visible on lawyer account page')
  }
})

await scenario('legal manager can open task review', async () => {
  await login(page, 'qa_legal')
  await page.goto(`${BASE}/admin/tasks/review`, { waitUntil: 'networkidle' })
  const body = await page.content()
  if (body.includes('صلاحية غير كافية')) throw new Error('Legal manager blocked from review')
})

await scenario('legal manager can open tasks assignment', async () => {
  await login(page, 'qa_legal')
  await page.goto(`${BASE}/admin/tasks`, { waitUntil: 'networkidle' })
  if ((await page.content()).includes('صلاحية غير كافية')) throw new Error('blocked')
})

await scenario('accountant can open debtor form', async () => {
  await login(page, 'qa_acct_branch')
  await page.goto(`${BASE}/admin/debtors/new`, { waitUntil: 'networkidle' })
  const body = await page.content()
  if (body.includes('صلاحية غير كافية')) throw new Error('Accountant blocked from new debtor')
  if (!body.includes('المدين') && !body.includes('مدين')) throw new Error('Debtor form not loaded')
})

await scenario('general accountant sees branch selector', async () => {
  await login(page, 'qa_acct_gen')
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  const body = await page.content()
  if (!body.includes('الفرع') && !body.includes('فرع')) {
    throw new Error('Branch selector not visible for general accountant')
  }
})

await scenario('delegate wallet API returns 200', async () => {
  await login(page, 'qa_delegate')
  const res = await page.request.get(`${BASE}/api/delegate/wallet`)
  if (res.status() !== 200) throw new Error(`wallet API ${res.status()}`)
})

await scenario('lawyer wallet API returns 200', async () => {
  await login(page, 'qa_lawyer')
  const res = await page.request.get(`${BASE}/api/lawyer/wallet`)
  if (res.status() !== 200) throw new Error(`wallet API ${res.status()}`)
})

await scenario('accountant blocked from delete-user API', async () => {
  await login(page, 'qa_acct_branch')
  const res = await page.request.post(`${BASE}/api/admin/delete-user`, {
    data: { userId: '00000000-0000-0000-0000-000000000000' },
  })
  if (res.status() !== 403 && res.status() !== 401) {
    throw new Error(`Expected 403, got ${res.status()}`)
  }
})

await scenario('admin finance page loads lawyer balances', async () => {
  await login(page, 'qa_admin')
  await page.goto(`${BASE}/admin/finance`, { waitUntil: 'networkidle' })
  const body = await page.content()
  if (body.includes('صلاحية غير كافية')) throw new Error('Admin blocked from finance')
  if (!body.includes('محفظة')) throw new Error('Finance wallet section missing')
})

await scenario('tasks overdue tab loads for admin', async () => {
  await login(page, 'qa_admin')
  await page.goto(`${BASE}/admin/tasks`, { waitUntil: 'networkidle' })
  const tab = page.locator('button, a').filter({ hasText: 'المهام المتأخرة' })
  if (await tab.count()) {
    await tab.first().click()
    await page.waitForTimeout(800)
  }
})

await browser.close()

console.log('\n========== WORKFLOW REPORT ==========')
console.log(JSON.stringify({ scenarios: stats.scenarios, errors: stats.errors }, null, 2))
process.exit(stats.errors.length ? 1 : 0)
