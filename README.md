# COMMS

COMMS is a minimal messaging and audio/video calling app.

## Architecture

- **Next.js App Router + TypeScript** renders the app, auth pages, API routes, and the protected `/app` workspace.
- **Firebase Authentication** owns account creation, sign in, persistence, password reset, email updates, password updates, and profile identity.
- **Supabase** stores user profiles, friends, blocks, conversations, messages, attachments, call logs, and presence metadata. The SQL in `supabase/schema.sql` enables RLS and realtime.
- **Cloudinary** stores profile pictures, chat images, documents, and voice recordings. Signed uploads are available through `app/api/cloudinary/sign/route.ts`; an unsigned restricted preset can be used for local development.
- **Google Drive backup** stores user-enabled batched chat archives in the user's app-specific Drive storage. Supabase keeps archive metadata and retention pointers.
- **PWA support** is provided by `app/manifest.ts` and `public/comms-sw.js`, with installability and offline shell caching.
- **WebRTC** carries direct and small-group call media between peers. The custom Node server in `server/index.ts` uses WebSocket for direct and group-call signaling.
- **Zustand** stores app UI selection and theme.
- **Zod + React Hook Form** validate auth, settings, and composer forms.

## Folder Structure

```txt
app/                 Next.js routes, layout, API handlers
components/          Shared UI and providers
features/            Auth, contacts, chats, calls, settings
hooks/               Reusable client hooks
lib/                 Firebase, Supabase, Cloudinary, validators, utilities
services/            Supabase and upload service functions
server/              Next.js custom server with WebSocket signaling
store/               Zustand stores
supabase/            Database schema and RLS policies
types/               Shared TypeScript types
public/comms-sw.js   Service worker for PWA shell and push notification handling
```

## Database Setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Enable Realtime for the listed tables if your project UI asks for confirmation.
4. Configure Supabase Auth to accept Firebase-issued JWTs for RLS. The policies compare `auth.jwt()->>'sub'` to Firebase UIDs, so Firebase `uid` must be the JWT subject.

The schema includes:

- `user_profiles`
- `notification_settings`
- `backup_preferences`
- `archive_batches`
- `message_archives`
- `friendships`
- `blocks`
- `conversations`
- `conversation_mutes`
- `messages`
- `message_attachments`
- `message_reactions`
- `call_sessions`
- `group_call_sessions`
- `group_call_participants`
- `presence_events`

## Environment

Copy `.env.example` to `.env.local` and fill in the values.

Important notes:

- `NEXT_PUBLIC_*` values are safe browser configuration values.
- `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_PRIVATE_KEY`, and `CLOUDINARY_API_SECRET` must remain server-only.
- `GOOGLE_DRIVE_CLIENT_SECRET`, `BACKUP_OAUTH_STATE_SECRET`, `BACKUP_TOKEN_ENCRYPTION_KEY`, and `BACKUP_RETENTION_SECRET` must remain server-only.
- `NEXT_PUBLIC_TURN_URLS`, `NEXT_PUBLIC_TURN_USERNAME`, and `NEXT_PUBLIC_TURN_CREDENTIAL` are placeholders for production TURN service credentials. TURN is especially important for reliable group calls.
- Local default signaling URL: `ws://localhost:3000/ws`.

## Firebase Setup

1. Create a Firebase project.
2. Enable Email/Password sign-in.
3. Add a web app and copy the client config into `.env.local`.
4. Create a service account and add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.

## Cloudinary Setup

Preferred production setup:

1. Add `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.
2. The app will request a signed upload from `/api/cloudinary/sign`.

Development fallback:

1. Create a restricted unsigned preset.
2. Set `NEXT_PUBLIC_CLOUDINARY_UNSIGNED_PRESET`.
3. Restrict allowed formats and max file size in Cloudinary as a second line of defense.

COMMS also validates upload size and MIME type before sending files.

## Google Drive Backup Setup

COMMS uses the Google Drive `appDataFolder` scope so archive files stay in app-specific hidden storage instead of cluttering the user's Drive.

1. Open Google Cloud Console and create or select a project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID with type `Web application`.
5. Add redirect URIs:
   - `http://localhost:3000/api/backup/google/callback`
   - `https://your-production-domain.com/api/backup/google/callback`
6. Add the client values to `.env.local`:

```bash
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
BACKUP_OAUTH_STATE_SECRET=long-random-string
BACKUP_TOKEN_ENCRYPTION_KEY=long-random-string
BACKUP_RETENTION_SECRET=long-random-string
```

Backup flow:

