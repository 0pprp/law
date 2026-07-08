'use client'

import { AppDialogProvider } from '@/context/app-dialog'

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <AppDialogProvider>{children}</AppDialogProvider>
}
