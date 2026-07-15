/**
 * UI smoke via Playwright — qa_ui_* users (thorough)
 *   node --env-file=.env.local scripts/qa-ui-smoke-playwright.mjs
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = 'QaTest12'
const BRANCH = 'بغداد الرصافة'
const findings = []
const blockers = []
const screenshots = []
const created = []

function find(msg, ok = true) {
  findings.push({ ok, msg, t: new Date().toISOString() })
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${msg}`)
}

function note(msg) {
  console.log(`[..] ${msg}`)
  findings.push({ ok: null, msg, t: new Date().toISOString() })
}

async function shot(page, name) {
  const path = resolve(__dirname, `qa-ui-shot-${name}.png`)
  await page.screenshot({ path, fullPage: true })
  screenshots.push(path)
}

async function login(page, username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 })
  await page.locator('input[autocomplete="username"]').fill(username)
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD)
  await Promise.all([
    page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 25000 }),
    page.locator('form button[type="submit"]').click(),
  ])
  await page.waitForTimeout(1000)
  find(`login ${username} → ${page.url()}`)
}

async function logout(page) {
  await page.context().clearCookies()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
}

/** Header branch selector — click current branch chip then pick name. Soft if read-only. */
async function selectHeaderBranch(page, name) {
  const chip = page.locator('button').filter({ hasText: /الفرع|بغداد|النجف|البصرة|الديوانية|كربلاء|الموصل|الناصرية|السماوة|ديالى|كركوك|كل الفروع/ }).first()
  const visible = await chip.isVisible().catch(() => false)
  if (!visible) {
    // Branch accountants often see a non-clickable chip; profile branch is enough
    const text = await page.locator('body').innerText()
    find(`header branch chip not clickable; page mentions ${name}? ${text.includes(name)}`, text.includes(name) || text.includes('بغداد'))
    return
  }
  const before = ((await chip.textContent()) || '').trim()
  if (before.includes(name)) {
    find(`header branch already ${name}`)
    return
  }
  await chip.click()
  await page.waitForTimeout(400)
  const search = page.locator('input[placeholder*="بحث"]').first()
  if (await search.isVisible().catch(() => false)) {
    await search.fill(name)
    await page.waitForTimeout(400)
  }
  // Dropdown list items — match partial (UI may truncate labels)
  const short = name.slice(0, 8) // بغداد الر
  const opt = page.locator('button').filter({ hasText: short }).last()
  if (!(await opt.isVisible().catch(() => false))) {
    find(`could not find branch option «${name}»`, false)
    await page.keyboard.press('Escape')
    return
  }
  await opt.click({ timeout: 8000 })
  await page.waitForTimeout(800)
  find(`header branch set → ${name} (was ${before})`)
}

/** Click PremiumSelect trigger that currently shows triggerText (or near label), pick optionText */
async function pickSelectByTriggerText(page, triggerContains, optionText) {
  const trigger = page.locator('button').filter({ hasText: triggerContains }).first()
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click({ timeout: 10000 })
  await page.waitForTimeout(350)
  // Use first visible matching option (last often scrolled out of max-h menu)
  await page.getByRole('button', { name: new RegExp(optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click({ timeout: 10000 })
  await page.waitForTimeout(500)
  find(`select: «${triggerContains.slice(0, 30)}» → «${optionText}»`)
}

async function openTaskMenuAndCollect(page) {
  const taskTrigger = page.locator('button').filter({ hasText: /اختر المهمة المطلوبة/ }).first()
  await taskTrigger.click({ timeout: 8000 })
  await page.waitForTimeout(500)

  const labels = await page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim()
      if (!/د\.ع|أتعاب/.test(t)) continue
      let z = 0
      let el = b
      while (el) {
        const zi = parseInt(getComputedStyle(el).zIndex || '0', 10)
        if (!Number.isNaN(zi) && zi > z) z = zi
        el = el.parentElement
      }
      if (z < 50) continue
      out.push(t.slice(0, 100))
    }
    return [...new Set(out)]
  })
  return labels // leave menu open
}

