import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Paperclip, Send, X } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import AttachmentList, { type AttachmentItem } from '@/components/ui/AttachmentList';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface MessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  attachments: unknown;
  created_at: string;
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
      void markReadMutation.mutateAsync({ threadId }).catch(() => undefined);
    }
  }, [threadId, markReadMutation]);

  useEffect(() => {
    if (!threadId) return;
    console.log('[thread-realtime] subscribing', threadId);
    const channel = supabase
      .channel(`thread-messages-${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'thread_messages', filter: `thread_id=eq.${threadId}` },
        () => {
          void utils.messaging.listMessages.invalidate({ threadId });
          void utils.messaging.listThreads.invalidate();
          void markReadMutation.mutateAsync({ threadId }).catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      console.log('[thread-realtime] unsubscribing', threadId);
      void supabase.removeChannel(channel);
    };
  }, [threadId, utils, markReadMutation]);

  useEffect(() => {
    if (messagesQuery.data && messagesQuery.data.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  }, [messagesQuery.data]);

  const handleSend = () => {
    const body = text.trim();
    if ((!body && pendingAttachments.length === 0) || !threadId) return;
    sendMutation.mutate(
      {
        threadId,
        body: body || '(attachment)',
        attachments: pendingAttachments.map((a) => ({ id: a.id, name: a.name, url: a.url })),
      },
      {
        onSuccess: () => { setPendingAttachments([]); },
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
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 60}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.msgs} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <Text style={styles.empty}>No messages yet. Say hello.</Text>
          ) : messages.map((m) => {
            const mine = m.sender_user_id === user?.id;
            const attachments = parseAttachments(m.attachments);
            return (
              <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
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
        </ScrollView>

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
