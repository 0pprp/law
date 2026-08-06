/** تفقيط المبالغ الصحيحة إلى كلمات عربية (دينار عراقي — أسلوب الوثائق القانونية) */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const ONES_F = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع']
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TEENS_F = ['عشر', 'إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة']
const TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

function twoDigits(n: number, feminine = false): string {
  if (n <= 0) return ''
  if (n < 10) return (feminine ? ONES_F : ONES)[n]
  if (n < 20) return (feminine ? TEENS_F : TEENS)[n - 10]
  const t = Math.floor(n / 10)
  const o = n % 10
  if (!o) return TENS[t]
  const one = (feminine ? ONES_F : ONES)[o]
  return `${one} و${TENS[t]}`
}

function threeDigits(n: number, feminine = false): string {
  if (n <= 0) return ''
  if (n < 100) return twoDigits(n, feminine)
  const h = Math.floor(n / 100)
  const rest = n % 100
  const hun = HUNDREDS[h]
  if (!rest) return hun
  return `${hun} و${twoDigits(rest, feminine)}`
}

/**
 * يحوّل عدداً صحيحاً غير سالب إلى كلمات عربية.
 * مثال: 2025000 → مليونان وخمسة وعشرون ألف
 */
export function arabicAmountInWords(value: number | string): string {
  const n = Math.floor(Math.abs(Number(String(value).replace(/[^\d]/g, '') || '0')))
  if (!Number.isFinite(n) || n === 0) return 'صفر'

  const parts: string[] = []
  let rem = n

  const billions = Math.floor(rem / 1_000_000_000)
  rem %= 1_000_000_000
  if (billions) {
    if (billions === 1) parts.push('مليار')
    else if (billions === 2) parts.push('ملياران')
    else if (billions >= 3 && billions <= 10) parts.push(`${threeDigits(billions)} مليارات`)
    else parts.push(`${threeDigits(billions)} مليار`)
  }

  const millions = Math.floor(rem / 1_000_000)
  rem %= 1_000_000
  if (millions) {
    if (millions === 1) parts.push('مليون')
    else if (millions === 2) parts.push('مليونان')
    else if (millions >= 3 && millions <= 10) parts.push(`${threeDigits(millions)} ملايين`)
    else parts.push(`${threeDigits(millions)} مليون`)
  }

  const thousands = Math.floor(rem / 1000)
  rem %= 1000
  if (thousands) {
    if (thousands === 1) parts.push('ألف')
    else if (thousands === 2) parts.push('ألفان')
    else if (thousands >= 3 && thousands <= 10) parts.push(`${threeDigits(thousands, true)} آلاف`)
    else parts.push(`${threeDigits(thousands)} ألف`)
  }

  if (rem) parts.push(threeDigits(rem))

  return parts.join(' و')
}

/** تنسيق المبلغ بأرقام إنجليزية مع فواصل آلاف — كما في العرائض */
export function formatPetitionAmountDigits(value: number | string): string {
  const n = Math.floor(Math.abs(Number(String(value).replace(/[^\d]/g, '') || '0')))
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
}
