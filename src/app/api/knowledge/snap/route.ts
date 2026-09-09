import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { createClient } from "@/lib/supabase/server";
import { rateLimitGuard } from "@/lib/rate-limit-guard";
import { aiAvailable, aiComplete, AI_UNAVAILABLE_MSG } from "@/lib/ai";

/** "Snap" a chess diagram (image or PDF page) → single FEN, for the live
 *  classroom board. One-shot vision call - the full multi-diagram pipeline
 *  stays in /api/knowledge/process. */

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimitGuard(`snap:${user.id}`, 10, 60_000);
  if (limited) return limited;
  if (!aiAvailable()) return NextResponse.json({ error: AI_UNAVAILABLE_MSG }, { status: 422 });

  const { base64, mediaType } = (await req.json().catch(() => ({}))) as {
    base64?: string;
    mediaType?: string;
  };
  if (!base64 || !mediaType) {
    return NextResponse.json({ error: "base64 and mediaType required" }, { status: 400 });
  }
  if (base64.length > 8_000_000) {
    return NextResponse.json({ error: "File too large (max ~6MB)" }, { status: 413 });
  }

  try {
    const text = await aiComplete({
      messages: [{
        role: "user",
        content:
          'Find the chess diagram in this file and reconstruct its position. Respond with ONLY a JSON object: {"fen": "<full 6-field FEN>", "confidence": 0..1}. If there is no chess diagram, return {"fen": null, "confidence": 0}.',
      }],
      media: {
        kind: mediaType === "application/pdf" ? "pdf" : "image",
        base64,
        mediaType,
      },
      maxTokens: 300,
    });
    const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      fen?: string | null;
      confidence?: number;
    };
    if (!parsed.fen) return NextResponse.json({ error: "No chess diagram found" }, { status: 404 });
    new Chess(parsed.fen); // validate
    return NextResponse.json({ fen: parsed.fen, confidence: parsed.confidence ?? 0 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Snap failed" },
      { status: 500 },
    );
  }
}
