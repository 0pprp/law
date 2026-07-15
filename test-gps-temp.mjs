import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const TASK_ID = 'ce42db0f-20c2-4c02-9a66-43d12711981e'
const TASK_URL = `http://localhost:3000/lawyer/tasks/${TASK_ID}`
const TEST_USER = 'test.lawyer@test.local'
const SHOTS = 'C:/Users/Marvel/AppData/Local/Temp/claude/c--GitHub-qalat-aldhaman-law/2ab40571-429f-4b07-9736-9fea2a9c28e3/scratchpad'

const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`)

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
})

// Context 1: GPS allowed + mock coordinates (Baghdad)
const context = await browser.newContext({
  permissions: ['geolocation'],
  geolocation: { latitude: 33.3152, longitude: 44.3661 },
  locale: 'ar-IQ',
})
const page = await context.newPage()
const results = []

// Capture console errors/logs
const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message))

// ── Step 1: Login ─────────────────────────────────────────────────────────────
log('Step 1: Login')
await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.screenshot({ path: `${SHOTS}/01-login-page.png` })

// Login page uses type="text" for username
await page.fill('input[type="text"]', TEST_USER)
await page.fill('input[type="password"]', 'TestPass123!')
await page.screenshot({ path: `${SHOTS}/02-login-filled.png` })

// Click submit and wait for navigation away from /login
await Promise.all([
  page.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => {}),
  page.click('button[type="submit"]'),
])
await page.waitForTimeout(2000)
await page.screenshot({ path: `${SHOTS}/03-after-login.png` })

const urlAfterLogin = page.url()
log(`After login URL: ${urlAfterLogin}`)
results.push({ step: 'S1_login', url: urlAfterLogin, ok: !urlAfterLogin.includes('/login') })

if (urlAfterLogin.includes('/login')) {
  // Check if error message is shown
  const errorText = await page.locator('.bg-red-50').textContent().catch(() => null)
  log(`Login error: ${errorText}`)
  results.push({ step: 'login_error', error: errorText })
}

// ── Step 2: Navigate directly to delegate task ────────────────────────────────
log('Step 2: Navigate to delegate task page')
await page.goto(TASK_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${SHOTS}/04-task-page.png` })

const taskPageUrl = page.url()
log(`Task page URL: ${taskPageUrl}`)
const h1Text = await page.locator('h1').first().textContent().catch(() => null)
const allTextOnPage = await page.locator('body').textContent().catch(() => '')
log(`H1: ${h1Text}`)
log(`Page has delegate task content: ${allTextOnPage?.includes('المهمة') || allTextOnPage?.includes('المدين')}`)
results.push({ step: 'S1_task_page', url: taskPageUrl, h1: h1Text, redirectedToLogin: taskPageUrl.includes('/login') })

// If redirected to login — session didn't survive. Report and bail.
if (taskPageUrl.includes('/login')) {
  log('ERROR: Redirected to login — session not persisting. Reporting and exiting.')
  await browser.close()
  console.log('\n======= RESULTS =======')
  for (const r of results) console.log(JSON.stringify(r))
  writeFileSync(`${SHOTS}/test-results.json`, JSON.stringify(results, null, 2))
  process.exit(0)
}

// ── Step 3: Find "تم الإنجاز" button ─────────────────────────────────────────
log('Step 3: Look for "تم الإنجاز" button')
const allBtns = await page.locator('button').allTextContents()
log('Buttons on task page: ' + allBtns.map(b => b.trim()).filter(Boolean).join(' | '))

const completeBtn = page.locator('button', { hasText: 'تم الإنجاز' }).first()
const completeBtnVisible = await completeBtn.isVisible().catch(() => false)
log(`Complete button visible: ${completeBtnVisible}`)
results.push({ step: 'S1_complete_btn', visible: completeBtnVisible, allButtons: allBtns.map(b => b.trim()).filter(Boolean) })

