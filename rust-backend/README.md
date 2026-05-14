# COMMS Rust Backend

Web/PWA-only backend for COMMS notifications and calling support.

## Run locally

```powershell
cd rust-backend
$env:DATABASE_URL="postgresql://..."
$env:FIREBASE_PROJECT_ID="your-firebase-project-id"
$env:FCM_PROJECT_ID="your-firebase-project-id"
$env:FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
$env:FRONTEND_URL="http://localhost:8080"
$env:CORS_ALLOWED_ORIGINS="http://localhost:8080,https://comms1.vercel.app"
cargo run
```

## Required SQL

Run `supabase/web_pwa_notifications.sql` in Supabase before starting this service.
