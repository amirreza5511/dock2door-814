import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, MessageSquare, Plus, Send } from 'lucide-react-native';
import AttachmentList from '@/components/ui/AttachmentList';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface ThreadItem {
  id: string;
  subject?: string | null;
  scope?: string | null;
  status?: string | null;
  last_message?: string | null;
}

interface MessageItem {
  id: string;
  sender_user_id?: string | null;
  body?: string | null;
  created_at?: string | null;
  attachments?: Array<{ id: string; url?: string | null; name?: string | null }> | null;
}

interface NotificationItem {
  id: string;
  title?: string | null;
  body?: string | null;
  channel?: string | null;
  read_at?: string | null;
  created_at?: string | null;
}

export default function TruckingMessagesScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<'threads' | 'notifications'>('threads');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string>('');
  const [messageBody, setMessageBody] = useState<string>('');
  const [attachmentUrl, setAttachmentUrl] = useState<string>('');

  const threadsQuery = trpc.messaging.listThreads.useQuery();
  const notificationsQuery = trpc.notifications.list.useQuery();
  const messagesQuery = trpc.messaging.listMessages.useQuery({ threadId: selectedThreadId ?? '' }, { enabled: Boolean(selectedThreadId) });
  const createThreadMutation = trpc.messaging.createThread.useMutation();
  const sendMessageMutation = trpc.messaging.sendMessage.useMutation();
  const markReadMutation = trpc.messaging.markThreadRead.useMutation();
  const markNotificationReadMutation = trpc.notifications.markRead.useMutation();

  const selectedThread = useMemo(() => ((threadsQuery.data ?? []) as ThreadItem[]).find((item) => item.id === selectedThreadId) ?? null, [selectedThreadId, threadsQuery.data]);

  const createThread = async () => {
    try {
      const result = await createThreadMutation.mutateAsync({ scope: 'Direct', subject: subject.trim() || 'General dispatch thread' });
      setSubject('');
      setSelectedThreadId(result.id);
      await utils.messaging.listThreads.invalidate();
    } catch (error) {
      Alert.alert('Unable to create thread', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const sendMessage = async () => {
    if (!selectedThreadId || !messageBody.trim()) {
      Alert.alert('Select a thread and enter a message');
      return;
    }
    try {
      await sendMessageMutation.mutateAsync({
        threadId: selectedThreadId,
        body: messageBody.trim(),
        attachments: attachmentUrl.trim() ? [{ id: attachmentUrl.trim(), url: attachmentUrl.trim(), name: 'Attachment' }] : [],
      });
      setMessageBody('');
      setAttachmentUrl('');
      await Promise.all([
        utils.messaging.listMessages.invalidate({ threadId: selectedThreadId }),
        utils.messaging.listThreads.invalidate(),
      ]);
    } catch (error) {
      Alert.alert('Send failed', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const openThread = async (threadId: string) => {
    setSelectedThreadId(threadId);
    try {
      await markReadMutation.mutateAsync({ threadId });
      await utils.messaging.listMessages.invalidate({ threadId });
    } catch {
    }
  };

  const markNotificationRead = async (id: string) => {
    try {
      await markNotificationReadMutation.mutateAsync({ id });
      await notificationsQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to mark notification read', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const isLoading = tab === 'threads' ? threadsQuery.isLoading : notificationsQuery.isLoading;
  const isError = tab === 'threads' ? threadsQuery.isError : notificationsQuery.isError;
  const refetch = tab === 'threads' ? threadsQuery.refetch : notificationsQuery.refetch;

  if (isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading inbox" /></View>;
  }

  if (isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load inbox" onRetry={() => void refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>Threaded backend messaging and notifications.</Text>

        <View style={styles.segmentRow}>
          <TouchableOpacity style={[styles.segment, tab === 'threads' && styles.segmentActive]} onPress={() => setTab('threads')}><Text style={[styles.segmentText, tab === 'threads' && styles.segmentTextActive]}>Threads</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.segment, tab === 'notifications' && styles.segmentActive]} onPress={() => setTab('notifications')}><Text style={[styles.segmentText, tab === 'notifications' && styles.segmentTextActive]}>Notifications</Text></TouchableOpacity>
        </View>

        {tab === 'threads' ? (
          <>
            <Card elevated>
              <Text style={styles.sectionTitle}>Create thread</Text>
              <View style={styles.formGap}>
                <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="Dispatch updates" testID="thread-subject" />
                <Button label="Create Thread" onPress={() => void createThread()} loading={createThreadMutation.isPending} icon={<Plus size={16} color={C.white} />} />
              </View>
            </Card>

            <Text style={styles.sectionTitle}>Threads</Text>
            {((threadsQuery.data ?? []) as ThreadItem[]).length === 0 ? <EmptyState icon={MessageSquare} title="No message threads" description="Create your first backend conversation to start dispatch messaging." /> : ((threadsQuery.data ?? []) as ThreadItem[]).map((thread) => (
              <Card key={thread.id} style={styles.listCard} onPress={() => void openThread(thread.id)}>
                <View style={styles.listTop}>
                  <View style={styles.iconWrap}><MessageSquare size={16} color={C.accent} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{String(thread.subject ?? 'Untitled thread')}</Text>
                    <Text style={styles.itemMeta}>{String(thread.last_message ?? thread.scope ?? 'No messages yet')}</Text>
                  </View>
                  <StatusBadge status={selectedThreadId === thread.id ? 'Open' : String(thread.scope ?? 'Direct')} />
                </View>
              </Card>
            ))}

            {selectedThread ? (
              <Card elevated>
                <Text style={styles.sectionTitle}>{String(selectedThread.subject ?? 'Thread detail')}</Text>
                <View style={styles.messageStack}>
                  {messagesQuery.isLoading ? <ScreenFeedback state="loading" title="Loading messages" /> : null}
                  {((messagesQuery.data ?? []) as MessageItem[]).map((message) => (
                    <View key={message.id} style={styles.messageBubble}>
                      <Text style={styles.messageMeta}>{String(message.sender_user_id ?? 'User')} · {message.created_at ? new Date(message.created_at).toLocaleString() : ''}</Text>
                      <Text style={styles.messageBody}>{String(message.body ?? '')}</Text>
                      <AttachmentList items={(message.attachments ?? []).map((item) => ({ id: item.id, label: item.name ?? item.id, url: item.url ?? null }))} emptyLabel="No attachments on this message." />
                    </View>
                  ))}
                </View>
                <View style={styles.formGap}>
                  <Input label="Message" value={messageBody} onChangeText={setMessageBody} placeholder="Share an operational update" multiline numberOfLines={3} testID="thread-message-body" />
                  <Input label="Attachment URL" value={attachmentUrl} onChangeText={setAttachmentUrl} placeholder="https://..." autoCapitalize="none" testID="thread-attachment-url" />
                  <Button label="Send Message" onPress={() => void sendMessage()} loading={sendMessageMutation.isPending} icon={<Send size={16} color={C.white} />} />
                </View>
              </Card>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Notifications</Text>
            {((notificationsQuery.data ?? []) as NotificationItem[]).length === 0 ? <EmptyState icon={Bell} title="No notifications" description="New backend events will appear here automatically." /> : ((notificationsQuery.data ?? []) as NotificationItem[]).map((notification) => (
              <Card key={notification.id} style={styles.listCard}>
                <View style={styles.listTop}>
                  <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}><Bell size={16} color={C.blue} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{String(notification.title ?? 'Notification')}</Text>
                    <Text style={styles.itemMeta}>{String(notification.body ?? '')}</Text>
                    <Text style={styles.itemMeta}>{notification.created_at ? new Date(notification.created_at).toLocaleString() : ''}</Text>
                  </View>
                  <Button label={notification.read_at ? 'Read' : 'Mark Read'} variant="secondary" onPress={() => void markNotificationRead(notification.id)} loading={markNotificationReadMutation.isPending} />
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  segmentRow: { flexDirection: 'row', gap: 10 },
  segment: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.accent },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  formGap: { gap: 12, marginTop: 12 },
  listCard: { gap: 10 },
  listTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  messageStack: { gap: 10, marginTop: 12 },
  messageBubble: { backgroundColor: C.bgSecondary, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  messageMeta: { fontSize: 11, color: C.textMuted },
  messageBody: { fontSize: 13, color: C.text },
});
