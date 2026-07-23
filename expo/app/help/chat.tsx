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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
Be concise, practical and step-by-step. Reference the exact screen/world names when relevant. If something isn't covered by the platform, say so briefly and suggest the closest world.

APP KNOWLEDGE:
${buildKnowledge()}`;

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

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
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: msg }]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, sending, systemPrompt]);

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
              <View
                key={m.id}
                style={[styles.bubbleRow, m.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAi]}
              >
                <View style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                  <Text style={[styles.bubbleText, { textAlign: dirText }, m.role === 'user' && { color: C.white }]}>{m.content}</Text>
                </View>
              </View>
            ))
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
            editable={!sending}
          />
          <TouchableOpacity
            onPress={() => void send(input)}
            disabled={sending || input.trim().length === 0}
            style={[styles.sendBtn, (sending || input.trim().length === 0) && styles.sendBtnDisabled]}
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
