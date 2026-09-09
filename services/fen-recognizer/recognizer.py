"""Board-image -> FEN pipeline.

Real (no-ML) recogniser for printed / rendered chess diagrams:

  1. decode -> grayscale, auto-trim a uniform outer border
  2. assume the (trimmed) crop IS the board, split into an 8x8 grid
  3. per cell: foreground = pixels that differ from the cell's own background;
     empty if the foreground fraction is tiny
  4. piece colour from the mean luminance of the foreground (white glyphs are
     outline-only -> light; black glyphs are filled -> dark)
  5. piece type by best mask-IoU against 12 rendered glyph templates
  6. confidence = mean IoU of the matched occupied cells

Works well on diagrams drawn with standard chess glyphs (the shared
`render_glyph` below is also what `make_sample_pdf.py` uses). Side-to-move /
castling aren't shown in a diagram, so we default to "w KQkq - 0 1".
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFont

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

FONT_PATH = "/System/Library/Fonts/Apple Symbols.ttf"
TILE = 64  # template / cell working resolution

# piece letter -> (white codepoint, black codepoint)
_CP = {
    "k": (0x2654, 0x265A), "q": (0x2655, 0x265B), "r": (0x2656, 0x265C),
    "b": (0x2657, 0x265D), "n": (0x2658, 0x265E), "p": (0x2659, 0x265F),
}


@dataclass
class Recognition:
    fen: str | None
    confidence: float
    stub: bool = False


def render_glyph(letter: str, white: bool, size: int = TILE) -> Image.Image:
    """A `size`x`size` grayscale tile: the piece glyph centred on white."""
    img = Image.new("L", (size, size), 255)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, int(size * 0.82))
    ch = chr(_CP[letter][0 if white else 1])
    l, t, r, b = font.getbbox(ch)
    d.text(((size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t), ch, font=font, fill=0)
    return img


def _mask(tile: np.ndarray, bg: float) -> np.ndarray:
    """Foreground = pixels far from the tile background luminance."""
    return np.abs(tile.astype(np.int16) - bg) > 45


def _silhouette(fg: np.ndarray) -> np.ndarray:
    """Fill a glyph outline into a solid blob: span-fill rows AND columns, so a
    hollow (white) piece and a filled (black) piece of the same TYPE match."""
    if not fg.any():
        return fg
    h_fill = np.zeros_like(fg)
    for r in np.where(fg.any(axis=1))[0]:
        cols = np.where(fg[r])[0]
        h_fill[r, cols[0]:cols[-1] + 1] = True
    v_fill = np.zeros_like(fg)
    for c in np.where(fg.any(axis=0))[0]:
        rows = np.where(fg[:, c])[0]
        v_fill[rows[0]:rows[-1] + 1, c] = True
    return h_fill & v_fill


# type templates: letter -> filled silhouette (colour-agnostic occupancy/shape)
_SIL: dict[str, np.ndarray] = {}
# appearance templates: (letter, white) -> zero-mean unit-norm grayscale tile
_APP: dict[tuple[str, bool], np.ndarray] = {}


def _norm(t: np.ndarray) -> np.ndarray:
    t = t.astype(np.float64) - t.mean()
    n = np.linalg.norm(t)
    return t / n if n else t


def _templates() -> dict[str, np.ndarray]:
    if not _SIL:
        for letter in _CP:
            for white in (True, False):
                arr = np.asarray(render_glyph(letter, white))
                _APP[(letter, white)] = _norm(arr)
                if not white:
                    _SIL[letter] = _silhouette(_mask(arr, 255))
    return _SIL


def _auto_trim(gray: np.ndarray) -> np.ndarray:
    """Drop a near-uniform outer border (labels, page margin)."""
    h, w = gray.shape
    row_var = gray.var(axis=1)
    col_var = gray.var(axis=0)
    thr = 25.0
    rows = np.where(row_var > thr)[0]
    cols = np.where(col_var > thr)[0]
    if rows.size < h * 0.2 or cols.size < w * 0.2:
        return gray
    return gray[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]




def _iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 0.0


def _classify_cell(cell: np.ndarray) -> tuple[str, float]:
    """cell: grayscale HxW. -> (piece char or '', match score)."""
    from PIL import Image as _I

    tile = np.asarray(_I.fromarray(cell).resize((TILE, TILE)))
    # background = modal-ish luminance from the corners
    corners = np.concatenate([
        tile[:8, :8].ravel(), tile[:8, -8:].ravel(),
        tile[-8:, :8].ravel(), tile[-8:, -8:].ravel(),
    ])
    bg = float(np.median(corners))
    fg = _mask(tile, bg)
    frac = fg.mean()
    if frac < 0.03 or frac > 0.95:
        return "", 0.0

    sil = _silhouette(fg)
    sils = _templates()
    # occupancy gate: does the blob look like any piece silhouette at all?
    if max(_iou(sil, t) for t in sils.values()) < 0.30:
        return "", 0.0

    # type + colour together: normalised cross-correlation of the cell against
    # all 12 rendered glyph tiles (captures both shape and fill/outline). Glyph
    # ink is dark on any square colour, matching the dark-on-white templates;
    # NCC is contrast-normalised so the square colour doesn't matter.
    cn = _norm(tile.astype(np.float64))
    best, best_ncc = ("p", False), -1.0
    for key, app in _APP.items():
        ncc = float((cn * app).sum())
        if ncc > best_ncc:
            best_ncc, best = ncc, key
    letter, white = best
    return (letter.upper() if white else letter), round(best_ncc, 3)


def _grid_to_placement(grid: list[list[str]]) -> str:
    ranks: list[str] = []
    for row in grid:
        out, run = "", 0
        for cell in row:
            if cell == "":
                run += 1
            else:
                if run:
                    out += str(run)
                    run = 0
                out += cell
        if run:
            out += str(run)
        ranks.append(out or "8")
    return "/".join(ranks)


def recognize_fen(image_bytes: bytes) -> Recognition:
    """Return a Recognition for the given image crop (PNG/JPEG bytes)."""
    if not image_bytes:
        return Recognition(fen=None, confidence=0.0)

    try:
        gray = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("L"), dtype=np.uint8)
    except Exception:
        return Recognition(fen=None, confidence=0.0)

    board = _auto_trim(gray)
    h, w = board.shape
    if h < 32 or w < 32:
        return Recognition(fen=None, confidence=0.0)
    if min(h, w) < 512:  # upscale small crops so the 64x64 cell match has detail
        s = 512 / min(h, w)
        board = np.asarray(Image.fromarray(board).resize((round(w * s), round(h * s))))
        h, w = board.shape

    grid: list[list[str]] = []
    scores: list[float] = []
    for r in range(8):
        row: list[str] = []
        for c in range(8):
            y0, y1 = round(r * h / 8), round((r + 1) * h / 8)
            x0, x1 = round(c * w / 8), round((c + 1) * w / 8)
            char, score = _classify_cell(board[y0:y1, x0:x1])
            row.append(char)
            if char:
                scores.append(score)
        grid.append(row)

    placement = _grid_to_placement(grid)
    if placement.replace("/", "").replace("8", "") == "":
        return Recognition(fen=None, confidence=0.0)  # no pieces found

    confidence = round(float(np.mean(scores)), 3) if scores else 0.0
    return Recognition(fen=f"{placement} w KQkq - 0 1", confidence=confidence)
