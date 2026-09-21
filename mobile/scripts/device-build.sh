#!/bin/zsh
# A Release build of the app for Jordan's iPhone.
#
# Release, because the prebuilt React Native frameworks in this project
# are the Release variants (a Debug build fails to link). Signed with the
# personal team, whose profiles last seven days: a build made while the
# old profile is still valid reuses it, so the expiry printed at the end
# is the date the installed app will stop opening. Install afterwards
# with:  xcrun devicectl device install app --device <udid> <the .app>
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
cd "$(dirname "$0")/../ios" || exit 1
LOG="${DEVICE_BUILD_LOG:-/tmp/agorasphere-device-build.log}"
echo "[device] $(date +%H:%M:%S) building Release for iOS devices at $(git -C .. rev-parse --short HEAD)"
xcodebuild -workspace AgoraSphere.xcworkspace -scheme AgoraSphere -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build ONLY_ACTIVE_ARCH=YES \
  DEVELOPMENT_TEAM=283NAZ9C88 CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  build > "$LOG" 2>&1
if grep -q 'BUILD SUCCEEDED' "$LOG"; then
  echo "[device] $(date +%H:%M:%S) build succeeded"
  APP=build/Build/Products/Release-iphoneos/AgoraSphere.app
  echo "[device] profile expires: $(security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null | grep -A1 '<key>ExpirationDate</key>' | tail -1 | sed 's/<[^>]*>//g' | tr -d ' \t')"
else
  echo "[device] build failed: $(grep -m3 'error:' "$LOG" | cut -c1-240 | tr '\n' ' ')"; exit 1
fi
