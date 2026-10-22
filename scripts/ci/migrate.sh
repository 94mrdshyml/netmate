#!/usr/bin/env bash
# Applies D1 migrations to the official instance. Forward-only (see CLAUDE.md).
set -euo pipefail

if ! ls migrations/*.sql >/dev/null 2>&1; then
  echo "No migrations yet. Nothing to apply."
  exit 0
fi

bunx wrangler d1 migrations apply DB --remote