if (completeBtnVisible) {
  await completeBtn.click()
  // Wait for "جارٍ التحقق..." to disappear (means handleCompleteClick finished)
  await page.waitForFunction(
    () => !document.body.innerText.includes('جارٍ التحقق'),
    { timeout: 10000 }
  ).catch(() => log('WARNING: still showing جارٍ التحقق after 10s'))
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/05-after-complete-click.png` })
  const btnsAfterCheck = await page.locator('button').allTextContents()
  log('Buttons after complete handler: ' + btnsAfterCheck.map(b => b.trim()).filter(Boolean).join(' | '))
}

// ── Step 4: Handle expense modal if it appears ────────────────────────────────
await page.waitForTimeout(300)
const skipBtn = page.locator('button', { hasText: 'تخطي' }).first()
const hasSkip = await skipBtn.isVisible().catch(() => false)
if (hasSkip) {
  log('Expense modal — clicking تخطي')
  await skipBtn.click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SHOTS}/06-after-skip.png` })
}
const continueBtn = page.locator('button', { hasText: 'متابعة' }).first()
const hasContinue = await continueBtn.isVisible().catch(() => false)
if (hasContinue) {
  log('Clicking متابعة')
  await continueBtn.click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SHOTS}/06b-after-continue.png` })
}

// ── Step 5: GPS field check ───────────────────────────────────────────────────
log('Step 5: Check GPS button in modal')
await page.waitForTimeout(500)

// Capture the full modal text content for debugging
const modalText = await page.locator('body').textContent().catch(() => '')
const hasAmberBox = modalText.includes('الحقول الإلزامية')
log(`Modal has الحقول الإلزامية box: ${hasAmberBox}`)
log(`Modal text excerpt: ${modalText.slice(0, 500)}`)

// Try to check supabase access from within browser
const dbCheck = await page.evaluate(async () => {
  try {
    const { createClient } = await import('/node_modules/@supabase/supabase-js/dist/module/index.js')
    return 'import available'
  } catch(e) {
    return 'import failed: ' + e.message
  }
}).catch(e => 'evaluate failed: ' + e.message)
log('DB check: ' + dbCheck)

// Check if there's an amber required fields box (only shows when reqFields.length > 0)
if (!hasAmberBox) {
  log('WARNING: No required fields box — reqFields is empty (RLS or query issue?)')
}

const btnsInModal = await page.locator('button').allTextContents()
log('Buttons after modal open: ' + btnsInModal.map(b => b.trim()).filter(Boolean).join(' | '))

const gpsBtn = page.locator('button', { hasText: 'تحديد الموقع' }).first()
const gpsBtnVisible = await gpsBtn.isVisible().catch(() => false)
const hasOldInput = await page.locator('input[placeholder*="33"]').isVisible().catch(() => false)
log(`GPS button visible: ${gpsBtnVisible}, Old input present: ${hasOldInput}`)
await page.screenshot({ path: `${SHOTS}/07-before-gps-click.png` })

results.push({
  step: 'S1_gps_ui',
  gpsButtonVisible: gpsBtnVisible,
  oldTextInputGone: !hasOldInput,
  pass: gpsBtnVisible && !hasOldInput,
})

// ── Step 6: S2 — Click GPS button (mock location auto-resolves) ───────────────
if (gpsBtnVisible) {
  log('Step 6: Clicking GPS button (S2)')
  await gpsBtn.click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${SHOTS}/08-gps-loading.png` })

  const spinnerVisible = await page.locator('button', { hasText: 'جارٍ تحديد الموقع' }).isVisible().catch(() => false)
  log(`S2 — Spinner visible: ${spinnerVisible}`)
  results.push({ step: 'S2_loading', spinnerVisible })

  // Wait for geolocation mock to resolve
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${SHOTS}/09-gps-confirmed.png` })

  const confirmedVisible = await page.locator('button', { hasText: 'تم التحديد' }).isVisible().catch(() => false)
  // GPS coords appear in a <p> with font-mono class below the button
  const coordsEl = await page.locator('p.font-mono').first().textContent().catch(() => null)
  log(`S2 — Green confirmed button: ${confirmedVisible}, Coords: ${coordsEl}`)
  results.push({ step: 'S2_confirmed', buttonGreen: confirmedVisible, coordinates: coordsEl, pass: confirmedVisible && (coordsEl?.includes(',') ?? false) })

  // ── Step 7: S3 — Submit button enabled after GPS confirmed ────────────────
  log('Step 7: S3 — Submit button state')
  const submitBtn = page.locator('button', { hasText: 'إرسال للاعتماد' }).first()
  const isDisabled = await submitBtn.isDisabled().catch(() => true)
  const isVisible = await submitBtn.isVisible().catch(() => false)
  log(`S3 — Submit button: visible=${isVisible}, disabled=${isDisabled}`)
  results.push({ step: 'S3_submit', submitVisible: isVisible, submitDisabled: isDisabled, pass: isVisible && !isDisabled })
} else {
  log('GPS button not found — capturing all modal buttons')
  const allModalBtns = await page.locator('button').allTextContents()
  log('All buttons: ' + allModalBtns.map(b => b.trim()).filter(Boolean).join(' | '))
  results.push({ step: 'S2_gps_not_found', allButtons: allModalBtns.map(b => b.trim()).filter(Boolean) })
}

// ── S3 before GPS — try submitting without GPS first ─────────────────────────
// (We need a fresh modal for this. Open in new page)
log('S3 pre-GPS test: fresh modal to test submit disabled before GPS')
await page.goto(TASK_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const freshCompleteBtn = page.locator('button', { hasText: 'تم الإنجاز' }).first()
if (await freshCompleteBtn.isVisible().catch(() => false)) {
  await freshCompleteBtn.click()
  await page.waitForFunction(() => !document.body.innerText.includes('جارٍ التحقق'), { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(800)
  const freshSkip = page.locator('button', { hasText: 'تخطي' }).first()
  if (await freshSkip.isVisible().catch(() => false)) { await freshSkip.click(); await page.waitForTimeout(1000) }
  const freshContinue = page.locator('button', { hasText: 'متابعة' }).first()
  if (await freshContinue.isVisible().catch(() => false)) { await freshContinue.click(); await page.waitForTimeout(1000) }
  // Wait for the modal to open
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)

  // S3: Click submit WITHOUT setting GPS — should show validation error
  // Use last() because first() matches the outer button behind the modal
  const submitBeforeGps = page.locator('[role="dialog"] button, [aria-modal] button').filter({ hasText: 'إرسال للاعتماد' }).first()
  await submitBeforeGps.click({ force: true })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/10-submit-before-gps.png` })
  // Check for validation error about GPS
  const validationErr = await page.locator('.bg-red-50').first().textContent().catch(() => null)
  log(`S3 — Validation error when submit without GPS: "${validationErr}"`)
  results.push({ step: 'S3_before_gps', validationError: validationErr, pass: !!validationErr })
}

