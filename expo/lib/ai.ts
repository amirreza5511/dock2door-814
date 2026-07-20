/**
 * Lightweight client for the Rork AI text endpoint.
 * Used by the in-app AI assistant chat.
 */

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
 * Tries the AI Gateway (Claude Sonnet 5) first, then falls back to the
 * legacy toolkit endpoint, then retries the gateway once more.
 * Throws a user-friendly error only when every attempt fails.
 */
export async function askAssistant(messages: AiMessage[]): Promise<string> {
  const viaGateway = await askViaGateway(messages);
  if (viaGateway) return viaGateway;

  const viaLegacy = await askViaLegacy(messages);
  if (viaLegacy) return viaLegacy;

  const retry = await askViaGateway(messages);
  if (retry) return retry;

  throw new Error('Could not reach the assistant. Check your connection and try again.');
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
