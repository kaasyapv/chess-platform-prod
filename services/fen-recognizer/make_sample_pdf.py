"""Generate a sample 1-page chess-lesson PDF with a board diagram, for testing
the PDF-to-board cropper end to end. Uses the same glyph renderer as the
recogniser so the closed loop is exact.

    python make_sample_pdf.py [FEN] [out.pdf]
"""

import sys

from PIL import Image, ImageDraw, ImageFont

from recognizer import render_glyph

FEN = sys.argv[1] if len(sys.argv) > 1 else "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1"
OUT = sys.argv[2] if len(sys.argv) > 2 else "sample-lesson.pdf"

SQ = 72
LIGHT, DARK = (238, 238, 210), (118, 150, 86)


def board_png(fen: str) -> Image.Image:
    rows = fen.split()[0].split("/")
    img = Image.new("RGB", (SQ * 8, SQ * 8), "white")
    d = ImageDraw.Draw(img)
    for r, row in enumerate(rows):
        c = 0
        for ch in row:
            if ch.isdigit():
                for _ in range(int(ch)):
                    d.rectangle([c * SQ, r * SQ, (c + 1) * SQ, (r + 1) * SQ],
                                fill=LIGHT if (r + c) % 2 == 0 else DARK)
                    c += 1
            else:
                d.rectangle([c * SQ, r * SQ, (c + 1) * SQ, (r + 1) * SQ],
                            fill=LIGHT if (r + c) % 2 == 0 else DARK)
                glyph = render_glyph(ch.lower(), ch.isupper(), SQ).convert("RGBA")
                # make the white tile background transparent
                px = glyph.load()
                for y in range(SQ):
                    for x in range(SQ):
                        if px[x, y][0] > 240:
                            px[x, y] = (0, 0, 0, 0)
                img.paste(glyph, (c * SQ, r * SQ), glyph)
                c += 1
    return img


page = Image.new("RGB", (816, 1056), "white")
d = ImageDraw.Draw(page)
title = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 28)
body = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 16)
d.text((60, 50), "Lesson 4 — The Italian Game", font=title, fill="black")
d.text((60, 100), "After 1.e4 e5 2.Nf3 Nc6 3.Bc4, Black must decide how to meet", font=body, fill="black")
d.text((60, 124), "the bishop's aim at f7. The main lines are 3...Bc5 and 3...Nf6.", font=body, fill="black")
page.paste(board_png(FEN), (168, 190))
d.text((60, 780), "Diagram: position after 3.Bc4 (Black to move).", font=body, fill="black")
page.save(OUT, "PDF", resolution=96)
print("wrote", OUT, "for FEN", FEN)
