#!/usr/bin/env python3
"""Configure fresh Flutter platform runners in CI without checking in generated code."""
from __future__ import annotations

import plistlib
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID_NS = "http://schemas.android.com/apk/res/android"

ANDROID_PERMISSIONS = (
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.BLUETOOTH",
    "android.permission.BLUETOOTH_CONNECT",
)


def configure_android() -> None:
    manifest = ROOT / "android/app/src/main/AndroidManifest.xml"
    if not manifest.is_file():
        raise FileNotFoundError(f"Flutter Android scaffold missing: {manifest}")
    ET.register_namespace("android", ANDROID_NS)
    tree = ET.parse(manifest)
    root = tree.getroot()
    attr = f"{{{ANDROID_NS}}}name"
    existing = {element.get(attr) for element in root.findall("uses-permission")}
    for name in ANDROID_PERMISSIONS:
        if name not in existing:
            root.insert(0, ET.Element("uses-permission", {attr: name}))
    application = root.find("application")
    if application is None:
        raise ValueError("Android application element is missing")
    application.set(f"{{{ANDROID_NS}}}label", "COMMS")
    tree.write(manifest, encoding="utf-8", xml_declaration=True)

    # Flutter generates Kotlin Gradle files dynamically in CI. Align their
    # minimum SDK and NDK with the plugins for voice recording and WebRTC.
    gradle_file = ROOT / "android/app/build.gradle.kts"
    if not gradle_file.is_file():
        raise FileNotFoundError(f"Flutter Android Gradle scaffold missing: {gradle_file}")
    gradle = gradle_file.read_text()
    gradle, ndk_count = re.subn(
        r"(?m)^(\\s*)ndkVersion\\s*=\\s*flutter\\.ndkVersion\\s*$",
        r'\\g<1>ndkVersion = "27.0.12077973"',
        gradle,
    )
    gradle, sdk_count = re.subn(
        r"(?m)^(\\s*)minSdk\\s*=\\s*flutter\\.minSdkVersion\\s*$",
        r"\\g<1>minSdk = 23",
        gradle,
    )
    if ndk_count != 1 or sdk_count != 1:
        raise ValueError(f"Unexpected Android Gradle layout: ndk={ndk_count}, minSdk={sdk_count}")
    gradle_file.write_text(gradle)


def configure_ios() -> None:
    info_path = ROOT / "ios/Runner/Info.plist"
    if not info_path.is_file():
        raise FileNotFoundError(f"Flutter iOS scaffold missing: {info_path}")
    with info_path.open("rb") as file:
        info = plistlib.load(file)
    info.update({
        "CFBundleDisplayName": "COMMS",
        "NSCameraUsageDescription": "COMMS uses the camera for video calls and meetings.",
        "NSMicrophoneUsageDescription": "COMMS uses the microphone for calls and voice messages.",
        "NSPhotoLibraryUsageDescription": "Select photos and videos to share in chats.",
        "NSPhotoLibraryAddUsageDescription": "Save shared photos and videos.",
    })
    with info_path.open("wb") as file:
        plistlib.dump(info, file)

    podfile = ROOT / "ios/Podfile"
    if podfile.exists():
        contents = podfile.read_text()
        contents = re.sub(
            r"(?m)^#?\s*platform :ios, ['\"][^'\"]+['\"]",
            "platform :ios, '14.0'",
            contents,
            count=1,
        )
        if "platform :ios, '14.0'" not in contents:
            contents = "platform :ios, '14.0'\n" + contents
        podfile.write_text(contents)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"android", "ios"}:
        raise SystemExit("Usage: python3 tool/configure_native.py android|ios")
    {"android": configure_android, "ios": configure_ios}[sys.argv[1]]()
    print(f"Configured Flutter {sys.argv[1]} runner")
