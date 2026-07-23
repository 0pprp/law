/**
 * يحافظ على موضع التمرير أثناء تحديثات الحالة التي قد تعيد رسم القائمة.
 * استخدمه حول setState / إعادة التحميل الجزئي بعد تكليف أو حفظ.
 */
export function preserveScrollDuring(fn: () => void | Promise<void>): void {
  if (typeof window === 'undefined') {
    void fn()
    return
  }
  const x = window.scrollX
  const y = window.scrollY
  const run = async () => {
    try {
      await fn()
    } finally {
      const restore = () => {
        window.scrollTo(x, y)
      }
      restore()
      requestAnimationFrame(restore)
      // بعد رسم React / الصور
      setTimeout(restore, 0)
      setTimeout(restore, 50)
    }
  }
  void run()
}
