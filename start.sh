#!/bin/bash
set -e

echo "[solarcast] Starting services..."

mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null || true

echo "[solarcast] Starting Xvfb on ${DISPLAY} (${SCREEN_W}x${SCREEN_H})..."
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 2

if ! kill -0 $XVFB_PID 2>/dev/null; then
  echo "[solarcast] ERROR: Xvfb failed to start"
  exit 1
fi
echo "[solarcast] Xvfb running (pid $XVFB_PID)"

DISPLAY="${DISPLAY}" openbox --sm-disable 2>/dev/null &
sleep 1

DISPLAY="${DISPLAY}" xsetroot -solid black 2>/dev/null || true

exec node /app/server/index.js
