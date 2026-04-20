# COMMS

Flutter is now the main app at repository root.

## Main client

- Flutter source: root (`lib`, `android`, `ios`, `web`)
- Platforms: Web, Android, iOS

Run locally:

```bash
flutter pub get
flutter run -d chrome --dart-define-from-file=env/local.json
```

Build web:

```bash
flutter build web --release --dart-define-from-file=env/local.json
```

## Backend support service

The Node service is still kept for production stability:

- Signaling: `WS /ws`
- Health check: `GET /healthz`
- API handlers: `app/api/*`
- Server entry: `server/index.ts`

Run backend locally:

```bash
npm run backend:dev
```

## Environment

1. Copy `.env.example` to `.env.local`
2. Generate Flutter env JSON:

```powershell
.\tool\make_env.ps1
```

## Deployment

- Vercel deploys Flutter web from `build/web` using `tool/vercel_build.sh`.
- Render hosts backend/signaling (`server/index.ts` + `app/api/*`).

