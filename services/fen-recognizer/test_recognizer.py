"""Self-check: render a board with the shared glyph renderer, recognise it back.
Run: .venv/bin/python test_recognizer.py"""
import io

from PIL import Image

from make_sample_pdf import board_png
from recognizer import recognize_fen

CASES = [
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1",
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "8/8/4k3/8/8/2K5/6Q1/8 w - - 0 1",
    "2kr3r/ppp2ppp/2n5/8/8/2N5/PPP2PPP/2KR3R w - - 0 1",
]

def _check(img_bytes: bytes, want_fen: str, label: str) -> None:
    got = recognize_fen(img_bytes)
    assert got.fen and got.fen.split()[0] == want_fen.split()[0], f"{label}: {got.fen} != {want_fen}"
    assert got.confidence > 0.5, f"{label}: low confidence {got.confidence}"


if __name__ == "__main__":
    for fen in CASES:
        b = board_png(fen)
        pad = Image.new("RGB", (b.width + 36, b.height + 36), "white")
        pad.paste(b, (18, 18))  # loose crop -> auto_trim must recover it
        buf = io.BytesIO()
        pad.save(buf, "PNG")
        _check(buf.getvalue(), fen, "synthetic")

    # full round-trip: board -> PDF page -> rasterise -> loosely crop -> recognise
    import shutil
    import subprocess
    import sys
    import tempfile

    pdftoppm = shutil.which("pdftoppm")
    if pdftoppm:
        fen = CASES[0]
        subprocess.run([sys.executable, "make_sample_pdf.py", fen, "/tmp/_t.pdf"], check=True, capture_output=True)
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([pdftoppm, "-png", "-r", "150", "/tmp/_t.pdf", f"{d}/p"], check=True)
            page = Image.open(f"{d}/p-1.png")
        s = 150 / 96  # Pillow writes the PDF page at 96 dpi
        crop = page.crop((int(150 * s), int(175 * s), int(762 * s), int(784 * s)))  # a few pt of slack
        buf = io.BytesIO()
        crop.save(buf, "PNG")
        _check(buf.getvalue(), fen, "pdf-roundtrip")
        print(f"OK — {len(CASES)} synthetic + 1 PDF round-trip recognised")
    else:
        print(f"OK — {len(CASES)} positions recognised (pdftoppm absent, skipped round-trip)")
