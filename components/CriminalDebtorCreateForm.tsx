'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { isMainBranchName } from '@/lib/branch-constants'
import {
  OperationBranchSelect,
  OPERATION_BRANCH_REQUIRED_MSG,
  useOperationBranch,
} from '@/components/OperationBranchSelect'
import { FormFlow, FormFlowHero, FormFlowStep, FormField, formInputClass } from '@/components/ui/form-flow'
import { cn } from '@/lib/utils'
import { parseMoneyInput } from '@/lib/money-input'
import {
  CriminalDebtorFields,
  EMPTY_CRIMINAL_DETAILS,
  criminalDetailsPayload,
  validateCriminalClientForm,
  type CriminalDetailsFormState,
} from '@/components/CriminalDebtorFields'
import { BackButton } from '@/components/ui/back-button'

type Props = {
  readOnly?: boolean
  /** إخفاء اختيار القسم عندما الدور ثابت */
  lockCaseType?: boolean
}

export default function CriminalDebtorCreateForm({ readOnly, lockCaseType }: Props) {
  const router = useRouter()
  const {
    needsPick,
    effectiveBranchId: branchId,
    effectiveBranchName: branchName,
    pickedId,
    setPickedBranch,
    validateOperationBranch,
  } = useOperationBranch()

  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [fullName, setFullName] = useState('')
  const [criminal, setCriminal] = useState<CriminalDetailsFormState>(EMPTY_CRIMINAL_DETAILS)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [petitionFile, setPetitionFile] = useState<File | null>(null)
  const submitLock = useRef(false)

  const branchOk = Boolean(branchId && branchName && !isMainBranchName(branchName))

  function setCriminalField(field: keyof CriminalDetailsFormState, value: string) {
    setCriminal(prev => ({ ...prev, [field]: value }))
  }

  function pickPdf(
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (f: File | null) => void,
  ) {
    const file = e.target.files?.[0] ?? null
    if (!file) {
      setFile(null)
      return
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (file.type !== 'application/pdf' || ext !== 'pdf') {
      setError('يجب أن يكون الملف بصيغة PDF فقط')
      setFile(null)
      e.target.value = ''
      return
    }
    setError('')
    setFile(file)
  }

  async function uploadCriminalPdf(debtorId: string, file: File, kind: 'documents' | 'petition') {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    const up = await fetch(`/api/admin/debtors/${debtorId}/criminal-file`, {
      method: 'POST',
      body: fd,
    })
    const upJson = await up.json().catch(() => ({}))
    if (!up.ok) {
      return typeof upJson.error === 'string' ? upJson.error : 'فشل رفع الملف'
    }
    return null
  }

  async function rollbackDebtor(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/debtors/${id}`, { method: 'DELETE' })
      return res.ok
    } catch {
      return false
    }
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (readOnly || saving || submitLock.current) return
    submitLock.current = true
    setSaving(true)
    setError('')
    setSuccess('')
    setUploadProgress('')

    const branchErr = validateOperationBranch()
    if (branchErr) {
      setError(branchErr)
      setSaving(false)
      submitLock.current = false
      return
    }

    const validation = validateCriminalClientForm(fullName, branchId, criminal)
    if (validation) {
      setError(validation)
      setSaving(false)
      submitLock.current = false
      return
    }

    const amountRaw = criminal.amount_owed.trim()
    const remaining = amountRaw ? parseMoneyInput(amountRaw) : 0

    let createdId: string | null = null
    try {
      const res = await fetch('/api/admin/debtors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          case_type: 'criminal',
          full_name: fullName.trim(),
          remaining_amount: amountRaw ? remaining : null,
          branch_list_id: null,
          criminal_details: criminalDetailsPayload(criminal),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.id) {
        setError(typeof json.error === 'string' ? json.error : 'فشل إنشاء المدين')
        setSaving(false)
        submitLock.current = false
        return
      }
      createdId = String(json.id)

      if (pdfFile) {
        setUploadProgress('جاري رفع المستمسكات والعقد…')
        const err = await uploadCriminalPdf(createdId, pdfFile, 'documents')
        if (err) {
          const rolled = await rollbackDebtor(createdId)
          setError(
            rolled
              ? `فشل رفع المستمسكات: ${err}`
              : `فشل رفع المستمسكات: ${err} — وتعذّر التراجع عن المدين؛ احذفه يدوياً إن لزم`,
          )
          setUploadProgress('')
          setSaving(false)
          submitLock.current = false
          return
        }
      }

      if (petitionFile) {
        setUploadProgress('جاري رفع عريضة الدعوى…')
        const err = await uploadCriminalPdf(createdId, petitionFile, 'petition')
        if (err) {
          const rolled = await rollbackDebtor(createdId)
          setError(
            rolled
              ? `فشل رفع عريضة الدعوى: ${err}`
              : `فشل رفع عريضة الدعوى: ${err} — وتعذّر التراجع عن المدين؛ احذفه يدوياً إن لزم`,
          )
          setUploadProgress('')
          setSaving(false)
          submitLock.current = false
          return
        }
      }

      setSuccess('تم إنشاء المدين الجزائي بنجاح')
      setUploadProgress('')
      router.push(`/admin/debtors/${createdId}/account`)
    } catch {
      if (createdId) await rollbackDebtor(createdId)
      setError('فشل إنشاء المدين')
      setSaving(false)
      submitLock.current = false
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <BackButton fallback="/admin/debtors" />
      </div>
      <PageHeader
        title="إضافة مدين جزائي"
        subtitle={
          lockCaseType
            ? 'قسم الجزائيات — الاسم والفرع إلزاميان؛ باقي الحقول اختيارية'
            : 'الاسم والفرع إلزاميان؛ باقي الحقول اختيارية'
        }
        breadcrumb={[{ label: 'المدينون', href: '/admin/debtors' }, { label: 'إضافة جزائي' }]}
      />

      {readOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          عرض النموذج فقط — لا تملك صلاحية إضافة مدين.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <FormFlow>
          {needsPick && (
            <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] p-4 mb-1">
              <OperationBranchSelect
                value={pickedId}
                onChange={(id, name) => setPickedBranch(id, name)}
              />
            </div>
          )}
          {branchOk ? (
            <FormFlowHero branchName={branchName!} meta={[{ label: 'القسم', value: 'جزائي' }]} />
          ) : (
            <FormFlowHero warning={OPERATION_BRANCH_REQUIRED_MSG} />
          )}

          <FormFlowStep step={1} title="البيانات الأساسية" subtitle="الاسم والفرع مطلوبان">
            <FormField label="الاسم الكامل" required>
              <input
                type="text"
                value={fullName}
                disabled={readOnly}
                onChange={e => setFullName(e.target.value)}
                className={formInputClass}
                placeholder="اسم المدين"
                required
              />
            </FormField>
          </FormFlowStep>

          <FormFlowStep step={2} title="تفاصيل القضية الجزائية" subtitle="جميع الحقول اختيارية">
            <CriminalDebtorFields
              form={criminal}
              onChange={setCriminalField}
              disabled={readOnly}
              documentsSlot={
                <>
                  <FormField label="المستمسكات والعقد" hint="اختياري — PDF واحد فقط">
                    <label
                      className={cn(
                        'flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all',
                        pdfFile
                          ? 'border-[#2C8780]/40 bg-[#2C8780]/5'
                          : 'border-[rgba(118,118,118,0.2)] bg-[#FAFAFA] hover:border-[#2C8780]/35',
                      )}
                    >
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={e => pickPdf(e, setPdfFile)}
                        className="hidden"
                        disabled={readOnly}
                      />
                      {pdfFile ? (
                        <>
                          <p className="text-sm font-bold text-[#2C8780]">{pdfFile.name}</p>
                          <p className="text-xs text-[#767676]">{(pdfFile.size / 1024).toFixed(0)} KB</p>
                        </>
                      ) : (
                        <p className="text-sm font-bold text-[#231F20]">رفع PDF</p>
                      )}
                    </label>
                  </FormField>
                  <FormField label="عريضة الدعوى" hint="اختياري — PDF واحد فقط">
                    <label
                      className={cn(
                        'flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all',
                        petitionFile
                          ? 'border-[#2C8780]/40 bg-[#2C8780]/5'
                          : 'border-[rgba(118,118,118,0.2)] bg-[#FAFAFA] hover:border-[#2C8780]/35',
                      )}
                    >
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={e => pickPdf(e, setPetitionFile)}
                        className="hidden"
                        disabled={readOnly}
                      />
                      {petitionFile ? (
                        <>
                          <p className="text-sm font-bold text-[#2C8780]">{petitionFile.name}</p>
                          <p className="text-xs text-[#767676]">{(petitionFile.size / 1024).toFixed(0)} KB</p>
                        </>
                      ) : (
                        <p className="text-sm font-bold text-[#231F20]">رفع عريضة الدعوى (PDF)</p>
                      )}
                    </label>
                  </FormField>
                </>
              }
            />
          </FormFlowStep>
        </FormFlow>

        {uploadProgress && <p className="text-sm text-[#2C8780]">{uploadProgress}</p>}
        {success && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">{success}</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-6">
          <Button type="submit" variant="primary" loading={saving} disabled={!branchOk || readOnly || saving}>
            حفظ المدين الجزائي
          </Button>
          <Link href="/admin/debtors">
            <Button type="button" variant="outline">إلغاء</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
