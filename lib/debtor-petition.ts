import { arabicAmountInWords, formatPetitionAmountDigits } from '@/lib/arabic-tafqeet'

export interface DebtorPetitionFields {
  courtName: string
  plaintiffName: string
  defendantName: string
  defendantAddress: string
  amountDigits: string
  amountWords: string
  lawyerName: string
}

export const DEFAULT_PLAINTIFF_NAME = 'المدير المفوض لشركة قلعة الضمان'

export const PETITION_FIELD_KEYS = [
  'courtName',
  'plaintiffName',
  'defendantName',
  'defendantAddress',
  'amountDigits',
  'amountWords',
  'lawyerName',
] as const

export const PETITION_FIELD_LABELS: Record<(typeof PETITION_FIELD_KEYS)[number], string> = {
  courtName: 'اسم المحكمة',
  plaintiffName: 'اسم المدعي',
  defendantName: 'اسم المدعى عليه',
  defendantAddress: 'عنوان المدعى عليه',
  amountDigits: 'المبلغ رقمًا',
  amountWords: 'المبلغ كتابةً',
  lawyerName: 'اسم المحامي',
}

export function emptyPetitionFields(): DebtorPetitionFields {
  return {
    courtName: '',
    plaintiffName: DEFAULT_PLAINTIFF_NAME,
    defendantName: '',
    defendantAddress: '',
    amountDigits: '',
    amountWords: '',
    lawyerName: '',
  }
}

export function normalizePetitionFields(raw: Partial<DebtorPetitionFields>): DebtorPetitionFields {
  const amountDigits = formatPetitionAmountDigits(raw.amountDigits ?? '')
  const amountWords = String(raw.amountWords ?? '').trim()
    || (amountDigits && amountDigits !== '0' ? arabicAmountInWords(amountDigits) : '')
  return {
    courtName: String(raw.courtName ?? '').trim(),
    plaintiffName: String(raw.plaintiffName ?? '').trim(),
    defendantName: String(raw.defendantName ?? '').trim(),
    defendantAddress: String(raw.defendantAddress ?? '').trim(),
    amountDigits,
    amountWords,
    lawyerName: String(raw.lawyerName ?? '').trim(),
  }
}

