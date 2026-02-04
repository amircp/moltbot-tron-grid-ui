# TRON Grid UI

A TRON-inspired web chat interface for [OpenClaw](https://github.com/openclaw/openclaw). Real-time communication with your AI agent through a cyberpunk terminal.

![Flynn Grid](https://img.shields.io/badge/theme-Flynn_Grid-00c8ff?style=flat-square)
![Dillinger Grid](https://img.shields.io/badge/theme-Dillinger_Grid-ff3a2f?style=flat-square)
![ENCOM Grid](https://img.shields.io/badge/theme-ENCOM_Grid-00ff88?style=flat-square)

## Features

- **Real-time WebSocket bridge** to the OpenClaw gateway (JSON-RPC)
- **Streaming responses** with live text rendering
- **Three color themes** inspired by TRON: Ares (2025)
  - **Flynn Grid** — Classic cyan/blue
  - **Dillinger Grid** — Red/orange
  - **ENCOM Grid** — Emerald green
- **Auto-configured identity** — reads agent and user names from workspace files
- **Audio feedback** — subtle beeps on message events
- **Persistent theme** — saves selection to localStorage
- **Keyboard shortcuts** — Enter to send, Escape to abort

## Installation

### As a OpenClaw Skill

```bash
openclaw skill install tron-grid-ui.skill
```

### Manual

```bash
git clone git@github.com:amircp/moltbot-tron-grid-ui.git
cd moltbot-tron-grid-ui/assets
npm install
node server.js
```

Open `http://localhost:3100` in your browser.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `GATEWAY_URL` | `ws://127.0.0.1:18789` | OpenClaw gateway WebSocket URL |

The server automatically reads:
- **Agent name** from `IDENTITY.md` in the workspace
- **User name** from `USER.md` in the workspace
- **Auth token** auto-detected from `~/.openclaw/` or `~/.clawdbot/` (backward compatible)

## Architecture

```
Browser ←→ WebSocket:3100 ←→ server.js ←→ WebSocket:18789 ←→ OpenClaw Gateway ←→ AI Agent
```

## Files

- `assets/index.html` — Self-contained frontend (HTML + CSS + JS)
- `assets/server.js` — Node.js bridge server (Express + WebSocket)
- `assets/package.json` — Dependencies (express, ws, uuid)
- `scripts/setup.sh` — Automated setup script
- `SKILL.md` — OpenClaw skill instructions

## License

MIT
