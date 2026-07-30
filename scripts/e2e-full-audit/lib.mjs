import { createClient } from '@supabase/supabase-js'

export const BASE = process.env.BASE_URL || 'http://localhost:3000'
export const PASSWORD = 'TestPass123!'
export const BRANCH_ID = '726654de-9037-471a-bb3e-353e8fb5065b' // بغداد الرصافة
export const BRANCH_LIST_ID = '1f337c5b-b8b5-4cc8-94da-d48bacb1b3bc' // شيخ عمر الاولى

export const ACCOUNTS = {
  admin: 'test.admin@test.local',
  viewer: 'test.viewer@test.local',
  criminal_legal_manager: 'test.criminal_legal_manager@test.local',
  accountant: 'test.accountant@test.local',
  delegate: 'test.delegate@test.local',
  lawyer: 'test.lawyer@test.local',
}

export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

export async function roleClient(email) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`signIn ${email}: ${error.message}`)
  return sb
}

/** Cookie-jar HTTP session against the Next.js app (same auth path as the browser). */
export class AppSession {
  constructor() { this.jar = new Map() }

  cookieHeader() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const raw of list) {
      const [pair] = raw.split(';')
      const idx = pair.indexOf('=')
      if (idx < 0) continue
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (value === '' || /Max-Age=0/i.test(raw)) this.jar.delete(name)
      else this.jar.set(name, value)
    }
  }

  async fetch(pathOrUrl, opts = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`
    const headers = { ...(opts.headers ?? {}) }
    const cookie = this.cookieHeader()
    if (cookie) headers.cookie = cookie
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
    const isBuf = Buffer.isBuffer(opts.body)
    if (opts.body && !headers['Content-Type'] && !isForm && !isBuf) {
      headers['Content-Type'] = 'application/json'
    }
    const res = await fetch(url, { ...opts, headers, redirect: 'manual' })
    this.absorb(res)
    return res
  }

  async login(email) {
    const res = await this.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: email, password: PASSWORD }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`login ${email} -> ${res.status} ${JSON.stringify(json)}`)
    return json
  }
}

export async function sessionFor(role) {
  const s = new AppSession()
  await s.login(ACCOUNTS[role])
  return s
}

export function mark(ok) { return ok ? '✅' : '❌' }
