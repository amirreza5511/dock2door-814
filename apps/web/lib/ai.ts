/**
 * Lightweight client for the Rork AI text endpoint (same service the mobile
 * app uses). No keys required.
 */

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** An image attachment the user added to a chat message (full data URI). */
export interface AiImageAttachment {
  /** e.g. `data:image/jpeg;base64,...` */
  dataUrl: string;
}

const LLM_ENDPOINT = "https://toolkit.rork.com/text/llm/";
const GATEWAY_ENDPOINT = "https://toolkit.rork.com/v2/vercel/v1/chat/completions";
const EXA_SEARCH_ENDPOINT = "https://toolkit.rork.com/v2/exa/search";
const VISION_MODEL = "anthropic/claude-sonnet-5";

interface LlmResponse {
  completion?: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

function toolkitKey(): string {
  return process.env.NEXT_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? "";
}

/**
 * Multimodal chat: attaches images to the LAST user message and asks the vision
 * model. Returns null on any failure so callers can fall back to text-only.
 */
async function askViaVision(messages: AiMessage[], images: AiImageAttachment[]): Promise<string | null> {
  try {
    let attached = false;
    const built = [...messages].reverse().map((m) => {
      if (!attached && m.role === "user") {
        attached = true;
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    }).reverse();

    const res = await fetch(GATEWAY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: VISION_MODEL, messages: built, max_tokens: 2048 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** One round-trip to the model: vision gateway when images are present, else the LLM endpoint. */
async function askOnce(messages: AiMessage[], images?: AiImageAttachment[]): Promise<string> {
  if (images && images.length > 0) {
    const viaVision = await askViaVision(messages, images);
    if (viaVision) return viaVision;
  }

  let res: Response;
  try {
    res = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error("Could not reach the assistant. Check your connection and try again.");
  }
  if (!res.ok) {
    throw new Error("The assistant is unavailable right now. Please try again shortly.");
  }
  const data = (await res.json()) as LlmResponse;
  const completion = data.completion?.trim();
  if (!completion) {
    throw new Error("The assistant did not return a response. Please try again.");
  }
  return completion;
}

/**
 * Send a conversation to the AI and return the assistant's reply.
 *
 * Supports an autonomous web-research loop: if the model replies with ONLY a
 * `SEARCH: <query>` line, we run a live web search, feed the results back and
 * let the model answer with fresh, grounded facts. Read-only and safe.
 */
export async function askAssistant(messages: AiMessage[], images?: AiImageAttachment[]): Promise<string> {
  let convo: AiMessage[] = messages;
  let imgs = images;
  for (let round = 0; round < 3; round += 1) {
    const reply = await askOnce(convo, imgs);
    const query = parseSearchDirective(reply);
    if (!query) return reply;
    const results = await searchWeb(query);
    convo = [
      ...convo,
      { role: "assistant", content: reply },
      {
        role: "user",
        content: results
          ? `WEB_SEARCH_RESULTS for "${query}":\n${results}\n\nUsing these results (cite full URLs), answer my previous question now. Only output another "SEARCH:" line if you genuinely need one more search.`
          : `No web results were found for "${query}". Answer my previous question using your own expert knowledge and be transparent that you could not fetch live sources. Do NOT output another SEARCH line.`,
      },
    ];
    imgs = undefined;
  }
  return askOnce(convo);
}

/**
 * When the model wants to look something up it replies with a single line
 * `SEARCH: <query>` and nothing else. Returns the query, or null otherwise.
 */
function parseSearchDirective(reply: string): string | null {
  const trimmed = reply.trim();
  const match = trimmed.match(/^SEARCH:\s*(.+)$/i);
  if (!match) return null;
  if (trimmed.includes("\n")) return null;
  const q = match[1].trim();
  return q.length > 0 ? q : null;
}

interface ExaSearchHit {
  title?: string;
  url: string;
  publishedDate?: string | null;
  highlights?: string[];
  summary?: string;
}

/**
 * Live web search via the Exa proxy. Returns a compact digest of the top hits.
 * Returns '' on any failure so the research loop falls back to model knowledge.
 */
export async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch(EXA_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 5,
        contents: { highlights: true, summary: { query } },
      }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { results?: ExaSearchHit[] };
    const hits = data.results ?? [];
    return hits
      .map((h) => {
        const date = h.publishedDate ? ` [${h.publishedDate}]` : "";
        const body = (h.highlights && h.highlights.length > 0 ? h.highlights.join(" ") : h.summary ?? "").trim();
        return `- ${h.title ?? "Untitled"} (${h.url})${date}\n  ${body}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

interface TranscriptionResponse {
  text?: string;
}

/**
 * Transcribe recorded audio (base64) to text via the Rork AI Gateway proxy.
 * Used by the copilot's voice input on the web.
 */
export async function transcribeAudio(base64Audio: string, mediaType: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://toolkit.rork.com/v2/vercel/v4/ai/transcription-model", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        "Content-Type": "application/json",
        "ai-model-id": "openai/gpt-4o-mini-transcribe",
        "ai-gateway-protocol-version": "0.0.1",
      },
      body: JSON.stringify({ audio: base64Audio, mediaType }),
    });
  } catch {
    throw new Error("Could not reach the voice service. Check your connection and try again.");
  }
  if (!res.ok) {
    throw new Error("Voice transcription is unavailable right now. Please type your message.");
  }
  const data = (await res.json()) as TranscriptionResponse;
  return (data.text ?? "").trim();
}
