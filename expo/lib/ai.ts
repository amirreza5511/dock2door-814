/**
 * Lightweight client for the Rork AI text endpoint.
 * Used by the in-app AI assistant chat.
 */

import { supabase } from '@/lib/supabase';

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** An image attachment the user added to a chat message (full data URI). */
export interface AiImageAttachment {
  /** e.g. `data:image/jpeg;base64,...` */
  dataUrl: string;
}

const LEGACY_LLM_ENDPOINT = 'https://toolkit.rork.com/text/llm/';
const CHAT_MODEL = 'anthropic/claude-sonnet-5';

interface LlmResponse {
  completion?: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

function toolkitBase(): string {
  return process.env.EXPO_PUBLIC_TOOLKIT_URL ?? 'https://toolkit.rork.com';
}

function toolkitKey(): string {
  return process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? '';
}

async function askViaEdgeFunction(messages: AiMessage[]): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { messages },
    });
    if (error) {
      console.log('[ai] edge chat failed', error.message);
      return null;
    }
    const completion = (data as { completion?: string } | null)?.completion?.trim();
    return completion && completion.length > 0 ? completion : null;
  } catch (e) {
    console.log('[ai] edge chat error', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

async function askViaGateway(messages: AiMessage[]): Promise<string | null> {
  try {
    const res = await fetch(`${toolkitBase()}/v2/vercel/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: CHAT_MODEL, messages, max_tokens: 2048 }),
    });
    if (!res.ok) {
      console.log('[ai] gateway chat failed', res.status);
      return null;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : null;
  } catch (e) {
    console.log('[ai] gateway chat error', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

async function askViaLegacy(messages: AiMessage[]): Promise<string | null> {
  try {
    const res = await fetch(LEGACY_LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      console.log('[ai] legacy chat failed', res.status);
      return null;
    }
    const data = (await res.json()) as LlmResponse;
    const completion = data.completion?.trim();
    return completion && completion.length > 0 ? completion : null;
  } catch (e) {
    console.log('[ai] legacy chat error', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/**
 * One round-trip to the model: tries the Supabase Edge Function proxy
 * (`ai-chat`), then the AI Gateway (Claude Sonnet 5), then the legacy toolkit
 * endpoint. Vision-capable gateway is used first when images are attached.
 */
async function askOnce(messages: AiMessage[], images?: AiImageAttachment[]): Promise<string> {
  if (images && images.length > 0) {
    const viaVision = await askViaGatewayVision(messages, images);
    if (viaVision) return viaVision;
  }

  const viaEdge = await askViaEdgeFunction(messages);
  if (viaEdge) return viaEdge;

  const viaGateway = await askViaGateway(messages);
  if (viaGateway) return viaGateway;

  const viaLegacy = await askViaLegacy(messages);
  if (viaLegacy) return viaLegacy;

  throw new Error('Could not reach the assistant. Check your connection and try again.');
}

/**
 * Send a conversation to the AI and return the assistant's reply.
 *
 * Supports an autonomous web-research loop: if the model replies with ONLY a
 * `SEARCH: <query>` line, we run a live web search, feed the results back and
 * let the model answer with fresh, grounded facts. Read-only and safe, so it
 * needs no user approval. Falls back gracefully across every transport.
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
      { role: 'assistant', content: reply },
      {
        role: 'user',
        content: results
          ? `WEB_SEARCH_RESULTS for "${query}":\n${results}\n\nUsing these results (cite full URLs), answer my previous question now. Only output another "SEARCH:" line if you genuinely need one more search.`
          : `No web results were found for "${query}". Answer my previous question using your own expert knowledge and be transparent that you could not fetch live sources. Do NOT output another SEARCH line.`,
      },
    ];
    imgs = undefined; // images only matter on the first turn
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
  // Guard against false positives: the directive must be the whole reply.
  if (trimmed.includes('\n')) return null;
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
 * Live web search via the Exa proxy. Returns a compact, model-friendly digest
 * of the top hits (title, URL, date, highlights). Returns '' on any failure so
 * the research loop can fall back to the model's own knowledge.
 */
export async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch(`${toolkitBase()}/v2/exa/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        type: 'auto',
        numResults: 5,
        contents: { highlights: true, summary: { query } },
      }),
    });
    if (!res.ok) {
      console.log('[ai] web search failed', res.status);
      return '';
    }
    const data = (await res.json()) as { results?: ExaSearchHit[] };
    const hits = data.results ?? [];
    return hits
      .map((h) => {
        const date = h.publishedDate ? ` [${h.publishedDate}]` : '';
        const body = (h.highlights && h.highlights.length > 0 ? h.highlights.join(' ') : h.summary ?? '').trim();
        return `- ${h.title ?? 'Untitled'} (${h.url})${date}\n  ${body}`;
      })
      .join('\n');
  } catch (e) {
    console.log('[ai] web search error', e instanceof Error ? e.message : 'unknown');
    return '';
  }
}

