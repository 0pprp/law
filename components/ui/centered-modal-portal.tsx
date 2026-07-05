'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  children: ReactNode
  onBackdropClick?: () => void
  zIndex?: number
  ariaLabelledBy?: string
}

/** Modal overlay centered on viewport — rendered via portal to avoid layout clipping */
export default function CenteredModalPortal({
  children,
  onBackdropClick,
  zIndex = 55,
  ariaLabelledBy,
}: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.6)', backdropFilter: 'blur(4px)', zIndex }}
      onClick={e => {
        if (e.target === e.currentTarget) onBackdropClick?.()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </div>,
    document.body,
  )
}
