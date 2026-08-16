import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import {
  buildPetitionFileName,
  normalizePetitionFields,
  type DebtorPetitionFields,
} from '@/lib/debtor-petition'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

function rtlRun(text: string, opts?: { bold?: boolean; size?: number }): TextRun {
  return new TextRun({
    text,
    bold: opts?.bold,
    size: opts?.size ?? 28, // 14pt
    font: 'Arial',
    rightToLeft: true,
  })
}

function rtlPara(
  text: string,
  opts?: {
    bold?: boolean
    size?: number
    align?: (typeof AlignmentType)[keyof typeof AlignmentType]
    spacingAfter?: number
    underline?: boolean
  },
): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: opts?.align ?? AlignmentType.RIGHT,
    spacing: { after: opts?.spacingAfter ?? 200, line: 360 },
    children: [
      new TextRun({
        text,
        bold: opts?.bold,
        size: opts?.size ?? 28,
        font: 'Arial',
        rightToLeft: true,
        underline: opts?.underline ? {} : undefined,
      }),
    ],
  })
}

function buildPetitionDocument(fields: DebtorPetitionFields): Document {
  const f = normalizePetitionFields(fields)
  const amountParen = `(${f.amountDigits})`

  const footerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [4680, 4680],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              rtlPara('الأدلة الثبوتية', { bold: true, size: 28, spacingAfter: 120 }),
              rtlPara('سائر البيانات القانونية', { size: 26, spacingAfter: 0 }),
            ],
          }),
          new TableCell({
            borders: NO_BORDER,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                spacing: { after: 120, line: 360 },
                children: [rtlRun('المدعي', { bold: true, size: 28 })],
              }),
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                spacing: { after: 80, line: 360 },
                children: [rtlRun(f.plaintiffName, { size: 26 })],
              }),
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                spacing: { after: 80, line: 360 },
                children: [rtlRun('وكيله المحامي', { size: 26 })],
              }),
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                spacing: { after: 0, line: 360 },
                children: [
                  rtlRun(
                    `${f.lawyerName} بموجب الوكالة المرفقة طياً نسخة منها`,
                    { size: 26 },
                  ),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: {
              top: 1008,
              bottom: 1008,
              right: 1134,
              left: 1134,
            },
          },
        },
        children: [
          rtlPara(`السيد قاضي محكمة ${f.courtName} المحترم`, {
            bold: true,
            size: 32,
            spacingAfter: 320,
          }),
          rtlPara(
            `المدعي / ${f.plaintiffName} / إضافة لوظيفته / وكيله المحامي ${f.lawyerName}`,
            { bold: true, size: 28, spacingAfter: 200 },
          ),
          rtlPara(
            `المدعى عليه / ${f.defendantName} / ${f.defendantOccupation} / يسكن / ${f.defendantAddress}`,
            { bold: true, size: 28, spacingAfter: 280 },
          ),
          rtlPara('جهة الدعوى', {
            bold: true,
            size: 30,
            underline: true,
            spacingAfter: 240,
          }),
          rtlPara(
            `لموكلي بذمة المدعى عليه مبلغ مقداره ${amountParen} ${f.amountWords} دينار عراقي، ورغم المطالبة المستمرة لموكلي إلا أنه ممتنع عن التسديد بدون وجه حق.`,
            { align: AlignmentType.BOTH, size: 28, spacingAfter: 240 },
          ),
          rtlPara(
            `عليه أطلب من محكمتكم الموقرة دعوة المدعى عليه للمرافعة والحكم بإلزامه بتأدية المبلغ المذكور أعلاه والبالغ ${amountParen} ${f.amountWords} دينار عراقي وتحميله كافة الرسوم والمصاريف وأتعاب المحاماة.`,
            { align: AlignmentType.BOTH, size: 28, spacingAfter: 280 },
          ),
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400, line: 360 },
            children: [rtlRun('ولكم فائق الشكر والتقدير', { bold: true, size: 28 })],
          }),
          footerTable,
        ],
      },
    ],
  })
}

/** توليد عريضة الدعوى كملف Word (.docx) — للاستخدام في المتصفح */
export async function generateDebtorPetitionDocxBlob(
  fields: DebtorPetitionFields,
): Promise<Blob> {
  const doc = buildPetitionDocument(fields)
  return Packer.toBlob(doc)
}

/** توليد عريضة الدعوى كـ Buffer — للخادم */
export async function generateDebtorPetitionDocx(
  fields: DebtorPetitionFields,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const f = normalizePetitionFields(fields)
  const doc = buildPetitionDocument(f)
  const buffer = Buffer.from(await Packer.toBuffer(doc))
  return {
    buffer,
    fileName: buildPetitionFileName(f.defendantName),
    mimeType: DOCX_MIME,
  }
}

export const PETITION_DOCX_MIME = DOCX_MIME