// ── Step 8: S4 — GPS denial (new context, no geolocation permission) ──────────
log('Step 8: S4 — GPS denial test')
const ctx2 = await browser.newContext({ permissions: [] /* no geolocation */ })
const page2 = await ctx2.newPage()
await page2.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
await page2.waitForTimeout(1000)

try {
  await page2.fill('input[type="text"]', TEST_USER)
  await page2.fill('input[type="password"]', 'TestPass123!')
  await page2.click('button[type="submit"]')
  // Don't wait for redirect — just wait a bit for the session cookie to be set
  await page2.waitForTimeout(3000)
  // Navigate directly (same pattern that works for page1)
  await page2.goto(TASK_URL, { waitUntil: 'domcontentloaded' })
  await page2.waitForTimeout(3000)

  const p2url = page2.url()
  log(`S4 page2 task URL: ${p2url}`)
  const cb2 = page2.locator('button', { hasText: 'تم الإنجاز' }).first()
  if (await cb2.isVisible().catch(() => false)) {
    await cb2.click()
    await page2.waitForFunction(() => !document.body.innerText.includes('جارٍ التحقق'), { timeout: 10000 }).catch(() => {})
    await page2.waitForTimeout(800)
    const sk2 = page2.locator('button', { hasText: 'تخطي' }).first()
    if (await sk2.isVisible().catch(() => false)) { await sk2.click(); await page2.waitForTimeout(1000) }
    const ct2 = page2.locator('button', { hasText: 'متابعة' }).first()
    if (await ct2.isVisible().catch(() => false)) { await ct2.click(); await page2.waitForTimeout(1000) }

    const gpsBtn2 = page2.locator('button', { hasText: 'تحديد الموقع' }).first()
    if (await gpsBtn2.isVisible().catch(() => false)) {
      await gpsBtn2.click()
      await page2.waitForTimeout(4000)
      await page2.screenshot({ path: `${SHOTS}/11-gps-denied-error.png` })

      const errorEl = await page2.locator('.bg-red-50, [class*="red-50"]').first().textContent().catch(() => null)
      const stillDefault = await page2.locator('button', { hasText: 'تحديد الموقع' }).isVisible().catch(() => false)
      log(`S4 — Error: ${errorEl}, Button reset: ${stillDefault}`)
      results.push({ step: 'S4_denied', errorShown: !!errorEl, errorText: errorEl, buttonReset: stillDefault, pass: !!errorEl && stillDefault })
    } else {
      log('S4 — GPS button not visible in no-permission context')
      results.push({ step: 'S4_denied', note: 'GPS button not visible' })
    }
  } else {
    log('S4 — Complete button not found in page2')
    results.push({ step: 'S4_denied', note: 'Complete button not found' })
  }
} catch (e) {
  log('S4 error: ' + e.message)
  results.push({ step: 'S4_denied', error: e.message })
}
await ctx2.close()

await page.screenshot({ path: `${SHOTS}/12-final-state.png` })
await browser.close()

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n======= RESULTS =======')
for (const r of results) console.log(JSON.stringify(r))
writeFileSync(`${SHOTS}/test-results.json`, JSON.stringify(results, null, 2))
console.log(`\nDone. Screenshots: ${SHOTS}`)
