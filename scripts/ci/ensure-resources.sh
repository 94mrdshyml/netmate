#!/usr/bin/env bash
# Creates the D1 database and R2 bucket for the official instance if they do
# not exist yet, then writes the D1 id into wrangler.jsonc (for this CI run only).
# The Cloudflare account is shared with other projects: only touch netmate-* names.
set -euo pipefail

DB_NAME="netmate-db"
BUCKET="netmate-media"

if ! bunx wrangler d1 info "$DB_NAME" >/dev/null 2>&1; then
  echo "Creating D1 database $DB_NAME"
  bunx wrangler d1 create "$DB_NAME" --location apac
fi

DB_ID="$(bunx wrangler d1 info "$DB_NAME" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.uuid||j.id||j.database_id)})')"
if [ -z "$DB_ID" ] || [ "$DB_ID" = "undefined" ]; then
  echo "::error::Could not read the D1 id for $DB_NAME"
  exit 1
fi
node scripts/ci/set-d1-id.mjs "$DB_ID"

if ! bunx wrangler r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "Creating R2 bucket $BUCKET"
  bunx wrangler r2 bucket create "$BUCKET" --location apac
fi
