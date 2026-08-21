#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
extension_dir="$script_dir/Extension"
bundle_identifier="${1:-com.example.chatgpttools.safari}"
project_location="${2:-$script_dir/SafariApp}"
platform="${3:-all}"

if [[ -e "$project_location" ]]; then
  print -u2 "Refusing to overwrite existing path: $project_location"
  print -u2 "Move it elsewhere or pass a different project location."
  exit 1
fi

if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  packager="safari-web-extension-packager"
elif xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  packager="safari-web-extension-converter"
else
  print -u2 "Safari Web Extension Packager was not found."
  print -u2 "Install full Xcode, then select it with xcode-select before running this script."
  exit 1
fi

platform_arguments=()
case "$platform" in
  all)
    ;;
  macos)
    platform_arguments+=(--macos-only)
    ;;
  ios)
    platform_arguments+=(--ios-only)
    ;;
  *)
    print -u2 "Platform must be one of: all, macos, ios"
    exit 1
    ;;
esac

xcrun "$packager" "$extension_dir" \
  --project-location "$project_location" \
  --app-name "ChatGPT Tools Safari" \
  --bundle-identifier "$bundle_identifier" \
  --swift \
  --no-open \
  --no-prompt \
  "${platform_arguments[@]}"

print "Safari project created at: $project_location"
print "Open the generated .xcodeproj, select your signing team, then build and run."