/**
 * Multimodal chat: attaches the given images to the LAST user message and asks
 * the vision model. Returns null on any failure so callers can fall back to a
 * text-only path.
 */
async function askViaGatewayVision(messages: AiMessage[], images: AiImageAttachment[]): Promise<string | null> {
  try {
    let attached = false;
    const built = [...messages].reverse().map((m) => {
      if (!attached && m.role === 'user') {
        attached = true;
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    }).reverse();

    const res = await fetch(`${toolkitBase()}/v2/vercel/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: VISION_MODEL, messages: built, max_tokens: 2048 }),
    });
    if (!res.ok) {
      console.log('[ai] vision chat failed', res.status);
      return null;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : null;
  } catch (e) {
    console.log('[ai] vision chat error', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

const VISION_MODEL = 'anthropic/claude-sonnet-5';

/** AI's best-guess parcel measurement, all in metric, from a single photo. */
export interface PhotoParcelEstimate {
  itemName: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  confidence: 'low' | 'medium' | 'high';
  note: string;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return body.trim();
  return body.slice(start, end + 1).trim();
}

function clampNum(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Ask a vision model to estimate a parcel's dimensions and weight from a photo.
 * `dataUrl` is a full data URI (e.g. `data:image/jpeg;base64,...`). Returns a
 * best-guess estimate the user can then fine-tune. Throws a friendly error if
 * the model can't be reached or returns nothing usable.
 */
export async function estimatePackageFromPhoto(dataUrl: string): Promise<PhotoParcelEstimate> {
  const prompt =
    'You are a shipping expert. Look at the package/box/item in this photo and estimate its ' +
    'shipping dimensions and weight. Use any visible reference objects (hands, coins, standard ' +
    'box sizes, furniture) for scale. Reply with ONLY a JSON object, no prose, with keys: ' +
    'itemName (short string), lengthCm (number), widthCm (number), heightCm (number), ' +
    'weightKg (number), confidence ("low"|"medium"|"high"), note (one short sentence with your ' +
    'reasoning or a tip). All measurements in centimeters and kilograms.';

  const body = {
    model: VISION_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch(`${toolkitBase()}/v2/vercel/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${toolkitKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the AI. Check your connection and try again.');
  }
  if (!res.ok) {
    console.log('[ai] photo estimate failed', res.status);
    throw new Error('The AI could not read this photo. Try a clearer, well-lit shot.');
  }
  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('The AI did not return an estimate. Please try another photo.');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  } catch {
    throw new Error('Could not understand the AI estimate. Please try again.');
  }

  const conf = String(parsed.confidence ?? 'medium').toLowerCase();
  return {
    itemName: String(parsed.itemName ?? 'Package').slice(0, 60),
    lengthCm: Math.round(clampNum(parsed.lengthCm, 20)),
    widthCm: Math.round(clampNum(parsed.widthCm, 15)),
    heightCm: Math.round(clampNum(parsed.heightCm, 10)),
    weightKg: Math.round(clampNum(parsed.weightKg, 1) * 100) / 100,
    confidence: conf === 'low' || conf === 'high' ? conf : 'medium',
    note: String(parsed.note ?? '').slice(0, 200),
  };
}

interface TranscriptionResponse {
  text?: string;
}

/**
 * Transcribe recorded audio (base64) to text via the Rork AI Gateway proxy.
 * Used by the copilot's voice input.
 */
export async function transcribeAudio(base64Audio: string, mediaType: string): Promise<string> {
  const toolkitUrl = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? 'https://toolkit.rork.com';
  const secretKey = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? '';
  let res: Response;
  try {
    res = await fetch(`${toolkitUrl}/v2/vercel/v4/ai/transcription-model`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'ai-model-id': 'openai/gpt-4o-mini-transcribe',
        'ai-gateway-protocol-version': '0.0.1',
      },
      body: JSON.stringify({ audio: base64Audio, mediaType }),
    });
  } catch {
    throw new Error('Could not reach the voice service. Check your connection and try again.');
  }
  if (!res.ok) {
    throw new Error('Voice transcription is unavailable right now. Please type your message.');
  }
  const data = (await res.json()) as TranscriptionResponse;
  return (data.text ?? '').trim();
}
