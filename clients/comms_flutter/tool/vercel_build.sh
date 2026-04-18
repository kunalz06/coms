#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FLUTTER_DIR="$ROOT_DIR/clients/comms_flutter"
FLUTTER_VERSION="${FLUTTER_VERSION:-3.29.2}"
FLUTTER_HOME="/tmp/flutter-sdk"

if [ ! -x "$FLUTTER_HOME/bin/flutter" ]; then
  rm -rf "$FLUTTER_HOME"
  mkdir -p "$FLUTTER_HOME"
  curl -sSL "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
    | tar -xJ -C /tmp
  mv /tmp/flutter "$FLUTTER_HOME"
fi

export PATH="$FLUTTER_HOME/bin:$PATH"

flutter --version
flutter config --enable-web

cd "$FLUTTER_DIR"
flutter pub get

if [ ! -f "env/vercel.json" ]; then
  echo "Missing clients/comms_flutter/env/vercel.json"
  exit 1
fi

flutter build web --release --dart-define-from-file=env/vercel.json
