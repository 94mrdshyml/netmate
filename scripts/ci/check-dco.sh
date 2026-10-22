#!/usr/bin/env bash
# Fails if any commit in the pushed range lacks a "Signed-off-by:" line.
# Merge commits and pushes to main are skipped: main only receives PRs that
# were already checked on their own branch.
set -euo pipefail

if [ "${REF:-}" = "refs/heads/main" ]; then
  echo "Push to main: DCO was checked on the PR branch. Skipping."
  exit 0
fi

case "${REF:-}" in
  refs/heads/release-please--*|refs/heads/dependabot/*)
    echo "Bot branch (${REF}): bots cannot sign off. A maintainer reviews the PR. Skipping."
    exit 0
    ;;
esac

zero="0000000000000000000000000000000000000000"
if [ -z "${BEFORE:-}" ] || [ "$BEFORE" = "$zero" ]; then
  git fetch --no-tags --quiet origin main || true
  range="origin/main..${HEAD_SHA}"
else
  range="${BEFORE}..${HEAD_SHA}"
fi

missing=0
for sha in $(git rev-list --no-merges "$range"); do
  if ! git log -1 --format=%B "$sha" | grep -qiE '^Signed-off-by: .+ <.+>'; then
    echo "::error::Commit $sha has no Signed-off-by line (use git commit -s): $(git log -1 --format=%s "$sha")"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  exit 1
fi
echo "All commits in $range are signed off."
