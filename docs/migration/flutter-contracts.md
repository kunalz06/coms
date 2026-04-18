# COMMS Flutter Migration Contracts

This document freezes the client/backend contracts that the Flutter client must preserve.

## Architecture Audit

### Auth
- Firebase Authentication is the source of identity.
- Firebase UID maps directly to `user_profiles.id`.
- The client must send Firebase ID tokens to server endpoints that require `Authorization: Bearer <token>`.
- Profile sync writes `user_profiles` rows after registration/sign-in.

### Conversations And Messages
- `conversations.type` is `direct` or `group`.
- Direct conversations use `user_one_id` and `user_two_id`.
- Group conversations use `title`, `avatar_url`, `created_by`, and `conversation_members`.
- Messages belong to `conversation_id` and use `kind = text | image | document | voice`.
- Message content may be redacted after retention. Metadata stays in Supabase.
- Message delete/edit rules are enforced by Supabase triggers:
  - delete for everyone: 1 minute
  - edit text: 2 minutes
  - retention redaction: server-side only

### Attachments
- `message_attachments` stores Cloudinary URL, public id, resource type, filename, MIME type, and size.
- Existing upload signing endpoint: `POST /api/cloudinary/sign`.
- Documents are bounded by backend/schema size rules. Flutter must validate before upload.
- Archived attachment restore uses `GET /api/backup/attachment`.

### Contacts And Blocks
- `friendships` stores accepted/removed direct contacts.
- `blocks` stores blocker/blocked pairs.
- Direct messaging/calling must respect block checks.

### Groups
- Groups are conversations with `type = group`.
- Membership and roles live in `conversation_members`.
- Roles: `owner`, `admin`, `member`.
- Group calls are capped to 10 participants in the signaling server.

### Calling And Signaling
- Signaling endpoint is `WS /ws`.
- The client must register after socket open:
  - `{ "type": "register", "userId": "<firebase uid>" }`
- Direct call events:
  - `call-initiate`
  - `call-offer`
  - `call-answer`
  - `ice-candidate`
  - `call-reject`
  - `call-left`
  - `call-join`
  - `call-available`
  - `call-end`
  - `call-busy`
  - `call-unavailable`
- Group call events:
  - `group-call-start`
  - `group-call-join`
  - `group-call-leave`
  - `group-call-end`
  - `group-call-invite`
  - `group-call-available`
  - `group-call-ended`
  - `group-call-peer-joined`
  - `group-call-peer-left`
  - `group-call-offer`
  - `group-call-answer`
  - `group-call-ice-candidate`
- STUN/TURN configuration stays environment-driven.

### Backup, Retention, And Restore
- Google Drive backup remains server-assisted.
- Server endpoints keep Google secrets and refresh tokens out of the client.
- Flutter calls:
  - `GET /api/backup/status`
  - `POST /api/backup/google/connect`
  - `POST /api/backup/run`
  - `POST /api/backup/disable`
  - `GET /api/backup/restore?conversationId=<id>`
  - `GET /api/backup/attachment?attachmentId=<id>`
- Retention endpoint remains server/cron-only:
  - `POST /api/backup/retention`

### Notifications
- Current web push is stored in `push_subscriptions`.
- Flutter mobile should use Firebase Messaging/native notifications.
- Flutter web can later adapt browser push if needed.
- Notification content must not leak hidden or locked chat previews.

### Privacy And Hidden/Lock Features
- New privacy features must not leak through:
  - global search
  - notifications
  - deep links
  - archive restore
  - conversation lists
- Credential material must be hashed, never stored as plaintext.

## Route/API Inventory

Server routes to preserve:
- `POST /api/cloudinary/sign`
- `GET /api/files/download`
- `GET /api/backup/status`
- `POST /api/backup/google/connect`
- `GET /api/backup/google/callback`
- `POST /api/backup/run`
- `POST /api/backup/disable`
- `GET /api/backup/restore`
- `GET /api/backup/attachment`
- `POST /api/backup/retention`
- `POST /api/notifications/message-push`
- `GET /healthz`
- `WS /ws`

## Feature Flags

The Flutter client should gate unfinished work with feature flags:
- `globalSearch`
- `callTab`
- `callReconnectUx`
- `chatLock`
- `hiddenChats`
- `privacyPasswordReset`
- `fileCompression`

