#!/bin/sh
set -eu
skill_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/cleanup-skill.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
cp -R "$skill_dir/assets/app" "$test_dir/app"
(cd "$test_dir/app/bridge" && npm ci --ignore-scripts --no-audit --no-fund)
PYTHONDONTWRITEBYTECODE=1 python3 "$skill_dir/scripts/test_executor.py"
CLEANUP_TEST_APP="$test_dir/app" node --test "$skill_dir/scripts/test_bridge.mjs"
