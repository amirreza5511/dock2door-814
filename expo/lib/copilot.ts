/**
 * AI Copilot core: role-aware system prompt builder + structured action parsing.
 *
 * The copilot proposes executable actions inside a fenced ```actions block.
 * The client parses that block, renders one-tap approval cards and only runs
 * an action after the user explicitly approves it. Nothing executes without
 * explicit approval.
 */

export type CopilotActionType =
  | 'dispatch_move'
  | 'assign_equipment'
  | 'set_charges'
  | 'link_street_turn'
  | 'run_watchdog'
  | 'request_customization'
  | 'create_shift'
  | 'accept_applicant'
  | 'apply_shift'
  | 'dispatch_load'
  | 'create_load'
  | 'create_drayage_order'
  | 'forward_intake'
  | 'escalate_human';

export interface CopilotAction {
  type: CopilotActionType;
  /** Short human-readable label shown on the approval card. */
  label: string;
  /** One-line reasoning shown under the label. */
  reason?: string;
  params: Record<string, unknown>;
}

export interface ParsedCopilotReply {
  text: string;
  actions: CopilotAction[];
  memory: string | null;
}

const ACTION_TYPES: CopilotActionType[] = [
  'dispatch_move',
  'assign_equipment',
  'set_charges',
  'link_street_turn',
  'run_watchdog',
  'request_customization',
  'create_shift',
  'accept_applicant',
  'apply_shift',
  'dispatch_load',
  'create_load',
  'create_drayage_order',
  'forward_intake',
  'escalate_human',
];

interface CopilotContextShape {
  role?: string;
  companyType?: string;
  [key: string]: unknown;
}

/** Action documentation lines assembled per role so the model only sees powers it may use. */
function actionDocsForRole(role: string, companyType: string, ctx: CopilotContextShape): string {
  const lines: string[] = [];
  const isDrayage = companyType === 'DrayageCompany' || 'orders' in ctx;
  const isEmployer = companyType === 'Employer' || companyType === 'EmploymentAgency' || 'recentShifts' in ctx;
  const isTrucking = companyType === 'TruckingCompany' || 'companyLoads' in ctx;
  const canOrderDrayage = ['FreightForwarder', 'Customer', 'Shipper', 'CustomsBroker'].includes(role);
  const canForward = 'providerCompanies' in ctx;
  // Everyone who is NOT a driver can post a freight load for quotes.
  const canPostLoad = role !== 'Driver' && role !== 'Worker';

  if (isDrayage) {
    lines.push(
      '- dispatch_move: { "moveId", "driverUserId", "apptDate"?, "apptTime"? } — driverUserId comes from drivers[].driverUserId (skip drivers whose driverUserId is null and mention they have no linked login).',
      '- assign_equipment: { "orderId", "truckId"?, "chassisId"?, "trailerId"? } — ids from trucks[].truckId / chassis[].chassisId.',
      '- set_charges: { "orderId", "perDiemFreeDays"?, "perDiemLastFreeDay"?, "perDiemDailyRate"?, "demurrageFreeDays"?, "demurrageLastFreeDay"?, "demurrageDailyRate"?, "storageFreeDays"?, "storageLastFreeDay"?, "storageDailyRate"? } (dates YYYY-MM-DD).',
      '- link_street_turn: { "providerOrderId", "receiverOrderId" } — from streetTurnSuggestions.',
    );
  }
  if (isEmployer) {
    lines.push(
      '- create_shift: { "title", "category", "date" (YYYY-MM-DD), "startTime" (HH:MM), "endTime" (HH:MM), "workersNeeded", "hourlyRate", "locationCity"?, "requirements"?, "notes"? } — posts a shift so workers can apply. category must be one of: General, Driver, Forklift, HighReach. When the user prefers previous workers (see pastWorkers), name them in "requirements" so they know it is for them.',
      '- accept_applicant: { "applicationId", "rate"? } — accept a pending application from pendingApplications (books that worker).',
    );
  }
  if (role === 'Worker') {
    lines.push(
      '- apply_shift: { "shiftId" } — apply to an open shift from openShifts.',
    );
  }
  if (isTrucking || isDrayage) {
    lines.push(
      '- dispatch_load: { "loadId", "driverUserId" } — assign a freight load from companyLoads to a driver from drivers[].driverUserId.',
    );
  }
  if (canPostLoad) {
    lines.push(
      '- create_load: { "title", "originCity", "originCountry"?, "destCity", "destCountry"?, "freightMode"? ("truck"|"lcl"|"fcl"), "weight"? (number), "weightUnit"? ("kg"|"lb"), "pieces"? (pallet/piece count), "commodity"?, "readyDate"? (YYYY-MM-DD), "finalMile"? (boolean — deliver to the door), "notes"? } — posts a NEW LTL/FTL/LCL truck load to the marketplace so carriers and companies send competing price quotes. Default originCountry/destCountry to "Canada" if the user only gives a city and it is clearly domestic. Use freightMode "truck" for LTL/FTL road freight (default), "lcl" for a shared container, "fcl" for a full container. Collect at least origin city, destination city and what is being shipped before proposing.',
    );
  }
  if (canOrderDrayage) {
    lines.push(
      '- create_drayage_order: { "direction" ("Import"|"Export"), "containerNumber", "containerSize"? ("20ft"|"40ft"|"45ft"), "commodity"?, "weightKg"?, "pickupAddress"?, "pickupCity"?, "deliveryAddress"?, "deliveryCity"?, "notes"?, "targetDrayageCompanyId"? } — creates a container move request. targetDrayageCompanyId may come from providerCompanies (type DrayageCompany). Collect at least direction + container number + delivery city before proposing.',
    );
  }
  if (canForward) {
    lines.push(
      '- forward_intake: { "targetCompanyId", "subject", "body" } — opens a chat with a provider company (from providerCompanies) and delivers your prepared summary. Use for insurance intake (send to a CargoInsurer), customs questions (CustomsBroker), warehousing/labour/trucking requests. "body" must be a complete, well-structured summary of everything the user told you.',
    );
  }
  // Everyone gets these.
  lines.push(
    '- run_watchdog: {} — a full system scan that files alerts (company operators only).',
    '- request_customization: { "title", "details"?, "payload"? } — file a workspace-customization request for the user\'s company (a human admin reviews and applies it).',
    '- escalate_human: { "subject", "summary" } — files a support ticket AND opens a chat with the human support team. Use when you cannot solve the problem, when something looks broken, or whenever the user asks for a person. "summary" must recap the conversation so the human has full context.',
  );
  return lines.join('\n');
}

