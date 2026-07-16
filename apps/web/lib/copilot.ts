/**
 * AI Copilot core: system prompt builder + structured action parsing.
 * Mirrors expo/lib/copilot.ts — keep the two in sync.
 */

export type CopilotActionType =
  | "dispatch_move"
  | "assign_equipment"
  | "set_charges"
  | "link_street_turn"
  | "run_watchdog"
  | "request_customization";

export interface CopilotAction {
  type: CopilotActionType;
  label: string;
  reason?: string;
  params: Record<string, unknown>;
}

export interface ParsedCopilotReply {
  text: string;
  actions: CopilotAction[];
  memory: string | null;
}

const ACTION_TYPES: CopilotActionType[] = [
  "dispatch_move",
  "assign_equipment",
  "set_charges",
  "link_street_turn",
  "run_watchdog",
  "request_customization",
];

export function buildCopilotSystemPrompt(context: unknown, memories: string[]): string {
  const memoryBlock = memories.length > 0
    ? `\nSaved memories (facts the user asked you to remember — always honor them):\n${memories.map((m) => `- ${m}`).join("\n")}\n`
    : "";
  return `You are the Dock2Door Copilot — an operations co-pilot for a logistics platform covering drayage (container trucking), trucking, warehousing and labour.

You watch the user's live operation and help them run it: dispatching, equipment, per diem/demurrage/storage deadlines, dead runs (empty miles), street turns, and making more money.

LIVE DATA SNAPSHOT (real, current — use it, never invent data):
${JSON.stringify(context ?? {}, null, 1)}
${memoryBlock}
RULES:
- Mirror the user's language: if they write in Persian/Farsi, answer in Persian. If English, answer in English.
- Be concise and practical. Use short paragraphs or bullet lists, no huge essays.
- Ground every claim in the snapshot. If data is missing, say so plainly.
- Money advice: point at concrete items (order refs, containers, equipment) with estimated dollar amounts when possible — e.g. dead-run costs, accruing per diem, street-turn savings, idle rentals.

PROPOSING ACTIONS (dispatch etc.):
When the user asks you to dispatch, assign equipment, set charge deadlines, or pair a street turn — and the snapshot contains the required IDs — append EXACTLY ONE fenced block at the very END of your reply:

\`\`\`actions
{"actions":[{"type":"dispatch_move","label":"Dispatch Ali to Pickup — DRY-1042","reason":"Ali has no active move and the appointment is tomorrow 08:00","params":{"moveId":"<moveId>","driverUserId":"<driverUserId>","apptDate":"2026-07-17","apptTime":"08:00"}}],"memory":null}
\`\`\`

Action types and required params (use EXACT ids from the snapshot, never fabricate):
- dispatch_move: { "moveId", "driverUserId", "apptDate"?, "apptTime"? } — driverUserId comes from drivers[].driverUserId (skip drivers whose driverUserId is null and mention they have no linked login).
- assign_equipment: { "orderId", "truckId"?, "chassisId"?, "trailerId"? } — ids from trucks[].truckId / chassis[].chassisId.
- set_charges: { "orderId", "perDiemFreeDays"?, "perDiemLastFreeDay"?, "perDiemDailyRate"?, "demurrageFreeDays"?, "demurrageLastFreeDay"?, "demurrageDailyRate"?, "storageFreeDays"?, "storageLastFreeDay"?, "storageDailyRate"? } (dates YYYY-MM-DD).
- link_street_turn: { "providerOrderId", "receiverOrderId" } — from streetTurnSuggestions.
- run_watchdog: {} — a full system scan that files alerts.
- request_customization: { "title", "details"?, "payload"? } — file a workspace-customization request for the user's company (a human admin reviews and applies it). Use when the user asks to change/hide/add parts of their own pages. payload may contain { "hiddenModules": ["reports","settlement",...], "customFields": [{"key","label","type","required"}] }. Hideable module keys: reports, settlement, fuel-surcharge, shipping-lines, equipment-report, dead-runs, terminals.

The user approves each action with one tap; NOTHING executes without approval, so propose confidently but explain the reasoning in "reason". Propose at most 3 actions at once. If you have no action to propose, do NOT emit the block.

MEMORY:
If the user tells you something worth remembering across sessions ("always...", "remember...", preferences, standing rules), set "memory" in the actions block to a short one-line fact (you may emit the block with an empty actions array just to save a memory). Otherwise keep it null.`;
}

export function parseCopilotReply(raw: string): ParsedCopilotReply {
  const match = raw.match(/```(?:actions|json)\s*([\s\S]*?)```\s*$/);
  if (!match) return { text: raw.trim(), actions: [], memory: null };

  const text = raw.slice(0, match.index).trim();
  let actions: CopilotAction[] = [];
  let memory: string | null = null;
  try {
    const parsed = JSON.parse(match[1]) as { actions?: unknown; memory?: unknown };
    if (Array.isArray(parsed.actions)) {
      actions = parsed.actions
        .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
        .filter((a) => ACTION_TYPES.includes(a.type as CopilotActionType))
        .slice(0, 3)
        .map((a) => ({
          type: a.type as CopilotActionType,
          label: typeof a.label === "string" && a.label.trim() ? a.label.trim() : String(a.type),
          reason: typeof a.reason === "string" ? a.reason : undefined,
          params: (typeof a.params === "object" && a.params !== null ? a.params : {}) as Record<string, unknown>,
        }));
    }
    if (typeof parsed.memory === "string" && parsed.memory.trim()) {
      memory = parsed.memory.trim();
    }
  } catch {
    // Malformed block — show the visible text only.
  }
  return { text: text || raw.trim(), actions, memory };
}

export const COPILOT_SUGGESTIONS: string[] = [
  "What needs my attention right now?",
  "Who should I dispatch to the pending moves?",
  "How can I make more money this week?",
  "Any per diem or demurrage risks coming up?",
];
