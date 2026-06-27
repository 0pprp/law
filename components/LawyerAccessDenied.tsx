import Link from 'next/link'

export default function LawyerAccessDenied() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-16 pb-24">
      <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-slate-800 mb-2">لا تملك صلاحية الوصول إلى هذا الملف</h1>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          يمكنك فقط عرض ملفات المدينين المكلفين بمهام نشطة لديك في فرعك.
        </p>
        <Link
          href="/lawyer/tasks"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
        >
          العودة إلى مهامي
        </Link>
      </div>
    </div>
  )
}