async function pickFirstTask(page, preferredLabel) {
  const nameRe = preferredLabel
    ? new RegExp(preferredLabel.replace(/[\d,.\s]*د\.ع.*$/u, '').replace(/\d[\d,]*.*$/u, '').trim().slice(0, 16))
    : /إيجاد عنوان المدين|تقديم طلب دعوى|تدوين أقوال/

  // Menu should already be open from collect; reopen if needed
  const open = await page.getByRole('button', { name: nameRe }).first().isVisible().catch(() => false)
  if (!open) {
    await page.locator('button').filter({ hasText: /اختر المهمة المطلوبة/ }).first().click()
    await page.waitForTimeout(500)
  }

  await page.getByRole('button', { name: nameRe }).first().click({ timeout: 8000 })
  await page.waitForTimeout(400)
  find(`picked task via «${nameRe}»`)
  return String(nameRe)
}

async function createDebtor(page, caseOptionLabel, suffix) {
  await page.goto(`${BASE}/admin/debtors/new`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await selectHeaderBranch(page, BRANCH)

  // Case type field
  const caseTrigger = page.locator('button').filter({ hasText: /اختر نوع الدعوى/ }).first()
  const hasCase = await caseTrigger.isVisible().catch(() => false)
  find('case type trigger visible', hasCase)
  if (!hasCase) {
    blockers.push('case type field missing')
    await shot(page, `no-case-${suffix}`)
    return null
  }

  await pickSelectByTriggerText(page, 'اختر نوع الدعوى', caseOptionLabel)
  await page.waitForTimeout(900)

  const taskLabels = await openTaskMenuAndCollect(page)
  find(`${caseOptionLabel} tasks (${taskLabels.length}): ${taskLabels.slice(0, 4).join(' | ')}`, taskLabels.length > 0)
  await shot(page, `tasks-${suffix}`)
  if (!taskLabels.length) {
    blockers.push(`no tasks for ${caseOptionLabel}`)
    return null
  }

  await pickFirstTask(page, taskLabels[0])

  const fullName = `مدين QA UI ${suffix}`
  const receipt = `QA-UI-${suffix}-${Date.now()}`
  await page.locator('input[placeholder="اسم المدين الكامل"]').fill(fullName)

  // رقم الوصل — find label text then input in same FormField
  const receiptFilled = await page.evaluate((rec) => {
    const walk = document.body.innerText
    // Find all labels
    const nodes = [...document.querySelectorAll('label, p, span, div')]
    for (const n of nodes) {
      const t = (n.textContent || '').trim()
      if (t === 'رقم الوصل' || t.startsWith('رقم الوصل')) {
        const wrap = n.closest('div')?.parentElement || n.parentElement
        const input = wrap?.querySelector('input')
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, rec)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }
      }
    }
    return false
  }, receipt)
  if (!receiptFilled) {
    // fallback: third text input in form often
    const inputs = page.locator('form input[type="text"][dir="ltr"]')
    const c = await inputs.count()
    if (c > 0) await inputs.nth(Math.min(1, c - 1)).fill(receipt)
  }
  find(`filled receipt ${receipt}`, receiptFilled)

  await shot(page, `before-submit-${suffix}`)
  const urlBefore = page.url()
  await page.locator('form button[type="submit"]').click()

  // Success usually redirects away from /new
  try {
    await page.waitForFunction(
      () => !window.location.pathname.includes('/debtors/new'),
      { timeout: 20000 },
    )
  } catch {}
  await page.waitForTimeout(800)

  const url = page.url()
  if (!url.includes('/debtors/new')) {
    find(`created ${suffix} debtor → ${url}`)
    created.push({ fullName, receipt, caseOptionLabel, url })
    return { fullName, receipt }
  }

  // Still on form — real validation / API error (not wallet amounts)
  const errText = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.bg-red-50, .border-red-200, [class*="text-red"]')]
    for (const n of nodes) {
      const t = (n.textContent || '').trim()
      if (!t) continue
      if (/د\.ع|رصيد|أتعاب|\d{1,3}(,\d{3})+/.test(t) && t.length < 40) continue
      if (/يجب|خطأ|فشل|مكرر|مطلوب|غير|لا يمكن|صلاحية/.test(t)) return t.slice(0, 160)
    }
    return ''
  })
  if (errText) {
    find(`create ${suffix} failed: ${errText}`, false)
    blockers.push(`create ${suffix}: ${errText}`)
    await shot(page, `err-${suffix}`)
    return null
  }
  find(`create ${suffix} stayed on form (${urlBefore} → ${url})`, false)
  await shot(page, `stuck-${suffix}`)
  blockers.push(`create ${suffix} did not redirect`)
  return null
}

