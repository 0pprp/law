'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'

export type AppConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export type AppAlertOptions = {
  title?: string
  message: string
  okLabel?: string
  variant?: 'info' | 'success' | 'warning' | 'error'
}

type ConfirmRequest = AppConfirmOptions & { kind: 'confirm' }
type AlertRequest = AppAlertOptions & { kind: 'alert' }
type DialogRequest = ConfirmRequest | AlertRequest

type Resolver = {
  resolve: (value: boolean | void) => void
}

let pushDialog: ((req: DialogRequest, resolver: Resolver) => void) | null = null

function normalizeConfirm(input: string | AppConfirmOptions): AppConfirmOptions {
  return typeof input === 'string' ? { message: input } : input
}

function normalizeAlert(input: string | AppAlertOptions): AppAlertOptions {
  return typeof input === 'string' ? { message: input } : input
}

/** تأكيد — يُرجع true عند الموافقة */
export function appConfirm(input: string | AppConfirmOptions): Promise<boolean> {
  const options = normalizeConfirm(input)
  return new Promise(resolve => {
    if (!pushDialog) {
      resolve(window.confirm(options.message))
      return
    }
    pushDialog({ kind: 'confirm', ...options }, { resolve: v => resolve(!!v) })
  })
}

/** تنبيه — زر موافق واحد */
export function appAlert(input: string | AppAlertOptions): Promise<void> {
  const options = normalizeAlert(input)
  return new Promise(resolve => {
    if (!pushDialog) {
      window.alert(options.message)
      resolve()
      return
    }
    pushDialog({ kind: 'alert', ...options }, { resolve: () => resolve() })
  })
}

const AppDialogContext = createContext({
  confirm: appConfirm,
  alert: appAlert,
})

export function useAppDialog() {
  return useContext(AppDialogContext)
}

function DialogIcon({ variant }: { variant: 'confirm' | 'danger' | AppAlertOptions['variant'] }) {
  const isDanger = variant === 'danger' || variant === 'error'
  const isWarning = variant === 'warning'
  const bg = isDanger ? 'bg-red-100 text-red-600' : isWarning ? 'bg-amber-100 text-amber-700' : variant === 'success' ? 'bg-green-100 text-green-700' : 'bg-[#2C8780]/10 text-[#2C8780]'

  return (
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
      {isDanger ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      ) : isWarning ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
    </div>
  )
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ req: DialogRequest; resolver: Resolver } | null>(null)
  const queueRef = useRef<{ req: DialogRequest; resolver: Resolver }[]>([])

  const showNext = useCallback(() => {
    if (active) return
    const next = queueRef.current.shift()
    if (next) setActive(next)
  }, [active])

  useEffect(() => {
    pushDialog = (req, resolver) => {
      queueRef.current.push({ req, resolver })
      setActive(prev => {
        if (prev) return prev
        return queueRef.current.shift() ?? null
      })
    }
    return () => { pushDialog = null }
  }, [])

  const close = useCallback((value: boolean | void) => {
    if (!active) return
    active.resolver.resolve(value)
    setActive(null)
    setTimeout(() => {
      const next = queueRef.current.shift()
      if (next) setActive(next)
    }, 0)
  }, [active])

  const req = active?.req

  return (
    <AppDialogContext.Provider value={{ confirm: appConfirm, alert: appAlert }}>
      {children}
      {req && (
        <CenteredModalPortal
          zIndex={80}
          ariaLabelledBy="app-dialog-title"
          onBackdropClick={() => {
            if (req.kind === 'confirm') close(false)
            else close()
          }}
        >
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)]">
              <div className="flex items-start gap-3">
                <DialogIcon
                  variant={
                    req.kind === 'confirm'
                      ? req.danger ? 'danger' : 'confirm'
                      : (req.variant ?? 'info')
                  }
                />
                <div className="min-w-0 flex-1">
                  <h2 id="app-dialog-title" className="font-bold text-[#231F20] text-base leading-snug">
                    {req.title ?? (req.kind === 'confirm'
                      ? (req.danger ? 'تأكيد الحذف' : 'تأكيد')
                      : req.variant === 'error' ? 'خطأ' : req.variant === 'warning' ? 'تنبيه' : 'ملاحظة')}
                  </h2>
                  <p className="text-sm text-[#767676] mt-2 leading-relaxed whitespace-pre-line">
                    {req.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 flex gap-3 bg-[#F8F7F8] border-t border-[rgba(118,118,118,0.08)]">
              {req.kind === 'confirm' ? (
                <>
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors"
                  >
                    {req.cancelLabel ?? 'إلغاء'}
                  </button>
                  <button
                    type="button"
                    onClick={() => close(true)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 ${
                      req.danger ? 'bg-red-600 hover:bg-red-700' : ''
                    }`}
                    style={req.danger ? undefined : { background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                  >
                    {req.confirmLabel ?? (req.danger ? 'حذف' : 'موافق')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => close()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                >
                  {req.okLabel ?? 'حسناً'}
                </button>
              )}
            </div>
          </div>
        </CenteredModalPortal>
      )}
    </AppDialogContext.Provider>
  )
}
