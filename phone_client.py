#!/usr/bin/env python3
"""
NexusClaw Phone Client v3
Polls Nexus Relay for commands, executes them, returns results.
Run in Termux: python3 phone_client.py
"""

import time
import json
import subprocess
import urllib.request
import urllib.error

RELAY_URL = "https://nexus-relay-production.up.railway.app"
POLL_INTERVAL = 3  # seconds between polls

def poll():
    try:
        req = urllib.request.Request(f"{RELAY_URL}/poll")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"[POLL ERROR] {e}")
        return None

def post_result(data):
    try:
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{RELAY_URL}/result",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"[RESULT ERROR] {e}")
        return None

def execute(cmd):
    action = cmd.get("action", "none")
    payload = cmd.get("payload", "")
    _id = cmd.get("_id", "?")

    print(f"[CMD] {action} | {str(payload)[:60]}")

    # --- Shell command ---
    if action == "shell":
        try:
            result = subprocess.run(
                payload, shell=True, capture_output=True, text=True, timeout=30
            )
            return {
                "_id": _id,
                "action": action,
                "status": "ok",
                "stdout": result.stdout[:2000],
                "stderr": result.stderr[:500],
                "returncode": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {"_id": _id, "action": action, "status": "timeout"}
        except Exception as e:
            return {"_id": _id, "action": action, "status": "error", "error": str(e)}

    # --- Open URL in browser ---
    elif action == "open_url":
        try:
            subprocess.Popen(["am", "start", "-a", "android.intent.action.VIEW", "-d", payload])
            return {"_id": _id, "action": action, "status": "ok"}
        except Exception as e:
            return {"_id": _id, "action": action, "status": "error", "error": str(e)}

    # --- Ping / health check ---
    elif action in ("ping", "test"):
        return {"_id": _id, "action": action, "status": "ok", "message": "pong from phone"}

    # --- Unknown ---
    else:
        return {"_id": _id, "action": action, "status": "unknown_action"}

def main():
    print(f"NexusClaw Phone Client v3")
    print(f"Relay: {RELAY_URL}")
    print(f"Polling every {POLL_INTERVAL}s... (Ctrl+C to stop)\n")

    while True:
        cmd = poll()
        if cmd and cmd.get("action") != "none":
            result = execute(cmd)
            post_result(result)
            print(f"[DONE] {result.get('status')}")
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[STOPPED] Phone client offline.")
