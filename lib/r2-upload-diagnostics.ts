const REQUIRED_R2_ENV = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET_NAME',
] as const

export function missingR2EnvironmentVariables(): string[] {
  return REQUIRED_R2_ENV.filter(name => !process.env[name]?.trim())
}

export function describeR2UploadError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { value: typeof error === 'string' ? error : JSON.stringify(error) }
  }

  const detail = error as Error & {
    name?: string
    code?: string
    $metadata?: {
      httpStatusCode?: number
      requestId?: string
      extendedRequestId?: string
      attempts?: number
    }
  }

  return {
    name: detail.name,
    message: detail.message,
    code: detail.code,
    httpStatusCode: detail.$metadata?.httpStatusCode,
    requestId: detail.$metadata?.requestId,
    extendedRequestId: detail.$metadata?.extendedRequestId,
    attempts: detail.$metadata?.attempts,
    stack: detail.stack,
  }
}

export function logR2UploadError(
  label: string,
  error: unknown,
  context: Record<string, unknown>,
): void {
  console.error(`[${label}] R2 upload failed`, {
    ...context,
    missingEnvironmentVariables: missingR2EnvironmentVariables(),
    error: describeR2UploadError(error),
  })
}

export function r2UploadClientMessage(error: unknown): string {
  const missing = missingR2EnvironmentVariables()
  if (missing.length) {
    return `إعدادات تخزين R2 ناقصة في الخادم: ${missing.join(', ')}`
  }

  const detail = describeR2UploadError(error)
  const code = String(detail.code ?? detail.name ?? '').trim()
  const status = Number(detail.httpStatusCode)
  if (status === 401 || status === 403 || /AccessDenied|InvalidAccessKeyId|Signature/i.test(code)) {
    return 'رفض R2 بيانات الدخول أو التوقيع. تحقق من مفاتيح R2 وR2_ENDPOINT.'
  }
  if (status === 404 || /NoSuchBucket/i.test(code)) {
    return 'باكت R2 أو عنوان R2_ENDPOINT غير صحيح.'
  }
  if (/fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(detail.message ?? ''))) {
    return 'تعذر الاتصال بخدمة R2 من الخادم.'
  }
  return `فشل رفع الملف إلى R2${code ? ` (${code})` : ''}`
}
