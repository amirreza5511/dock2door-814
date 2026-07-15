import React, { useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, ArrowUpFromLine, MapPin, Package, Truck, Warehouse } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

type OpenLeg = {
  id: string; vehicle_type: string; pallets: number; distance_km: number;
  pickup_address?: string | null; dropoff_address?: string | null;
  pickup_city?: string | null; dropoff_city?: string | null;
  hub_name?: string | null; hub_leg_status: string; provider_net: number;
  handling_fee?: number | null; storage_per_day?: number | null;
};

type LegKind = 'pickup' | 'delivery';

function legOf(l: OpenLeg): LegKind {
  return l.hub_leg_status === 'Released' ? 'delivery' : 'pickup';
}

export default function DriverOpenJobs() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [zone, setZone] = useState<string>('');
  const [filter, setFilter] = useState<'all' | LegKind>('all');

  const utils = trpc.useUtils();
  const query = trpc.loads.openLegs.useQuery(undefined, { refetchInterval: 20000 });
  const claim = trpc.loads.claimLeg.useMutation({
    onSuccess: async () => { await utils.loads.openLegs.invalidate(); },
  });

  const legs = useMemo<OpenLeg[]>(() => (query.data ?? []) as OpenLeg[], [query.data]);

  const filtered = useMemo(() => {
    const z = zone.trim().toLowerCase();
    return legs.filter((l) => {
      const kind = legOf(l);
      if (filter !== 'all' && kind !== filter) return false;
      if (!z) return true;
      const city = kind === 'delivery' ? String(l.dropoff_city ?? '') : String(l.pickup_city ?? '');
      return city.toLowerCase().includes(z);
    });
  }, [legs, zone, filter]);

  const onClaim = (l: OpenLeg) => {
    const kind = legOf(l);
    Alert.alert(
      kind === 'pickup' ? 'Take the pickup leg?' : 'Take the delivery leg?',
      kind === 'pickup'
        ? 'You run pickup → hub. It moves into My Loads to start.'
        : 'You run hub → final drop-off. It moves into My Loads to start.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Take it',
          onPress: () => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            claim.mutate({ id: l.id, leg: kind }, {
              onSuccess: () => router.push('/driver/my-loads' as never),
              onError: (e) => Alert.alert('Unable to claim', e instanceof Error ? e.message : 'Error'),
            });
          },
        },
      ],
    );
  };

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading open jobs" /></View>;
  if (query.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load open jobs" onRetry={() => void query.refetch()} /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Open jobs board</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        <Input
          label="Zone"
          value={zone}
          onChangeText={setZone}
          placeholder="Filter by zone / city (e.g. Coquitlam)"
        />
        <View style={styles.segment}>
          {([['all', 'All legs'], ['pickup', 'Pickup → hub'], ['delivery', 'Hub → drop']] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.segBtn, filter === key && styles.segBtnActive]}
            >
              <Text style={[styles.segText, filter === key && styles.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {filtered.length === 0 ? (
          <EmptyState icon={Truck} title="No open jobs" description="Pickup and delivery legs routed through the hub network will appear here. Check back — new next-day and next-week runs post throughout the day." />
        ) : (
          filtered.map((l) => {
            const kind = legOf(l);
            const from = kind === 'delivery' ? (l.hub_name || 'Hub') : (l.pickup_address || 'Pickup point');
            const to = kind === 'delivery' ? (l.dropoff_address || 'Drop-off point') : (l.hub_name || 'Hub');
            return (
              <Card key={l.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.legBadge, kind === 'delivery' ? styles.legBadgeDelivery : styles.legBadgePickup]}>
                    {kind === 'delivery' ? <ArrowUpFromLine size={12} color={C.white} /> : <Warehouse size={12} color={C.white} />}
                    <Text style={styles.legBadgeText}>{kind === 'delivery' ? 'Delivery leg' : 'Pickup leg'}</Text>
                  </View>
                  <View style={styles.vehBadge}><Text style={styles.vehBadgeText}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type}</Text></View>
                </View>
                <View style={styles.routeCol}>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{from}</Text></View>
                  <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{to}</Text></View>
                </View>
                <View style={styles.metaRow}>
                  <View style={styles.meta}><Package size={12} color={C.textMuted} /><Text style={styles.metaText}>{l.pallets} {l.pallets === 1 ? 'pallet' : 'pallets'}</Text></View>
                  <View style={styles.meta}><MapPin size={12} color={C.textMuted} /><Text style={styles.metaText}>{l.distance_km} km</Text></View>
                  <Text style={styles.earn}>${Number(l.provider_net).toFixed(2)}</Text>
                </View>
                <Button label="Take this leg" onPress={() => onClaim(l)} loading={claim.isPending} fullWidth size="sm" icon={<Truck size={15} color={C.white} />} />
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 12 },
  segment: { flexDirection: 'row', gap: 6, backgroundColor: C.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: C.border },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.accent },
  segText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  segTextActive: { color: C.white },
  card: { gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  legBadgePickup: { backgroundColor: C.blue },
  legBadgeDelivery: { backgroundColor: C.accent },
  legBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.white },
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
});
