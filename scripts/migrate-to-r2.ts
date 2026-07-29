/**
 * نقل ملفات Supabase Storage → Cloudflare R2 (يكمل الناقص فقط — لا يكرر الموجود).
 * لا يحذف من Supabase.
 *
 * تشغيل:
 *   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts
 *   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts --apply-cors
 */
import { createClient } from '@supabase/supabase-js'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3'

const BUCKETS = ['task-files', 'debtor-files', 'lawyer-files'] as const
type Bucket = (typeof BUCKETS)[number]

const dryRun = process.argv.includes('--dry-run')
const applyCors = process.argv.includes('--apply-cors')
const LIST_CONCURRENCY = 12
const COPY_CONCURRENCY = 8

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const r2Endpoint = process.env.R2_ENDPOINT
const r2Access = process.env.R2_ACCESS_KEY_ID
const r2Secret = process.env.R2_SECRET_ACCESS_KEY
const r2Bucket = process.env.R2_BUCKET_NAME
const r2Public = (process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '').replace(/\/$/, '')

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!r2Endpoint || !r2Access || !r2Secret || !r2Bucket || !r2Public) {
  console.error('Missing R2_* env vars')
  process.exit(1)
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
const r2 = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  credentials: { accessKeyId: r2Access, secretAccessKey: r2Secret },
})

type ListedFile = { name: string; metadata?: { mimetype?: string } }

function r2Key(bucket: Bucket, path: string): string {
  return `${bucket}/${path.replace(/^\/+/, '')}`
}

function publicUrl(key: string): string {
  return `${r2Public}/${key.replace(/^\/+/, '')}`
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => run()))
  return results
}

async function listPrefixPage(bucket: Bucket, prefix: string, offset: number, limit: number) {
  const { data, error } = await sb.storage.from(bucket).list(prefix, {
    limit,
    offset,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
  return data ?? []
}

/** سرد متوازي لكل المجلدات داخل الباكت */
async function listAll(bucket: Bucket): Promise<ListedFile[]> {
  const files: ListedFile[] = []
  const folderQueue: string[] = ['']
  let listedFolders = 0

  while (folderQueue.length) {
    const batch = folderQueue.splice(0, LIST_CONCURRENCY)
    const pages = await Promise.all(
      batch.map(async (prefix) => {
        const items: { name: string; id?: string; metadata?: { mimetype?: string } }[] = []
        let offset = 0
        const limit = 1000
        for (;;) {
          const page = await listPrefixPage(bucket, prefix, offset, limit)
          items.push(...page)
          if (page.length < limit) break
          offset += limit
        }
        return { prefix, items }
      }),
    )

    for (const { prefix, items } of pages) {
      listedFolders++
      for (const item of items) {
        if (!item.name || item.name === '.emptyFolderPlaceholder') continue
        const full = prefix ? `${prefix}/${item.name}` : item.name
        // مجلدات غالباً بلا id
        if (!item.id) {
          folderQueue.push(full)
        } else {
          files.push({
            name: full,
            metadata: item.metadata as { mimetype?: string } | undefined,
          })
        }
      }
    }

    if (listedFolders % 50 === 0 || folderQueue.length === 0) {
      console.log(`  list ${bucket}: folders=${listedFolders} files=${files.length} queue=${folderQueue.length}`)
    }
  }

  return files
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }))
    return true
  } catch {
    return false
  }
}

async function copyOne(bucket: Bucket, path: string, contentType?: string): Promise<'ok' | 'skip' | 'fail'> {
  const key = r2Key(bucket, path)
  if (await objectExists(key)) return 'skip'
  if (dryRun) return 'ok'

  const { data, error } = await sb.storage.from(bucket).download(path)
  if (error || !data) {
    console.error(`  download fail ${bucket}/${path}: ${error?.message}`)
    return 'fail'
  }
  const bytes = Buffer.from(await data.arrayBuffer())
  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType || data.type || 'application/octet-stream',
      }),
    )
    return 'ok'
  } catch (e) {
    console.error(`  upload fail ${key}:`, e instanceof Error ? e.message : e)
    return 'fail'
  }
}

