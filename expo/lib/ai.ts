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
 * Send a conversation to the AI and return the assistant's reply.
 * Primary path is the Supabase Edge Function proxy (`ai-chat`), which works
 * everywhere — including the browser preview where direct toolkit calls are
 * blocked. Falls back to the AI Gateway (Claude Sonnet 5) and the legacy
 * toolkit endpoint. Throws a user-friendly error only when every attempt fails.
 */
export async function askAssistant(messages: AiMessage[]): Promise<string> {
  const viaEdge = await askViaEdgeFunction(messages);
  if (viaEdge) return viaEdge;

  const viaGateway = await askViaGateway(messages);
  if (viaGateway) return viaGateway;

  const viaLegacy = await askViaLegacy(messages);
  if (viaLegacy) return viaLegacy;

  throw new Error('Could not reach the assistant. Check your connection and try again.');
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
