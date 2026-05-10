#!/usr/bin/env python3
"""
phone_client.py — NexusClaw Relay Client v4.0.0
Full Duplex Ghost Operator mode.
Runs in Termux. No inbound tunnel needed.
Flow: GET /poll -> execute command -> POST /result
"""

import subprocess, time, json, os, sys
import urllib.request, urllib.error

RELAY   = os.environ.get("RELAY_URL", "https://nexus-relay-production.up.railway.app")
SECRET  = os.environ.get("SECRET", "pantheon_prime")
POLL_MS = int(os.environ.get("POLL_INTERVAL_MS", "2000"))

def request(method, path, data=None):
    url = RELAY + path
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("X-Secret", SECRET)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": str(e), "code": e.code}
    except Exception as e:
        return {"error": str(e)}

def execute(cmd):
    t = cmd.get("type", "shell")
    if t == "shell":
        raw = cmd.get("cmd", "echo no_cmd")
        try:
            out = subprocess.check_output(
                raw, shell=True, stderr=subprocess.STDOUT,
                timeout=30, text=True
            )
            return {"status": "ok", "output": out.strip()}
        except subprocess.TimeoutExpired:
            return {"status": "timeout", "output": ""}
        except subprocess.CalledProcessError as e:
            return {"status": "error", "output": e.output.strip(), "exit_code": e.returncode}
    elif t == "ping":
        return {"status": "ok", "output": "pong"}
    elif t == "info":
        import platform
        return {
            "status": "ok",
            "output": "NexusClaw v4 | Python " + sys.version.split()[0] + " | " + platform.system() + " " + platform.machine()
        }
    else:
        return {"status": "error", "output": "unknown type: " + t}

def main():
    print("[NexusClaw] v4.0.0 connecting to " + RELAY)
    p = request("GET", "/ping")
    print("[NexusClaw] Relay: " + str(p))
    print("[NexusClaw] Polling every " + str(POLL_MS) + "ms — CTRL+C to stop")

    consecutive_errors = 0
    while True:
        try:
            cmd = request("GET", "/poll")
            if "error" in cmd:
                consecutive_errors += 1
                wait = min(30, 2 ** consecutive_errors)
                print("[NexusClaw] Poll error: " + cmd["error"] + " — retry in " + str(wait) + "s")
                time.sleep(wait)
                continue
            consecutive_errors = 0
            if cmd.get("status") == "empty" or not cmd.get("_id"):
                time.sleep(POLL_MS / 1000)
                continue
            cmd_id = cmd["_id"]
            print("[NexusClaw] Got command [" + cmd_id + "]: " + json.dumps(cmd)[:80])
            result = execute(cmd)
            result["_id"] = cmd_id
            resp = request("POST", "/result", result)
            print("[NexusClaw] Result posted: " + str(resp))
        except KeyboardInterrupt:
            print("\n[NexusClaw] Stopped.")
            break
        except Exception as e:
            print("[NexusClaw] Error: " + str(e))
            time.sleep(5)

if __name__ == "__main__":
    main()
