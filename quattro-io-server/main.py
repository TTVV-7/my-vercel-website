import asyncio
import contextlib
import json
import math
import random
import secrets
from dataclasses import dataclass, field
from typing import Dict, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

WORLD_WIDTH = 1000
WORLD_HEIGHT = 650
PLAYER_SPEED = 220.0
TICK_RATE = 20
STATE_RATE = 10
CRATE_COUNT = 24
PLAYER_RADIUS = 14
CRATE_RADIUS = 11


@dataclass
class Player:
    id: str
    name: str
    x: float
    y: float
    color: str
    score: int = 0
    up: bool = False
    down: bool = False
    left: bool = False
    right: bool = False


@dataclass
class Crate:
    id: str
    x: float
    y: float


@dataclass
class Room:
    players: Dict[str, Player] = field(default_factory=dict)
    sockets: Dict[str, WebSocket] = field(default_factory=dict)
    crates: List[Crate] = field(default_factory=list)


app = FastAPI(title="Quattro IO Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

room = Room()
colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"]
state_task: asyncio.Task | None = None


def random_xy(margin: int = 30) -> tuple[float, float]:
    return (
        random.uniform(margin, WORLD_WIDTH - margin),
        random.uniform(margin, WORLD_HEIGHT - margin),
    )


def random_crate(crate_id: str) -> Crate:
    x, y = random_xy(20)
    return Crate(id=crate_id, x=x, y=y)


def ensure_crates() -> None:
    while len(room.crates) < CRATE_COUNT:
        room.crates.append(random_crate(secrets.token_hex(4)))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def collide(a_x: float, a_y: float, a_r: float, b_x: float, b_y: float, b_r: float) -> bool:
    return math.hypot(a_x - b_x, a_y - b_y) <= (a_r + b_r)


def player_payload(player: Player) -> dict:
    return {
        "id": player.id,
        "name": player.name,
        "x": round(player.x, 2),
        "y": round(player.y, 2),
        "score": player.score,
        "color": player.color,
    }


def state_payload() -> dict:
    leaderboard = sorted(room.players.values(), key=lambda p: p.score, reverse=True)
    return {
        "type": "state",
        "players": [player_payload(player) for player in room.players.values()],
        "crates": [{"id": crate.id, "x": crate.x, "y": crate.y} for crate in room.crates],
        "leaderboard": [{"id": p.id, "name": p.name, "score": p.score} for p in leaderboard[:8]],
    }


async def safe_send(socket: WebSocket, payload: dict) -> None:
    await socket.send_text(json.dumps(payload))


async def broadcast_state() -> None:
    if not room.sockets:
        return
    payload = state_payload()
    dead_ids = []
    for player_id, socket in room.sockets.items():
        try:
            await safe_send(socket, payload)
        except Exception:
            dead_ids.append(player_id)
    for player_id in dead_ids:
        room.sockets.pop(player_id, None)
        room.players.pop(player_id, None)


async def tick_loop() -> None:
    tick_dt = 1.0 / TICK_RATE
    state_every = max(1, int(TICK_RATE / STATE_RATE))
    tick_counter = 0

    while True:
        if not room.players:
            await asyncio.sleep(0.2)
            continue

        ensure_crates()

        for player in list(room.players.values()):
            dx = float(player.right) - float(player.left)
            dy = float(player.down) - float(player.up)
            if dx or dy:
                mag = math.hypot(dx, dy)
                dx /= mag
                dy /= mag
                player.x += dx * PLAYER_SPEED * tick_dt
                player.y += dy * PLAYER_SPEED * tick_dt
                player.x = clamp(player.x, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS)
                player.y = clamp(player.y, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS)

            for crate in room.crates:
                if collide(player.x, player.y, PLAYER_RADIUS, crate.x, crate.y, CRATE_RADIUS):
                    player.score += 1
                    crate.x, crate.y = random_xy(20)

        tick_counter += 1
        if tick_counter % state_every == 0:
            await broadcast_state()

        await asyncio.sleep(tick_dt)


@app.on_event("startup")
async def startup() -> None:
    global state_task
    ensure_crates()
    state_task = asyncio.create_task(tick_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    global state_task
    if state_task:
        state_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await state_task


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "players": len(room.players), "crates": len(room.crates)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    player_id = secrets.token_hex(6)
    start_x, start_y = random_xy(40)
    player = Player(
        id=player_id,
        name="Builder",
        x=start_x,
        y=start_y,
        color=random.choice(colors),
    )

    room.players[player_id] = player
    room.sockets[player_id] = websocket

    await safe_send(websocket, {"type": "welcome", "id": player_id})
    await safe_send(websocket, state_payload())

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "join":
                maybe_name = str(data.get("name", "")).strip()
                if maybe_name:
                    player.name = maybe_name[:18]
            elif msg_type == "input":
                player.up = bool(data.get("up"))
                player.down = bool(data.get("down"))
                player.left = bool(data.get("left"))
                player.right = bool(data.get("right"))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.players.pop(player_id, None)
        room.sockets.pop(player_id, None)
