import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

const key = `diagnostics/upload-${Date.now()}.pdf`
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

try {
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: Buffer.from('%PDF-1.4\n%%EOF'),
    ContentType: 'application/pdf',
  }))
  const metadata = await client.send(new HeadObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  }))
  console.log(JSON.stringify({
    ok: true,
    key,
    size: metadata.ContentLength,
    contentType: metadata.ContentType,
  }))
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  }))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name,
    message: error?.message,
    code: error?.Code,
    httpStatus: error?.$metadata?.httpStatusCode,
    requestId: error?.$metadata?.requestId,
  }))
  process.exit(1)
}
