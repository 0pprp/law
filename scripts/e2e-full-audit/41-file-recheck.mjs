import { sessionFor, serviceClient } from './lib.mjs'
import fs from 'fs'

const state = JSON.parse(fs.readFileSync('scripts/e2e-full-audit/state.json', 'utf8'))
const svc = serviceClient()
const { data: atts } = await svc.from('task_attachments').select('*').eq('task_id', state.hybrid.taskId).order('created_at', { ascending: false }).limit(3)
console.log('attachments:', JSON.stringify(atts, null, 2))

const att = atts?.[0]
if (!att) process.exit(1)

const admin = await sessionFor('admin')
const res = await admin.fetch('/api/admin/task-file-url', {
  method: 'POST',
  body: JSON.stringify({ fileId: att.id, path: att.file_path }),
})
const body = await res.json().catch(() => ({}))
console.log('task-file-url', res.status, body)

const urls = [
  body.url,
  `https://pub-029fa309232c423fbacd7723c644d28f.r2.dev/task-files/${att.file_path}`,
  `https://pub-029fa309232c423fbacd7723c644d28f.r2.dev/${att.file_path}`,
].filter(Boolean)

for (const u of urls) {
  const r = await fetch(u)
  console.log(r.status, u)
}
