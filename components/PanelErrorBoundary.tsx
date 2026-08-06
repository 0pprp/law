'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

/** يمنع انهيار صفحة كاملة إذا فشل مكون فرعي (مثلاً محفظة القرطاسية). */
export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'خطأ غير متوقع' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PanelErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
          تعذّر تحميل هذا القسم: {this.state.message}
        </div>
      )
    }
    return this.props.children
  }
}
