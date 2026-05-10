# Nexus Relay v2

HTTP polling relay for NexusClaw Ghost Operator mode.

## Endpoints
- POST /command - queue a command (X-Secret required)
- GET /poll - phone polls for next command
- POST /result - phone posts result back
- GET /result - ZapiaPrime checks result (X-Secret required)
- GET /ping - health check
