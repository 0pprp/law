/**
 * مرادفات أعمدة استيراد المدينين الجزائيين — مصدر مركزي وحيد.
 * لا تخمين فضفاض: فقط المرادفات المدرجة هنا.
 */

export const CRIMINAL_IMPORT_CANONICAL_HEADERS = [
  'الاسم',
  'الفرع',
  'العنوان الوظيفي',
  'عنوان السكن الحالي',
  'تاريخ الواقعة',
  'نوع التهمة',
  'المبلغ الذي بذمته',
  'العقد والكفيل',
  'اسم الشاهد الأول',
  'اسم الشاهد الثاني',
  'اسم ملف المستمسكات والعقد',
] as const

export type CriminalImportCanonicalHeader = (typeof CRIMINAL_IMPORT_CANONICAL_HEADERS)[number]

/** مفتاح داخلي لكل عمود */
export type CriminalImportFieldKey =
  | 'full_name'
  | 'branch_name'
  | 'job_title'
  | 'current_address'
  | 'incident_date'
  | 'charge_type'
  | 'amount_owed'
  | 'contract_guarantor'
  | 'first_witness'
  | 'second_witness'
  | 'documents_filename'

export const CRIMINAL_IMPORT_FIELD_BY_CANONICAL: Record<
  CriminalImportCanonicalHeader,
  CriminalImportFieldKey
> = {
  الاسم: 'full_name',
  الفرع: 'branch_name',
  'العنوان الوظيفي': 'job_title',
  'عنوان السكن الحالي': 'current_address',
  'تاريخ الواقعة': 'incident_date',
  'نوع التهمة': 'charge_type',
  'المبلغ الذي بذمته': 'amount_owed',
  'العقد والكفيل': 'contract_guarantor',
  'اسم الشاهد الأول': 'first_witness',
  'اسم الشاهد الثاني': 'second_witness',
  'اسم ملف المستمسكات والعقد': 'documents_filename',
}

/**
 * مرادفات آمنة فقط — المفتاح بعد تطبيع الهيدر (انظر normalizeHeaderLabel).
 * القيمة = الحقل الداخلي.
 */
export const CRIMINAL_IMPORT_HEADER_SYNONYMS: Record<string, CriminalImportFieldKey> = {
  // الاسم
  الاسم: 'full_name',
  'اسم المدين': 'full_name',

  // الفرع
  الفرع: 'branch_name',
  'اسم الفرع': 'branch_name',

  // العنوان الوظيفي
  'العنوان الوظيفي': 'job_title',
  'المسمى الوظيفي': 'job_title',

  // عنوان السكن
  'عنوان السكن الحالي': 'current_address',
  'السكن الحالي': 'current_address',
  'العنوان الحالي': 'current_address',

  // تاريخ الواقعة
  'تاريخ الواقعة': 'incident_date',
  'تاريخ الحادثة': 'incident_date',

  // التهمة
  'نوع التهمة': 'charge_type',
  التهمة: 'charge_type',

  // المبلغ
  'المبلغ الذي بذمته': 'amount_owed',
  المبلغ: 'amount_owed',
  'المبلغ المطلوب': 'amount_owed',

  // العقد والكفيل
  'العقد والكفيل': 'contract_guarantor',
  'حالة العقد والكفيل': 'contract_guarantor',

  // الشهود
  'اسم الشاهد الأول': 'first_witness',
  'اسم الشاهد الاول': 'first_witness',
  'اسم الشاهد الثاني': 'second_witness',
  'اسم الشاهد الثانيه': 'second_witness',

  // ملف المستمسكات
  'اسم ملف المستمسكات والعقد': 'documents_filename',
  'ملف المستمسكات والعقد': 'documents_filename',
  'اسم الملف': 'documents_filename',
}

/** قيم العقد والكفيل المقبولة → التخزين الداخلي */
export const CONTRACT_GUARANTOR_IMPORT_MAP: Record<string, 'yes' | 'no' | 'contract_only'> = {
  نعم: 'yes',
  لا: 'no',
  'فقط عقد': 'contract_only',
  yes: 'yes',
  no: 'no',
  contract_only: 'contract_only',
}
