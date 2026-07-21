# تقرير جلسة QA — 15 دقيقة (2026-07-21)

كلمة مرور مستخدمي QA: `QaTest12`  
حسابات: `qa_admin`, `qa_legal`, `qa_clm`, `ali123`, `qa_acct_branch`, `qa_acct_gen`, `qa_lawyer`, `qa_delegate`, `qa_pfu`

---

## ما نجح

| الدور | النتيجة |
|--------|---------|
| **مدير** `qa_admin` | دخول، لوحة، مالية، عمليات، فروع/قوائم |
| **مسؤول مدنية** `qa_legal` | وصول كامل تقريباً؛ محفظة مسؤول المدنية مرفوضة ✓ |
| **مسؤول جزائيات** `qa_clm` / `ali123` | عمليات + تقارير + إعدادات + سجل نشاط؛ **بدون مالية/مندوبين/جاري تسديد**؛ نطاق جزائي فقط في اللوحة |
| **محاسب فرع/عام** | مهام مرفوضة؛ مالية ومدينون OK |
| **محامي / مندوب** | توجيه لـ `/lawyer` و `/delegate` |
| **متابعة تسديد** | لوحة + تسديدات؛ مهام/مالية مرفوضة؛ `/admin/dashboard` يُحوَّل للوحته |
| **انتظار الإسناد** `qa-awaiting-assignment` | **19/19 OK** |

سكربت: `scripts/qa-role-matrix.mjs` + تقارير JSON في `scripts/`.

---

## أعطال حقيقية مكتشفة

### 1) Hydration mismatch — صفحة التسديدات (وغالباً AdminLayout)
- الظاهرة: شارة Next.js «React hydration error» على `/admin/payments`
- المصدر المشار إليه: `app/admin/layout.tsx`
- الشدة: متوسطة (UI/DevTools ضوضاء؛ قد تسبب ومضات)

### 2) إنشاء مدين جزائي عبر API لا ينشئ مهمة أولية
- في `app/api/admin/debtors/route.ts`: الشرط `if (taskDefinitionId && !isCriminal)` يتجاهل تعريف المهمة للجزائي دائماً → `taskId: null`
- النتيجة: سكربت `qa-workflow-civil-criminal` يفشل عند التكليف (`uuid: "null"`)
- ملاحظة: قد يكون مقصوداً (الجزائي يدخل «تحت إسناد مهمة»)، لكن مسار الاعتماد الجزائي يتعطل في الاختبارات

### 3) اعتماد إنجاز جزائي API → 400 «بيانات غير صالحة»
- `qa-workflow-civil-criminal`: civil approve 200؛ criminal approve 400
- يحتاج تتبع في `approve-task` / `task-transition` مع `taskId` صالح

### 4) RLS دور متابعة التسديد — رؤية زائدة + منع إدراج تسديد
- `qa-payment-follow-up`: **FAIL 2**
  - يرى مدينين `active` و`other` وليس فقط `payment_in_progress`
  - إدراج تسديد كدور PFU يُرفض برسالة عن تعديل الأرصدة/المهام
- الشدة: عالية لخصوصية البيانات / قدرة الدور على العمل

### 5) سكربت عدم الالتزام
- فشل لأن «حسن عبدالوهاب حسن» حالته `active` وليس `payment_in_progress` (بيانات وليست بالضرورة عطل كود)

---

## صلاحيات مسؤول الجزائيات (تحقق متصفح حي)

- القائمة: عمليات + تقارير + إعدادات الفرع + سجل النشاط — **بدون** قسم «المالية» وبدون مندوبين
- `/admin/payments` → «صلاحية غير كافية — المالية غير متاحة لقسمك» ✓
- اللوحة: عناوين جزائية فقط؛ بدون كروت جاري التسديد / عدم الالتزام ✓

---

## ملفات التقارير

- `scripts/qa-role-matrix-report.json`
- `scripts/qa-workflow-civil-criminal-report.json`
- `scripts/qa-awaiting-assignment-report.json`
- `scripts/qa-out-*.txt`