/** استبدال روابط Supabase العامة المخزّنة كنص في بعض الأعمدة (إن وُجدت) */
async function rewriteStoredUrls(): Promise<{ scanned: number; updated: number }> {
  let scanned = 0
  let updated = 0
  const supabaseHost = new URL(url!).host
  for (const table of ['debtor_attachments', 'task_attachments', 'lawyer_attachments'] as const) {
    const { data, error } = await sb
      .from(table)
      .select('id, file_path')
      .like('file_path', `%${supabaseHost}%`)
      .limit(5000)
    if (error) {
      console.warn(`  URL scan ${table}.file_path: ${error.message}`)
      continue
    }
    for (const row of data ?? []) {
      scanned++
      const raw = String(row.file_path ?? '')
      if (!raw.includes(supabaseHost)) continue
      const m = raw.match(/\/storage\/v1\/object\/(?:public|sign)\/(task-files|debtor-files|lawyer-files)\/([^?]+)/)
      if (!m) continue
      const next = publicUrl(`${m[1]}/${decodeURIComponent(m[2])}`)
      if (dryRun) {
        updated++
        continue
      }
      const { error: upErr } = await sb.from(table).update({ file_path: next }).eq('id', row.id)
      if (upErr) console.error(`  update ${table} ${row.id}: ${upErr.message}`)
      else updated++
    }
  }

  const { data: details } = await sb
    .from('criminal_debtor_details')
    .select('debtor_id, documents_contract_file_path, petition_file_path')
    .limit(10000)
  for (const row of details ?? []) {
    for (const col of ['documents_contract_file_path', 'petition_file_path'] as const) {
      const raw = String(row[col] ?? '')
      if (!raw.includes(supabaseHost)) continue
      scanned++
      const m = raw.match(/\/storage\/v1\/object\/(?:public|sign)\/debtor-files\/([^?]+)/)
      if (!m) continue
      const next = publicUrl(`debtor-files/${decodeURIComponent(m[1])}`)
      if (!dryRun) {
        await sb.from('criminal_debtor_details').update({ [col]: next }).eq('debtor_id', row.debtor_id)
      }
      updated++
    }
  }

  return { scanned, updated }
}

async function main() {
  console.log(`\n=== migrate-to-r2 ${dryRun ? '(DRY RUN)' : ''} ===\n`)
  console.log(`R2 bucket: ${r2Bucket}`)
  console.log(`Public: ${r2Public}`)
  console.log(`Concurrency: list=${LIST_CONCURRENCY} copy=${COPY_CONCURRENCY}\n`)

  if (applyCors) {
    console.log('Applying CORS...')
    if (!dryRun) {
      await r2.send(
        new PutBucketCorsCommand({
          Bucket: r2Bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['https://qalatlaw.com', 'http://localhost:3000'],
                AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE'],
                AllowedHeaders: ['*'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      )
    }
    console.log('CORS OK\n')
  }

  let total = 0
  let ok = 0
  let skip = 0
  let fail = 0

  for (const bucket of BUCKETS) {
    console.log(`Listing ${bucket}...`)
    const files = await listAll(bucket)
    console.log(`  ${files.length} files — copying missing only...\n`)

    await mapPool(files, COPY_CONCURRENCY, async (f) => {
      const result = await copyOne(bucket, f.name, f.metadata?.mimetype)
      total++
      if (result === 'ok') ok++
      else if (result === 'skip') skip++
      else fail++
      if (total % 50 === 0) {
        console.log(`  progress ${total}/${files.length} across buckets (ok=${ok} skip=${skip} fail=${fail})`)
      }
      return result
    })
  }

  console.log('\nRewriting stored Supabase URLs in DB (if any)...')
  const urlReport = await rewriteStoredUrls()

  console.log('\n========== REPORT ==========')
  console.log(`Files seen:     ${total}`)
  console.log(`Uploaded/OK:    ${ok}`)
  console.log(`Skipped exist:  ${skip}`)
  console.log(`Failed:         ${fail}`)
  console.log(`URL rows scanned: ${urlReport.scanned}`)
  console.log(`URL rows updated: ${urlReport.updated}`)
  console.log('Supabase Storage NOT deleted (by design).')
  console.log('============================\n')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
