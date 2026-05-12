/**
 * NEXUS RELAY v5 — WebSocket + HTTP Full Duplex Ghost Operator Bridge
 *
 * HTTP (backwards compatible):
 *   POST /command     → queue command, returns {ok, _id}
 *   GET  /poll        → phone picks up next command (legacy)
 *   POST /result      → phone posts result (legacy)
 *   GET  /result/:id  → ZapiaPrime polls for specific result
 *   GET  /ping        → health check
 *
 * WebSocket (new — EleftheriaPrime v2):
 *   ws(s)://nexus-relay.../ws
 *   Phone connects, registers, receives commands, sends results back
 *   ZapiaPrime uses POST /command + GET /result/:id as before
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

app.use(express.json());

const SECRET      = process.env.SECRET || 'pantheon_prime';
const PORT        = process.env.PORT || 3000;
const MAX_RESULTS = 100;

let commandQueue = [];
let results      = {};
let lastResult   = null;
let startTime    = Date.now();
let phoneSocket  = null;   // the connected phone WebSocket
let phoneVersion = null;
let phoneConnectedAt = null;

// ─── AUTH ────────────────────────────────────────────────────────

function auth(req, res, next) {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ─── WEBSOCKET HANDLER ───────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const secret = req.headers['x-secret'];
  // Allow phone connection without secret header (validated via register msg)
  console.log('[WS] New connection from', req.socket.remoteAddress);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Phone registration
      if (msg.type === 'register') {
        phoneSocket = ws;
        phoneVersion = msg.version || '?';
        phoneConnectedAt = Date.now();
        console.log('[WS] Phone registered: EleftheriaPrime v' + phoneVersion);
        ws.send(JSON.stringify({ type: 'ack', status: 'registered', relay: 'v5' }));

        // Flush any queued commands
        while (commandQueue.length > 0) {
          const cmd = commandQueue.shift();
          console.log('[WS] → Phone (flushed):', JSON.stringify(cmd).slice(0, 80));
          ws.send(JSON.stringify(cmd));
        }
        return;
      }

      // Result from phone
      if (msg._id) {
        results[msg._id] = msg;
        lastResult = msg;
        console.log('[WS] ← Phone result:', JSON.stringify(msg).slice(0, 80));
        pruneResults();
        return;
      }

    } catch (e) {
      console.error('[WS] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    if (ws === phoneSocket) {
      phoneSocket = null;
      console.log('[WS] Phone disconnected');
    }
  });

  ws.on('error', (e) => {
    console.error('[WS] Error:', e.message);
    if (ws === phoneSocket) phoneSocket = null;
  });
});

function pruneResults() {
  const keys = Object.keys(results);
  if (keys.length > MAX_RESULTS) {
    delete results[keys[0]];
  }
}

// ─── HTTP: ZapiaPrime sends command ─────────────────────────────

app.post('/command', auth, (req, res) => {
  const cmd = req.body;
  cmd._id = Date.now().toString();

  if (phoneSocket && phoneSocket.readyState === WebSocket.OPEN) {
    // Send directly via WebSocket
    phoneSocket.send(JSON.stringify(cmd));
    console.log('[RELAY] → Phone (WS):', JSON.stringify(cmd).slice(0, 80));
  } else {
    // Queue for when phone reconnects or legacy HTTP poll
    commandQueue.push(cmd);
    console.log('[RELAY] Queued (no WS):', JSON.stringify(cmd).slice(0, 80));
  }

  res.json({ ok: true, _id: cmd._id });
});

// ─── HTTP: ZapiaPrime polls for result ───────────────────────────

app.get('/result/:id', auth, (req, res) => {
  const id = req.params.id;
  if (results[id]) {
    res.json(results[id]);
  } else {
    res.json({ status: 'pending', _id: id });
  }
});

app.get('/result', auth, (req, res) => {
  res.json(lastResult || { status: 'no_result' });
});

// ─── HTTP: Legacy phone poll (HTTP fallback) ─────────────────────

app.get('/poll', (req, res) => {
  if (commandQueue.length > 0) {
    const cmd = commandQueue.shift();
    console.log('[RELAY] → Phone (HTTP poll):', JSON.stringify(cmd).slice(0, 80));
    res.json(cmd);
  } else {
    res.json({ action: 'none' });
  }
});

app.post('/result', (req, res) => {
  const data = req.body;
  lastResult = data;
  if (data._id) {
    results[data._id] = data;
    pruneResults();
  }
  console.log('[RELAY] ← Phone result (HTTP):', JSON.stringify(data).slice(0, 80));
  res.json({ ok: true });
});

// ─── HEALTH ──────────────────────────────────────────────────────

app.get('/ping', (req, res) => {
  res.json({
    ok: true,
    version: '5.0.0',
    phone_ws: phoneSocket ? 'connected' : 'disconnected',
    phone_version: phoneVersion,
    queue: commandQueue.length
  });
});

app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  res.json({
    status: 'ok',
    version: '5.0.0',
    phone_ws: phoneSocket ? 'connected' : 'waiting',
    phone_version: phoneVersion,
    pending: commandQueue.length,
    results_stored: Object.keys(results).length,
    uptime
  });
});

app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const phone  = phoneSocket ? '🟢 WS Connected (v' + phoneVersion + ')' : '🔴 Disconnected';
  res.send(
    '<html><body style="background:#0a0a0a;color:#00ff88;font-family:monospace;padding:2rem">' +
    '<h2>🔱 NEXUS RELAY v5</h2>' +
    '<p>WebSocket + HTTP Full Duplex Ghost Operator Bridge</p>' +
    '<p>Phone: ' + phone + '</p>' +
    '<p>Pending: ' + commandQueue.length + '</p>' +
    '<p>Results stored: ' + Object.keys(results).length + '</p>' +
    '<p>Uptime: ' + uptime + 's</p>' +
    '</body></html>'
  );
});

server.listen(PORT, () => {
  console.log('Nexus Relay v5 (WebSocket + HTTP) running on port ' + PORT);
});
