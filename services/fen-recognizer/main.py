"""FEN recognizer microservice.

POST /api/recognize
    body (JSON): { "base64": "<png/jpeg bytes, base64>", "mediaType": "image/png" }
    -> { "fen": "<6-field FEN>", "confidence": 0.0-1.0, "stub": bool }

This mirrors the shape of the app's built-in /api/knowledge/snap route, so the
frontend (src/components/class/pdf-cropper.tsx) can point at either by setting
NEXT_PUBLIC_FEN_RECOGNIZER_URL.

The actual board-reading pipeline is stubbed - see recognizer.py.
"""

from __future__ import annotations

import base64 as b64
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from recognizer import recognize_fen

app = FastAPI(title="fen-recognizer", version="0.1.0")

# The classroom calls this straight from the browser, so CORS has to allow the
# app origin(s). Comma-separated list in FEN_RECOGNIZER_ALLOW_ORIGINS, or "*"
# for local dev.
_origins = os.environ.get("FEN_RECOGNIZER_ALLOW_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",")],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["content-type"],
)

# ~6 MB of base64 is roughly a 4 MB image - past that it is almost certainly a
# whole page, not a cropped diagram.
MAX_B64_LEN = 8_000_000


class RecognizeRequest(BaseModel):
    base64: str = Field(..., description="Image bytes, base64-encoded (no data: prefix)")
    mediaType: str = Field(default="image/png")


class RecognizeResponse(BaseModel):
    fen: str
    confidence: float
    stub: bool = False


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/recognize", response_model=RecognizeResponse)
def recognize(req: RecognizeRequest) -> RecognizeResponse:
    if not req.base64:
        raise HTTPException(status_code=400, detail="base64 is required")
    if len(req.base64) > MAX_B64_LEN:
        raise HTTPException(status_code=413, detail="image too large (max ~6MB)")
    if not req.mediaType.startswith("image/"):
        raise HTTPException(status_code=415, detail="only image/* crops are accepted")

    try:
        raw = b64.b64decode(req.base64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"bad base64: {exc}") from exc

    result = recognize_fen(raw)
    print(f"[recognize] {len(raw)}B -> fen={result.fen} conf={result.confidence}", flush=True)
    if result.fen is None:
        raise HTTPException(status_code=404, detail="no chessboard found in the crop")

    return RecognizeResponse(
        fen=result.fen, confidence=result.confidence, stub=result.stub
    )
