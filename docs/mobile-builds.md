# COMMS mobile builds

The repository's Flutter client is currently web-first. To keep the Git tree
small, CI generates the standard Flutter `android/` and `ios/` runners
rather than checking build-tool scaffolds into source. The custom permissions
are injected by `tool/configure_native.py` in each fresh runner.

## Free GitHub Actions builds

Open **Actions → Mobile APK and unsigned IPA → Run workflow** (or open a PR).
The workflow uses GitHub-hosted `ubuntu-24.04` and `macos-15` standard
runners. These standard runners are free on this **public** repository.
Artifact retention is set to seven days to reduce storage consumption.

* **Android:** download `comms-android-apks`, extract the artifact ZIP,
  and install the APK matching your CPU architecture. Android may ask you to
  allow installation of apps from the source. CI's generated Flutter Android
  project uses **debug-key signing for the release build by default**.
  The resulting APK is installable for personal testing but is **not suitable
  for Play Store distribution**. CI-created debug signing keys are not stable
  between runs: remove a previous version before installing an update,
  or configure a persistent private release keystore.
* **iOS:** download `comms-ios-unsigned-ipa` and extract
  `Comms-unsigned.ipa`. This is a **real iPhone build, but unsigned**.
  It cannot be installed on an iPhone directly. For personal testing,
  use AltStore or Sideloadly to sign and sideload with a free Apple Account,
  where supported. Free personal-team provisioning expires after seven days;
  some capabilities (including push notifications) may be unavailable.
  Distribution through TestFlight/App Store or long-lived signed releases
  requires valid Apple Developer signing credentials and provisioning.

The IPA is compiled on GitHub's macOS/Xcode runner at no CI-minute charge on
standard public-repository runners. **Free compilation does not bypass
Apple's code-signing requirements.**

## Services and environment

Flutter mobile loads the public client configuration from
`env/flutter.web.vercel.json`. The existing Firebase Android/iOS options
in `lib/firebase_options.dart` are used at startup. Check Firebase console
for correct Android package / iOS bundle ID registrations before relying on
Firebase Authentication or messaging. **Never put service-role keys, Cloudinary
API secrets, TURN credentials, or signing certificates into dart-define files
or the repository.** Inject protected values from secure CI secrets or
server endpoints. Calls require functioning signaling on Render, valid ICE/TURN
configuration and device permissions. iOS push notifications require APNs
configuration and Apple-supported signing entitlements; unsigned builds do
not prove push works.

The workflow is configured to use the repository's present `com.example`
development IDs, not a permanent consumer application identifier. Before
public release, commit fixed native runners and use correct unique package
and bundle IDs, verified Firebase registrations, signed Android releases,
iOS provisioning and device regression tests.

## Run locally

```bash
flutter create --platforms=android,ios --project-name=comms_flutter --org=com.example .
python3 tool/configure_native.py android
python3 tool/configure_native.py ios
flutter pub get
flutter analyze
flutter test
flutter build apk --release --split-per-abi --dart-define-from-file=env/flutter.web.vercel.json
# On macOS with Xcode:
flutter build ios --release --no-codesign --dart-define-from-file=env/flutter.web.vercel.json
```

## Performance checklist

* Unified Material 3 light/dark tokens and flat gradient surfaces avoid heavy
  image or blur layers in the main navigation.
* Call signaling connection is scheduled on identity changes rather than every
  widget repaint.
* The chat list consumes an existing bulk unread stream instead of issuing an
  extra pair of database queries for each visible conversation tile.
* Global search selects only the message fields used for rendering and
  parallel-fetches its conversation and sender metadata.
* Upload code avoids copying a file buffer when it is already a `Uint8List`
  and reports progress only when the integer percentage changes.

Validate scroll smoothness, memory, network calls, WebRTC reconnection,
search result permissions, attachments, and real-device push on at least one
low-end Android device and an iPhone before release.

Sources:
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://developer.apple.com/help/account/basics/about-your-developer-account
- https://docs.flutter.dev/deployment/cd
