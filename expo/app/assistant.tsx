import React, { useCallback, useRef, useState } from 'react';
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'How do I clock in to my shift?',
  'Explain how hours get confirmed and paid.',
  'Write a short shift description for a forklift operator.',
  'What documents do I need to start working?',
];

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  const systemPrompt = `You are Dock2Door's helpful in-app assistant for a logistics and labour-staffing platform. The current user role is "${user?.role ?? 'guest'}". Answer concisely and practically about shifts, clocking in/out, warehousing, bookings, and general logistics. If asked something unrelated, answer briefly and helpfully.`;

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

  const empty = messages.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.aiBadge}>
            <Sparkles size={14} color={C.accent} />
          </View>
          <View>
            <Text style={styles.headerTitle}>AI Assistant</Text>
            <Text style={styles.headerSub}>Ask anything about your work</Text>
          </View>
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
              <Text style={styles.emptyTitle}>How can I help?</Text>
              <Text style={styles.emptySub}>
                I can explain how the app works, draft shift posts, and answer logistics questions.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => void send(s)}>
                    <Text style={styles.suggestionText}>{s}</Text>
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
                  <Text style={[styles.bubbleText, m.role === 'user' && { color: C.white }]}>{m.content}</Text>
                </View>
              </View>
            ))
          )}
          {sending && (
            <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
              <View style={[styles.bubble, styles.bubbleAi, styles.typing]}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={styles.typingText}>Thinking…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Composer */}
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message the assistant…"
            placeholderTextColor={C.textMuted}
            style={styles.input}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: C.bgSecondary,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: C.text,
    fontSize: 14,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: C.border },
});
