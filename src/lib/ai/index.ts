/** AI provider abstraction - the only file that knows vendor wire formats.
 *  Selected by AI_PROVIDER (anthropic default | openai); callers pass
 *  provider-neutral messages and get text back. Retries transient failures.
 *
 *  ponytail: one function, not a class hierarchy - both call sites (knowledge
 *  extraction, coach assistant) are "messages in, text out". Add streaming or
 *  tool-use to the options bag when a feature actually needs them. */

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Media = { kind: "pdf" | "image"; base64: string; mediaType: string };

export type CompleteOptions = {
  system?: string;
  messages: ChatMessage[];
  /** Attached to the last user message (vision/document input). */
  media?: Media;
  maxTokens: number;
};

export function aiProvider(): "anthropic" | "openai" {
  return process.env.AI_PROVIDER === "openai" ? "openai" : "anthropic";
}

/** Key present for the active provider? Callers gate features on this. */
export function aiAvailable(): boolean {
  return Boolean(
    aiProvider() === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY,
  );
}

export const AI_UNAVAILABLE_MSG =
  "AI provider not configured - set ANTHROPIC_API_KEY (or AI_PROVIDER=openai + OPENAI_API_KEY); see docs/NEEDS.md";

/** POST with up to 2 retries on 429/5xx/network errors (exponential backoff). */
async function postWithRetry(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI request failed after retries");
}

export async function aiComplete(opts: CompleteOptions): Promise<string> {
  if (!aiAvailable()) throw new Error(AI_UNAVAILABLE_MSG);
  return aiProvider() === "openai" ? openaiComplete(opts) : anthropicComplete(opts);
}

// ── Anthropic ────────────────────────────────────────────────────────────────

async function anthropicComplete({ system, messages, media, maxTokens }: CompleteOptions): Promise<string> {
  type Block = Record<string, unknown>;
  const apiMessages: { role: string; content: string | Block[] }[] = messages.map((m) => ({ ...m }));
  if (media) {
    const last = apiMessages[apiMessages.length - 1];
    const mediaBlock: Block =
      media.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: media.base64 } }
        : { type: "image", source: { type: "base64", media_type: media.mediaType, data: media.base64 } };
    last.content = [mediaBlock, { type: "text", text: last.content as string }];
  }

  const res = await postWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    { model: "claude-sonnet-5", max_tokens: maxTokens, system, messages: apiMessages },
  );
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const msg = await res.json();
  return ((msg.content ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function openaiComplete({ system, messages, media, maxTokens }: CompleteOptions): Promise<string> {
  type Part = Record<string, unknown>;
  const apiMessages: { role: string; content: string | Part[] }[] = messages.map((m) => ({ ...m }));
  if (media) {
    if (media.kind === "pdf")
      // ponytail: OpenAI PDF input needs their Files/Responses API - a second
      // wire format for one optional provider. Add if someone runs openai+PDFs.
      throw new Error("PDF extraction currently requires AI_PROVIDER=anthropic (images work on both)");
    const last = apiMessages[apiMessages.length - 1];
    last.content = [
      { type: "image_url", image_url: { url: `data:${media.mediaType};base64,${media.base64}` } },
      { type: "text", text: last.content as string },
    ];
  }
  if (system) apiMessages.unshift({ role: "system", content: system });

  const res = await postWithRetry(
    "https://api.openai.com/v1/chat/completions",
    {
      authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      "content-type": "application/json",
    },
    { model: "gpt-4o", max_tokens: maxTokens, messages: apiMessages },
  );
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const msg = await res.json();
  return (msg.choices?.[0]?.message?.content ?? "").trim();
}
