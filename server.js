/**
 * NEXUS RELAY v2 — HTTP Polling (no WebSocket, no keepalive)
 * Phone polls GET /poll -> gets queued command
 * ZapiaPrime posts POST /command -> queues it
 * Phone posts POST /result -> stores result
 * ZapiaPrime polls GET /result -> gets it
 */

const express = require('express');
const app = express();
app.use(express.json());

const SECRET = process.env.SECRET || 'pantheon_prime';
const PORT   = process.env.PORT || 3000;

let commandQueue = [];
let lastResult   = null;

function auth(req, res, next) {
  if (req.headers['x-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ZapiaPrime: queue a command
app.post('/command', auth, (req, res) => {
  const cmd = req.body;
  cmd._id = Date.now().toString();
  commandQueue.push(cmd);
  console.log('[RELAY] Command queued:', JSON.stringify(cmd).slice(0, 80));
  res.json({ ok: true, _id: cmd._id });
});

// ZapiaPrime: get last result
app.get('/result', auth, (req, res) => {
  res.json(lastResult || { status: 'no_result' });
});

// Phone: poll for next command
app.get('/poll', (req, res) => {
  if (commandQueue.length > 0) {
    const cmd = commandQueue.shift();
    console.log('[RELAY] Dispatching to phone:', JSON.stringify(cmd).slice(0, 80));
    res.json(cmd);
  } else {
    res.json({ action: 'none' });
  }
});

// Phone: post result back
app.post('/result', (req, res) => {
  lastResult = req.body;
  console.log('[RELAY] Result received:', JSON.stringify(lastResult).slice(0, 80));
  res.json({ ok: true });
});

// Health check
app.get('/ping', (req, res) => res.json({ ok: true, queue: commandQueue.length }));

app.listen(PORT, () => {
  console.log('Nexus Relay v2 (HTTP polling) running on port ' + PORT);
});
