# COMMS Flutter Client

This folder is the primary COMMS app client for web, Android, and iOS.

## Local Development

```powershell
cd clients\comms_flutter
flutter pub get
.\tool\make_env.ps1
flutter run -d chrome --dart-define-from-file=env\local.json
```

Run backend signaling/API separately from repo root:

```powershell
npm run backend:dev
```

## Vercel Build

Vercel uses:

- `../../vercel.json`
- `tool/vercel_build.sh`
- `env/vercel.json`

Set `env/vercel.json` with production values:

- `COMMS_API_BASE_URL` pointing to backend host
- `COMMS_SIGNALING_URL` pointing to backend `/ws`
- Supabase and Cloudinary public config values

Backend CORS must allow your Vercel frontend origin through `ALLOWED_ORIGIN`.
