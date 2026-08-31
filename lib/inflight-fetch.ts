const inflight = new Map<string, Promise<Response>>()

/** GET واحد لنفس العنوان — يمنع تكرار Strict Mode والتنقّل السريع. */
export function fetchDeduped(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method !== 'GET') return fetch(url, init)

  const existing = inflight.get(url)
  if (existing) return existing.then(res => res.clone())

  const pending = fetch(url, init).finally(() => {
    inflight.delete(url)
  })
  inflight.set(url, pending)
  return pending.then(res => res.clone())
}
