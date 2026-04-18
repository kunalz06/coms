# COMMS

COMMS is now a Flutter-first client with a Node support backend.

## Main App (Flutter)

- Primary client: `clients/comms_flutter`
- Platforms: Web, Android, iOS
- Flutter is the default development and deployment workflow.

## Support Backend (Node + Next Runtime)

The backend remains in the repository for API and signaling compatibility during migration:

- WebSocket signaling: `WS /ws`
- Health: `GET /healthz`
- API routes: `app/api/*`
- Server entry: `server/index.ts`

This backend is not the primary frontend anymore.

## Repository Workflow

Root scripts now default to Flutter:

```bash
npm run dev
npm run build
```

Backend scripts are explicit:

```bash
npm run backend:dev
npm run backend:build
npm run backend:start
```

Legacy Next frontend build command remains for compatibility only:

```bash
npm run legacy:web:build
```

## Local Setup

1. Create root env:
   - Copy `.env.example` to `.env.local`
2. Generate Flutter env from root env:

```powershell
cd clients\comms_flutter
.\tool\make_env.ps1
```

3. Run Flutter web locally:

```powershell
cd ..\..
npm run dev
```

4. Run backend signaling/API support server:

```powershell
npm run backend:dev
```

## Deployment Model

### Frontend

- Deploy Flutter web output to Vercel from `clients/comms_flutter/build/web`.

### Backend

- Keep backend/signaling on Render (or equivalent Node host).
- Flutter must point to backend via:
  - `COMMS_API_BASE_URL`
  - `COMMS_SIGNALING_URL`

## Vercel Notes

- Vercel config is in `vercel.json`.
- Build script installs Flutter in CI and builds `clients/comms_flutter`.
- Output directory is `clients/comms_flutter/build/web`.

## Migration Status

- Flutter is the main client.
- Backend contracts are frozen under `docs/migration`.
- Legacy Next frontend is retained as non-primary migration support code.
