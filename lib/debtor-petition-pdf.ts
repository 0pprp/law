import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import PDFDocument from 'pdfkit'
import { ArabicShaper } from 'arabic-persian-reshaper'
import bidiFactory from 'bidi-js'
import {
  buildPetitionFileName,
  buildPetitionHtml,
  buildPetitionTextLines,
  normalizePetitionFields,
  type DebtorPetitionFields,
} from '@/lib/debtor-petition'

const execFileAsync = promisify(execFile)
const bidi = bidiFactory()

function resolveBrowserExecutable(): string | null {
  if (process.env.PETITION_FORCE_PDFKIT === '1') return null
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean) as string[]

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

function resolveArabicFontPath(): string {
  const candidates = [
    path.join(process.cwd(), 'fonts', 'NotoNaskhArabic-Regular.ttf'),
    path.join(process.cwd(), 'public', 'fonts', 'NotoNaskhArabic-Regular.ttf'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  throw new Error('خط عربي غير موجود (NotoNaskhArabic-Regular.ttf)')
}

/** تشكيل + إعادة ترتيب RTL لعرض صحيح في pdfkit */
function shapeRtl(text: string): string {
  const shaped = ArabicShaper.convertArabic(String(text ?? ''))
  const levels = bidi.getEmbeddingLevels(shaped)
  return bidi.getReorderedString(shaped, levels)
}

async function generateWithBrowser(html: string): Promise<Buffer> {
  const browser = resolveBrowserExecutable()
  if (!browser) {
    throw new Error('لا متصفح متاح')
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'petition-'))
  const htmlPath = path.join(tmpDir, 'petition.html')
  const pdfPath = path.join(tmpDir, 'petition.pdf')

  try {
    await fs.promises.writeFile(htmlPath, html, 'utf8')
    const fileUrl = pathToFileURL(htmlPath).href

    await execFileAsync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-file-access-from-files',
        `--print-to-pdf=${pdfPath}`,
        '--print-to-pdf-no-header',
        fileUrl,
      ],
      { timeout: 60_000, windowsHide: true },
    )

    if (!fs.existsSync(pdfPath)) {
      throw new Error('فشل إنشاء ملف PDF من المتصفح')
    }
    const buffer = await fs.promises.readFile(pdfPath)
    if (!buffer.length || buffer.slice(0, 4).toString() !== '%PDF') {
      throw new Error('ملف PDF الناتج غير صالح')
    }
    return buffer
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => null)
  }
}

async function generateWithPdfkit(fields: DebtorPetitionFields): Promise<Buffer> {
  const fontPath = resolveArabicFontPath()
  const lines = buildPetitionTextLines(fields)

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      info: { Title: 'عريضة دعوى', Author: 'قلعة الضمان' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.registerFont('Arabic', fontPath)
    doc.font('Arabic')

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const rightX = doc.page.margins.left

    function writeRight(text: string, opts?: { size?: number; boldGap?: number; underline?: boolean }) {
      const size = opts?.size ?? 14
      doc.fontSize(size)
      const shaped = shapeRtl(text)
      const h = doc.heightOfString(shaped, { width: pageWidth, align: 'right' })
      doc.text(shaped, rightX, doc.y, {
        width: pageWidth,
        align: 'right',
        underline: opts?.underline,
      })
      if (opts?.boldGap) doc.moveDown(opts.boldGap)
      else if (h < 18) doc.moveDown(0.35)
    }

    // عنوان المحكمة
    writeRight(lines[0] ?? '', { size: 16 })
    doc.moveDown(0.8)

    // أطراف
    writeRight(lines[2] ?? '', { size: 13 })
    doc.moveDown(0.4)
    writeRight(lines[4] ?? '', { size: 13 })
    doc.moveDown(0.9)

    // جهة الدعوى
    writeRight('جهة الدعوى', { size: 15, underline: true })
    doc.moveDown(0.6)

    writeRight(lines[8] ?? '', { size: 13 })
    doc.moveDown(0.5)
    writeRight(lines[10] ?? '', { size: 13 })
    doc.moveDown(0.9)
    writeRight(lines[12] ?? '', { size: 13 })
    doc.moveDown(1.4)

    // تذييل: أدلة | مدعي
    const colW = pageWidth / 2 - 8
    const y = doc.y
    const leftColX = doc.page.margins.left
    const rightColX = doc.page.margins.left + colW + 16

    doc.fontSize(13)
    doc.text(shapeRtl('الأدلة الثبوتية'), rightColX, y, { width: colW, align: 'right' })
    doc.text(shapeRtl('سائر البيانات القانونية'), rightColX, y + 22, { width: colW, align: 'right' })

    doc.text(shapeRtl('المدعي'), leftColX, y, { width: colW, align: 'center' })
    doc.text(shapeRtl(fields.plaintiffName), leftColX, y + 22, { width: colW, align: 'center' })
    doc.text(shapeRtl('وكيله المحامي'), leftColX, y + 44, { width: colW, align: 'center' })
    doc.text(
      shapeRtl(`${fields.lawyerName} بموجب الوكالة المرفقة طياً نسخة منها`),
      leftColX,
      y + 66,
      { width: colW, align: 'center' },
    )

    doc.end()
  })
}

/**
 * يولّد PDF من نفس محتوى المعاينة.
 * يفضّل Chrome/Edge إن وُجد (محلياً)، وإلا pdfkit + خط عربي (إنتاج بدون متصفح).
 */
export async function generateDebtorPetitionPdf(
  fields: DebtorPetitionFields,
): Promise<{ buffer: Buffer; fileName: string }> {
  const f = normalizePetitionFields(fields)
  const fileName = buildPetitionFileName(f.defendantName)
  const html = buildPetitionHtml(f)

  let lastError: unknown = null

  try {
    const buffer = await generateWithBrowser(html)
    return { buffer, fileName }
  } catch (e) {
    lastError = e
    console.warn(
      '[debtor-petition-pdf] browser path failed, falling back to pdfkit:',
      e instanceof Error ? e.message : e,
    )
  }

  try {
    const buffer = await generateWithPdfkit(f)
    if (!buffer.length || buffer.slice(0, 4).toString() !== '%PDF') {
      throw new Error('ملف PDF الاحتياطي غير صالح')
    }
    return { buffer, fileName }
  } catch (e) {
    const browserMsg = lastError instanceof Error ? lastError.message : String(lastError ?? '')
    const kitMsg = e instanceof Error ? e.message : String(e)
    throw new Error(`فشل توليد PDF (متصفح: ${browserMsg} | احتياطي: ${kitMsg})`)
  }
}
