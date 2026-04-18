# COMMS Flutter Migration Plan

## Current Execution Status
- Phase 1-4: completed baseline migration and chat/contact flows.
- Phase 5: in progress (calling hardening and UX parity).
- Phase 6-9: queued in strict order after Phase 5 acceptance.

## Phase 1: Cleanup And Contract Freeze
- Preserve the Next/Node backend and API routes.
- Treat the React client as legacy during migration.
- Freeze shared backend contracts in `docs/migration/flutter-contracts.md`.
- Add Flutter feature flags for planned privacy/search/call-tab work.

## Phase 2: Flutter Bootstrap
- Create `clients/comms_flutter`.
- Add Firebase, Supabase, Riverpod, GoRouter, Dio, WebRTC, secure storage, media/file packages.
- Add responsive app shell and design system.

## Phase 3: Auth And Shell
- Firebase email/password login, registration, reset.
- Auth guard and profile bootstrap.
- Responsive navigation: bottom tabs on mobile, rail/sidebar on wide screens.

## Phase 4: Chats And Contacts
- Direct/group list.
- Realtime message stream.
- Message composer.
- Cloudinary signed uploads.
- Reactions, edit/delete, unread, pins, mutes.

## Phase 5: Calling
- Dart WebSocket signaling client.
- Direct and group WebRTC adapters.
- Call state machine, reconnect UX, call tab.

## Phase 6: Backup And Settings
- Backup status, connect, disable, backup now, restore.
- Settings, blocked contacts, theme, notification controls.

## Phase 7: Privacy
- Chat lock.
- Hidden chats.
- Privacy reset flow contract and UI.
- Notification/search/deep-link privacy filters.

## Phase 8: File Improvements
- Image compression for 5-20 MB images.
- Direct upload up to 5 MB.
- Reject oversized unsupported documents with clear messaging.

## Phase 9: Search And Polish
- Global search across unlocked/non-hidden chats.
- Jump to exact message.
- Responsive polish, tests, and release QA.
