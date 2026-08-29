/**
 * Test Supabase Storage upload path (no Next.js).
 *   set MOBILE_TEST_PASS=...
 *   node scripts/test-supabase-task-upload.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnv(resolve(process.cwd(), '.env.local'))
loadEnv(resolve(process.cwd(), '.env'))

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const username = process.env.MOBILE_TEST_USER || 'demo_lawyer_gen'
const password = process.env.MOBILE_TEST_PASS || ''
if (!url || !anon || !password) {
  console.error('Need NEXT_PUBLIC_SUPABASE_* and MOBILE_TEST_PASS')
  process.exit(1)
}

const email = username.includes('@') ? username : `${username}@internal.qalat.local`
const sb = createClient(url, anon, { auth: { persistSession: false } })

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64',
)

const { data: sign, error: signErr } = await sb.auth.signInWithPassword({ email, password })
if (signErr) {
  console.error('LOGIN', signErr.message)
  process.exit(2)
}
const uid = sign.user.id
console.log('user', uid)

const { data: tasks, error: tErr } = await sb
  .from('tasks')
  .select('id, task_status')
  .eq('assigned_to', uid)
  .in('task_status', ['assigned', 'in_progress'])
  .limit(1)
if (tErr || !tasks?.[0]) {
  console.error('TASK', tErr?.message || 'none')
  process.exit(3)
}
const taskId = tasks[0].id
const path = `${taskId}/probe-${Date.now()}.jpg`
console.log('task', taskId, 'path', path)

const { error: upErr } = await sb.storage.from('task-files').upload(path, jpeg, {
  contentType: 'image/jpeg',
  upsert: true,
})
if (upErr) {
  console.error('STORAGE_UPLOAD_FAIL', upErr.message)
  process.exit(4)
}
console.log('STORAGE_OK')

const { error: dbErr } = await sb.from('task_attachments').insert({
  task_id: taskId,
  file_name: 'probe.jpg',
  file_path: path,
  file_size: jpeg.length,
  mime_type: 'image/jpeg',
  uploaded_by: uid,
})
if (dbErr) {
  console.error('DB_INSERT_FAIL', dbErr.message)
  process.exit(5)
}
console.log('DB_OK SUCCESS')
