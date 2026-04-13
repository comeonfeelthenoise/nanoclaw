#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: kill \$(cat /home/user/nanoclaw/nanoclaw.pid)

set -euo pipefail

cd "/home/user/nanoclaw"

# Stop existing instance if running
if [ -f "/home/user/nanoclaw/nanoclaw.pid" ]; then
  OLD_PID=$(cat "/home/user/nanoclaw/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."

# Ensure Docker is running (no systemd in this environment)
if ! docker info &>/dev/null 2>&1; then
  echo "Starting Docker daemon..."
  dockerd &>/tmp/dockerd-nanoclaw.log &
  sleep 3
  if ! docker info &>/dev/null 2>&1; then
    echo "Warning: Docker daemon may not have started. Check /tmp/dockerd-nanoclaw.log"
  fi
fi

nohup "/opt/node22/bin/node" "/home/user/nanoclaw/dist/index.js" \
  >> "/home/user/nanoclaw/logs/nanoclaw.log" \
  2>> "/home/user/nanoclaw/logs/nanoclaw.error.log" &

echo $! > "/home/user/nanoclaw/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /home/user/nanoclaw/logs/nanoclaw.log"
