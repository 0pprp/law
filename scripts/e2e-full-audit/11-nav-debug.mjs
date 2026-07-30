/** Debug login redirect for failing roles. */
import { chromium } from 'playwright'
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const PASSWORD = 'TestPass123!'
const targets = process.argv.slice(2)

const browser = await chromium.launch({ headless: true })
for (const email of targets) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  page.on('console', m => console.log(`   [console:${m.type()}]`, m.text().slice(0, 300)))
  page.on('pageerror', e => console.log('   [pageerror]', String(e).slice(0, 300)))
  page.on('response', async r => {
    if (r.url().includes('/api/auth/login')) {
      let body = ''
      try { body = (await r.text()).slice(0, 300) } catch {}
      console.log(`   [login api] ${r.status()} ${body}`)
    }
  })
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('   [nav]', f.url()) })

  console.log(`\n=== ${email} ===`)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[autocomplete="username"]', email)
  await page.fill('input[autocomplete="current-password"]', PASSWORD)
  page.on('request', r => { if (r.url().includes('/api/')) console.log('   [req]', r.method(), r.url()) })
  console.log('   values:', await page.inputValue('input[autocomplete="username"]'), '/', (await page.inputValue('input[autocomplete="current-password"]')).length)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(45000)
  console.log('   final url:', page.url())
  const err = await page.$eval('.text-red-600', el => el.textContent).catch(() => null)
  if (err) console.log('   form error:', err)
  const links = await page.$$eval('nav a[href^="/admin/"]', els => [...new Set(els.map(e => e.getAttribute('href')))]).catch(() => [])
  console.log('   nav links:', links.join(' ') || '(none)')
  await ctx.close()
}
await browser.close()
