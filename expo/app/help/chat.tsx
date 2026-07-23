import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Send, Sparkles, ChevronLeft, Lock } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import C from '@/constants/colors';
import { askAssistant, type AiMessage } from '@/lib/ai';
import { HELP_ROLES, ROLE_TO_HELP_KEY } from '@/constants/help';
import { useHelpLanguage } from '@/store/help-language';
import { getLang, tUI, CHAT_SUGGESTIONS } from '@/constants/i18n';
import LanguagePicker from '@/components/help/LanguagePicker';

/** A tappable action card the assistant can attach to a reply. */
interface ChatAction {
  /** 'open' navigates to an in-app world/screen; 'signup' routes to sign-up. */
  type: 'open' | 'signup';
  label: string;
  route?: string;
}

/** A single field inside an intake form card the assistant builds. */
interface ChatFormField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number';
}

/** An intake form the assistant renders so the user just fills in the blanks. */
interface ChatForm {
  title?: string;
  submitLabel?: string;
  fields: ChatFormField[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
  form?: ChatForm;
  /** Once a form is submitted it becomes read-only. */
  formDone?: boolean;
}

/** In-app destinations the guest assistant is allowed to deep-link into. */
const ALLOWED_ROUTES: Record<string, true> = {
  '/ground-freight': true,
  '/global-freight': true,
  '/international': true,
  '/ship': true,
  '/directory': true,
};

/**
 * Split a raw model reply into visible text + a trailing fenced ```actions block.
 * The block is JSON that may contain `actions` (tap-to-open cards) and/or `form`
 * (an intake form the user fills in). Unknown routes are dropped so the assistant
 * can never link somewhere invalid.
 */
function parseReply(raw: string): { text: string; actions: ChatAction[]; form?: ChatForm } {
  const match = raw.match(/```(?:actions|json)\s*([\s\S]*?)```\s*$/);
  if (!match) return { text: raw.trim(), actions: [] };
  const text = raw.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1]) as { actions?: unknown; form?: unknown };
    const list = Array.isArray(parsed.actions) ? parsed.actions : [];
    const actions: ChatAction[] = list
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      .map((a) => {
        const type = a.type === 'signup' ? 'signup' : 'open';
        const label = typeof a.label === 'string' ? a.label.trim() : '';
        const route = typeof a.route === 'string' ? a.route : undefined;
        return { type, label, route } as ChatAction;
      })
      .filter((a) => a.label.length > 0 && (a.type === 'signup' || (a.route != null && ALLOWED_ROUTES[a.route])))
      .slice(0, 3);
    const form = parseForm(parsed.form);
    return { text: text || raw.trim(), actions, form };
  } catch {
    return { text: raw.trim(), actions: [] };
  }
}

/** Validates and normalizes a raw `form` object from the model. */
function parseForm(raw: unknown): ChatForm | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const rawFields = Array.isArray(obj.fields) ? obj.fields : [];
  const fields: ChatFormField[] = rawFields
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      key: typeof f.key === 'string' ? f.key : '',
      label: typeof f.label === 'string' ? f.label.trim() : '',
      placeholder: typeof f.placeholder === 'string' ? f.placeholder : undefined,
      type: f.type === 'number' ? ('number' as const) : ('text' as const),
    }))
    .filter((f) => f.key.length > 0 && f.label.length > 0)
    .slice(0, 8);
  if (fields.length === 0) return undefined;
  return {
    title: typeof obj.title === 'string' ? obj.title.trim() : undefined,
    submitLabel: typeof obj.submitLabel === 'string' ? obj.submitLabel.trim() : undefined,
    fields,
  };
}

/** Free assistant messages a guest gets before we ask them to sign in. */
const GUEST_FREE_MESSAGES = 5;

