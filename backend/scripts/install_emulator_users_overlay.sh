#!/usr/bin/env bash
# Build the emulator's users overlay (services/instagram_emulator/users_overlay) and
# install it as a static overlay on the product partition, so Android keeps all four
# Android users that hold the school accounts running, and never stops one on a timer.
#
# The emulator must be running with -writable-system (controlbox emulator_arguments):
# the overlay lives in the writable system's scratch space, so an emulator started
# without the flag boots the stock system and the overlay is gone until it is again.
# Hold the emulator lock while this runs; it reboots the emulator twice at most.
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
ADB="$SDK/platform-tools/adb"
SERIAL="${SERIAL:-emulator-5554}"
SOURCE="$(cd "$(dirname "$0")/../services/instagram_emulator/users_overlay" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

"$BUILD_TOOLS/aapt2" compile --dir "$SOURCE/res" -o "$WORK/compiled.zip"
"$BUILD_TOOLS/aapt2" link -o "$WORK/unsigned.apk" --manifest "$SOURCE/AndroidManifest.xml" \
  -I "$PLATFORM" "$WORK/compiled.zip" --min-sdk-version 35 --target-sdk-version 35
"$BUILD_TOOLS/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
# Any key will do: the product partition is what makes a static overlay trusted.
keytool -genkeypair -keystore "$WORK/key.jks" -storepass overlay -keypass overlay \
  -alias overlay -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=wat2do overlay" >/dev/null 2>&1
"$BUILD_TOOLS/apksigner" sign --ks "$WORK/key.jks" --ks-pass pass:overlay \
  --out "$WORK/overlay.apk" "$WORK/aligned.apk" 2>/dev/null

boot() {
  "$ADB" -s "$SERIAL" wait-for-device
  until [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 5; done
}

"$ADB" -s "$SERIAL" root >/dev/null
sleep 3
boot
if "$ADB" -s "$SERIAL" remount 2>&1 | grep -q "reboot"; then
  # The first remount only sets the writable system up.
  "$ADB" -s "$SERIAL" reboot
  sleep 20
  boot
  "$ADB" -s "$SERIAL" root >/dev/null
  sleep 3
  boot
  "$ADB" -s "$SERIAL" remount >/dev/null
fi
"$ADB" -s "$SERIAL" push "$WORK/overlay.apk" /product/overlay/Wat2doUsersOverlay.apk >/dev/null
"$ADB" -s "$SERIAL" shell chmod 644 /product/overlay/Wat2doUsersOverlay.apk
"$ADB" -s "$SERIAL" reboot
sleep 20
boot
"$ADB" -s "$SERIAL" shell dumpsys activity users | grep -E "mMaxRunningUsers|mBackgroundUserScheduledStopTimeSecs"
