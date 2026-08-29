/**
 * End-to-end test: sign in as demo lawyer → upload tiny JPEG via JSON API.
 * Usage (from law repo root):
 *   node scripts/test-mobile-upload.mjs
 * Optional env: MOBILE_TEST_USER MOBILE_TEST_PASS MOBILE_TEST_TASK_ID API_BASE
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnv(resolve(process.cwd(), '.env.local'))
loadEnv(resolve(process.cwd(), '.env'))

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const apiBase = (process.env.API_BASE || process.env.NEXT_BASE_URL || 'https://qalatlaw.com').replace(/\/$/, '')
const username = process.env.MOBILE_TEST_USER || 'demo_lawyer_gen'
const password = process.env.MOBILE_TEST_PASS || ''
const taskIdOverride = process.env.MOBILE_TEST_TASK_ID || ''

if (!url || !anon) {
  console.error('Missing SUPABASE url/anon key')
  process.exit(1)
}
if (!password) {
  console.error('Set MOBILE_TEST_PASS to the demo lawyer password')
  process.exit(1)
}

const email = username.includes('@') ? username : `${username}@internal.qalat.local`
const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })

const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64',
)

async function main() {
  console.log('API:', apiBase)
  console.log('Login as', email)
  const { data: sign, error: signErr } = await sb.auth.signInWithPassword({ email, password })
  if (signErr || !sign.session) {
    console.error('LOGIN_FAIL', signErr?.message)
    process.exit(2)
  }
  const token = sign.session.access_token
  const uid = sign.user.id
  console.log('OK user', uid)

  let taskId = taskIdOverride
  if (!taskId) {
    const { data: tasks, error: tErr } = await sb
      .from('tasks')
      .select('id, task_status')
      .eq('assigned_to', uid)
      .in('task_status', ['assigned', 'in_progress', 'assignment_pending_acceptance'])
      .limit(1)
    if (tErr) {
      console.error('TASK_QUERY_FAIL', tErr.message)
      process.exit(3)
    }
    taskId = tasks?.[0]?.id
  }
  if (!taskId) {
    console.error('NO_TASK for lawyer — set MOBILE_TEST_TASK_ID')
    process.exit(4)
  }
  console.log('Using task', taskId)

  const res = await fetch(`${apiBase}/api/lawyer/mobile-upload-task-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      taskId,
      fileName: 'probe.jpg',
      contentType: 'image/jpeg',
      dataBase64: tinyJpeg.toString('base64'),
      access_token: token,
    }),
  })
  const text = await res.text()
  console.log('UPLOAD_STATUS', res.status)
  console.log('UPLOAD_BODY', text)
  if (!res.ok) process.exit(5)
  console.log('SUCCESS')
}

main().catch((e) => {
  console.error(e)
  process.exit(99)
})