/** Localized copy for the sign-in / credits gate shown to guests. */
function gateCopy(lang: string): { title: string; body: string; cta: string } {
  switch (lang) {
    case 'fa':
      return {
        title: 'به سقف گفتگوی رایگان رسیدی',
        body: 'برای ادامهٔ گفتگو با دستیار هوشمند لجستیک، وارد حساب کاربری شو و کردیت بگیر.',
        cta: 'ورود / ثبت‌نام و دریافت کردیت',
      };
    case 'fr':
      return { title: 'Limite gratuite atteinte', body: 'Connectez-vous et obtenez des crédits pour continuer à discuter avec l’assistant logistique.', cta: 'Se connecter et obtenir des crédits' };
    case 'es':
      return { title: 'Límite gratuito alcanzado', body: 'Inicia sesión y obtén créditos para seguir hablando con el asistente de logística.', cta: 'Iniciar sesión y obtener créditos' };
    case 'hi':
      return { title: 'मुफ़्त सीमा पूरी हुई', body: 'लॉजिस्टिक्स असिस्टेंट से बात जारी रखने के लिए लॉग इन करें और क्रेडिट लें।', cta: 'लॉग इन करें और क्रेडिट लें' };
    case 'zh':
      return { title: '已达免费上限', body: '登录并获取额度，即可继续与物流助手对话。', cta: '登录并获取额度' };
    case 'pa':
      return { title: 'ਮੁਫ਼ਤ ਹੱਦ ਪੂਰੀ ਹੋਈ', body: 'ਲੌਜਿਸਟਿਕਸ ਸਹਾਇਕ ਨਾਲ ਗੱਲ ਜਾਰੀ ਰੱਖਣ ਲਈ ਲੌਗ ਇਨ ਕਰੋ ਤੇ ਕ੍ਰੈਡਿਟ ਲਓ।', cta: 'ਲੌਗ ਇਨ ਕਰੋ ਤੇ ਕ੍ਰੈਡਿਟ ਲਓ' };
    default:
      return { title: 'You’ve reached the free limit', body: 'Sign in and get credits to keep chatting with the logistics assistant.', cta: 'Sign in & get credits' };
  }
}

/** Builds a compact knowledge summary of the manual so the AI answers accurately. */
function buildKnowledge(): string {
  return HELP_ROLES.map((r) => {
    const screens = r.screens.map((s) => `${s.title} (${s.summary})`).join('; ');
    return `ROLE ${r.name}: ${r.overview} Screens: ${screens}`;
  }).join('\n');
}

