#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLUTTER_DIR="$ROOT_DIR"
FLUTTER_VERSION="${FLUTTER_VERSION:-3.29.2}"
FLUTTER_HOME="$ROOT_DIR/.flutter-sdk"
FLUTTER_ARCHIVE="/tmp/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"

# Always install a clean SDK in CI to avoid stale/corrupt cache state.
rm -rf "$FLUTTER_HOME"
mkdir -p "$ROOT_DIR"
curl -fsSL "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
  -o "$FLUTTER_ARCHIVE"
tar -xJf "$FLUTTER_ARCHIVE" -C "$ROOT_DIR"
if [ -d "$ROOT_DIR/flutter" ]; then
  mv "$ROOT_DIR/flutter" "$FLUTTER_HOME"
fi

export PATH="$FLUTTER_HOME/bin:$PATH"

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter SDK not available on PATH after install."
  ls -la /tmp
  exit 1
fi

git config --global --add safe.directory "$FLUTTER_HOME" >/dev/null 2>&1 || true

flutter --version
flutter config --enable-web

cd "$FLUTTER_DIR"
flutter pub get

if [ ! -f "env/flutter.web.vercel.json" ]; then
  echo "Missing env/flutter.web.vercel.json"
  exit 1
fi 
BUILD_ENV_FILE="$ROOT_DIR/.vercel.flutter.env.json"

node <<'NODE'
const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), 'env', 'flutter.web.vercel.json');
const buildEnvPath = path.join(process.cwd(), '.vercel.flutter.env.json');
const swPath = path.join(process.cwd(), 'web', 'firebase-messaging-sw.js');
const templatePath = path.join(process.cwd(), 'web', 'firebase-messaging-sw.template.js');
const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
for (const key of [
  'API_BASE_URL',
  'WS_BASE_URL',
  'COMMS_API_BASE_URL',
  'COMMS_SIGNALING_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'VAPID_PUBLIC_KEY',
  'FCM_WEB_VAPID_KEY',
  'STUN_URLS',
  'TURN_URLS',
  'TURN_USERNAME',
  'TURN_CREDENTIAL',
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
]) {
  if (process.env[key]) env[key] = process.env[key];
}
env.API_BASE_URL ||= env.COMMS_API_BASE_URL;
env.WS_BASE_URL ||= env.COMMS_SIGNALING_URL;
env.COMMS_API_BASE_URL ||= env.API_BASE_URL;
env.COMMS_SIGNALING_URL ||= env.WS_BASE_URL;
fs.writeFileSync(buildEnvPath, JSON.stringify(env, null, 2));
const replacements = {
  __FIREBASE_API_KEY__: env.FIREBASE_API_KEY || '',
  __FIREBASE_AUTH_DOMAIN__: env.FIREBASE_AUTH_DOMAIN || '',
  __FIREBASE_PROJECT_ID__: env.FIREBASE_PROJECT_ID || '',
  __FIREBASE_STORAGE_BUCKET__: env.FIREBASE_STORAGE_BUCKET || '',
  __FIREBASE_MESSAGING_SENDER_ID__: env.FIREBASE_MESSAGING_SENDER_ID || '',
  __FIREBASE_APP_ID__: env.FIREBASE_APP_ID || '',
};
let sw = fs.readFileSync(fs.existsSync(templatePath) ? templatePath : swPath, 'utf8');
for (const [key, value] of Object.entries(replacements)) {
  sw = sw.replaceAll(key, String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}
fs.writeFileSync(swPath, sw);
NODE

flutter build web --release --pwa-strategy=none --dart-define-from-file="$BUILD_ENV_FILE"
