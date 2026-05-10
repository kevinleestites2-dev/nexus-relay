/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         NEXUS RELAY — NexusClaw Bridge Server               ║
 * ║         Railway (stable URL) ↔ Phone (outbound only)        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   Phone (Termux) → connects OUT to this relay (WebSocket)
 *   ZapiaPrime → hits relay REST API → commands forwarded to phone
 *   No inbound tunnel needed. Works on garbage hotel wifi.
 *
 * Endpoints:
 *   GET  /health            → status check
 *   POST /command           → send command to phone (ZapiaPrime uses this)
 *   GET  /response/:id      → poll for command result
 *   WS   /phone             → phone connects here (NexusClaw)
 */

const http    = require("http");
const crypto  = require("crypto");

const PORT    = process.env.PORT || 3000;
const SECRET  = process.env.RELAY_SECRET || "pantheon";

// In-memory command queue and response store
const pending   = new Map(); // id → { command, resolve, timeout }
const responses = new Map(); // id → result

let phoneSocket = null;
let phoneConnected = false;

// ── WebSocket server (phone connects here) ─────────────────────────────────
// Using raw HTTP upgrade to avoid npm dependencies
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Secret");

  if (req.method === "OPTIONS") {
    res.writeHead(204); res.end(); return;
  }

  // ── Health check ─────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status:    "ok",
      phone:     phoneConnected ? "connected" : "disconnected",
      pending:   pending.size,
      uptime:    process.uptime(),
      version:   "1.0.0",
    }));
    return;
  }

  // ── Send command to phone ────────────────────────────────────────────────
  if (req.method === "POST" && url === "/command") {
    // Auth check
    const secret = req.headers["x-secret"];
    if (secret !== SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (!phoneConnected || !phoneSocket) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Phone not connected" }));
      return;
    }

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const command = JSON.parse(body);
        const id = crypto.randomUUID();
        command._id = id;

        // Forward to phone
        phoneSocket.write(frameWebSocket(JSON.stringify(command)));

        // Wait for response (15s timeout)
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            responses.set(id, { error: "Timeout — phone did not respond in 15s" });
          }
        }, 15000);

        pending.set(id, { timer });

        // Poll for result
        const poll = setInterval(() => {
          if (responses.has(id)) {
            clearInterval(poll);
            const result = responses.get(id);
            responses.delete(id);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id, result }));
          }
        }, 100);

      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
      }
    });
    return;
  }

  // ── Status page ──────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="background:#0a0a0a;color:#00ff88;font-family:monospace;padding:2rem">
      <h2>⚡ NEXUS RELAY</h2>
      <p>Phone: <b>${phoneConnected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"}</b></p>
      <p>Pending commands: ${pending.size}</p>
      <p>Uptime: ${Math.floor(process.uptime())}s</p>
      <p><a href="/health" style="color:#00ff88">/health</a> — JSON status</p>
      </body></html>
    `);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── WebSocket upgrade (phone connects here) ───────────────────────────────
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/phone") {
    socket.destroy(); return;
  }

  // WebSocket handshake
  const key = req.headers["sec-websocket-key"];
  const acceptKey = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  phoneSocket    = socket;
  phoneConnected = true;
  console.log("📱 Phone connected via WebSocket");

  socket.on("data", buf => {
    try {
      const msg = parseWebSocket(buf);
      if (!msg) return;
      const data = JSON.parse(msg);
      const id   = data._id;
      if (id && pending.has(id)) {
        const { timer } = pending.get(id);
        clearTimeout(timer);
        pending.delete(id);
        responses.set(id, data);
        console.log(`✅ Response received for ${id}`);
      } else {
        console.log("📨 Phone message:", msg.slice(0, 100));
      }
    } catch (e) {
      console.error("Parse error:", e.message);
    }
  });

  socket.on("close",   () => { phoneConnected = false; phoneSocket = null; console.log("📱 Phone disconnected"); });
  socket.on("error",   e  => { phoneConnected = false; phoneSocket = null; console.error("Socket error:", e.message); });

  // Ping every 20s to keep alive through aggressive proxies
  const ping = setInterval(() => {
    if (phoneConnected && phoneSocket) {
      phoneSocket.write(frameWebSocket("__ping__"));
    } else {
      clearInterval(ping);
    }
  }, 20000);
});

// ── WebSocket frame helpers ───────────────────────────────────────────────
function frameWebSocket(msg) {
  const payload = Buffer.from(msg, "utf8");
  const len     = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  } else {
    header = Buffer.from([0x81, 127, 0, 0, 0, 0,
      (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([header, payload]);
}

function parseWebSocket(buf) {
  if (buf.length < 2) return null;
  const masked  = (buf[1] & 0x80) !== 0;
  let   payLen  = buf[1] & 0x7f;
  let   offset  = 2;
  if (payLen === 126) { payLen = buf.readUInt16BE(2); offset = 4; }
  else if (payLen === 127) { offset = 10; }
  const mask    = masked ? buf.slice(offset, offset + 4) : null;
  offset        += masked ? 4 : 0;
  const payload = buf.slice(offset, offset + payLen);
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return payload.toString("utf8");
}

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`⚡ Nexus Relay v1.0 running on port ${PORT}`);
  console.log(`   Phone connects to: ws://[this-url]/phone`);
  console.log(`   Commands via:      POST /command (X-Secret: ${SECRET})`);
});
