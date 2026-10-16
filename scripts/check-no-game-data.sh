#!/bin/bash
# Fails if a disk image or a file decoded from one is staged or tracked.
# Shizuku is commercial software: its bytes must never be committed.
set -euo pipefail
pattern='(\.(fdi|d88|88d|d98|98d|hdm|xdf|dup|nfd|hdi|nhd|thd|vhd|rom|np2|img|ima|rar|lzh|7z|lfg|lfd|kcd|knj|sdt|efc|vd|fm|sav)$)|(^|/)(out|fixtures/private)/|(^|/)SCN[0-9]+\.DAT$'
files=$( { git diff --cached --name-only --diff-filter=AM 2>/dev/null; git ls-files; } | sort -u | grep -iE "$pattern" || true)
if [ -n "$files" ]; then
  echo "Refusing to commit game data:" >&2
  echo "$files" >&2
  exit 1
fi
