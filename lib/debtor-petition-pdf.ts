import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  buildPetitionFileName,
  buildPetitionHtml,
  normalizePetitionFields,
  type DebtorPetitionFields,
} from '@/lib/debtor-petition'

const execFileAsync = promisify(execFile)

function resolveBrowserExecutable(): string | null {
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

/**
 * يولّد PDF من نفس HTML المعاينة عبر Chrome/Edge headless
 * حتى تبقى العربية متصلة وصحيحة (بدون تشويه pdfkit).
 */
export async function generateDebtorPetitionPdf(
  fields: DebtorPetitionFields,
): Promise<{ buffer: Buffer; fileName: string }> {
  const f = normalizePetitionFields(fields)
  const fileName = buildPetitionFileName(f.defendantName)
  const html = buildPetitionHtml(f)

  const browser = resolveBrowserExecutable()
  if (!browser) {
    throw new Error(
      'تعذر توليد PDF: لم يُعثر على Chrome أو Edge. ثبّت أحدهما أو عيّن CHROME_PATH.',
    )
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
    return { buffer, fileName }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => null)
  }
}
