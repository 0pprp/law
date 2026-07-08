import type { Metadata } from 'next'
import { Cairo } from 'next/font/google'
import './globals.css'
import AppProviders from '@/components/AppProviders'

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-cairo',
  weight: ['400', '500', '600', '700', '800', '900'],
})

export const metadata: Metadata = {
  title: 'قلعة الضمان',
  description: 'النظام الإداري والقانوني للتحصيل والمتابعة',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full`}>
      <body className="font-[family-name:var(--font-cairo)] h-full bg-[#F3F1F2] antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}