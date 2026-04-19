#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FLUTTER_DIR="$ROOT_DIR/clients/comms_flutter"
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
  echo "Missing clients/comms_flutter/env/flutter.web.vercel.json"
  exit 1
fi

flutter build web --release --pwa-strategy=none --dart-define-from-file=env/flutter.web.vercel.json
