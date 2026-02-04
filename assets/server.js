/**
 * TRON Interface Bridge Server
 * Bridges the frontend TRON UI to the OpenClaw gateway WebSocket API.
 */

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3100', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';

// ─── Read identity from workspace files ─────────────────────────
let AGENT_NAME = 'AGENT';
let USER_NAME = 'USER';

function parseNameFromMd(filePath, fallback) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/\*\*Name:\*\*\s*(.+)/i);
    if (match) {
      // Take just the first word/name (before parentheses or dashes)
      const raw = match[1].trim();
      const clean = raw.split(/\s*[\(—\-]/)[0].trim();
      return clean || fallback;
    }
  } catch {}
  return fallback;
}

// Try to find workspace from openclaw config or use default
function findWorkspace() {
  try {
    const configPath = path.join(require('os').homedir(), '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config?.agents?.defaults?.workspace || path.join(require('os').homedir(), 'clawd');
  } catch {
    return path.join(require('os').homedir(), 'clawd');
  }
}

const WORKSPACE = findWorkspace();
AGENT_NAME = parseNameFromMd(path.join(WORKSPACE, 'IDENTITY.md'), 'AGENT');
USER_NAME = parseNameFromMd(path.join(WORKSPACE, 'USER.md'), 'USER');
console.log(`[IDENTITY] Agent: ${AGENT_NAME} | User: ${USER_NAME}`);

// Read gateway auth token from openclaw config
let GATEWAY_TOKEN = '';
try {
  const configPath = path.join(require('os').homedir(), '.openclaw', 'openclaw.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  GATEWAY_TOKEN = config?.gateway?.auth?.token || '';
  if (GATEWAY_TOKEN) console.log('[CONFIG] Gateway token loaded');
} catch (e) {
  console.warn('[CONFIG] Could not read gateway token:', e.message);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Gateway connection state
let gatewayWs = null;
let gatewayConnected = false;
let gatewayReconnectTimer = null;
let pendingRequests = new Map(); // id -> { resolve, reject, frontendWs }
let sessionKey = 'main';
let currentRunId = null;

// All connected frontend clients
const frontendClients = new Set();

// ─── Gateway Connection ───────────────────────────────────────────

function connectToGateway() {
  if (gatewayWs && gatewayWs.readyState === WebSocket.OPEN) return;

  console.log('[GATEWAY] Connecting to', GATEWAY_URL);
  gatewayWs = new WebSocket(GATEWAY_URL);

  gatewayWs.on('open', () => {
    console.log('[GATEWAY] Connected');
    gatewayConnected = true;
    broadcastToFrontend({ type: 'status', connected: true });

    // Send connect handshake
    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        version: '1.0.0',
        platform: 'node',
        mode: 'backend',
        instanceId: uuidv4()
      },
      role: 'operator',
      scopes: ['operator.admin'],
      caps: []
    };
    if (GATEWAY_TOKEN) {
      connectParams.auth = { token: GATEWAY_TOKEN };
    }
    sendGatewayRequest('connect', connectParams).then(hello => {
      console.log('[GATEWAY] Handshake complete');
      // Check session defaults
      if (hello?.snapshot?.sessionDefaults?.mainSessionKey) {
        sessionKey = hello.snapshot.sessionDefaults.mainSessionKey;
      }
      broadcastToFrontend({ type: 'hello', sessionKey, agentName: AGENT_NAME, userName: USER_NAME });
    }).catch(err => {
      console.error('[GATEWAY] Handshake failed:', err.message);
    });
  });

  gatewayWs.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch { return; }

    // Handle response to our requests
    if (msg.type === 'res') {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || 'request failed'));
        }
      }
      return;
    }

    // Handle events
    if (msg.type === 'event') {
      handleGatewayEvent(msg);
      return;
    }
  });

  gatewayWs.on('close', (code, reason) => {
    console.log(`[GATEWAY] Disconnected (${code}): ${reason || 'no reason'}`);
    gatewayConnected = false;
    gatewayWs = null;
    broadcastToFrontend({ type: 'status', connected: false });
    flushPendingRequests(new Error('gateway disconnected'));
    scheduleReconnect();
  });

  gatewayWs.on('error', (err) => {
    console.error('[GATEWAY] Error:', err.message);
  });
}

function scheduleReconnect() {
  if (gatewayReconnectTimer) return;
  gatewayReconnectTimer = setTimeout(() => {
    gatewayReconnectTimer = null;
    connectToGateway();
  }, 3000);
}

function flushPendingRequests(err) {
  for (const [, pending] of pendingRequests) {
    pending.reject(err);
  }
  pendingRequests.clear();
}

function sendGatewayRequest(method, params) {
  return new Promise((resolve, reject) => {
    if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN) {
      return reject(new Error('gateway not connected'));
    }
    const id = uuidv4();
    const msg = { type: 'req', id, method, params };
    pendingRequests.set(id, { resolve, reject });
    gatewayWs.send(JSON.stringify(msg));

    // Timeout after 60s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('request timeout'));
      }
    }, 60000);
  });
}

// ─── Gateway Event Handling ───────────────────────────────────────

function handleGatewayEvent(event) {
  if (event.event === 'connect.challenge') {
    // Re-send connect without auth challenge handling for simplicity
    return;
  }

  if (event.event === 'chat') {
    handleChatEvent(event.payload);
    return;
  }

  if (event.event === 'agent') {
    handleAgentEvent(event.payload);
    return;
  }
}

// Track accumulated text across chunks (tool calls reset gateway cumulative text)
let fullResponseText = '';
let lastChunkText = '';

