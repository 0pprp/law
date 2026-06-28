/** In-memory TTL cache for branch-scoped client fetches (stale-while-revalidate). */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

const DEFAULT_TTL_MS = 60_000

export const CACHE_TTL = {
  dashboard: 60_000,
  notifications: 45_000,
  list: 60_000,
} as const

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function cacheDelete(key: string): void {
  store.delete(key)
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export function cacheClear(): void {
  store.clear()
}