export default function HelpChat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const scrollRef = useRef<ScrollView>(null);

  const lang = useHelpLanguage((s) => s.lang);
  const hydrate = useHelpLanguage((s) => s.hydrate);
  useEffect(() => { void hydrate(); }, [hydrate]);
  const langDef = getLang(lang);
  const dirText = langDef.rtl ? ('right' as const) : ('left' as const);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  const myRole = user ? HELP_ROLES.find((x) => x.key === ROLE_TO_HELP_KEY[user.role]) : undefined;

  const isGuest = !user;

  const systemPrompt = `You are the Dock2Door AI — a senior logistics, supply-chain and freight-transport expert AND the product guide for the Dock2Door platform (identical mobile app + web app; everything below works on both).

YOUR EXPERTISE (answer like a seasoned professional, not a generic chatbot):
- End-to-end supply chain: procurement, inbound/outbound, warehousing, inventory, fulfillment, last-mile and reverse logistics.
- Freight modes & pricing: LTL, FTL, LCL, FCL, drayage/container trucking, ocean, air; how chargeable/volumetric weight, accessorials, fuel surcharges, per diem, demurrage and detention work.
- Incoterms 2020 (EXW, FOB, CIF, DAP, DDP, etc.), customs clearance, HS codes, duties/taxes and required documents (BOL, commercial invoice, packing list, AWB, B/L).
- Transport regulations & compliance: carrier authority/operating licenses, insurance & liability, weight/axle limits, hours-of-service/driver rules, dangerous-goods/hazmat basics, and cross-border (Canada/US/international) requirements. Give practical guidance and ALWAYS remind the user to confirm current local rules with the relevant authority — never invent specific legal citations.

Dock2Door is a B2B logistics super-app with these worlds (domains):
1. Labour — post & fill work shifts; workers find shifts; employment agencies bring their own crews.
2. Logistics & Warehousing — book warehouse space (dry/chilled/frozen), industrial services, trucking & fulfillment.
3. Freight & Delivery — "Uber for trucks": shippers post loads (parcel to full truckload), owner-operators & fleet carriers accept and dispatch.
4. Container Drayage — post import/export container orders; drayage companies claim, dispatch drivers & track live; customs brokers clear shipments.
5. Rentals & Services — rent equipment (forklifts, cranes), book mobile repair, and insure cargo.
6. Global Freight — international shipping exchange: post one freight request (air/ocean/truck, FCL/LCL) and receive competing quotes from forwarders and carriers worldwide.
7. LTL & FTL Quotes — post a truck load (LTL part-load, FTL full-truck, or LCL shared container) locally, across Canada, or internationally with optional final-mile to the door, get an instant ballpark estimate, and receive competing quotes from carriers and companies.
The current user's role is "${myRole?.name ?? user?.role ?? 'guest visitor (no account yet)'}".
${isGuest ? 'This person is exploring WITHOUT an account. Answer their logistics question expertly first, then briefly connect it to the right world/screen and warmly invite them to create an account to post a real order or get live quotes. Keep it helpful, not pushy.' : ''}
LANGUAGE: Reply in the SAME language the user writes in (if they write Persian/Farsi, answer in fluent Persian). If their language is unclear, use ${langDef.aiName}. Keep app screen/world names recognizable.
Be concise, practical and step-by-step. Reference the exact screen/world names when relevant. If something isn't covered by the platform, say so briefly and suggest the closest world. Keep replies complete but tight — never leave a sentence unfinished.

MANY USERS KNOW NOTHING ABOUT LOGISTICS. Don't dump jargon or ask them to fill a long form themselves. Instead, gently gather what you need with a simple INTAKE FORM CARD, then do the thinking for them.

CHOOSING THE RIGHT MODE (critical — do NOT default everything to LTL):
- A small parcel / box / envelope / a few cartons / anything a courier could carry (roughly under ~70 kg and not on a pallet) is a PARCEL. Send it to "/ship" — NEVER call this LTL. If a user says "a package" / "یک بسته" / "a box", treat it as parcel unless they clearly describe pallets or heavy freight.
- LTL (Less-than-Truckload) is ONLY for palletized / freight-sized shipments that don't fill a truck (roughly 1–6 pallets or ~100–5,000 kg) → "/ground-freight".
- FTL (Full Truckload) is a full/near-full truck or very heavy load → "/ground-freight".
- LCL / FCL is ocean containers (shared vs. full) for overseas cargo → "/global-freight" (or "/ground-freight" LCL for a shared container inland).
- Air / ocean international freight → "/global-freight".
When the size is unclear, ASK (how many pieces, on pallets or loose, rough weight) before naming a mode. Only recommend LTL/FTL once you're confident it's palletized freight, not a courier parcel.

END-OF-REPLY BLOCK:
When it helps, append EXACTLY ONE fenced block at the very END of your reply. It is JSON that may contain a "form" (fields the user fills in) and/or "actions" (tap-to-open cards). Nothing after it.

1) INTAKE FORM — use this to collect a shipment's/job's details ONE friendly step at a time. Ask only for what you still need, in plain words with examples:
\`\`\`actions
{"form":{"title":"Tell me about your load","submitLabel":"Get my estimate","fields":[{"key":"from","label":"Where does it ship FROM? (city)","placeholder":"e.g. Toronto"},{"key":"to","label":"Where should it go? (city)","placeholder":"e.g. Vancouver"},{"key":"what","label":"What are you shipping?","placeholder":"e.g. 5 pallets of furniture"},{"key":"weight","label":"Rough total weight?","placeholder":"e.g. 800 kg","type":"number"},{"key":"when","label":"When is it ready?","placeholder":"e.g. next Monday"}]}}
\`\`\`
Keep forms short (max ~6 fields). After the user submits, their answers arrive as their next message; then explain in simple terms what it means (which mode — LTL/FTL/LCL), give a rough ballpark estimate and range, and guide the next step. Never show a form and an 'open' card at the same time.

2) OPEN / SIGN-UP CARDS — once details are gathered, send them to the right place:
\`\`\`actions
{"actions":[{"type":"open","label":"Get LTL & FTL truck quotes","route":"/ground-freight"}]}
\`\`\`
Allowed routes ONLY: "/ground-freight" (LTL/FTL/LCL truck quotes), "/global-freight" (international air/ocean freight quotes), "/international" (import/export tools), "/ship" (parcel & load shipping), "/directory" (browse companies). Use type "signup" (no route) when the next step needs an account (posting a real load, sending a request, seeing live quotes). Max 2 action cards. Omit the block entirely when nothing fits. The visible text before the block must read naturally on its own.

APP KNOWLEDGE:
${buildKnowledge()}`;

  // Guests get a handful of free replies before we invite them to sign in.
  const [guestReplies, setGuestReplies] = useState<number>(0);
  const gated = isGuest && guestReplies >= GUEST_FREE_MESSAGES;
  const gate = gateCopy(lang);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (isGuest && guestReplies >= GUEST_FREE_MESSAGES) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setSending(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const payload: AiMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m): AiMessage => ({ role: m.role, content: m.content })),
      ];
      const reply = await askAssistant(payload);
      const { text: replyText, actions, form } = parseReply(reply);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: replyText, actions, form }]);
      if (isGuest) setGuestReplies((n) => n + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: msg }]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, sending, systemPrompt, isGuest, guestReplies]);

  const runAction = useCallback((action: ChatAction) => {
    if (action.type === 'signup') { router.push('/auth/signup' as never); return; }
    if (action.route && ALLOWED_ROUTES[action.route]) router.push(action.route as never);
  }, [router]);

  // Per-message form answers, keyed by message id then field key.
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const setField = useCallback((msgId: string, key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [msgId]: { ...(prev[msgId] ?? {}), [key]: value } }));
  }, []);

  const submitForm = useCallback((msg: ChatMessage) => {
    if (!msg.form || msg.formDone || sending) return;
    const answers = formData[msg.id] ?? {};
    const filled = msg.form.fields.filter((f) => (answers[f.key] ?? '').trim().length > 0);
    if (filled.length === 0) return;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, formDone: true } : m)));
    const summary = filled.map((f) => `- ${f.label}: ${(answers[f.key] ?? '').trim()}`).join('\n');
    void send(`Here are my details:\n${summary}`);
  }, [formData, sending, send]);

  const suggestions = CHAT_SUGGESTIONS[lang] ?? CHAT_SUGGESTIONS.en;

  const empty = messages.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.aiBadge}>
            <Sparkles size={14} color={C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{tUI(lang, 'helpAssistant')}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{tUI(lang, 'answersFromManual')}</Text>
          </View>
          <LanguagePicker />
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {empty ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Sparkles size={28} color={C.accent} />
              </View>
              <Text style={styles.emptyTitle}>{tUI(lang, 'howCanIHelp')}</Text>
              <Text style={styles.emptySub}>
                {tUI(lang, 'askAnythingSub')}
              </Text>
              <View style={styles.suggestions}>
                {suggestions.map((s) => (
                  <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => void send(s)}>
                    <Text style={[styles.suggestionText, { textAlign: dirText }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m) => (
              <View key={m.id} style={styles.msgGroup}>
                <View
                  style={[styles.bubbleRow, m.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAi]}
                >
                  <View style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                    <Text style={[styles.bubbleText, { textAlign: dirText }, m.role === 'user' && { color: C.white }]}>{m.content}</Text>
                  </View>
                </View>
                {m.role === 'assistant' && m.form && (
                  <View style={styles.formCard}>
                    {m.form.title ? <Text style={[styles.formTitle, { textAlign: dirText }]}>{m.form.title}</Text> : null}
                    {m.form.fields.map((f) => (
                      <View key={`${m.id}-f-${f.key}`} style={styles.formField}>
                        <Text style={[styles.formLabel, { textAlign: dirText }]}>{f.label}</Text>
                        <TextInput
                          value={(formData[m.id] ?? {})[f.key] ?? ''}
                          onChangeText={(v) => setField(m.id, f.key, v)}
                          placeholder={f.placeholder}
                          placeholderTextColor={C.textMuted}
                          editable={!m.formDone}
                          keyboardType={f.type === 'number' ? 'numeric' : 'default'}
                          style={[styles.formInput, { textAlign: dirText }, m.formDone && styles.formInputDone]}
                        />
                      </View>
                    ))}
                    {!m.formDone && (
                      <TouchableOpacity style={styles.formSubmit} activeOpacity={0.85} onPress={() => submitForm(m)}>
                        <Sparkles size={15} color={C.white} />
                        <Text style={styles.formSubmitText}>{m.form.submitLabel ?? tUI(lang, 'askAi')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {m.role === 'assistant' && m.actions && m.actions.length > 0 && (
                  <View style={styles.actionCards}>
                    {m.actions.map((a, i) => (
                      <TouchableOpacity
                        key={`${m.id}-a-${i}`}
                        style={styles.actionCard}
                        activeOpacity={0.85}
                        onPress={() => runAction(a)}
                      >
                        <View style={styles.actionIcon}>
                          {a.type === 'signup'
                            ? <Lock size={15} color={C.accent} />
                            : <Sparkles size={15} color={C.accent} />}
                        </View>
                        <Text style={[styles.actionLabel, { textAlign: dirText }]} numberOfLines={2}>{a.label}</Text>
                        <Send size={15} color={C.textSecondary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
          {gated && (
            <View style={styles.gateCard}>
              <View style={styles.gateIcon}><Lock size={22} color={C.accent} /></View>
              <Text style={styles.gateTitle}>{gate.title}</Text>
              <Text style={[styles.gateBody, { textAlign: dirText }]}>{gate.body}</Text>
              <TouchableOpacity style={styles.gateBtn} activeOpacity={0.85} onPress={() => router.push('/auth/signup' as never)}>
                <Text style={styles.gateBtnText}>{gate.cta}</Text>
              </TouchableOpacity>
            </View>
          )}
          {sending && (
            <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
              <View style={[styles.bubble, styles.bubbleAi, styles.typing]}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={styles.typingText}>{tUI(lang, 'thinking')}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={tUI(lang, 'askPlaceholder')}
            placeholderTextColor={C.textMuted}
            style={[styles.input, { textAlign: dirText }]}
            multiline
            onSubmitEditing={() => void send(input)}
            editable={!sending && !gated}
          />
          <TouchableOpacity
            onPress={() => void send(input)}
            disabled={sending || gated || input.trim().length === 0}
            style={[styles.sendBtn, (sending || gated || input.trim().length === 0) && styles.sendBtnDisabled]}
          >
            <Send size={18} color={C.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  aiBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },

  scroll: { padding: 16, gap: 12, flexGrow: 1 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19, paddingHorizontal: 20, marginBottom: 14 },
  suggestions: { gap: 8, width: '100%' },
  suggestionChip: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  suggestionText: { fontSize: 13, color: C.text, fontWeight: '500' as const },

  msgGroup: { gap: 8 },
  actionCards: { gap: 8, alignSelf: 'stretch' },
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.accentDim, borderRadius: 14, borderWidth: 1, borderColor: C.accent + '55',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  actionIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.accent + '22', alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flex: 1, fontSize: 13.5, fontWeight: '700' as const, color: C.text },

  formCard: {
    alignSelf: 'stretch', gap: 12, backgroundColor: C.card, borderRadius: 16,
    borderWidth: 1, borderColor: C.accent + '44', padding: 16,
  },
  formTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  formField: { gap: 6 },
  formLabel: { fontSize: 12.5, fontWeight: '600' as const, color: C.textSecondary },
  formInput: {
    backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14,
  },
  formInputDone: { opacity: 0.6 },
  formSubmit: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 12, paddingVertical: 12, marginTop: 2,
  },
  formSubmitText: { fontSize: 14, fontWeight: '800' as const, color: C.white },
  gateCard: {
    alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 18,
    borderWidth: 1, borderColor: C.accent + '55', padding: 20, marginTop: 4,
  },
  gateIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  gateTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  gateBody: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  gateBtn: { marginTop: 8, backgroundColor: C.accent, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, alignSelf: 'stretch', alignItems: 'center' },
  gateBtnText: { fontSize: 14, fontWeight: '800' as const, color: C.white },

  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAi: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: C.accent, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, color: C.text, lineHeight: 20 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText: { fontSize: 13, color: C.textSecondary },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: C.bgSecondary, borderTopWidth: 1, borderTopColor: C.border,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: C.text, fontSize: 14,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: C.border },
});
