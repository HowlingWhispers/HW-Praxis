#!/usr/bin/env bash
# Builds Praxis and serves it exactly as production does: one port, interface and API together.
# Runs on every codespace start; the log is at /tmp/praxis.log.
set -u
cd "$(dirname "$0")/.."
{
  echo "[praxis] $(date) installing and building"
  [ -d node_modules ] || npm ci
  npm run build
  echo "[praxis] starting on port 8791"
  NODE_ENV=production PORT=8791 exec node dist-server/server/index.js
} >> /tmp/praxis.log 2>&1
