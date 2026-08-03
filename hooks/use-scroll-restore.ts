'use client'

import { useCallback, useEffect, useRef } from 'react'

const PREFIX = 'scroll-restore:'

function readY(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (raw == null) return null
    const y = Number(raw)
    return Number.isFinite(y) && y >= 0 ? y : null
  } catch {
    return null
  }
}

function writeY(key: string, y: number): void {
  try {
    sessionStorage.setItem(PREFIX + key, String(Math.max(0, Math.round(y))))
  } catch {
    /* private mode / quota */
  }
}

/**
 * يحفظ موضع التمرير في sessionStorage عند مغادرة الصفحة،
 * ويستعيده عند العودة (browser back) بعد جاهزية المحتوى.
 */
export function useScrollRestore(key: string, options?: { ready?: boolean }) {
  const ready = options?.ready ?? true
  const restoredRef = useRef(false)
  const keyRef = useRef(key)
  keyRef.current = key

  const saveScroll = useCallback(() => {
    if (typeof window === 'undefined') return
    writeY(keyRef.current, window.scrollY)
  }, [])

  const restoreScroll = useCallback(() => {
    if (typeof window === 'undefined') return
    const y = readY(keyRef.current)
    if (y == null) return
    const apply = () => window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior })
    apply()
    requestAnimationFrame(apply)
    setTimeout(apply, 0)
    setTimeout(apply, 50)
    setTimeout(apply, 150)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('scrollRestoration' in history) {
      const prev = history.scrollRestoration
      history.scrollRestoration = 'manual'
      return () => {
        history.scrollRestoration = prev
      }
    }
  }, [])

  // حفظ قبل الانتقال عبر الروابط الداخلية + عند إخفاء الصفحة
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = (e.target as Element | null)?.closest?.('a[href]')
      if (!el) return
      const a = el as HTMLAnchorElement
      if (a.target && a.target !== '_self') return
      if (a.hasAttribute('download')) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      try {
        const url = new URL(a.href, window.location.href)
        if (url.origin !== window.location.origin) return
        if (url.pathname === window.location.pathname && url.search === window.location.search) return
      } catch {
        return
      }
      saveScroll()
    }

    const onPageHide = () => saveScroll()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveScroll()
    }

    document.addEventListener('click', onClickCapture, true)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      saveScroll()
      document.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [saveScroll])

  useEffect(() => {
    restoredRef.current = false
  }, [key])

  useEffect(() => {
    if (!ready || restoredRef.current) return
    if (readY(key) == null) {
      restoredRef.current = true
      return
    }
    restoredRef.current = true
    restoreScroll()
  }, [ready, key, restoreScroll])

  return { saveScroll, restoreScroll }
}
