'use client'

import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

/**
 * يحوّل HTML المعاينة إلى PDF عبر تصيير المتصفح (العربية صحيحة مثل المعاينة).
 */
export async function htmlToPetitionPdfBlob(html: string): Promise<Blob> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)

  try {
    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc || !win) throw new Error('تعذر تهيئة معاينة الطباعة')

    doc.open()
    doc.write(html)
    doc.close()

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('انتهت مهلة تحميل المعاينة')), 15000)
      const done = () => {
        window.clearTimeout(t)
        resolve()
      }
      if (doc.readyState === 'complete') {
        window.setTimeout(done, 50)
      } else {
        iframe.onload = () => window.setTimeout(done, 50)
      }
    })

    // انتظر الخطوط إن وُجدت
    try {
      await (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
    } catch {
      /* ignore */
    }
    await new Promise(r => window.setTimeout(r, 100))

    const sheet = doc.querySelector('.sheet') as HTMLElement | null
    const target = sheet ?? doc.body

    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 794,
      scrollX: 0,
      scrollY: 0,
    })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const margin = 8
    const usableW = pageW - margin * 2
    const usableH = pageH - margin * 2

    const imgW = usableW
    const imgH = (canvas.height * usableW) / canvas.width

    if (imgH <= usableH) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, imgW, imgH)
    } else {
      // قصّ على صفحة واحدة مع الحفاظ على العرض (العريضة مصممة لصفحة واحدة)
      const clippedH = usableH
      const clipCanvas = document.createElement('canvas')
      const ratio = canvas.width / usableW
      clipCanvas.width = canvas.width
      clipCanvas.height = Math.floor(clippedH * ratio)
      const ctx = clipCanvas.getContext('2d')
      if (!ctx) throw new Error('تعذر قص صفحة PDF')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, clipCanvas.width, clipCanvas.height)
      ctx.drawImage(canvas, 0, 0)
      pdf.addImage(clipCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, imgW, clippedH)
    }

    return pdf.output('blob')
  } finally {
    iframe.remove()
  }
}

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
