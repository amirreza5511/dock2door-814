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

/** Send a conversation to the AI and return the assistant's reply. */
export async function askAssistant(messages: AiMessage[], images?: AiImageAttachment[]): Promise<string> {
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
