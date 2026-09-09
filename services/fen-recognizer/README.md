# fen-recognizer

Standalone microservice that turns a cropped chess-diagram image into a FEN.
Called from the classroom's **PDF → board** cropper
(`src/components/class/pdf-cropper.tsx`).

The board-reading pipeline is **stubbed** (`recognizer.py`) - it returns the
start position at confidence `0.0` with `"stub": true`. The API contract and the
frontend wiring are complete, so the CNN can drop in later without touching
either.

## Run

```bash
cd services/fen-recognizer
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Point the app at it:

```bash
# .env.local in the repo root
NEXT_PUBLIC_FEN_RECOGNIZER_URL=http://localhost:8000/api/recognize
```

Without that env var the cropper falls back to the built-in `/api/knowledge/snap`
AI-vision route, so this service is optional.

## API

### `POST /api/recognize`

```jsonc
// request
{ "base64": "<image bytes, base64, no data: prefix>", "mediaType": "image/png" }

// 200
{ "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "confidence": 0.0, "stub": true }

// 404 - no board found | 400 - bad base64 | 413 - too large | 415 - not an image
{ "detail": "no chessboard found in the crop" }
```

Same request/response shape as `POST /api/knowledge/snap` in the Next app, on
purpose - the frontend swaps only the URL.

### `GET /health`

`{ "status": "ok" }`

## Config

| Env var | Default | Purpose |
|---|---|---|
| `FEN_RECOGNIZER_ALLOW_ORIGINS` | `*` | Comma-separated allowed CORS origins (the browser calls this directly). Set to your app origin in production. |

## Implementing the pipeline

`recognizer.py` has the six steps laid out with `# TODO`s: decode → find & warp
the board quad → 8×8 slice → per-cell CNN → assemble placement → confidence.
Uncomment the vision deps in `requirements.txt` when you start.
