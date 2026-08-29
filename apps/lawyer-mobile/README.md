# تطبيق محامي قلعة الضمان (Flutter)

## المتطلبات
- Flutter 3.22+
- Android SDK
- API يعمل على المنفذ 5088 (أو Next.js مع `/api/auth/mobile-login`)

## أول مرة

```bash
cd apps/lawyer-mobile
flutter create . --project-name qalat_lawyer_mobile --org com.qalat.lawyer
flutter pub get
```

## تشغيل (محاكي أندرويد)

`10.0.2.2` يصل إلى localhost من المحاكي.

```bash
flutter run --dart-define=SUPABASE_URL=https://YOUR.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY \
  --dart-define=API_BASE_URL=http://10.0.2.2:5088 \
  --dart-define=NEXT_BASE_URL=https://qalatlaw.com
```

## بناء APK تجريبي

```bash
flutter build apk --release \
  --dart-define=SUPABASE_URL=https://YOUR.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY \
  --dart-define=API_BASE_URL=https://api-lawyer.qalatlaw.com \
  --dart-define=NEXT_BASE_URL=https://qalatlaw.com
```

الملف الناتج: `build/app/outputs/flutter-apk/app-release.apk`

## الشاشات
- دخول (نفس يوزر الويب)
- الرئيسية + عدّادات
- قائمة المهام + فلاتر
- تفاصيل: قبول/رفض، إنجاز + GPS، رفع مرفق
- حسابي: محفظة + طلب سحب