- Users open Settings and choose `Enable backup`.
- COMMS sends them through Google OAuth with the Drive app-data scope.
- Refresh/access tokens are encrypted server-side before storage in `backup_preferences`.
- `Backup now` and background backup after sending messages call `/api/backup/run`.
- Archives are batched by conversation and message date as JSON files.
- Archive metadata is stored in `archive_batches`; per-user message pointers are stored in `message_archives`.

Restore flow:

- The chat hook loads Supabase messages first.
- If older message content has been redacted, COMMS checks IndexedDB via `lib/archive-cache.ts`.
- If not cached, COMMS calls `/api/backup/restore?conversationId=...`, fetches the Drive archive server-side, reconstructs message content, and caches the restored payload locally.

Retention cleanup:

- Call `POST /api/backup/retention` from a scheduler with `Authorization: Bearer $BACKUP_RETENTION_SECRET`.
- The cleanup job scans messages past `retention_expires_at`.
- It only redacts message content when every backup-enabled participant has a successful archive pointer for that message.
- It removes primary `message_attachments` rows for redacted messages after archive coverage exists, while the archive keeps attachment metadata for restore.
- It preserves conversation/message metadata and marks skipped or partial messages without deleting conversation structure.

For Render, run the retention endpoint from a cron service or external scheduler every few hours. For local testing:

```bash
curl -X POST http://localhost:3000/api/backup/retention -H "Authorization: Bearer your-secret"
```

## PWA Setup

PWA files are already included:

- `app/manifest.ts` defines install metadata, theme color, and standalone behavior.
- `public/comms-sw.js` caches safe shell/static assets and handles push notification clicks.
- `features/pwa/pwa-provider.tsx` registers the service worker and exposes the install prompt in Settings.

The service worker intentionally avoids caching `/api/*` so authenticated dynamic data is not stored incorrectly. Restored archives use IndexedDB through `lib/archive-cache.ts` instead.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The `dev` script runs the custom Next.js server and WebSocket signaling server on the same port.

Production build:

```bash
npm run build
npm run start
```

## Product Flows

- Register with name, email, password, and optional avatar.
- Sign in, persist session, reset password, sign out.
- Search users by registered email.
- Add friends, delete friends, block and unblock contacts.
- Open one-to-one conversations with realtime messages.
- Create small group chats, capped at 10 members for the current MVP.
- Manage group members with owner/admin/member roles.
- Send text, images, documents up to 5 MB, and voice notes.
- React to messages with quick emojis, custom emoji, or short text reactions.
- Turn browser notifications and call ringtone on or off, and mute specific direct chats or groups.
- Enable Google Drive backup once, run manual backup, and restore older archived messages from Drive.
- Install COMMS as a PWA on supported browsers.
- Start one-to-one or group audio/video calls.
- Accept, reject, end, mute mic, toggle camera, and switch between audio and video.

## Calling Stability Notes

- One `RTCPeerConnection` is owned by the call provider for each active call.
- The provider queues ICE candidates until a remote description exists.
- Offers, answers, ICE candidates, reject, end, busy, and unavailable states are handled explicitly.
- Media tracks and peer connections are closed on call end, disconnect, route unmount, and failed connection states.
- The signaling server tracks active users and returns busy/unavailable states to prevent duplicate peer connection bugs.
- Call UI state is constrained by a strict state machine in `lib/call-state.ts`.
- Add a production TURN service before deploying outside a local network. STUN alone is not enough for all NAT/firewall conditions.
- Group calls use a browser mesh WebRTC model through the same `/ws` signaling server. This is capped at 10 participants for the MVP; add an SFU before increasing that cap further.

## Tradeoffs

- Direct Supabase client access is designed around Firebase JWT integration with Supabase RLS. If that integration is not enabled, route Supabase operations through authenticated Next.js API routes using the service role key.
- The custom Node server is the simplest stable WebSocket signaling layer. On serverless-only hosting, deploy the signaling server as a separate Node service or use a managed realtime signaling provider.
- Friend adding is immediate rather than request/accept. The schema can support pending requests later by adding another `friendships.status` value.
- Uploads include client-side validation and a virus-scan hook placeholder in `services/upload-service.ts`; wire that hook to a malware scanning service before allowing high-risk document types in production.
- Retention cleanup removes archived attachment references from Supabase, but it does not delete Cloudinary objects yet. Add Cloudinary Admin API deletion once your retention policy for media objects is finalized.
- Group chats reuse `conversations` with `type = 'group'` plus `conversation_members`, instead of creating parallel group message tables. This keeps direct and group messaging on the same engine.
