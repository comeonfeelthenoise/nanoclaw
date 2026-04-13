#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd (with Docker watchdog)
# To stop: kill $(cat /home/user/nanoclaw/nanoclaw.pid)

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

# Stop existing watchdog if running
if [ -f "/home/user/nanoclaw/watchdog.pid" ]; then
  OLD_WD=$(cat "/home/user/nanoclaw/watchdog.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_WD" ] && kill -0 "$OLD_WD" 2>/dev/null; then
    kill "$OLD_WD" 2>/dev/null || true
  fi
fi

ensure_docker() {
  if ! docker info &>/dev/null 2>&1; then
    echo "[watchdog] Starting Docker daemon..."
    pkill dockerd 2>/dev/null || true
    sleep 1
    dockerd &>>/tmp/dockerd-nanoclaw.log &
    local i=0
    while [ $i -lt 10 ]; do
      sleep 1
      docker info &>/dev/null 2>&1 && return 0
      i=$((i+1))
    done
    echo "[watchdog] Docker failed to start"
    return 1
  fi
}

echo "Starting NanoClaw..."

# Start Docker watchdog in background
(
  while true; do
    ensure_docker 2>>/home/user/nanoclaw/logs/nanoclaw.error.log
    sleep 15
  done
) &>/dev/null &
echo $! > "/home/user/nanoclaw/watchdog.pid"

# Ensure Docker is up before starting NanoClaw
ensure_docker

nohup "/opt/node22/bin/node" "/home/user/nanoclaw/dist/index.js" \
  >> "/home/user/nanoclaw/logs/nanoclaw.log" \
  2>> "/home/user/nanoclaw/logs/nanoclaw.error.log" &

echo $! > "/home/user/nanoclaw/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /home/user/nanoclaw/logs/nanoclaw.log"
