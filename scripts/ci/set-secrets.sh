#!/usr/bin/env bash
# Sets the Worker secrets the app needs from GitHub Actions secrets of the same name.
# CI only. Skips with a notice when they are not all present, so the live /setup page then
# lists what is missing instead of the deploy failing.
set -euo pipefail

missing=()
for name in SETUP_TOKEN AUTH_SECRET SETTINGS_ENCRYPTION_KEY; do
  if [ -z "${!name:-}" ]; then missing+=("$name"); fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::notice::Not setting Worker secrets: GitHub secrets missing: ${missing[*]}"
  exit 0
fi

file="$(mktemp)"
trap 'rm -f "$file"' EXIT
node -e '
  const { SETUP_TOKEN, AUTH_SECRET, SETTINGS_ENCRYPTION_KEY } = process.env;
  process.stdout.write(JSON.stringify({ SETUP_TOKEN, AUTH_SECRET, SETTINGS_ENCRYPTION_KEY }));
' > "$file"

bunx wrangler secret bulk "$file"
echo "Worker secrets set."
