#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║         NEXUS RELAY — Phone Client (runs in Termux)         ║
║         Connects OUT to Railway relay                        ║
║         Forwards commands to NexusClaw on localhost:7474     ║
╚══════════════════════════════════════════════════════════════╝

Run in Termux:
  pip install websocket-client requests
  python3 phone_client.py

This punches through hotel firewalls because it's OUTBOUND only.
"""

import json
import time
import threading
import requests
import websocket

# ── Config ─────────────────────────────────────────────────────────────────
# Update RELAY_URL after Railway deployment
RELAY_URL    = "wss://nexus-relay-production.up.railway.app/phone"
NEXUSCLAW    = "http://localhost:7474"
RECONNECT_S  = 5   # seconds between reconnect attempts

def forward_to_nexusclaw(command: dict) -> dict:
    """Forward a command to the local NexusClaw MCP server."""
    cmd_id = command.get("_id")
    # Strip relay metadata before forwarding
    clean = {k: v for k, v in command.items() if not k.startswith("_")}
    try:
        r = requests.post(
            f"{NEXUSCLAW}/execute",
            json=clean,
            timeout=12,
        )
        result = r.json()
        result["_id"] = cmd_id
        return result
    except Exception as e:
        return {"_id": cmd_id, "error": str(e), "status": "nexusclaw_error"}


def on_message(ws, message):
    if message == "__ping__":
        return
    try:
        command = json.loads(message)
        print(f"[RELAY] Command: {json.dumps(command)[:80]}")
        result = forward_to_nexusclaw(command)
        ws.send(json.dumps(result))
        print(f"[RELAY] Response sent: {json.dumps(result)[:80]}")
    except Exception as e:
        print(f"[RELAY] Error processing command: {e}")


def on_error(ws, error):
    print(f"[RELAY] WS error: {error}")


def on_close(ws, code, msg):
    print(f"[RELAY] Disconnected ({code}). Reconnecting in {RECONNECT_S}s...")


def on_open(ws):
    print("[RELAY] ✅ Connected to Nexus Relay on Railway")
    print(f"[RELAY] Forwarding commands to NexusClaw @ {NEXUSCLAW}")


def connect():
    while True:
        try:
            ws = websocket.WebSocketApp(
                RELAY_URL,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
            )
            ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as e:
            print(f"[RELAY] Connection failed: {e}")
        print(f"[RELAY] Reconnecting in {RECONNECT_S}s...")
        time.sleep(RECONNECT_S)


if __name__ == "__main__":
    print("⚡ Nexus Relay Phone Client v1.0")
    print(f"   Relay:     {RELAY_URL}")
    print(f"   NexusClaw: {NEXUSCLAW}")
    print()
    connect()
