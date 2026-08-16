/**
 * In-memory + sessionStorage cache with stale-while-revalidate.
 * Fresh hits return instantly; stale hits paint immediately while a background refresh runs.
 */

interface CacheEntry<T> {
  value: T
  /** Soft TTL — بعد انتهائه ما زال يُعرض كـ stale */
  expiresAt: number
  /** Hard TTL — بعده يُحذف */
  staleUntil: number
}

const store = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

const DEFAULT_TTL_MS = 60_000
/** نافذة الـ stale بعد انتهاء الـ fresh (5 دقائق) */
const DEFAULT_STALE_MS = 5 * 60_000
const SS_PREFIX = 'qalat:qc:v1:'

export const CACHE_TTL = {
  notifications: 45_000,
  list: 60_000,
  /** قائمة مهام المحامي — قصيرة لأن الحالة تتغير بعد قبول/إنجاز */
  lawyerTasks: 30_000,
} as const

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

function readSession<T>(key: string): CacheEntry<T> | null {
  if (!canUseSessionStorage()) return null
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed.expiresAt !== 'number' || typeof parsed.staleUntil !== 'number') {
      sessionStorage.removeItem(SS_PREFIX + key)
      return null
    }
    if (Date.now() > parsed.staleUntil) {
      sessionStorage.removeItem(SS_PREFIX + key)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeSession<T>(key: string, entry: CacheEntry<T>): void {
  if (!canUseSessionStorage()) return
  try {
    sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(entry))
  } catch {
    // quota / private mode — تجاهل
  }
}

function removeSession(key: string): void {
  if (!canUseSessionStorage()) return
  try {
    sessionStorage.removeItem(SS_PREFIX + key)
  } catch {
    // ignore
  }
}

function getEntry<T>(key: string): CacheEntry<T> | null {
  const mem = store.get(key) as CacheEntry<T> | undefined
  if (mem) {
    if (Date.now() > mem.staleUntil) {
      store.delete(key)
      removeSession(key)
      return null
    }
    return mem
  }
  const fromSs = readSession<T>(key)
  if (fromSs) {
    store.set(key, fromSs as CacheEntry<unknown>)
    return fromSs
  }
  return null
}

export type CacheHit<T> = {
  value: T
  /** true = ضمن الـ TTL الطري */
  fresh: boolean
}

/** قراءة مع دعم الـ stale (الافتراضي: fresh فقط — متوافق مع الاستدعاءات القديمة) */
export function cacheGet<T>(key: string, opts?: { allowStale?: boolean }): T | null {
  const hit = cachePeek<T>(key)
  if (!hit) return null
  if (hit.fresh || opts?.allowStale) return hit.value
  return null
}

export function cachePeek<T>(key: string): CacheHit<T> | null {
  const entry = getEntry<T>(key)
  if (!entry) return null
  const now = Date.now()
  if (now > entry.staleUntil) {
    store.delete(key)
    removeSession(key)
    return null
  }
  return { value: entry.value, fresh: now <= entry.expiresAt }
}

export function cacheIsFresh(key: string): boolean {
  return cachePeek(key)?.fresh === true
}

export function cacheSet<T>(
  key: string,
  value: T,
  ttlMs = DEFAULT_TTL_MS,
  staleMs = DEFAULT_STALE_MS,
): void {
  const now = Date.now()
  const entry: CacheEntry<T> = {
    value,
    expiresAt: now + ttlMs,
    staleUntil: now + ttlMs + staleMs,
  }
  store.set(key, entry as CacheEntry<unknown>)
  writeSession(key, entry)
}

export function cacheDelete(key: string): void {
  store.delete(key)
  removeSession(key)
  inflight.delete(key)
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key)
      removeSession(key)
      inflight.delete(key)
    }
  }
  if (canUseSessionStorage()) {
    try {
      const toRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (k?.startsWith(SS_PREFIX + prefix)) toRemove.push(k)
      }
      toRemove.forEach(k => sessionStorage.removeItem(k))
    } catch {
      // ignore
    }
  }
}

export function cacheClear(): void {
  store.clear()
  inflight.clear()
  if (canUseSessionStorage()) {
    try {
      const toRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (k?.startsWith(SS_PREFIX)) toRemove.push(k)
      }
      toRemove.forEach(k => sessionStorage.removeItem(k))
    } catch {
      // ignore
    }
  }
}

/**
 * Stale-while-revalidate helper:
 * - إن وُجدت قيمة (fresh أو stale) تُعاد فوراً
 * - إن كانت stale أو مفقودة يُشغَّل fetcher (مع dedupe)
 * - onUpdate يُستدعى عند وصول بيانات جديدة
 */
export async function cacheSWR<T>(options: {
  key: string
  ttlMs?: number
  staleMs?: number
  fetcher: () => Promise<T>
  /** إن true يتجاهل الكاش ويجلب من جديد */
  force?: boolean
  onUpdate?: (value: T) => void
}): Promise<{ value: T; fromCache: boolean; fresh: boolean }> {
  const { key, fetcher, force = false, onUpdate } = options
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS

  const peek = force ? null : cachePeek<T>(key)
  if (peek?.fresh) {
    return { value: peek.value, fromCache: true, fresh: true }
  }

  const runFetch = async (): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const p = (async () => {
      try {
        const value = await fetcher()
        cacheSet(key, value, ttlMs, staleMs)
        onUpdate?.(value)
        return value
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
    return p
  }

  if (peek && !peek.fresh) {
    // stale: أعِد فوراً وحدّث بالخلفية
    void runFetch().catch(() => {})
    return { value: peek.value, fromCache: true, fresh: false }
  }

  const value = await runFetch()
  return { value, fromCache: false, fresh: true }
}
