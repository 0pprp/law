# Qalat Lawyer API (ASP.NET Core 8)

Mobile BFF for the Flutter lawyer app. Validates Supabase JWTs and exposes privileged lawyer endpoints.

## Setup

1. Copy secrets into `appsettings.Development.json` (or env vars):
   - `Supabase__Url`
   - `Supabase__AnonKey`
   - `Supabase__ServiceRoleKey`
   - `Supabase__JwtSecret` (Project Settings → API → JWT Secret)
2. Run:

```bash
cd apps/lawyer-api
dotnet restore
dotnet run --urls http://0.0.0.0:5088
```

Swagger: `http://localhost:5088/swagger`

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/auth/mobile-login` | none |
| GET | `/lawyer/me` | Bearer |
| GET | `/lawyer/wallet` | Bearer |
| POST | `/lawyer/task-assignment` | Bearer |
| POST | `/lawyer/payout-request` | Bearer |
| POST | `/lawyer/persist-task-expenses` | Bearer |
| POST | `/lawyer/complete-task` | Bearer |
| GET | `/health` | none |

Also available on Next.js: `POST /api/auth/mobile-login`
