#!/bin/sh
# Container entrypoint. Platform disks (Render, Railway) are mounted root-owned,
# so fix ownership of the data dir while still root, then switch to the
# unprivileged "node" user and start tini AS that user, so tini can forward
# SIGTERM to the app on deploys (root tini -> node child fails on Render).
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- /usr/bin/tini -- sh "$0" "$@"
fi
npx prisma migrate deploy
exec node server/index.js
