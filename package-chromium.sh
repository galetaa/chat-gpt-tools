#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
output_path="${1:-$script_dir/ChatGPT-Tools-Chromium.zip}"
build_root="$script_dir/Build/ChromiumExtension"
archive_temp_dir="$(mktemp -d)"
archive_temp_path="$archive_temp_dir/ChatGPT-Tools-Chromium.zip"

if [[ "$output_path" != /* ]]; then
  output_path="$PWD/$output_path"
fi

node "$script_dir/tools/build-chromium.mjs"

cd "$build_root"
zip -Xqr "$archive_temp_path" . -x '*.DS_Store'
mv "$archive_temp_path" "$output_path"
rmdir "$archive_temp_dir"

print "Chromium package created at: $output_path"
