import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, CheckCheck, Settings, ArrowLeft } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface NotificationRow {
  id: string;
  user_id: string;
  kind?: string;
  title?: string;
  body?: string;
  entity_type?: string;
  entity_id?: string;
  read: boolean;
  read_at?: string | null;
  payload?: Record<string, unknown>;
  created_at: string;
}

export default function NotificationsCenter() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const listQuery = trpc.notifications.list.useQuery();
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: async () => { await utils.notifications.list.invalidate(); },
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: async () => { await utils.notifications.list.invalidate(); },
  });

  const items = useMemo<NotificationRow[]>(() => (listQuery.data ?? []) as NotificationRow[], [listQuery.data]);
  const unread = items.filter((n) => !n.read).length;

  if (listQuery.isLoading) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading notifications" /></View>;
  }
  if (listQuery.isError) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="error" title="Unable to load" onRetry={() => void listQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="notif-back">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.sub}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/notifications/preferences' as never)} style={styles.iconBtn} testID="notif-prefs">
          <Settings size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} tintColor={C.accent} />}
      >
        {unread > 0 ? (
          <Button
            label="Mark all as read"
            onPress={() => markAll.mutate(undefined)}
            variant="secondary"
            icon={<CheckCheck size={15} color={C.text} />}
            loading={markAll.isPending}
            fullWidth
          />
        ) : null}

        {items.length === 0 ? (
          <EmptyState icon={Bell} title="Inbox zero" description="Platform and operational notifications appear here." />
        ) : items.map((n) => (
          <Card
            key={n.id}
            style={StyleSheet.flatten([styles.card, !n.read && styles.cardUnread])}
            onPress={() => { if (!n.read) markRead.mutate({ id: n.id }); }}
          >
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: n.read ? C.border : C.accentDim }]}>
                <Bell size={16} color={n.read ? C.textMuted : C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, !n.read && styles.cardTitleUnread]}>{n.title ?? n.kind ?? 'Notification'}</Text>
                {n.body ? <Text style={styles.cardBody} numberOfLines={3}>{n.body}</Text> : null}
                <Text style={styles.cardMeta}>{new Date(n.created_at).toLocaleString()}</Text>
              </View>
              {!n.read ? <View style={styles.dot} /> : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  card: { padding: 14 },
  cardUnread: { borderColor: C.accent },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  cardTitleUnread: { fontWeight: '800' as const },
  cardBody: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  cardMeta: { fontSize: 11, color: C.textMuted, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginTop: 6 },
});
