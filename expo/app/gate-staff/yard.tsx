import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Truck, Calendar, MoveRight } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface GateEventRow { id: string; appointment_id: string; kind: string; notes?: string; occurred_at: string }
interface YardMoveRow { id: string; kind?: string; from_location?: string; to_location?: string; truck_plate?: string; trailer_number?: string; created_at: string }

export default function YardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const events = trpc.yard.listEvents.useQuery();
  const moves = trpc.yard.listMoves.useQuery();

  const eventList = useMemo<GateEventRow[]>(() => (events.data ?? []) as GateEventRow[], [events.data]);
  const moveList = useMemo<YardMoveRow[]>(() => (moves.data ?? []) as YardMoveRow[], [moves.data]);

  if (events.isLoading) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading yard" /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Yard Events</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={events.isFetching || moves.isFetching} onRefresh={() => { void events.refetch(); void moves.refetch(); }} tintColor={C.accent} />}
      >
        <Text style={styles.sectionTitle}>Gate events</Text>
        {eventList.length === 0 ? (
          <EmptyState icon={Calendar} title="No gate events" description="Gate check-ins and check-outs show here." />
        ) : eventList.map((e) => (
          <Card key={e.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={[styles.iconWrap, { backgroundColor: C.accentDim }]}><Truck size={15} color={C.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{e.kind.replace('_', ' ').toUpperCase()}</Text>
                <Text style={styles.cardMeta}>{e.appointment_id.slice(0, 8)} · {new Date(e.occurred_at).toLocaleString()}</Text>
                {e.notes ? <Text style={styles.cardBody}>{e.notes}</Text> : null}
              </View>
              <StatusBadge status={e.kind} />
            </View>
          </Card>
        ))}

        <Text style={styles.sectionTitle}>Yard moves</Text>
        {moveList.length === 0 ? (
          <EmptyState icon={MoveRight} title="No yard moves" description="Truck / trailer moves between dock doors appear here." />
        ) : moveList.map((m) => (
          <Card key={m.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}><MoveRight size={15} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{m.truck_plate ?? m.trailer_number ?? m.kind ?? 'Move'}</Text>
                <Text style={styles.cardMeta}>{m.from_location ?? '—'} → {m.to_location ?? '—'}</Text>
                <Text style={styles.cardMeta}>{new Date(m.created_at).toLocaleString()}</Text>
              </View>
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
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 8 },
  card: { padding: 14 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  cardBody: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
});
