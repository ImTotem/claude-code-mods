#!/bin/sh
# Publishes a mod's branch to main: merges the branch into plugins/<mod>/,
# the folder the marketplace lists. Run on main, then push main.
#
#   scripts/publish.sh usage-rail
#   scripts/publish.sh todo-stack
set -eu

mod="${1:?usage: scripts/publish.sh <mod>}"
prefix="plugins/$mod"

if [ "$(git branch --show-current)" != main ]; then
  echo "publish.sh: run it on main" >&2
  exit 1
fi

git fetch origin "$mod"

if [ -d "$prefix" ]; then
  git subtree pull --prefix="$prefix" origin "$mod" -m "Publish $mod"
else
  git subtree add --prefix="$prefix" origin "$mod" -m "Publish $mod"
  echo "publish.sh: add $mod to .claude-plugin/marketplace.json" >&2
fi