/** Role-specific coaching so the copilot behaves like a domain expert. */
function rolePlaybook(role: string, companyType: string): string {
  if (companyType === 'Employer' || companyType === 'EmploymentAgency') {
    return `PLAYBOOK — STAFFING:
- When the user asks for workers ("I need 2 workers Monday 7am-3pm"), draft ONE create_shift proposal with all details filled in. Check pastWorkers for people they used before and mention them by name in requirements when the user wants "the same ones as before".
- If pendingApplications contains applicants for their shifts, surface them and propose accept_applicant.
- Quote the estimated cost: workersNeeded × hours × hourlyRate.`;
  }
  if (companyType === 'DrayageCompany' || companyType === 'TruckingCompany') {
    return `PLAYBOOK — DISPATCH:
- When asked "who should I send", rank drivers using the snapshot (who has no active move/load, appointment times) and explain the ranking, then propose dispatch_move or dispatch_load.
- Watch per diem/demurrage/storage deadlines and dead runs; point at concrete refs with dollar estimates.`;
  }
  if (role === 'FreightForwarder' || role === 'Shipper' || role === 'CustomsBroker') {
    return `PLAYBOOK — FREIGHT COORDINATION:
- To ship a truck load / get price quotes ("I want to send a load from Vancouver to Calgary"), gather origin city, destination city and what is being shipped (plus rough weight/pallets if handy), then propose create_load. This posts it to the marketplace so carriers send competing prices.
- For container work ("coordinate delivery of MSCU1234567"), collect direction, container number/size, and pickup/delivery details step by step, then propose create_drayage_order. Suggest a drayage company from providerCompanies when relevant (set targetDrayageCompanyId).
- For anything a provider must answer (rates, insurance, customs), prepare a summary and propose forward_intake to the right company.`;
  }
  if (role === 'Guest' || role === 'Customer' || role === 'MarketplaceBuyer') {
    return `PLAYBOOK — INTAKE:
- To ship something ("I want to send a package/load from A to B"), first size it up: a small courier parcel is different from palletized freight. For a truck load (pallets / heavy freight), gather origin city, destination city and what is being shipped, then propose create_load so carriers send competing price quotes.
- When the user wants a service (cargo insurance, customs clearance, warehousing, trucking, workers), run a short intake: ask the needed follow-up questions ONE AT A TIME (for insurance: what cargo, its value, route from/to, dates, container or LTL). Keep it conversational.
- Once you have enough, write a clean summary, pick the best-matching company from providerCompanies, and propose forward_intake so they receive the package. Tell the user who you picked and why.`;
  }
  if (role === 'Worker') {
    return `PLAYBOOK — WORKER:
- Help them find shifts that fit (openShifts), propose apply_shift, and answer questions about their schedule (myAssignments), clock-in/out, and pay.`;
  }
  if (role === 'Driver') {
    return `PLAYBOOK — DRIVER:
- Answer about their assigned moves/loads (myMoves, myLoads), appointments and what to do next. Escalate to a human for anything you cannot resolve.`;
  }
  return `PLAYBOOK:
- Help the user run their day on the platform. Ground answers in the snapshot; propose the matching action when they want something done.
- If they want to ship a truck load or get freight prices ("send a load from A to B"), gather origin city, destination city and what is being shipped, then propose create_load so carriers send competing quotes.`;
}

/**
 * Build the copilot system prompt with the live context snapshot, the
 * user's saved memories and the role-scoped action catalog embedded.
 */
