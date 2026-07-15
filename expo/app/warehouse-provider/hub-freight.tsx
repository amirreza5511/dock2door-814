import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PackageCheck, Warehouse, ArrowDownToLine, ArrowUpFromLine, Clock, Layers } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { CARGO_LABEL, CargoType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

type HubLoad = {
  id: string; cargo_type: string; pallets: number; status: string;
  pickup_address?: string | null; dropoff_address?: string | null;
  hub_leg_status: string; hub_arrived_at?: string | null;
  storage_per_day?: number; storage_payer?: string;
  recipient_name?: string | null; created_at: string;
};

function daysAtHub(arrivedAt?: string | null): number {
  if (!arrivedAt) return 0;
  const ms = Date.now() - new Date(arrivedAt).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

export default function HubFreight() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const query = trpc.loads.hubInbound.useQuery(undefined, { refetchInterval: 20000 });

  const confirmInbound = trpc.loads.hubConfirmInbound.useMutation({
    onSuccess: async () => { await utils.loads.hubInbound.invalidate(); },
  });
  const release = trpc.loads.hubRelease.useMutation({
    onSuccess: async () => { await utils.loads.hubInbound.invalidate(); },
  });

  const loads = useMemo<HubLoad[]>(() => (query.data ?? []) as HubLoad[], [query.data]);
  const inbound = useMemo(() => loads.filter((l) => l.hub_leg_status === 'Pending'), [loads]);
  const atHub = useMemo(() => loads.filter((l) => l.hub_leg_status === 'AtHub'), [loads]);
  const palletsStored = useMemo(() => atHub.reduce((s, l) => s + Number(l.pallets ?? 0), 0), [atHub]);

  const onConfirm = (l: HubLoad) => {
    confirmInbound.mutate({ id: l.id }, {
      onError: (e) => Alert.alert('Unable to confirm', e instanceof Error ? e.message : 'Error'),
    });
  };

  const onRelease = (l: HubLoad) => {
    const days = daysAtHub(l.hub_arrived_at);
    const charge = (Number(l.storage_per_day ?? 0) * days).toFixed(2);
    Alert.alert(
      'Release for delivery?',
      `Storage: ${days} day(s) · $${charge} (${l.storage_payer === 'receiver' ? 'billed to receiver' : 'billed to shipper'}). This releases the goods for their final leg.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          onPress: () => release.mutate({ id: l.id }, {
            onError: (e) => Alert.alert('Unable to release', e instanceof Error ? e.message : 'Error'),
          }),
        },
      ],
    );
  };

  if (query.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading hub freight" /></View>;
  }
  if (query.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load hub freight" onRetry={() => void query.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}><Warehouse size={18} color={C.accent} /></View>
          <View>
            <Text style={styles.greeting}>Network Hub</Text>
            <Text style={styles.name}>Inbound & outbound freight</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: C.blue + '20' }]}><ArrowDownToLine size={16} color={C.blue} /></View>
            <Text style={styles.statValue}>{inbound.length}</Text>
            <Text style={styles.statLabel}>Expected in</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: C.accent + '20' }]}><Layers size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{atHub.length}</Text>
            <Text style={styles.statLabel}>In storage</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: C.green + '20' }]}><PackageCheck size={16} color={C.green} /></View>
            <Text style={styles.statValue}>{palletsStored}</Text>
            <Text style={styles.statLabel}>Pallets held</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Expected inbound</Text>
        {inbound.length === 0 ? (
          <EmptyState icon={ArrowDownToLine} title="Nothing expected" description="Freight routed to your hub from the delivery network will appear here to check in." />
        ) : (
          inbound.map((l) => (
            <Card key={l.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cargoBadge}><Text style={styles.cargoBadgeText}>{CARGO_LABEL[l.cargo_type as CargoType] ?? l.cargo_type}</Text></View>
                <Text style={styles.palletText}>{l.pallets} {l.pallets === 1 ? 'pallet' : 'pallets'}</Text>
              </View>
              <View style={styles.routeCol}>
                <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>From: {l.pickup_address || 'Pickup point'}</Text></View>
                <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>To: {l.dropoff_address || 'Drop-off point'}</Text></View>
              </View>
              <Button label="Confirm arrival at hub" onPress={() => onConfirm(l)} loading={confirmInbound.isPending} fullWidth size="sm" icon={<ArrowDownToLine size={15} color={C.white} />} />
            </Card>
          ))
        )}

        <Text style={styles.sectionTitle}>In storage</Text>
        {atHub.length === 0 ? (
          <EmptyState icon={Layers} title="Storage empty" description="Once you check freight in, it shows here with accruing daily storage until you release it." />
        ) : (
          atHub.map((l) => {
            const days = daysAtHub(l.hub_arrived_at);
            const charge = (Number(l.storage_per_day ?? 0) * days).toFixed(2);
            return (
              <Card key={l.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.cargoBadge}><Text style={styles.cargoBadgeText}>{CARGO_LABEL[l.cargo_type as CargoType] ?? l.cargo_type}</Text></View>
                  <Text style={styles.palletText}>{l.pallets} {l.pallets === 1 ? 'pallet' : 'pallets'}</Text>
                  <View style={{ flex: 1 }} />
                  <View style={styles.daysPill}><Clock size={11} color={C.accent} /><Text style={styles.daysPillText}>{days}d</Text></View>
                </View>
                <View style={styles.routeCol}>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>To: {l.dropoff_address || 'Drop-off point'}</Text></View>
                </View>
                <View style={styles.storageRow}>
                  <Text style={styles.storageLabel}>Storage so far</Text>
                  <Text style={styles.storageValue}>${charge} <Text style={styles.storagePayer}>({l.storage_payer === 'receiver' ? 'receiver pays' : 'shipper pays'})</Text></Text>
                </View>
                <Button label="Release for final delivery" onPress={() => onRelease(l)} loading={release.isPending} fullWidth size="sm" variant="secondary" icon={<ArrowUpFromLine size={15} color={C.accent} />} />
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 12, color: C.accent, fontWeight: '700' as const, letterSpacing: 0.4 },
  name: { fontSize: 18, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  scroll: { padding: 20, gap: 14 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 3, alignItems: 'flex-start' },
  statIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textSecondary },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, letterSpacing: -0.2, marginTop: 6 },
  card: { gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cargoBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  cargoBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  palletText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  daysPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  daysPillText: { fontSize: 11, fontWeight: '800' as const, color: C.accent },
  routeCol: { gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  storageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: C.bgSecondary, borderRadius: 10 },
  storageLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  storageValue: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  storagePayer: { fontSize: 10, fontWeight: '600' as const, color: C.textMuted },
});