async function main() {
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'msedge' })
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ar-IQ' })
  const page = await context.newPage()
  page.setDefaultTimeout(25000)
  const consoleErrors = []
  page.on('pageerror', e => consoleErrors.push(String(e)))

  try {
    note('=== ACCOUNTANT debtors/new ===')
    await login(page, 'qa_ui_acct')
    await selectHeaderBranch(page, BRANCH)
    await page.goto(`${BASE}/admin/debtors/new`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await shot(page, 'acct-debtors-new')
    const caseVisible = await page.locator('button').filter({ hasText: /اختر نوع الدعوى/ }).first().isVisible()
    find('نوع الدعوى field present', caseVisible)

    // Civil create
    await createDebtor(page, 'دعوى مدنية', 'CIVIL')
    // Criminal create
    await createDebtor(page, 'دعوى جزائية', 'CRIM')

    note('=== LEGAL dashboard + review ===')
    await logout(page)
    await login(page, 'qa_ui_legal')
    await selectHeaderBranch(page, BRANCH)

    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await shot(page, 'legal-dashboard')
    const civilSec = await page.getByText('القضايا المدنية غير المكلفة').isVisible()
    const crimSec = await page.getByText('القضايا الجزائية غير المكلفة').isVisible()
    find('dashboard civil section', civilSec)
    find('dashboard criminal section', crimSec)
    if (!civilSec || !crimSec) blockers.push('dashboard dual sections missing')

    // Unassigned count maybe updated after create
    const body = await page.locator('main').first().innerText().catch(() => '')
    note(`dashboard has QA UI text? ${/مدين QA UI|QA-UI/.test(body)}`)

    await page.goto(`${BASE}/admin/tasks/review`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await shot(page, 'legal-review')
    const reviewOk = await page.getByText(/مراجعة الإنجازات/).first().isVisible()
    find('review page loaded', reviewOk)
    const filterOk = await page.locator('button').filter({ hasText: /كل أنواع الدعاوى|دعوى مدنية|دعوى جزائية/ }).first().isVisible()
    find('review case-type filter', filterOk)

    // Try filter criminal
    try {
      await pickSelectByTriggerText(page, 'كل أنواع الدعاوى', 'دعوى جزائية')
      await page.waitForTimeout(800)
      await shot(page, 'legal-review-criminal-filter')
      find('review filter to criminal applied')
    } catch (e) {
      note(`criminal filter: ${e.message}`)
    }

    note('=== LAWYER tasks ===')
    await logout(page)
    await login(page, 'qa_ui_lawyer')
    await page.goto(`${BASE}/lawyer/tasks`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await shot(page, 'lawyer-tasks')
    find(`lawyer tasks URL ${page.url()}`, page.url().includes('/lawyer/tasks'))
  } catch (e) {
    blockers.push(`fatal: ${e.message}`)
    find(`fatal: ${e.message}`, false)
    try { await shot(page, 'fatal') } catch {}
  }

  // DB verify created debtors
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  let dbDebtors = []
  if (url && key) {
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data } = await admin.from('debtors').select('id, full_name, receipt_number, case_type').ilike('full_name', '%مدين QA UI%')
    dbDebtors = data ?? []
    find(`DB qa debtors: ${dbDebtors.map(d => `${d.case_type}:${d.full_name}`).join(', ') || 'none'}`, dbDebtors.length >= 1)
  }

  const report = {
    finishedAt: new Date().toISOString(),
    findings,
    blockers,
    screenshots,
    created,
    dbDebtors,
    consoleErrors: consoleErrors.slice(0, 30),
  }
  writeFileSync(resolve(__dirname, 'qa-ui-smoke-report.json'), JSON.stringify(report, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify({
    blockers,
    created,
    dbDebtors,
    ok: findings.filter(f => f.ok === true).length,
    fail: findings.filter(f => f.ok === false).length,
  }, null, 2))
  await browser.close()
  if (blockers.length) process.exitCode = 2
}

main().catch(e => { console.error(e); process.exit(1) })
