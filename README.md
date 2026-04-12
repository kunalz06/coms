# COMMS

COMMS is a minimal messaging and audio/video calling app.

## Architecture

- **Next.js App Router + TypeScript** renders the app, auth pages, API routes, and the protected `/app` workspace.
- **Firebase Authentication** owns account creation, sign in, persistence, password reset, email updates, password updates, and profile identity.
- **Supabase** stores user profiles, friends, blocks, conversations, messages, attachments, call logs, and presence metadata. The SQL in `supabase/schema.sql` enables RLS and realtime.
- **Cloudinary** stores profile pictures, chat images, documents, and voice recordings. Signed uploads are available through `app/api/cloudinary/sign/route.ts`; an unsigned restricted preset can be used for local development.
- **WebRTC** carries direct-call media between peers. The custom Node server in `server/index.ts` uses WebSocket for direct signaling and group-call invites, while Jitsi hosts group call media.
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
```

## Database Setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Enable Realtime for the listed tables if your project UI asks for confirmation.
4. Configure Supabase Auth to accept Firebase-issued JWTs for RLS. The policies compare `auth.jwt()->>'sub'` to Firebase UIDs, so Firebase `uid` must be the JWT subject.

The schema includes:

- `user_profiles`
- `friendships`
- `blocks`
- `conversations`
- `messages`
- `message_attachments`
- `call_sessions`
- `group_call_sessions`
- `group_call_participants`
- `presence_events`

## Environment

Copy `.env.example` to `.env.local` and fill in the values.

Important notes:

- `NEXT_PUBLIC_*` values are safe browser configuration values.
- `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_PRIVATE_KEY`, and `CLOUDINARY_API_SECRET` must remain server-only.
- `NEXT_PUBLIC_TURN_URLS`, `NEXT_PUBLIC_TURN_USERNAME`, and `NEXT_PUBLIC_TURN_CREDENTIAL` are placeholders for production TURN service credentials.
- Local default signaling URL: `ws://localhost:3000/ws`.
- `NEXT_PUBLIC_JITSI_DOMAIN=meet.jit.si` is fine for testing. Use a Jitsi/JaaS domain and JWT-backed rooms before treating group calls as private production calls.

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
- Create small group chats, capped at 5 members for the current MVP.
- Manage group members with owner/admin/member roles.
- Send text, images, documents up to 5 MB, and voice notes.
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
- Group calls are routed through Jitsi instead of a browser mesh or self-hosted SFU. COMMS still uses `/ws` to show incoming group call popups to members.

## Tradeoffs

- Direct Supabase client access is designed around Firebase JWT integration with Supabase RLS. If that integration is not enabled, route Supabase operations through authenticated Next.js API routes using the service role key.
- The custom Node server is the simplest stable WebSocket signaling layer. On serverless-only hosting, deploy the signaling server as a separate Node service or use a managed realtime signaling provider.
- Friend adding is immediate rather than request/accept. The schema can support pending requests later by adding another `friendships.status` value.
- Uploads include client-side validation and a virus-scan hook placeholder in `services/upload-service.ts`; wire that hook to a malware scanning service before allowing high-risk document types in production.
- Group chats reuse `conversations` with `type = 'group'` plus `conversation_members`, instead of creating parallel group message tables. This keeps direct and group messaging on the same engine.
