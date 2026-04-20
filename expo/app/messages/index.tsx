import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, MessageCircle } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface ThreadRow {
  id: string;
  scope: string;
  subject: string | null;
  booking_id: string | null;
  appointment_id: string | null;
  updated_at: string;
  last_message: string | null;
}

export default function MessagesList() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const threadsQuery = trpc.messaging.listThreads.useQuery();

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="messages-back">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Messages</Text>
          <Text style={styles.sub}>{(threadsQuery.data?.length ?? 0)} threads</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {threadsQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading threads" />
        ) : threadsQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load threads" onRetry={() => void threadsQuery.refetch()} />
        ) : (threadsQuery.data as ThreadRow[] | undefined ?? []).length === 0 ? (
          <EmptyState icon={MessageCircle} title="No conversations yet" description="Messages linked to your bookings and disputes will appear here." />
        ) : (threadsQuery.data as ThreadRow[]).map((thread) => (
          <TouchableOpacity
            key={thread.id}
            onPress={() => router.push(`/messages/${thread.id}` as never)}
            activeOpacity={0.85}
            testID={`thread-${thread.id}`}
          >
            <Card style={styles.threadCard}>
              <View style={styles.threadTop}>
                <View style={styles.avatar}>
                  <MessageCircle size={16} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject} numberOfLines={1}>{thread.subject ?? thread.scope + (thread.booking_id ? ` · Booking ${thread.booking_id.slice(0, 8)}` : '')}</Text>
                  <Text style={styles.preview} numberOfLines={1}>{thread.last_message ?? 'No messages yet'}</Text>
                </View>
                <Text style={styles.time}>{new Date(thread.updated_at).toLocaleDateString()}</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  list: { padding: 14, gap: 8 },
  threadCard: { padding: 12 },
  threadTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  subject: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  preview: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  time: { fontSize: 11, color: C.textMuted },
});
