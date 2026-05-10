#!/data/data/com.termux/files/usr/bin/bash
# NEXUS RELAY — Poll Client v2
# Runs in Termux. No Python needed. Just curl.
# Polls Railway for commands, executes on ZeroTap, sends result back.

RELAY="https://nexus-relay-production.up.railway.app"
ZEROTAP="http://localhost:7474"

echo "ZapiaPrime Hands — Poll Client v2"
echo "Relay: $RELAY"
echo "ZeroTap: $ZEROTAP"
echo ""

while true; do
  # Poll for a command
  RESPONSE=$(curl -s --max-time 5 "$RELAY/poll")
  ACTION=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('action','none'))" 2>/dev/null)

  if [ "$ACTION" != "none" ] && [ -n "$ACTION" ]; then
    echo "[POLL] Command received: $RESPONSE"
    # Forward to ZeroTap
    CMD_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_id',''))" 2>/dev/null)
    CLEAN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); d.pop('_id',None); print(json.dumps(d))" 2>/dev/null)
    RESULT=$(curl -s --max-time 10 -X POST -H "Content-Type: application/json" -d "$CLEAN" "$ZEROTAP/execute")
    echo "[POLL] ZeroTap result: $RESULT"
    # Send result back
    PAYLOAD="{\"_id\":\"$CMD_ID\",\"result\":$RESULT}"
    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$RELAY/result" > /dev/null
  fi

  sleep 1
done
