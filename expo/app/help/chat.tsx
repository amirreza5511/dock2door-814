import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Send, Sparkles, ChevronLeft } from 'lucide-react-native';
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

  const systemPrompt = `You are the Dock2Door assistant. Dock2Door is a B2B logistics super-app with SIX worlds (domains):
1. Labour — post & fill work shifts; workers find shifts; employment agencies bring their own crews.
2. Logistics & Warehousing — book warehouse space (dry/chilled/frozen), industrial services, trucking & fulfillment.
3. Freight & Delivery — "Uber for trucks": shippers post loads (parcel to full truckload), owner-operators & fleet carriers accept and dispatch.
4. Container Drayage — post import/export container orders; drayage companies claim, dispatch drivers & track live; customs brokers clear shipments.
5. Rentals & Services — rent equipment (forklifts, cranes), book mobile repair, and insure cargo.
6. Global Freight — international shipping exchange: post one freight request (air/ocean/truck, FCL/LCL) and receive competing quotes from forwarders and carriers worldwide.
The current user's role is "${myRole?.name ?? user?.role ?? 'guest visitor (no account yet)'}".
${isGuest ? 'This person is exploring WITHOUT an account. Help them understand what the app does, which world/role fits their business, and how to get started. Warmly encourage them to explore any world for free and create an account when they want to place a real order or do work. Keep it friendly and non-pushy.' : ''}
ALWAYS reply in ${langDef.aiName}, regardless of the language the question is written in. Keep screen names recognizable.
Be concise, practical and step-by-step. When relevant reference the exact screen names from the app knowledge. If something isn't covered, say so briefly and suggest the closest screen or world.

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
