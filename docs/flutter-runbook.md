# COMMS Flutter Runbook

## Dart Defines

Run Flutter with the existing backend values:

```powershell
flutter run -d chrome `
  --dart-define=COMMS_API_BASE_URL=https://comms-qo3y.onrender.com `
  --dart-define=COMMS_SIGNALING_URL=wss://comms-qo3y.onrender.com/ws `
  --dart-define=SUPABASE_URL=https://tdvhiarzoqzvuavwrxfz.supabase.co `
  --dart-define=SUPABASE_ANON_KEY=replace-with-anon-key `
  --dart-define=FIREBASE_API_KEY=replace-with-firebase-api-key `
  --dart-define=FIREBASE_AUTH_DOMAIN=comms-426a1.firebaseapp.com `
  --dart-define=FIREBASE_PROJECT_ID=comms-426a1 `
  --dart-define=FIREBASE_STORAGE_BUCKET=comms-426a1.firebasestorage.app `
  --dart-define=FIREBASE_MESSAGING_SENDER_ID=88729314159 `
  --dart-define=FIREBASE_APP_ID=1:88729314159:web:0c4eb3d724cafc55bbbe9a
```

## Platform Generation

The Flutter SDK in this environment timed out while running `flutter create`. Once it responds normally:

```powershell
cd clients\comms_flutter
flutter create --platforms=web,android,ios .
flutter pub get
flutter analyze
flutter test
```

Keep existing COMMS files when prompted.

## Current Migration State

- Backend contracts are frozen in `docs/migration`.
- Flutter app bootstrap, router, theme, auth shell, chat shell, backup shell, privacy shell, notification shell, and signaling client skeleton are present.
- Full feature parity work continues phase-by-phase.

