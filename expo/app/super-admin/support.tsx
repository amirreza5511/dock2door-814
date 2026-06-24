import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, LifeBuoy, MessageCircle } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface SupportThreadRow {
  id: string;
  subject: string | null;
  updated_at: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  last_message: string | null;
  is_member: boolean;
}

export default function SuperAdminSupportInbox() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const threadsQuery = trpc.messaging.listSupportThreads.useQuery(undefined, { staleTime: 15_000 });
  const joinMutation = trpc.messaging.adminJoinThread.useMutation();

  const refetch = threadsQuery.refetch;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const threads = (threadsQuery.data as SupportThreadRow[] | undefined) ?? [];

  const openThread = async (thread: SupportThreadRow) => {
    try {
      if (!thread.is_member) {
        await joinMutation.mutateAsync({ threadId: thread.id });
      }
      router.push(`/messages/${thread.id}` as never);
    } catch (error) {
      Alert.alert('Unable to open conversation', error instanceof Error ? error.message : 'Please try again');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="support-back">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerIcon}>
          <LifeBuoy size={18} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Support Inbox</Text>
          <Text style={styles.sub}>{threads.length} conversation{threads.length === 1 ? '' : 's'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={threadsQuery.isFetching} onRefresh={() => void refetch()} tintColor={C.accent} />
        }
      >
        {threadsQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading support inbox" />
        ) : threadsQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load support inbox" onRetry={() => void refetch()} />
        ) : threads.length === 0 ? (
          <EmptyState icon={LifeBuoy} title="No support requests yet" description="When a worker or company contacts dock2door support, their conversation appears here." />
        ) : threads.map((thread) => (
          <TouchableOpacity
            key={thread.id}
            onPress={() => void openThread(thread)}
            activeOpacity={0.85}
            testID={`support-thread-${thread.id}`}
          >
            <Card style={styles.threadCard}>
              <View style={styles.avatar}>
                <MessageCircle size={16} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>{thread.requester_name}</Text>
                  <Text style={styles.time}>{new Date(thread.updated_at).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.preview} numberOfLines={1}>{thread.last_message ?? 'No messages yet'}</Text>
                {thread.requester_email ? (
                  <Text style={styles.email} numberOfLines={1}>{thread.requester_email}</Text>
                ) : null}
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
  headerIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  list: { padding: 14, gap: 8 },
  threadCard: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 14, fontWeight: '700' as const, color: C.text, flex: 1 },
  preview: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  email: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  time: { fontSize: 11, color: C.textMuted },
});
