/**
 * Empty test files from storage buckets (keeps buckets + policies).
 * Run: node --env-file=.env.local scripts/empty-storage-buckets.mjs
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const BUCKETS = ['lawyer-files', 'debtor-files', 'task-files']

async function listAllPaths(bucket, prefix = '') {
  const paths = []
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) {
      paths.push(...(await listAllPaths(bucket, path)))
    } else {
      paths.push(path)
    }
  }
  return paths
}

for (const bucket of BUCKETS) {
  const paths = await listAllPaths(bucket)
  console.log(`${bucket}: ${paths.length} file(s)`)
  if (paths.length === 0) continue

  const batchSize = 100
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize)
    const { error } = await admin.storage.from(bucket).remove(batch)
    if (error) {
      console.error(`Failed deleting from ${bucket}:`, error.message)
      process.exit(1)
    }
  }
  console.log(`  deleted ${paths.length} file(s)`)
}

// Remove empty top-level folders (UUID dirs) if any remain as placeholders
for (const bucket of BUCKETS) {
  const { data: top } = await admin.storage.from(bucket).list('', { limit: 1000 })
  const folders = (top ?? []).filter(x => x.id === null).map(x => x.name)
  if (folders.length) {
    const { error } = await admin.storage.from(bucket).remove(folders)
    if (error) console.warn(`${bucket}: could not remove folder entries:`, error.message)
    else console.log(`${bucket}: removed ${folders.length} top folder(s)`)
  }
}

console.log('Storage cleanup done.')
