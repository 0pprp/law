# تطبيقات المحامي (موبايل)

| مجلد | الوصف |
|------|--------|
| [lawyer-api](lawyer-api/) | ASP.NET Core 8 BFF — JWT سوبربيس |
| [lawyer-mobile](lawyer-mobile/) | Flutter APK للمحامي |

## تشغيل محلي سريع

### 1) API
```bash
cd apps/lawyer-api
# عبّئ appsettings.Development.json
dotnet run --urls http://0.0.0.0:5088
```

### 2) Mobile
ثبّت Flutter ثم:
```bash
cd apps/lawyer-mobile
flutter create . --project-name qalat_lawyer_mobile --org com.qalat.lawyer
# انظر README داخل المجلد لبناء APK
```

دخول الموبايل يعمل أيضاً عبر Next: `POST /api/auth/mobile-login`
