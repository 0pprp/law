import { NextResponse } from 'next/server'

/** رسائل عامة للمستخدم — التفاصيل تُسجَّل في السيرفر فقط */
export function apiServerError(
  logLabel: string,
  err: unknown,
  clientMessage = 'حدث خطأ في الخادم',
  status = 500,
) {
  const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
  console.error(`[${logLabel}]`, detail)
  return NextResponse.json({ error: clientMessage }, { status })
}

export function safeClientError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}
