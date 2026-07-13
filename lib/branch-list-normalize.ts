/**
 * تطبيع أسماء قوائم الفروع للمقارنة فقط — لا يغيّر الاسم المعروض للمستخدم.
 */

const TATWEEL = /\u0640/g
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g

const ALEF_VARIANTS = /[أإآٱ]/g
const ALEF_WASLA = /\u0671/g

const WORD_NUM_END: Array<[RegExp, string]> = [
  [/(?:^|\s)(واحد|الاول|الأول|الاولى|الأولى|اولى|أولى)\s*$/u, '1'],
  [/(?:^|\s)(اثنان|اثنين|اثنتان|اثنتين|الثاني|الثانية|ثاني|ثانية)\s*$/u, '2'],
  [/(?:^|\s)(ثلاثة|ثلاث|الثالث|الثالثة|ثالث|ثالثة)\s*$/u, '3'],
  [/(?:^|\s)(اربعة|أربعة|اربع|أربع|الرابع|الرابعة|رابع|رابعة)\s*$/u, '4'],
  [/(?:^|\s)(خمسة|خمس|الخامس|الخامسة|خامس|خامسة)\s*$/u, '5'],
]

const EASTERN_ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

function unifyDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, ch => EASTERN_ARABIC_DIGITS[ch] ?? ch)
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** مفتاح مقارنة موحّد داخل الفرع */
export function normalizeBranchListName(raw: unknown): string {
  let s = String(raw ?? '')
  s = collapseSpaces(s)
  if (!s) return ''

  s = s.replace(TATWEEL, '')
  s = s.replace(ARABIC_DIACRITICS, '')
  s = s.replace(ALEF_VARIANTS, 'ا').replace(ALEF_WASLA, 'ا')
  s = s.replace(/ى/g, 'ي')
  s = unifyDigits(s)

  for (const [re, digit] of WORD_NUM_END) {
    if (re.test(s)) {
      s = s.replace(re, ` ${digit}`).trim()
      break
    }
  }

  s = collapseSpaces(s)

  // للمقارنة: أزل الفواصل/الشرطات/المسافات
  let key = s.replace(/[\s\-_/.,،]+/g, '')

  // تجاهل «ال» التعريف في البداية
  if (key.startsWith('ال') && key.length > 2) {
    key = key.slice(2)
  }

  return key
}

/**
 * اختيار اسم عرض مرتّب من مرشّحين متكافئين بعد التطبيع.
 * يفضّل: مسافة قبل الرقم، همزة مناسبة على الألف، بدون تكرار «ال» الزائدة عند الإمكان.
 */
export function preferBranchListDisplayName(names: string[]): string {
  const cleaned = names.map(n => collapseSpaces(String(n ?? ''))).filter(Boolean)
  if (!cleaned.length) return ''
  if (cleaned.length === 1) return cleaned[0]

  const scored = cleaned.map(name => {
    let score = 0
    // مسافة قبل رقم في النهاية: "حبوبي 1"
    if (/\s\d+$/.test(name)) score += 30
    // همزة على الألف في البداية الشائعة: الإسكان
    if (/^[إأ]/.test(name)) score += 20
    // طول أقرب للصياغة المقروءة (مسافات معتدلة)
    if (name.includes(' ')) score += 5
    // عقوبة على أرقام ملتصقة بلا مسافة إن وُجد بديل بمسافة
    if (/\D\d+$/.test(name) && !/\s\d+$/.test(name)) score -= 10
    // تفضيل «ال» في أسماء مثل الإسكان/السوق إن ظهرت في المرشحين
    const key = normalizeBranchListName(name)
    const withAl = cleaned.some(n => collapseSpaces(n).startsWith('ال'))
    if (withAl && name.startsWith('ال')) score += 8
    // للإسكان تحديداً فضّل الإسكان
    if (key === 'اسكان' && name.startsWith('الإ')) score += 15
    // لحبوبي فضّل بدون «ال» مع مسافة: حبوبي 1
    if (key.startsWith('حبوبي') && !name.startsWith('ال') && /\s\d+$/.test(name)) score += 25
    if (key.startsWith('حبوبي') && name.startsWith('ال')) score -= 5
    return { name, score }
  })

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ar'))
  return scored[0].name
}

/** تنظيف خفيف للتخزين كاسم معروض (بدون تغيير المعنى) */
export function sanitizeBranchListDisplayName(raw: unknown): string {
  return collapseSpaces(String(raw ?? ''))
}
