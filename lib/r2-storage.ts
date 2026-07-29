/**
 * مكتبة Cloudflare R2 المركزية (S3-compatible).
 * Server-only — لا تستورد من Client Components.
 */
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Url } from '@/lib/r2-url'

export { getR2Url, getR2UrlFor, r2ObjectKey, getR2PublicBase } from '@/lib/r2-url'
export type { R2LegacyBucket } from '@/lib/r2-url'

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`متغير البيئة ناقص: ${name}`)
  return v
}

function getBucket(): string {
  return requireEnv('R2_BUCKET_NAME')
}

let cachedClient: S3Client | null = null

function getR2Client(): S3Client {
  if (cachedClient) return cachedClient
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: requireEnv('R2_ENDPOINT'),
    // الإصدارات الحديثة من AWS SDK تضيف CRC32 لقيمة فارغة عند توقيع PUT بلا Body.
    // هذا يجعل R2 يرفض ملف المتصفح الفعلي ويظهر كخطأ CORS مضلل.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  })
  return cachedClient
}

async function toBuffer(file: Buffer | Blob | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(file)) return file
  if (file instanceof Uint8Array) return Buffer.from(file)
  return Buffer.from(await file.arrayBuffer())
}

/**
 * يرفع الملف إلى R2 ويرجع الـ public URL.
 * @param key مفتاح الكائن داخل الباكت (مثال: task-files/uuid/file.pdf)
 */
export async function uploadToR2(
  file: Buffer | Blob | Uint8Array,
  key: string,
  contentType: string,
): Promise<string> {
  const Body = await toBuffer(file)
  const Key = key.replace(/^\/+/, '')
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key,
      Body,
      ContentType: contentType || 'application/octet-stream',
    }),
  )
  return getR2Url(Key)
}

/** رابط PUT مؤقت يرفع المتصفح من خلاله مباشرة إلى R2، متجاوزاً حد جسم طلب الخادم. */
export async function createR2PresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 15 * 60,
): Promise<string> {
  const Key = key.replace(/^\/+/, '')
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: getBucket(),
      Key,
      ContentType: contentType || 'application/octet-stream',
    }),
    { expiresIn },
  )
}

/** التحقق من وصول الملف إلى R2 قبل حفظ مساره في قاعدة البيانات. */
export async function getR2ObjectMetadata(
  key: string,
): Promise<{ size: number; contentType: string | null } | null> {
  const Key = key.replace(/^\/+/, '')
  try {
    const result = await getR2Client().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key }),
    )
    return {
      size: Number(result.ContentLength ?? 0),
      contentType: result.ContentType ?? null,
    }
  } catch {
    return null
  }
}

/** يتحقق من توقيع PDF (%PDF) دون تنزيل الملف كاملاً. */
export async function isR2PdfObject(key: string): Promise<boolean> {
  const Key = key.replace(/^\/+/, '')
  try {
    const result = await getR2Client().send(
      new GetObjectCommand({
        Bucket: getBucket(),
        Key,
        Range: 'bytes=0-3',
      }),
    )
    if (!result.Body) return false
    const bytes = await result.Body.transformToByteArray()
    return (
      bytes.length >= 4
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46
    )
  } catch {
    return false
  }
}

/** يحذف ملف واحد من R2 */
export async function deleteFromR2(key: string): Promise<void> {
  const Key = key.replace(/^\/+/, '')
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key,
    }),
  )
}

/** حذف عدة مفاتيح دفعة واحدة */
export async function deleteManyFromR2(keys: string[]): Promise<void> {
  const Objects = keys
    .map(k => k.replace(/^\/+/, ''))
    .filter(Boolean)
    .map(Key => ({ Key }))
  if (!Objects.length) return

  for (let i = 0; i < Objects.length; i += 1000) {
    const chunk = Objects.slice(i, i + 1000)
    await getR2Client().send(
      new DeleteObjectsCommand({
        Bucket: getBucket(),
        Delete: { Objects: chunk, Quiet: true },
      }),
    )
  }
}

/** يطبّق CORS Policy على باكت R2 (شغّله مرة عند الإعداد) */
export async function applyR2CorsPolicy(): Promise<void> {
  await getR2Client().send(
    new PutBucketCorsCommand({
      Bucket: getBucket(),
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [
              'https://qalatlaw.com',
              'https://www.qalatlaw.com',
              'http://localhost:3000',
            ],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  )
}
