import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Linking, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Paperclip, Send, X, Phone, Sparkles, Headphones } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import AttachmentList, { type AttachmentItem } from '@/components/ui/AttachmentList';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { askAssistant, type AiMessage } from '@/lib/ai';

interface MessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  attachments: unknown;
  created_at: string;
  author_kind?: string | null;
}

function parseAttachments(raw: unknown): AttachmentItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a): AttachmentItem | null => {
      if (typeof a !== 'object' || a === null) return null;
      const v = a as Record<string, unknown>;
      if (typeof v.id !== 'string') return null;
      return {
        id: v.id,
        label: typeof v.name === 'string' ? v.name : 'Attachment',
        url: typeof v.url === 'string' ? v.url : null,
      };
    })
    .filter((v): v is AttachmentItem => v !== null);
}

export default function MessageThread() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();
  const scrollRef = useRef<ScrollView | null>(null);

  const threadQuery = trpc.messaging.getThread.useQuery({ threadId: threadId ?? '' }, { enabled: Boolean(threadId) });
  const messagesQuery = trpc.messaging.listMessages.useQuery({ threadId: threadId ?? '' }, { enabled: Boolean(threadId) });
  const sendMutation = trpc.messaging.sendMessage.useMutation({
    onSuccess: async () => {
      setText('');
      await utils.messaging.listMessages.invalidate({ threadId: threadId ?? '' });
      await utils.messaging.listThreads.invalidate();
    },
  });
  const markReadMutation = trpc.messaging.markThreadRead.useMutation();
  const sendSupportReply = trpc.messaging.sendSupportReply.useMutation();
  const escalateMutation = trpc.messaging.escalateSupport.useMutation();
  const [aiThinking, setAiThinking] = useState<boolean>(false);
  const [escalating, setEscalating] = useState<boolean>(false);
  // Hold latest mutation/utils in refs so realtime + mark-read effects don't
  // re-run on every render (these objects get a fresh identity each render,
  // which previously caused an infinite subscribe/mark-read loop that flooded
  // the network and surfaced as "Failed to fetch").
  const markReadRef = useRef(markReadMutation);
  markReadRef.current = markReadMutation;
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const callContactQuery = trpc.messaging.threadCallContact.useQuery(
    { threadId: threadId ?? '' },
    { enabled: Boolean(threadId) },
  );

  const handleCall = async () => {
    const phone = callContactQuery.data?.phone;
    if (!phone) {
      Alert.alert('No phone number', 'This contact has not shared a phone number you can call.');
      return;
    }
    const url = `tel:${phone.replace(/[^+0-9]/g, '')}`;
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (!ok) {
      Alert.alert('Unable to call', 'Calling is not available on this device.');
      return;
    }
    await Linking.openURL(url);
  };

  const [text, setText] = useState<string>('');
  const [pendingAttachments, setPendingAttachments] = useState<{ id: string; name: string; url: string | null }[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);

  const presignMutation = trpc.uploads.createPresignedUrl.useMutation();
  const confirmUploadMutation = trpc.uploads.confirmUpload.useMutation();

  const handlePickAttachment = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      setUploading(true);
      const target = await presignMutation.mutateAsync({
        fileName: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        sizeBytes: asset.size ?? 0,
        kind: 'Attachment',
      });
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const upload = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: target.headers,
        body: blob,
      });
      if (!upload.ok) {
        throw new Error(`Upload failed (${upload.status})`);
      }
      const confirmed = await confirmUploadMutation.mutateAsync({
        objectKey: target.objectKey,
        originalName: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        sizeBytes: asset.size ?? blob.size ?? 0,
        kind: 'Attachment',
        publicUrl: target.publicUrl ?? null,
      });
      setPendingAttachments((prev) => [...prev, { id: confirmed.id, name: asset.name, url: target.publicUrl ?? null }]);
    } catch (error) {
      Alert.alert('Unable to upload', error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removePending = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  useEffect(() => {
    if (threadId) {
      void markReadRef.current.mutateAsync({ threadId }).catch(() => undefined);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    console.log('[thread-realtime] subscribing', threadId);
    const channel = supabase
      .channel(`thread-messages-${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'thread_messages', filter: `thread_id=eq.${threadId}` },
        () => {
          void utilsRef.current.messaging.listMessages.invalidate({ threadId });
          void utilsRef.current.messaging.listThreads.invalidate();
          void markReadRef.current.mutateAsync({ threadId }).catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      console.log('[thread-realtime] unsubscribing', threadId);
      void supabase.removeChannel(channel);
    };
  }, [threadId]);

  useEffect(() => {
    if (messagesQuery.data && messagesQuery.data.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  }, [messagesQuery.data]);

  const threadData = threadQuery.data as { scope?: string; support_status?: string | null } | undefined;
  const isSupportAi = threadData?.scope === 'Support' && (threadData?.support_status ?? 'ai') === 'ai';

  // Generate an AI support reply for the user's latest message. If the AI can't
  // resolve it (or the user asks for a person), it appends [[ESCALATE]] and we
  // hand the thread to real humans.
  const runAiSupport = useCallback(async (userText: string) => {
    if (!threadId) return;
    setAiThinking(true);
    try {
      const prior = ((messagesQuery.data as MessageRow[] | undefined) ?? [])
        .filter((m) => m.author_kind !== 'system')
        .map((m): AiMessage => ({ role: m.author_kind === 'ai' ? 'assistant' : 'user', content: m.body }));
      const systemPrompt =
        `You are dock2door Support — the first-line support agent inside a logistics and labour-staffing app. ` +
        `The user's role is "${user?.role ?? 'guest'}". Be warm, concise and practical. Help with shifts, clocking in/out, ` +
        `bookings, payments, profiles, documents, warehousing and account questions. ` +
        `If you genuinely cannot resolve the issue, or the user clearly asks to talk to a human/person/agent/support staff, ` +
        `reassure them you're connecting them with the dock2door team and end your message with a final line containing exactly [[ESCALATE]].`;
      const reply = await askAssistant([{ role: 'system', content: systemPrompt }, ...prior, { role: 'user', content: userText }]);
      const shouldEscalate = /\[\[ESCALATE\]\]/i.test(reply);
      const clean = reply.replace(/\[\[ESCALATE\]\]/gi, '').trim() || 'Let me connect you with our team.';
      await sendSupportReply.mutateAsync({ threadId, body: clean, authorKind: 'ai' });
      if (shouldEscalate) {
        await escalateMutation.mutateAsync({ threadId });
        await sendSupportReply.mutateAsync({
          threadId,
          body: "You're now connected with the dock2door team. A human agent will reply here shortly.",
          authorKind: 'system',
        });
        await utilsRef.current.messaging.getThread.invalidate({ threadId });
      }
    } catch {
      await sendSupportReply
        .mutateAsync({
          threadId,
          body: "I'm having trouble answering right now. Tap \u201cTalk to a human\u201d below and our team will help you directly.",
          authorKind: 'system',
        })
        .catch(() => undefined);
    } finally {
      setAiThinking(false);
      await utilsRef.current.messaging.listMessages.invalidate({ threadId });
      await utilsRef.current.messaging.listThreads.invalidate();
    }
  }, [threadId, messagesQuery.data, user?.role, sendSupportReply, escalateMutation]);

  const handleTalkToHuman = useCallback(async () => {
    if (!threadId || escalating) return;
    setEscalating(true);
    try {
      await escalateMutation.mutateAsync({ threadId });
      await sendSupportReply.mutateAsync({
        threadId,
        body: "You asked to speak with a person \u2014 connecting you with the dock2door team. A human agent will reply here shortly.",
        authorKind: 'system',
      });
      await utilsRef.current.messaging.getThread.invalidate({ threadId });
      await utilsRef.current.messaging.listMessages.invalidate({ threadId });
    } catch (error) {
      Alert.alert('Unable to reach a human', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setEscalating(false);
    }
  }, [threadId, escalating, escalateMutation, sendSupportReply]);

  const handleSend = () => {
    const body = text.trim();
    if ((!body && pendingAttachments.length === 0) || !threadId) return;
    const aiShouldReply = isSupportAi && body.length > 0;
    sendMutation.mutate(
      {
        threadId,
        body: body || '(attachment)',
        attachments: pendingAttachments.map((a) => ({ id: a.id, name: a.name, url: a.url })),
      },
      {
        onSuccess: () => {
          setPendingAttachments([]);
          if (aiShouldReply) void runAiSupport(body);
        },
        onError: (error) => { Alert.alert('Unable to send message', error.message); },
      },
    );
  };

  if (!threadId) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={{ color: C.red }}>Missing thread id</Text>
      </View>
    );
  }

  if (threadQuery.isLoading || messagesQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading conversation" />
      </View>
    );
  }

  if (threadQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="error" title="Unable to load conversation" onRetry={() => void threadQuery.refetch()} />
      </View>
    );
  }

  const thread = threadQuery.data;
  const messages = (messagesQuery.data as MessageRow[] | undefined) ?? [];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="thread-back">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{thread?.subject ?? thread?.scope ?? 'Conversation'}</Text>
          {thread?.booking_id ? <Text style={styles.sub}>Booking #{thread.booking_id.slice(0, 8).toUpperCase()}</Text> : null}
        </View>
        {callContactQuery.data?.phone ? (
          <TouchableOpacity onPress={() => void handleCall()} style={styles.callBtn} testID="thread-call">
            <Phone size={18} color={C.white} />
          </TouchableOpacity>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 60}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.msgs} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <Text style={styles.empty}>
              {isSupportAi
                ? 'Hi! I\u2019m the dock2door support assistant. Ask me anything \u2014 if I can\u2019t help, I\u2019ll connect you with a person.'
                : 'No messages yet. Say hello.'}
            </Text>
          ) : messages.map((m) => {
            const isAi = m.author_kind === 'ai';
            const isSystem = m.author_kind === 'system';
            const mine = !isAi && !isSystem && m.sender_user_id === user?.id;
            const attachments = parseAttachments(m.attachments);
            if (isSystem) {
              return (
                <View key={m.id} style={styles.systemRow}>
                  <Text style={styles.systemText}>{m.body}</Text>
                </View>
              );
            }
            return (
              <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                {isAi ? (
                  <View style={styles.aiTag}>
                    <Sparkles size={11} color={C.accent} />
                    <Text style={styles.aiTagText}>Support AI</Text>
                  </View>
                ) : null}
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                {attachments.length > 0 ? (
                  <View style={styles.attWrap}>
                    <AttachmentList items={attachments} />
                  </View>
                ) : null}
                <Text style={styles.bubbleTime}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            );
          })}
          {aiThinking ? (
            <View style={[styles.bubble, styles.bubbleOther, styles.typing]}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={styles.typingText}>Support AI is typing…</Text>
            </View>
          ) : null}
        </ScrollView>

        {isSupportAi ? (
          <TouchableOpacity
            onPress={() => void handleTalkToHuman()}
            disabled={escalating}
            style={[styles.humanBtn, escalating && styles.sendBtnDisabled]}
            testID="talk-to-human"
          >
            <Headphones size={15} color={C.accent} />
            <Text style={styles.humanBtnText}>{escalating ? 'Connecting\u2026' : 'Talk to a human'}</Text>
          </TouchableOpacity>
        ) : null}

        {pendingAttachments.length > 0 ? (
          <View style={styles.pendingWrap}>
            {pendingAttachments.map((a) => (
              <View key={a.id} style={styles.pendingChip}>
                <Text style={styles.pendingText} numberOfLines={1}>{a.name}</Text>
                <TouchableOpacity onPress={() => removePending(a.id)} style={styles.pendingRemove}>
                  <X size={12} color={C.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity onPress={() => void handlePickAttachment()} disabled={uploading} style={[styles.attachBtn, uploading && styles.sendBtnDisabled]} testID="thread-attach">
            <Paperclip size={18} color={C.textSecondary} />
          </TouchableOpacity>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={uploading ? 'Uploading attachment…' : 'Write a message…'}
            placeholderTextColor={C.textMuted}
            style={styles.input}
            multiline
            editable={!uploading}
            testID="thread-input"
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={(!text.trim() && pendingAttachments.length === 0) || sendMutation.isPending || uploading}
            style={[styles.sendBtn, ((!text.trim() && pendingAttachments.length === 0) || sendMutation.isPending || uploading) && styles.sendBtnDisabled]}
            testID="thread-send"
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
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  callBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  aiTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  aiTagText: { fontSize: 10, fontWeight: '800' as const, color: C.accent, letterSpacing: 0.3 },
  systemRow: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 16 },
  systemText: { fontSize: 11.5, color: C.textMuted, textAlign: 'center', lineHeight: 17 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  typingText: { fontSize: 12.5, color: C.textSecondary },
  humanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 14, marginBottom: 8, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.accent, backgroundColor: C.accentDim },
  humanBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  title: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  msgs: { padding: 16, gap: 8 },
  empty: { textAlign: 'center', color: C.textMuted, fontSize: 13, paddingVertical: 40 },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 10, borderWidth: 1 },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: C.card, borderColor: C.border },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: C.accent, borderColor: C.accent },
  bubbleText: { fontSize: 13.5, color: C.text, lineHeight: 19 },
  bubbleTextMine: { color: C.white },
  bubbleTime: { fontSize: 10, color: C.textMuted, marginTop: 4, textAlign: 'right' },
  attWrap: { marginTop: 8 },
  pendingWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingTop: 8, backgroundColor: C.bgSecondary },
  pendingChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 200 },
  pendingText: { fontSize: 11, color: C.text, flexShrink: 1 },
  pendingRemove: { padding: 2 },
  attachBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bgSecondary },
  input: { flex: 1, minHeight: 40, maxHeight: 140, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, color: C.text, fontSize: 14 },
  sendBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
});
