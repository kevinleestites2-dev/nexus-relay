/**
 * NEXUS RELAY v4 — Full Duplex Ghost Operator Bridge
 * POST /command  → queue command, returns {ok, _id}
 * GET  /poll     → phone picks up next command
 * POST /result   → phone posts result back (with _id)
 * GET  /result   → ZapiaPrime gets latest result
 * GET  /result/:id → ZapiaPrime polls for specific command result
 * GET  /health   → status
 */

const express = require('express');
const app = express();
app.use(express.json());

const SECRET   = process.env.SECRET || 'pantheon_prime';
const PORT     = process.env.PORT || 3000;
const MAX_RESULTS = 50; // keep last 50 results

let commandQueue = [];
let results      = {};   // _id -> result object
let lastResult   = null;
let startTime    = Date.now();

function auth(req, res, next) {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ── ZapiaPrime: queue a command ───────────────────────────────────
app.post('/command', auth, (req, res) => {
  const cmd = req.body;
  cmd._id = Date.now().toString();
  commandQueue.push(cmd);
  console.log('[RELAY] Queued:', JSON.stringify(cmd).slice(0, 100));
  res.json({ ok: true, _id: cmd._id });
});

// ── ZapiaPrime: get result by command ID (polls until ready) ──────
app.get('/result/:id', auth, (req, res) => {
  const id = req.params.id;
  if (results[id]) {
    res.json(results[id]);
  } else {
    res.json({ status: 'pending', _id: id });
  }
});

// ── ZapiaPrime: get last result ───────────────────────────────────
app.get('/result', auth, (req, res) => {
  res.json(lastResult || { status: 'no_result' });
});

// ── Phone: poll for next command ──────────────────────────────────
app.get('/poll', (req, res) => {
  if (commandQueue.length > 0) {
    const cmd = commandQueue.shift();
    console.log('[RELAY] → Phone:', JSON.stringify(cmd).slice(0, 100));
    res.json(cmd);
  } else {
    res.json({ action: 'none' });
  }
});

// ── Phone: post result back ───────────────────────────────────────
app.post('/result', (req, res) => {
  const data = req.body;
  lastResult = data;
  if (data._id) {
    results[data._id] = data;
    // Prune old results
    const keys = Object.keys(results);
    if (keys.length > MAX_RESULTS) {
      delete results[keys[0]];
    }
  }
  console.log('[RELAY] ← Phone result:', JSON.stringify(data).slice(0, 100));
  res.json({ ok: true });
});

// ── Health ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
    phone: lastResult ? 'connected' : 'waiting',
    pending: commandQueue.length,
    results_stored: Object.keys(results).length,
    uptime: Math.floor((Date.now() - startTime) / 1000)
  });
});

app.get('/ping', (req, res) => res.json({ ok: true, queue: commandQueue.length, version: '4.0.0' }));

app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const phone = lastResult ? '🟢 Connected' : '🔴 Waiting';
  res.send(
    '<html><body style="background:#0a0a0a;color:#00ff88;font-family:monospace;padding:2rem">' +
    '<h2>🔱 NEXUS RELAY v4</h2>' +
    '<p>Full Duplex Ghost Operator Bridge</p>' +
    '<p>Phone: ' + phone + '</p>' +
    '<p>Pending: ' + commandQueue.length + '</p>' +
    '<p>Results stored: ' + Object.keys(results).length + '</p>' +
    '<p>Uptime: ' + uptime + 's</p>' +
    '</body></html>'
  );
});

app.listen(PORT, () => {
  console.log('Nexus Relay v4 (Full Duplex) running on port ' + PORT);
});
