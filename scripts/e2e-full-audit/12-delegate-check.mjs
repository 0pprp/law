import { AppSession, ACCOUNTS } from './lib.mjs'
const s = new AppSession()
try {
  const r = await s.login(ACCOUNTS.delegate)
  console.log('delegate HTTP login OK:', JSON.stringify(r))
  const res = await s.fetch('/delegate')
  console.log('/delegate status', res.status, 'location', res.headers.get('location'))
} catch (e) {
  console.log('delegate HTTP login FAILED:', e.message)
}
