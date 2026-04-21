# COMMS Sideload Build Guide (APK + IPA)

This project is configured for direct distribution builds without Play Store/App Store publishing.

## Android APK (no Play Store)

Recommended local toolchain:
- Android Studio current stable
- JDK 17 for Gradle builds
- Android SDK Platform 35 installed

1. Create a release key:
   - `keytool -genkey -v -keystore comms-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias comms`
2. Place `comms-release-key.jks` at repo root.
3. Copy `android/key.properties.example` to `android/key.properties` and set real values.
4. Build release APK:
   - `flutter build apk --release --dart-define-from-file=env/production.json`
5. Output:
   - `build/app/outputs/flutter-apk/app-release.apk`

Notes:
- If `android/key.properties` is missing, build config falls back to debug signing for local testing only.
- Use release signing for production sideloading.
- If Gradle still reports a JDK image / `jlink` transform error after this update:
  - `flutter clean`
  - delete `android/.gradle`
  - delete `%USERPROFILE%\.gradle\caches\transforms-3`
  - rerun `flutter pub get`
  - rebuild the APK

## iOS IPA (no App Store)

Prerequisites:
- macOS + Xcode
- Apple Developer account (free/dev account works for personal sideload; paid recommended for broader distribution)
- Valid provisioning profile for your bundle id

1. Keep using workspace:
   - `ios/Runner.xcworkspace`
2. In Xcode:
   - Select Runner target
   - Set Team
   - Set unique Bundle Identifier
   - Enable automatic signing
3. Install pods:
   - `flutter pub get`
   - `cd ios && pod install && cd ..`
4. Build archive:
   - `flutter build ipa --release --dart-define-from-file=env/production.json --export-options-plist=ios/ExportOptions-AdHoc.plist`
5. Output:
   - `build/ios/ipa/*.ipa`

Notes:
- This uses Ad Hoc export options, not App Store export.
- For personal-device installs, Development export can also be used via Xcode Organizer.
- If pods were installed before this setup, run `cd ios && pod deintegrate && pod install && cd ..`.
