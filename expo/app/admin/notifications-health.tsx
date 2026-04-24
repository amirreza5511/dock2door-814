import React, { useMemo } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Activity, BellRing, CheckCircle2, Clock, Send, XCircle } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';

interface NotifRow {
  id: string;
  user_id: string;
  kind: string;
  title: string | null;
  body: string | null;
  read_at: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

interface TokenRow { user_id: string; platform: string | null; is_active: boolean; created_at: string; token: string }

export default function NotificationsHealthScreen() {
  const insets = useSafeAreaInsets();

  const notifQuery = useQuery<NotifRow[]>({
    queryKey: ['admin', 'notifications-health', 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, user_id, kind, title, body, read_at, created_at, payload')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as NotifRow[];
    },
  });

  const tokensQuery = useQuery<TokenRow[]>({
    queryKey: ['admin', 'notifications-health', 'tokens'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('push_tokens')
        .select('user_id, platform, is_active, created_at, token')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as TokenRow[];
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('push-notifications', { body: { batch: true, limit: 100 } });
      if (error) throw new Error(error.message);
      return data as { ok: boolean; dispatched: number; results?: unknown };
    },
    onSuccess: async (res) => {
      Alert.alert('Dispatcher run', `Dispatched: ${res?.dispatched ?? 0}`);
      await notifQuery.refetch();
    },
    onError: (err: Error) => Alert.alert('Dispatcher failed', err.message),
  });

  const stats = useMemo(() => {
    const rows = notifQuery.data ?? [];
    const delivered = rows.filter((r) => Boolean((r.payload as { delivered_at?: string } | null)?.delivered_at)).length;
    const pending = rows.filter((r) => !(r.payload as { delivered_at?: string } | null)?.delivered_at && !r.read_at).length;
    const read = rows.filter((r) => Boolean(r.read_at)).length;
    const lastRun = rows
      .map((r) => (r.payload as { delivered_at?: string } | null)?.delivered_at)
      .filter((x): x is string => Boolean(x))
      .sort()
      .pop() ?? null;
    return { total: rows.length, delivered, pending, read, lastRun };
  }, [notifQuery.data]);

  const activeTokens = (tokensQuery.data ?? []).filter((t) => t.is_active).length;

  if (notifQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading notifications health" /></View>;
  }
  if (notifQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load" onRetry={() => void notifQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]}
        refreshControl={<RefreshControl refreshing={notifQuery.isFetching} onRefresh={() => { void notifQuery.refetch(); void tokensQuery.refetch(); }} tintColor={C.accent} />}
      >
        <Text style={styles.title}>Notifications health</Text>
        <Text style={styles.subtitle}>Monitor the push dispatcher, tokens, and recent deliveries.</Text>

        <View style={styles.statsRow}>
          <StatCard label="Pending" value={stats.pending} color={C.yellow} icon={<Clock size={16} color={C.yellow} />} />
          <StatCard label="Delivered" value={stats.delivered} color={C.green} icon={<CheckCircle2 size={16} color={C.green} />} />
          <StatCard label="Read" value={stats.read} color={C.accent} icon={<Activity size={16} color={C.accent} />} />
          <StatCard label="Tokens" value={activeTokens} color={C.blue} icon={<BellRing size={16} color={C.blue} />} />
        </View>

        <Card elevated style={styles.runCard}>
          <View style={styles.runHead}>
            <View style={[styles.iconWrap, { backgroundColor: C.accentDim }]}><Send size={20} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.runTitle}>Push dispatcher</Text>
              <Text style={styles.runMeta}>Last delivery: {stats.lastRun ? new Date(stats.lastRun).toLocaleString() : '—'}</Text>
            </View>
          </View>
          <View style={styles.runActions}>
            <Button label="Run dispatcher now" onPress={() => dispatchMutation.mutate()} loading={dispatchMutation.isPending} icon={<Send size={14} color={C.white} />} />
            <Button label="Reload" variant="secondary" onPress={() => { void notifQuery.refetch(); void tokensQuery.refetch(); }} />
          </View>
          <Text style={styles.note}>The dispatcher also runs on cron. Manual run uses batch mode (limit 100).</Text>
        </Card>

        <Text style={styles.sectionTitle}>Recent notifications</Text>
        {(notifQuery.data ?? []).map((n) => {
          const delivered = Boolean((n.payload as { delivered_at?: string } | null)?.delivered_at);
          return (
            <Card key={n.id} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: delivered ? C.greenDim : C.yellowDim }]}>
                {delivered ? <CheckCircle2 size={14} color={C.green} /> : <Clock size={14} color={C.yellow} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{n.title || n.kind}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>{n.body || n.kind} · {new Date(n.created_at).toLocaleString()}</Text>
              </View>
              <StatusBadge status={n.read_at ? 'Read' : delivered ? 'Delivered' : 'Pending'} />
            </Card>
          );
        })}

        {(notifQuery.data ?? []).length === 0 ? (
          <View style={styles.empty}><XCircle size={16} color={C.textMuted} /><Text style={styles.emptyText}>No notifications yet.</Text></View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>{icon}<Text style={[styles.statLabel]}>{label}</Text></View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: -4 },
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  statCard: { flex: 1, minWidth: 140, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const },
  statValue: { fontSize: 22, fontWeight: '800' as const, marginTop: 6, letterSpacing: -0.4 },
  runCard: { gap: 10, marginTop: 4 },
  runHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  runTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  runMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  runActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  note: { fontSize: 11, color: C.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rowIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  empty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20 },
  emptyText: { fontSize: 12, color: C.textMuted },
});