function handleChatEvent(payload) {
  if (!payload) return;

  const state = payload.state;

  if (state === 'delta') {
    const chunkCumulative = extractText(payload.message);
    if (chunkCumulative !== null) {
      // Detect chunk reset: if new text is shorter than last chunk, a new chunk started
      if (chunkCumulative.length < lastChunkText.length) {
        // New chunk after tool call - save previous chunk
        fullResponseText += lastChunkText;
        lastChunkText = '';
      }
      lastChunkText = chunkCumulative;
      
      // Send full accumulated text to frontend
      broadcastToFrontend({
        type: 'stream',
        state: 'delta',
        text: fullResponseText + lastChunkText,
        runId: payload.runId
      });
    }
  } else if (state === 'final') {
    // Try to get final text from the final event payload itself
    const finalText = extractText(payload.message);
    if (finalText) {
      // Final event has the complete message
      console.log(`[FINAL] from payload len=${finalText.length} last30="${finalText.slice(-30)}"`);
      broadcastToFrontend({
        type: 'stream',
        state: 'final',
        text: finalText,
        runId: payload.runId
      });
    } else {
      // Fallback to accumulated text
      fullResponseText += lastChunkText;
      console.log(`[FINAL] from accumulated len=${fullResponseText.length} last30="${fullResponseText.slice(-30)}"`);
      broadcastToFrontend({
        type: 'stream',
        state: 'final',
        text: fullResponseText,
        runId: payload.runId
      });
    }
    currentRunId = null;
    fullResponseText = '';
    lastChunkText = '';
  } else if (state === 'aborted') {
    currentRunId = null;
    broadcastToFrontend({
      type: 'stream',
      state: 'aborted',
      runId: payload.runId
    });
  } else if (state === 'error') {
    currentRunId = null;
    broadcastToFrontend({
      type: 'stream',
      state: 'error',
      error: payload.errorMessage || 'Unknown error',
      runId: payload.runId
    });
  }
}

function handleAgentEvent(payload) {
  // Tool events, etc. - we can forward tool activity to the frontend
  if (payload?.stream === 'tool') {
    const data = payload.data || {};
    const phase = data.phase || '';
    const name = data.name || 'tool';
    if (phase === 'start') {
      broadcastToFrontend({
        type: 'tool',
        phase: 'start',
        name,
        toolCallId: data.toolCallId
      });
    } else if (phase === 'result') {
      broadcastToFrontend({
        type: 'tool',
        phase: 'result',
        name,
        toolCallId: data.toolCallId
      });
    }
  }
}

function extractText(message) {
  if (!message) return null;
  const content = message.content;
  if (typeof content === 'string') {
    return stripThinkingTags(content);
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text);
    if (texts.length > 0) {
      return stripThinkingTags(texts.join('\n'));
    }
  }
  if (typeof message.text === 'string') {
    return stripThinkingTags(message.text);
  }
  return null;
}

function stripThinkingTags(text) {
  if (!text) return text;
  // Remove <thinking>...</thinking> blocks
  return text.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '').trimStart();
}

// ─── Frontend WebSocket Handling ──────────────────────────────────

wss.on('connection', (ws) => {
  console.log('[FRONTEND] Client connected');
  frontendClients.add(ws);

  // Send current status and identity
  ws.send(JSON.stringify({
    type: 'status',
    connected: gatewayConnected,
    agentName: AGENT_NAME,
    userName: USER_NAME
  }));

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch { return; }

    if (msg.type === 'chat') {
      await handleFrontendChat(ws, msg);
    } else if (msg.type === 'abort') {
      await handleFrontendAbort(ws);
    } else if (msg.type === 'history') {
      await handleFrontendHistory(ws);
    }
  });

  ws.on('close', () => {
    console.log('[FRONTEND] Client disconnected');
    frontendClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[FRONTEND] Error:', err.message);
    frontendClients.delete(ws);
  });
});

async function handleFrontendChat(ws, msg) {
  const text = (msg.message || '').trim();
  if (!text) return;

  if (!gatewayConnected) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Gateway not connected'
    }));
    return;
  }

  const idempotencyKey = uuidv4();
  currentRunId = idempotencyKey;
  fullResponseText = '';
  lastChunkText = '';

  // Broadcast that we're sending
  broadcastToFrontend({
    type: 'stream',
    state: 'start',
    runId: idempotencyKey
  });

  try {
    await sendGatewayRequest('chat.send', {
      sessionKey,
      message: text,
      deliver: false,
      idempotencyKey
    });
  } catch (err) {
    currentRunId = null;
    ws.send(JSON.stringify({
      type: 'error',
      error: err.message
    }));
  }
}

async function handleFrontendAbort(ws) {
  if (!gatewayConnected) return;

  try {
    const params = currentRunId
      ? { sessionKey, runId: currentRunId }
      : { sessionKey };
    await sendGatewayRequest('chat.abort', params);
  } catch (err) {
    console.error('[ABORT] Error:', err.message);
  }
}

async function handleFrontendHistory(ws) {
  if (!gatewayConnected) {
    ws.send(JSON.stringify({ type: 'history', messages: [] }));
    return;
  }

  try {
    const result = await sendGatewayRequest('chat.history', {
      sessionKey,
      limit: 100
    });
    const messages = (result.messages || []).map(m => ({
      role: m.role,
      text: extractText(m) || '',
      timestamp: m.timestamp
    }));
    ws.send(JSON.stringify({ type: 'history', messages }));
  } catch (err) {
    console.error('[HISTORY] Error:', err.message);
    ws.send(JSON.stringify({ type: 'history', messages: [] }));
  }
}

function broadcastToFrontend(msg) {
  const data = JSON.stringify(msg);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n⚡ TRON Interface Server running on http://localhost:${PORT}`);
  console.log(`   Gateway: ${GATEWAY_URL}`);
  console.log(`   Session: ${sessionKey}\n`);
  connectToGateway();
});
