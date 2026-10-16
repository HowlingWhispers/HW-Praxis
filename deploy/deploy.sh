#!/usr/bin/env bash
# Deploys the newest main to this server, following the owner's steps: fetch, pull,
# install if the lockfile changed, test, type-check, build, restart, verify.
#
# Run it on the server, from anywhere:
#   bash /srv/howling-whispers/praxis/deploy/deploy.sh
#
# It stops at the first failure, before the running service is touched, so a broken build
# never replaces a working one. Everything runs inside main() so that the pull, which may
# update this file, cannot change the script while bash is still reading it.

set -euo pipefail

APP_DIR=/srv/howling-whispers/praxis
SERVICE=praxis
PORT=8791

say() { printf '\n== %s\n' "$*"; }

main() {
  # Files made here stay writable by the www-data group, so the next person can deploy too.
  umask 002
  cd "$APP_DIR"

  # The checkout belongs to root:www-data; git refuses to work in it for anyone else
  # unless it is marked safe once per user.
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$APP_DIR"; then
    git config --global --add safe.directory "$APP_DIR"
  fi

  say "Fetching from GitHub"
  git fetch origin
  local running newest
  running=$(git rev-parse --short HEAD)
  newest=$(git rev-parse --short origin/main)
  echo "Running now:   $(git log --oneline -1 HEAD)"
  echo "Newest on main: $(git log --oneline -1 origin/main)"
  if [ "$running" = "$newest" ] && [ "${1:-}" != "--force" ]; then
    echo "Already up to date. Run with --force to rebuild and restart anyway."
    exit 0
  fi

  say "Pulling"
  local lock_before lock_after
  lock_before=$(git rev-parse HEAD:package-lock.json)
  git pull --ff-only origin main
  lock_after=$(git rev-parse HEAD:package-lock.json)

  if [ "$lock_before" != "$lock_after" ] || [ ! -d node_modules ]; then
    say "Installing dependencies"
    npm ci
  fi

  say "Testing"
  npm test
  say "Type checks"
  npm run lint
  say "Building"
  npm run build

  say "Restarting $SERVICE"
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart "$SERVICE"
  elif ! sudo -n systemctl restart "$SERVICE" 2>/dev/null && ! sudo systemctl restart "$SERVICE"; then
    echo "The build is ready, but this account cannot restart $SERVICE."
    echo "Ask the owner to run: systemctl restart $SERVICE"
    exit 1
  fi

  say "Checking it is live"
  sleep 2
  systemctl status "$SERVICE" --no-pager --lines=3 || true
  if curl -fsS "http://localhost:$PORT/" >/dev/null; then
    echo
    echo "Praxis is live at $(git log --oneline -1 HEAD), version $(node -p "require('./package.json').version")."
  else
    echo "The service restarted but http://localhost:$PORT/ did not answer. Check: journalctl -u $SERVICE -n 50"
    exit 1
  fi
}

main "$@"