export function validatePetitionFields(fields: DebtorPetitionFields): string | null {
  for (const key of PETITION_FIELD_KEYS) {
    if (!String(fields[key] ?? '').trim()) {
      return `الحقل مطلوب: ${PETITION_FIELD_LABELS[key]}`
    }
  }
  const amount = Number(String(fields.amountDigits).replace(/[^\d]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'المبلغ رقمًا يجب أن يكون أكبر من صفر'
  }
  return null
}

/** نص العريضة سطرًا بسطر — مطابق لترتيب المرجع */
export function buildPetitionTextLines(fields: DebtorPetitionFields): string[] {
  const f = normalizePetitionFields(fields)
  const amountParen = `(${f.amountDigits})`
  return [
    `السيد قاضي محكمة ${f.courtName} المحترم`,
    '',
    `المدعي / ${f.plaintiffName} / إضافة لوظيفته / وكيله المحامي ${f.lawyerName}`,
    '',
    `المدعى عليه / ${f.defendantName} / يسكن / ${f.defendantAddress}`,
    '',
    'جهة الدعوى',
    '',
    `لموكلي بذمة المدعى عليه مبلغ مقداره ${amountParen} ${f.amountWords} دينار عراقي، ورغم المطالبة المستمرة لموكلي إلا أنه ممتنع عن التسديد بدون وجه حق.`,
    '',
    `عليه أطلب من محكمتكم الموقرة دعوة المدعى عليه للمرافعة والحكم بإلزامه بتأدية المبلغ المذكور أعلاه والبالغ ${amountParen} ${f.amountWords} دينار عراقي وتحميله كافة الرسوم والمصاريف وأتعاب المحاماة.`,
    '',
    'ولكم فائق الشكر والتقدير',
  ]
}

export function buildPetitionHtml(fields: DebtorPetitionFields): string {
  const f = normalizePetitionFields(fields)
  const amountParen = `(${f.amountDigits})`
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>عريضة دعوى</title>
<style>
  @page {
    size: A4 portrait;
    /* هوامش كافية خاصة اليسار حتى لا تُقص نهايات السطور العربية */
    margin: 14mm 16mm 14mm 18mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    background: #fff;
    color: #111;
    font-family: Arial, "Segoe UI", Tahoma, sans-serif;
    font-size: 22px;
    line-height: 1.95;
    direction: rtl;
    overflow-x: hidden;
  }
  .sheet {
    width: 100%;
    max-width: 100%;
    margin: 0;
    padding: 6mm 4mm;
    background: #fff;
  }
  .court-line {
    text-align: right;
    font-size: 26px;
    font-weight: 700;
    margin: 0 0 20px;
  }
  .party {
    text-align: right;
    margin: 0 0 12px;
    font-size: 22px;
    font-weight: 600;
  }
  .section-title {
    text-align: right;
    font-weight: 800;
    font-size: 24px;
    margin: 22px 0 14px;
    text-decoration: underline;
    text-underline-offset: 6px;
  }
  .para {
    text-align: justify;
    text-justify: inter-word;
    margin: 0 0 16px;
    font-size: 22px;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .thanks {
    text-align: center;
    margin: 22px 0 36px;
    font-weight: 700;
    font-size: 22px;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-top: 4px;
    page-break-inside: avoid;
  }
  .footer-col {
    width: 46%;
    font-size: 20px;
  }
  .footer-col.evidence { text-align: right; }
  .footer-col.plaintiff { text-align: center; }
  .footer-head { font-weight: 700; margin-bottom: 8px; font-size: 22px; }
  .footer-line { margin: 4px 0; }
  @media print {
    html, body {
      width: auto;
      height: auto !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: auto !important;
      max-width: 100% !important;
      min-height: 0 !important;
      height: auto !important;
      padding: 0 !important;
      margin: 0 !important;
      page-break-after: avoid;
      page-break-inside: avoid;
    }
    .para, .party, .thanks, .footer {
      page-break-inside: avoid;
    }
  }
</style>
</head>
<body>
  <div class="sheet">
    <p class="court-line">السيد قاضي محكمة ${esc(f.courtName)} المحترم</p>
    <p class="party">المدعي / ${esc(f.plaintiffName)} / إضافة لوظيفته / وكيله المحامي ${esc(f.lawyerName)}</p>
    <p class="party">المدعى عليه / ${esc(f.defendantName)} / يسكن / ${esc(f.defendantAddress)}</p>
    <p class="section-title">جهة الدعوى</p>
    <p class="para">لموكلي بذمة المدعى عليه مبلغ مقداره ${esc(amountParen)} ${esc(f.amountWords)} دينار عراقي، ورغم المطالبة المستمرة لموكلي إلا أنه ممتنع عن التسديد بدون وجه حق.</p>
    <p class="para">عليه أطلب من محكمتكم الموقرة دعوة المدعى عليه للمرافعة والحكم بإلزامه بتأدية المبلغ المذكور أعلاه والبالغ ${esc(amountParen)} ${esc(f.amountWords)} دينار عراقي وتحميله كافة الرسوم والمصاريف وأتعاب المحاماة.</p>
    <p class="thanks">ولكم فائق الشكر والتقدير</p>
    <div class="footer">
      <div class="footer-col evidence">
        <div class="footer-head">الأدلة الثبوتية</div>
        <div class="footer-line">سائر البيانات القانونية</div>
      </div>
      <div class="footer-col plaintiff">
        <div class="footer-head">المدعي</div>
        <div class="footer-line">${esc(f.plaintiffName)}</div>
        <div class="footer-line">وكيله المحامي</div>
        <div class="footer-line">${esc(f.lawyerName)} بموجب الوكالة المرفقة طياً نسخة منها</div>
      </div>
    </div>
  </div>
</body>
</html>`
}

export const PETITION_ATTACHMENT_LABEL = 'عريضة الدعوى'

export function sanitizePetitionFileNamePart(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'مدين'
}

export function buildPetitionFileName(defendantName: string, date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const name = String(defendantName ?? '').trim() || 'مدين'
  return `${PETITION_ATTACHMENT_LABEL} - ${name} - ${y}-${m}-${d}.pdf`.slice(0, 200)
}
