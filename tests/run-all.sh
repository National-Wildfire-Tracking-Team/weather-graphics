#!/usr/bin/env bash
# Runs every e2e suite against a running static server (default http://localhost:8765/index.html).
set -u
cd "$(dirname "$0")"
rc=0
for t in editor editor2 map mapexport export templates app alerts outlooks; do
  echo "=== $t ==="
  node "$t.test.mjs" || rc=1
done
exit $rc
