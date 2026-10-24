#!/usr/bin/env bash
# Decides how much of CI a push needs, and prints two lines for the workflow to read:
#   code=true|false   false when every changed file is documentation (nothing to build, test or deploy)
#   heavy=true|false  true when the slow checks (unit, integration, build, browser tests) should run
#
# The slow checks run on every push to a branch that changes code. They do not run again after a merge to main:
# the pull request already ran them on the same code, and the deploy job builds the app itself (a type error or a
# broken build stops it before anything is uploaded). A manual run (workflow_dispatch) runs everything.
# Any doubt means "run everything": a failure to work out the changed files never skips a check.
set -uo pipefail

event="${EVENT:-push}"
ref="${REF:-}"
before="${BEFORE:-}"
head_sha="${HEAD_SHA:-HEAD}"
zero="0000000000000000000000000000000000000000"

if [ "$event" != "push" ]; then
  echo "code=true"
  echo "heavy=true"
  exit 0
fi

if [ -z "$before" ] || [ "$before" = "$zero" ]; then
  git fetch --no-tags --quiet origin main >/dev/null 2>&1 || true
  range="origin/main...${head_sha}"
else
  range="${before}..${head_sha}"
fi

if ! files="$(git diff --name-only "$range" 2>/dev/null)" || [ -z "$files" ]; then
  # Could not tell (or nothing changed, as on a branch with no new files): run everything.
  code=true
else
  code=false
  while IFS= read -r file; do
    case "$file" in
      docs/*|*.md|LICENSE|.github/ISSUE_TEMPLATE/*) ;;
      *) code=true; break ;;
    esac
  done <<< "$files"
fi

heavy=false
if [ "$code" = "true" ] && [ "$ref" != "refs/heads/main" ]; then
  heavy=true
fi

echo "code=$code"
echo "heavy=$heavy"
