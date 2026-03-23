# ☀️ Solarcast

A self-hosted, browser watch-party server. Stream a live Firefox desktop to multiple viewers simultaneously, with real-time chat and shared mouse/keyboard control running inside a Docker container.

---

# ⚠️ Attention/Alternatives
Solarcast uses [Neko](https://github.com/m1k1o/neko)'s Firefox image as a base. Solarcast was built because Neko uses WebRTC which causes issues with dynamic IPs and I couldn't get it working thanks to restrictions by my ISP. Solarcast avoids this by only relying on websockets. Unless you're having a similar issue with Neko you don't need to use Solarcast, Neko is much better thanks to WebRTC it has almost zero delay. Due to how websockets works Solarcast has quite a bit of delay, it's not lag. It is delay.
---

## Features

- **Live browser streaming** — Captures a headless Firefox desktop via FFmpeg and streams it to all connected clients using fragmented MP4 over WebSocket.
- **Shared control** — One viewer at a time can take control of the browser (mouse, keyboard, scrolling, navigation).
- **Real-time chat** — Built-in chat panel with viewer list, display names, and message history.
- **URL bar** — The controller can navigate Firefox to any URL directly from the UI.
- **High Quality Video** — H.264 baseline with `zerolatency` tuning, audio via PulseAudio AAC, targeted at ~60 FPS.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                Docker Container              │
│                                             │
│  Xvfb (:99) ──► Firefox ──► FFmpeg          │
│                               │             │
│                         fMP4 pipe           │
│                               │             │
│                    Node.js / Express         │
│                    ├── /stream  (WebSocket)  │
│                    ├── /        (WebSocket)  │
│                    └── /status  (HTTP)       │
└─────────────────────────────────────────────┘
          ▲ port 3000
          │
    Browser clients
```

- **`server/index.js`** — Express + WebSocket server. Manages the FFmpeg process, streams fMP4 boxes to viewers, and relays control input (via `xdotool`) to the virtual display.
- **`public/index.html`** — Single-file frontend.
- **`start.sh`** — Entrypoint that starts Xvfb, Openbox, and the Node server.
- **`navigate.sh`** — Helper script for navigating Firefox directly from the host/container CLI.
- **`supervisord.solarcast.conf`** — Supervisor config that integrates the Node server into the neko container's process management.

---

## Requirements

- Docker

---

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/solarcast.git
   cd solarcast
   ```

2. **Build and run:**
   ```bash
   docker compose up --build
   ```

3. **Open your browser:**
   ```
   http://localhost:3000
   ```


4. **Let your friends join:**
   Get [cloudflared tunnel](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe) from here.
   Run it.
   ```
   .\cloudflared-windows-amd64.exe tunnel --url http://localhost:3000
   ```
   Send the link it shares to your friends such as.
   ```
   Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
   https://ctrl-replies-main-rewards.trycloudflare.com                                       |
   ```
   Multiple browser tabs/devices can connect simultaneously. The first person to click **Take Control** gets control of the Firefox instance.
---

## Configuration

Environment variables can be set in `docker-compose.yaml`:

| Variable | Default | Description |
|---|---|---|
| `SCREEN_W` | `1920` | Virtual display width (pixels) |
| `SCREEN_H` | `1080` | Virtual display height (pixels) |
| `DISPLAY` | `:99` | X11 display to capture |

---

## API

### `GET /status`

Returns the current server state as JSON.

```json
{
  "ffmpegRunning": true,
  "gotInit": true,
  "streamClients": 3
}
```

### WebSocket `/` — Control channel

Used for signalling, chat, and input events.

**Server → Client messages:**

| Type | Description |
|---|---|
| `welcome` | Sent on connect. Includes your `id`, `name`, viewer list, and last 50 chat messages. |
| `state` | Viewer list update with current controller ID. |
| `chat` | A chat message from a viewer. |

**Client → Server messages:**

| Type | Fields | Description |
|---|---|---|
| `setName` | `name` | Set your display name (max 32 chars). |
| `chat` | `text` | Send a chat message (max 500 chars). |
| `requestControl` | — | Request control of the browser (granted if no one else holds it). |
| `releaseControl` | — | Release control. |
| `mousemove` | `x, y` | Move mouse (normalized 0–1 coordinates). |
| `mousedown` | `x, y, button` | Mouse button press. |
| `mouseup` | `x, y, button` | Mouse button release. |
| `scroll` | `x, y, dy` | Scroll wheel. |
| `keydown` | `key` | Key press (xdotool key name). |
| `keyup` | `key` | Key release. |
| `type` | `char` | Type a single character. |
| `typeText` | `text` | Type a string (max 1000 chars). |
| `navigate` | `url` | Navigate Firefox to a URL (max 2000 chars). |

### WebSocket `/stream` — Video stream

Receives raw fMP4 binary chunks. The client must feed these into a [MediaSource](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource) with codec `video/mp4; codecs="avc1.42C01F, mp4a.40.2"`.

---

## Navigating from the CLI

Use `navigate.sh` to open a URL in Firefox from inside the container without going through the web UI:

```bash
docker exec solarcast /solarcast/navigate.sh https://example.com
```

---

## Dependencies

**Server (`server/package.json`):**
- [express](https://expressjs.com/) `^4.18.2` — HTTP server and static file serving
- [ws](https://github.com/websockets/ws) `^8.14.2` — WebSocket server

**System (installed in Dockerfile):**
- `ffmpeg` — screen capture and encoding
- `xdotool` — simulating mouse and keyboard input
- `xclip` — clipboard support
- `nodejs` 20.x

**Base image:** [`ghcr.io/m1k1o/neko/firefox:latest`](https://github.com/m1k1o/neko)

---
