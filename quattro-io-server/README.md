# Quattro IO Server (Python)

Realtime game server for `Quattro Site Rush`.

## Local setup

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run server:

```bash
uvicorn main:app --host 0.0.0.0 --port 8787 --reload
```

4. Health check:

```bash
curl http://localhost:8787/health
```

## WebSocket protocol

### Client -> Server

- `{"type":"join","name":"Tom"}`
- `{"type":"input","up":true,"down":false,"left":false,"right":true}`

### Server -> Client

- `{"type":"welcome","id":"abc123"}`
- `{"type":"state","players":[...],"crates":[...],"leaderboard":[...]}`

## Frontend connection

In Next app set:

```bash
NEXT_PUBLIC_QUATTRO_IO_WS_URL=ws://localhost:8787/ws
```

Then open `/fitness/io`.