export function buildCopilotSystemPrompt(context: unknown, memories: string[]): string {
  const ctx = (context ?? {}) as CopilotContextShape;
  const role = typeof ctx.role === 'string' ? ctx.role : 'guest';
  const companyType = typeof ctx.companyType === 'string' ? ctx.companyType : '';
  const memoryBlock = memories.length > 0
    ? `\nSaved memories (facts the user asked you to remember — always honor them):\n${memories.map((m) => `- ${m}`).join('\n')}\n`
    : '';
  return `You are the Dock2Door Copilot — a personal AI operator for a logistics platform covering drayage (container trucking), freight, trucking, warehousing, customs, cargo insurance and labour staffing. Every user has their own copilot; this user's role is "${role}"${companyType ? ` at a ${companyType} company` : ''}.

LIVE DATA SNAPSHOT (real, current — use it, never invent data):
${JSON.stringify(ctx, null, 1)}
${memoryBlock}
RULES:
- Mirror the user's language EXACTLY: Persian in → Persian out, English in → English out, any other language likewise.
- Be concise and practical. Short paragraphs or bullet lists, no essays.
- Ground every claim in the snapshot. If data is missing, say so plainly — never fabricate ids, names or numbers.
- You can DO things, not just talk: when the user wants something done and you have the required data, propose the action. The user approves each action with one tap; NOTHING executes without approval, so propose confidently and explain the reasoning in "reason".
- If you genuinely cannot help, or the user asks for a human/person/support, propose escalate_human with a full summary — never leave them stuck.

${rolePlaybook(role, companyType)}

PROPOSING ACTIONS:
When an action is warranted, append EXACTLY ONE fenced block at the very END of your reply:

\`\`\`actions
{"actions":[{"type":"create_shift","label":"Book 2 forklift workers — Mon 07:00-15:00","reason":"You asked for the same crew as last week","params":{"title":"Forklift operators","category":"Forklift","date":"2026-07-27","startTime":"07:00","endTime":"15:00","workersNeeded":2,"hourlyRate":28}}],"memory":null}
\`\`\`

Action types available to THIS user and their required params (use EXACT ids from the snapshot, never fabricate):
${actionDocsForRole(role, companyType, ctx)}

Propose at most 3 actions at once. If you have no action to propose, do NOT emit the block. Never propose an action type that is not in the list above.

MEMORY:
If the user tells you something worth remembering across sessions ("always...", "remember...", preferences, standing rules), set "memory" in the actions block to a short one-line fact (you may emit the block with an empty actions array just to save a memory). Otherwise keep it null.`;
}

/**
 * Extract the trailing ```actions block from a raw model reply.
 * Returns clean display text, validated actions and an optional memory.
 */
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
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .filter((a) => ACTION_TYPES.includes(a.type as CopilotActionType))
        .slice(0, 3)
        .map((a) => ({
          type: a.type as CopilotActionType,
          label: typeof a.label === 'string' && a.label.trim() ? a.label.trim() : String(a.type),
          reason: typeof a.reason === 'string' ? a.reason : undefined,
          params: (typeof a.params === 'object' && a.params !== null ? a.params : {}) as Record<string, unknown>,
        }));
    }
    if (typeof parsed.memory === 'string' && parsed.memory.trim()) {
      memory = parsed.memory.trim();
    }
  } catch {
    // Malformed block — show the visible text only, drop the block silently.
  }
  return { text: text || raw.trim(), actions, memory };
}

/** Suggested starter prompts, tailored to the user's role. */
export function copilotSuggestions(role: string, companyType: string): string[] {
  if (companyType === 'Employer' || companyType === 'EmploymentAgency') {
    return [
      'I need 2 workers Monday 7am to 3pm — prefer the ones from last time',
      'Any pending applications I should review?',
      'What does my week look like?',
      'Connect me with a human',
    ];
  }
  if (companyType === 'DrayageCompany' || companyType === 'TruckingCompany') {
    return [
      'What needs my attention right now?',
      'Who should I dispatch to the pending moves?',
      'Any per diem or demurrage risks coming up?',
      'How can I make more money this week?',
    ];
  }
  if (role === 'FreightForwarder' || role === 'Shipper' || role === 'CustomsBroker') {
    return [
      'I have a container arriving — help me coordinate delivery',
      'Which drayage companies can I work with?',
      'Draft a request to a trucking partner',
      'Connect me with a human',
    ];
  }
  if (role === 'Worker') {
    return [
      'Find me shifts this week',
      'What is my schedule?',
      'How do I clock in?',
      'Connect me with a human',
    ];
  }
  if (role === 'Guest' || role === 'Customer' || role === 'MarketplaceBuyer') {
    return [
      'I need cargo insurance for a shipment',
      'Help me find a customs broker',
      'I want to book warehouse space',
      'Connect me with a human',
    ];
  }
  return [
    'What can you do for me?',
    'What needs my attention right now?',
    'Connect me with a human',
  ];
}

/** Legacy export kept for compatibility. */
export const COPILOT_SUGGESTIONS: string[] = copilotSuggestions('', '');
