#!/bin/bash
URL="${1:-https://www.miruro.to/}"
echo "[nav] Navigating to: $URL"
DISPLAY=:99 firefox --new-tab "$URL"
echo "[nav] Done."