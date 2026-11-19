#!/bin/sh
# Container entrypoint. Platform disks (Render, Railway) are mounted root-owned,
# so fix ownership of the data dir while still root, then re-run this script as
# the unprivileged "node" user (environment is preserved) for migrations + server.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- sh "$0" "$@"
fi
npx prisma migrate deploy
exec node server/index.js
