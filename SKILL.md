---
name: tron-grid-ui
description: TRON-themed web interface for Clawdbot. Provides a cyberpunk chat UI with real-time WebSocket bridge to the gateway. Features multiple color themes (Flynn/Dillinger/ENCOM grids), streaming responses, and auto-configured identity from workspace files. Use when user asks to set up, start, or manage the TRON interface, Grid UI, or cyberpunk chat frontend.
---

# TRON Grid UI

A TRON-inspired web chat interface that connects directly to the Clawdbot gateway via WebSocket JSON-RPC.

## Setup

Run the setup script to install dependencies:

```bash
bash "$(clawdbot skill path tron-grid-ui)/scripts/setup.sh"
```

This copies the assets to `~/clawd/tron-ui/` and runs `npm install`.

## Start

```bash
cd ~/clawd/tron-ui && node server.js
```

Or use the start script:

```bash
bash ~/clawd/tron-ui/start.sh
```

The server runs on `http://localhost:3100` by default.

## How It Works

- **`server.js`** — Node.js bridge: connects to Clawdbot gateway (`ws://127.0.0.1:18789`) via JSON-RPC, serves the frontend, proxies chat messages via WebSocket
- **`index.html`** — Self-contained frontend with CSS themes, streaming chat, audio beeps
- Identity (agent name, user name) auto-reads from `IDENTITY.md` and `USER.md` in the workspace
- Gateway auth token auto-reads from `~/.clawdbot/clawdbot.json`

## Themes

Three color themes switchable from the UI header:

- **Flynn Grid** — Classic cyan/blue (TRON Legacy)
- **Dillinger Grid** — Red/orange (TRON Ares)
- **ENCOM Grid** — Emerald green

Theme selection persists via localStorage.

## Configuration

Environment variables (optional):

- `PORT` — Server port (default: 3100)
- `GATEWAY_URL` — Gateway WebSocket URL (default: `ws://127.0.0.1:18789`)
