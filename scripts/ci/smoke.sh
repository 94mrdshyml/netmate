#!/usr/bin/env bash
# Reads the deployed URL from the deploy log and checks the live site.
set -euo pipefail

log="${1:?usage: smoke.sh <deploy-log>}"
url="$(grep -oE 'https://[A-Za-z0-9._-]+\.workers\.dev' "$log" | head -1 || true)"
if [ -z "$url" ]; then
  echo "::error::No workers.dev URL found in $log"
  exit 1
fi
echo "Smoke testing $url"

for attempt in 1 2 3 4 5 6; do
  body="$(curl -fsS --max-time 20 "$url/" || true)"
  if echo "$body" | grep -q "D1 binding" && echo "$body" | grep -q "ok"; then
    if echo "$body" | grep -qE 'D1 binding: (<!-- -->)?ok' && echo "$body" | grep -qE 'R2 binding: (<!-- -->)?ok'; then
      echo "Live site reaches D1 and R2."
      exit 0
    fi
  fi
  echo "Attempt $attempt not ready, retrying in 10s"
  sleep 10
done

echo "::error::Live site did not report D1 and R2 as ok"
exit 1
