#!/usr/bin/env bash
# Keep agent skills in sync: .agents/skills is canonical, .claude/skills is the mirror.
# 1) Skills found only in .claude/skills are adopted into .agents/skills.
# 2) .agents/skills is then mirrored to .claude/skills (canonical wins on conflicts).
# 3) Verifies the two trees are identical (ignoring .DS_Store).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

AGENTS=.agents/skills
CLAUDE=.claude/skills
mkdir -p "$AGENTS" "$CLAUDE"

for dir in "$CLAUDE"/*/; do
  name=$(basename "$dir")
  if [ ! -d "$AGENTS/$name" ]; then
    echo "adopt  $name  (.claude/skills -> .agents/skills)"
    rsync -a --exclude .DS_Store "$dir" "$AGENTS/$name/"
  fi
done

for dir in "$AGENTS"/*/; do
  name=$(basename "$dir")
  rsync -a --delete --exclude .DS_Store "$dir" "$CLAUDE/$name/"
done

if diff -rq -x .DS_Store "$AGENTS" "$CLAUDE" >/dev/null; then
  echo "OK: $AGENTS and $CLAUDE are in sync"
else
  echo "ERROR: $AGENTS and $CLAUDE still differ:" >&2
  diff -rq -x .DS_Store "$AGENTS" "$CLAUDE" >&2 || true
  exit 1
fi
