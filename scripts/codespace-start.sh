#!/usr/bin/env bash
# Builds Praxis and serves it exactly as production does: one port, interface and API together.
# Runs in a terminal when the codespace opens, so its progress is visible; also logged to /tmp/praxis.log.
set -u
cd "$(dirname "$0")/.."
if curl -fsS http://127.0.0.1:8791/api/health > /dev/null 2>&1; then
  echo "[praxis] already running on port 8791"
  exit 0
fi
{
  echo "[praxis] $(date) installing and building"
  [ -d node_modules ] || npm ci
  npm run build
  echo "[praxis] ready: open the Ports tab and click the globe beside Praxis (8791)"
  NODE_ENV=production PORT=8791 exec node dist-server/server/index.js
} 2>&1 | tee -a /tmp/praxis.log
