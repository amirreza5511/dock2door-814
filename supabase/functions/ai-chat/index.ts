// AI chat proxy — forwards copilot conversations to the Rork AI Gateway
// server-side so mobile/web clients never hit toolkit auth issues directly.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

interface LegacyResponse {
  completion?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let messages: AiMessage[];
  try {
    const body = (await req.json()) as { messages?: AiMessage[] };
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (messages.length === 0) {
    return json({ error: "messages is required" }, 400);
  }

  const toolkitUrl = Deno.env.get("TOOLKIT_URL") ?? "https://toolkit.rork.com";
  const toolkitKey = Deno.env.get("TOOLKIT_SECRET_KEY") ?? "";

  // Primary: Vercel AI Gateway (Claude Sonnet 5) via the Rork toolkit proxy.
  if (toolkitKey) {
    try {
      const res = await fetch(`${toolkitUrl}/v2/vercel/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${toolkitKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-5",
          messages,
          max_tokens: 2048,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as ChatCompletionResponse;
        const completion = data.choices?.[0]?.message?.content?.trim();
        if (completion) return json({ completion });
      } else {
        console.error("[ai-chat] gateway failed", res.status, await res.text().catch(() => ""));
      }
    } catch (e) {
      console.error("[ai-chat] gateway error", e instanceof Error ? e.message : e);
    }
  }

  // Fallback: legacy toolkit text endpoint (no auth required).
  try {
    const res = await fetch("https://toolkit.rork.com/text/llm/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (res.ok) {
      const data = (await res.json()) as LegacyResponse;
      const completion = data.completion?.trim();
      if (completion) return json({ completion });
    } else {
      console.error("[ai-chat] legacy failed", res.status);
    }
  } catch (e) {
    console.error("[ai-chat] legacy error", e instanceof Error ? e.message : e);
  }

  return json({ error: "assistant_unavailable" }, 502);
});
