#!/usr/bin/env bash
# Reads the deployed URL from the deploy log and checks the live site.
# A fresh instance sends "/" to /setup; a configured one sends a signed-out visitor to /sign-in.
# Both prove the Worker renders and can read D1 (the redirect itself is a database read).
set -euo pipefail

log="${1:?usage: smoke.sh <deploy-log>}"
url="$(grep -oE 'https://[A-Za-z0-9._-]+\.workers\.dev' "$log" | head -1 || true)"
if [ -z "$url" ]; then
  echo "::error::No workers.dev URL found in $log"
  exit 1
fi
echo "Smoke testing $url"

for attempt in 1 2 3 4 5 6; do
  body="$(curl -fsSL --max-time 20 "$url/" || true)"
  if echo "$body" | grep -qE 'Welcome back to'; then
    echo "Configured instance: signed-out visitors reach the sign-in page."
    exit 0
  fi
  if echo "$body" | grep -qE 'Prove it is you|Setup is not ready'; then
    echo "Fresh instance: /setup is served (the database was read to decide that)."
    exit 0
  fi
  echo "Attempt $attempt not ready, retrying in 10s"
  sleep 10
done

echo "::error::Live site did not render the sign-in page or the setup page"
exit 1
