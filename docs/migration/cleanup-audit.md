# COMMS Cleanup Audit

## Keep
- `server/`: signaling, health, group-call manager, Next request handling.
- `app/api/`: Cloudinary, backup, restore, retention, notifications, file download.
- `supabase/schema.sql`: schema, RLS, realtime, functions, triggers.
- `types/index.ts`: source contract for Flutter models.
- `services/`: useful behavior reference for Flutter data repositories.
- `public/comms-sw.js`: legacy web client support while migration is in progress.

## Legacy Client During Migration
- `app/(auth)`, `app/(protected)`, `features/*`, `components/*`, `hooks/*`, `store/*`, and most browser-only `lib/*` are retained as reference/legacy web client code.
- React/Next frontend is now non-primary and archived for migration support.
- Do not add net-new product UI to the legacy React frontend.

## Cleanup Decision
- No destructive deletion in this phase.
- Dead-code removal is deferred until Flutter reaches equivalent auth/chat/call coverage.
- Backend-sensitive files are isolated by documentation rather than moved, because current Render deployment depends on the Next custom server structure.
