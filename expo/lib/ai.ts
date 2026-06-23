/**
 * Lightweight client for the Rork AI text endpoint.
 * Used by the in-app AI assistant chat.
 */

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

const LLM_ENDPOINT = 'https://toolkit.rork.com/text/llm/';

interface LlmResponse {
  completion?: string;
}

/**
 * Send a conversation to the AI and return the assistant's reply.
 * Throws a user-friendly error if the request fails.
 */
export async function askAssistant(messages: AiMessage[]): Promise<string> {
  let res: Response;
  try {
    res = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error('Could not reach the assistant. Check your connection and try again.');
  }

  if (!res.ok) {
    throw new Error('The assistant is unavailable right now. Please try again shortly.');
  }

  const data = (await res.json()) as LlmResponse;
  const completion = data.completion?.trim();
  if (!completion) {
    throw new Error('The assistant did not return a response. Please try again.');
  }
  return completion;
}
