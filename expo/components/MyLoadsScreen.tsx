import React, { useMemo } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, CheckCircle2, ChevronRight, MapPin, Package, Truck } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { LOAD_STATUS_FLOW, VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

type LoadRow = {
  id: string; vehicle_type: string; pallets: number; delivery_speed: string; status: string;
  pickup_address?: string | null; dropoff_address?: string | null;
  distance_km: number; total_price: number; provider_net: number;
};

interface Props {
  title?: string;
  /** 'accepted' = carrier/driver runs the trip; 'posted' = shipper tracks read-only. */
  source?: 'accepted' | 'posted';
}

export default function MyLoadsScreen({ title = 'My loads', source = 'accepted' }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const acceptedQuery = trpc.loads.listAccepted.useQuery(undefined, { refetchInterval: 20000, enabled: source === 'accepted' });
  const postedQuery = trpc.loads.listPosted.useQuery(undefined, { refetchInterval: 20000, enabled: source === 'posted' });
  const query = source === 'accepted' ? acceptedQuery : postedQuery;
  const canRun = source === 'accepted';
  const advance = trpc.loads.advance.useMutation({
    onSuccess: async () => { await query.refetch(); },
  });

  const loads = useMemo<LoadRow[]>(() => (query.data ?? []) as LoadRow[], [query.data]);
  const active = loads.filter((l) => ['Accepted', 'EnRoute', 'Arrived'].includes(l.status));
  const done = loads.filter((l) => ['Delivered', 'Cancelled'].includes(l.status));

  const move = async (l: LoadRow) => {
    const flow = LOAD_STATUS_FLOW[l.status];
    if (!flow) return;
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await advance.mutateAsync({ id: l.id, status: flow.next });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Unable to update', err instanceof Error ? err.message : 'Unknown');
    }
  };

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading your trips" /></View>;
  if (query.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load trips" onRetry={() => void query.refetch()} /></View>;

  const renderCard = (l: LoadRow, primary: boolean) => {
    const flow = canRun ? LOAD_STATUS_FLOW[l.status] : undefined;
    return (
      <Card key={l.id} style={StyleSheet.flatten([styles.card, primary && styles.cardActive])}>
        <View style={styles.cardTop}>
          <View style={styles.vehBadge}><Text style={styles.vehBadgeText}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type}</Text></View>
          <StatusBadge status={l.status} />
        </View>
        <View style={styles.routeCol}>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{l.pickup_address || 'Pickup point'}</Text></View>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{l.dropoff_address || 'Drop-off point'}</Text></View>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.meta}><Package size={12} color={C.textMuted} /><Text style={styles.metaText}>{l.pallets} {l.pallets === 1 ? 'pallet' : 'pallets'}</Text></View>
          <View style={styles.meta}><MapPin size={12} color={C.textMuted} /><Text style={styles.metaText}>{l.distance_km} km</Text></View>
          <Text style={styles.earn}>${Number(l.provider_net).toFixed(2)}</Text>
        </View>
        {flow ? (
          <TouchableOpacity style={[styles.primaryBtn, advance.isPending && { opacity: 0.6 }]} disabled={advance.isPending} onPress={() => void move(l)}>
            <Truck size={15} color={C.white} />
            <Text style={styles.primaryBtnText}>{flow.label}</Text>
            <ChevronRight size={16} color={C.white} />
          </TouchableOpacity>
        ) : l.status === 'Delivered' ? (
          <View style={styles.deliveredRow}><CheckCircle2 size={14} color={C.green} /><Text style={styles.deliveredText}>Delivered</Text></View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        {loads.length === 0 ? (
          <EmptyState icon={Truck} title={source === 'posted' ? 'No posted loads yet' : 'No accepted loads yet'} description={source === 'posted' ? 'Post a load and track its progress here as a driver picks it up.' : 'Accept a load from the marketplace and it will show up here to run.'} />
        ) : null}

        {active.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Active</Text>
            {active.map((l, i) => renderCard(l, i === 0))}
          </>
        ) : null}

        {done.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>History</Text>
            {done.map((l) => renderCard(l, false))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  card: { gap: 10 },
  cardActive: { borderColor: C.accent, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vehBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  vehBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  routeCol: { gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  earn: { marginLeft: 'auto', fontSize: 15, fontWeight: '800' as const, color: C.green },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13 },
  primaryBtnText: { flex: 1, textAlign: 'center' as const, color: C.white, fontSize: 14, fontWeight: '800' as const },
  deliveredRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 4 },
  deliveredText: { fontSize: 13, color: C.green, fontWeight: '700' as const },
});
