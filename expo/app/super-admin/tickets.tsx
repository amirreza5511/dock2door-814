import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, Ticket, MessageSquare, Check, CircleDot, Clock } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface TicketRow {
  id: string;
  subject: string;
  summary: string;
  status: 'open' | 'in_progress' | 'resolved';
  threadId: string | null;
  createdAt: string;
  requesterName?: string;
  requesterEmail?: string;
  companyName?: string;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  open: { color: C.red, label: 'Open' },
  in_progress: { color: C.yellow, label: 'In progress' },
  resolved: { color: C.green, label: 'Resolved' },
};

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Admin inbox for AI-filed support tickets: list, status, jump-to-chat. */
export default function TicketsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const ticketsQuery = trpc.tickets.list.useQuery({ scope: 'all' }, { refetchInterval: 30000 });
  const setStatus = trpc.tickets.setStatus.useMutation({
    onSuccess: () => void utils.tickets.list.invalidate(),
    onError: (e: Error) => Alert.alert('Failed', e.message),
  });

  const tickets = (ticketsQuery.data ?? []) as TicketRow[];
  const shown = filter === 'active' ? tickets.filter((t) => t.status !== 'resolved') : tickets;
  const activeCount = tickets.filter((t) => t.status !== 'resolved').length;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.iconBadge}><Ticket size={15} color={C.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Support Tickets</Text>
            <Text style={styles.headerSub}>{activeCount} active · filed by the AI copilot</Text>
          </View>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['active', 'all'] as const).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'active' ? `Active (${activeCount})` : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={ticketsQuery.isFetching} onRefresh={() => void ticketsQuery.refetch()} tintColor={C.accent} />}
      >
        {ticketsQuery.isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : shown.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}><Check size={26} color={C.green} /></View>
            <Text style={styles.emptyTitle}>No tickets</Text>
            <Text style={styles.emptySub}>When the AI copilot escalates a conversation to a human, the ticket lands here with a full summary.</Text>
          </View>
        ) : shown.map((t) => {
          const meta = STATUS_META[t.status] ?? STATUS_META.open;
          return (
            <Card key={t.id} style={styles.ticketCard}>
              <View style={styles.ticketHead}>
                <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
                <Text style={styles.ticketSubject} numberOfLines={2}>{t.subject}</Text>
                <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
              </View>
              <Text style={styles.ticketMeta}>
                {t.requesterName || t.requesterEmail || 'Unknown user'}
                {t.companyName ? ` · ${t.companyName}` : ''} · {timeAgo(t.createdAt)}
              </Text>
              {t.summary ? <Text style={styles.ticketSummary} numberOfLines={5}>{t.summary}</Text> : null}
              <View style={styles.btnRow}>
                {t.threadId ? (
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: C.accentDim, borderColor: C.accent + '44' }]}
                    onPress={() => router.push(`/messages/${t.threadId}` as never)}
                  >
                    <MessageSquare size={13} color={C.accent} />
                    <Text style={[styles.btnText, { color: C.accent }]}>Open chat</Text>
                  </TouchableOpacity>
                ) : null}
                {t.status === 'open' ? (
                  <TouchableOpacity
                    style={styles.btn}
                    disabled={setStatus.isPending}
                    onPress={() => setStatus.mutate({ id: t.id, status: 'in_progress' })}
                  >
                    <Clock size={13} color={C.yellow} />
                    <Text style={[styles.btnText, { color: C.yellow }]}>Take it</Text>
                  </TouchableOpacity>
                ) : null}
                {t.status !== 'resolved' ? (
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: C.green + '15', borderColor: C.green + '44' }]}
                    disabled={setStatus.isPending}
                    onPress={() => setStatus.mutate({ id: t.id, status: 'resolved' })}
                  >
                    <Check size={13} color={C.green} />
                    <Text style={[styles.btnText, { color: C.green }]}>Resolve</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.btn}
                    disabled={setStatus.isPending}
                    onPress={() => setStatus.mutate({ id: t.id, status: 'open' })}
                  >
                    <CircleDot size={13} color={C.textMuted} />
                    <Text style={styles.btnText}>Reopen</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
  filterTextActive: { color: C.accent },
  scroll: { padding: 16, gap: 12, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8 },
  emptyIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: C.green + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19, paddingHorizontal: 24 },
  ticketCard: { gap: 8 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  ticketSubject: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: C.text },
  statusText: { fontSize: 11, fontWeight: '800' as const },
  ticketMeta: { fontSize: 11.5, color: C.textMuted },
  ticketSummary: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18, backgroundColor: C.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  btnText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
});
