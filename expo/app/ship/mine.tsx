import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Package, RotateCcw, PackageSearch, Plus } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useExploreStore } from '@/store/explore';

interface Parcel {
  id: string;
  tracking_number: string;
  status: string;
  service: string;
  currency: string;
  price: number;
  to_name: string;
  to_city: string;
  notes: string;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  Created: C.statusDraft,
  DroppedOff: C.blue,
  InTransit: C.yellow,
  Delivered: C.green,
  Cancelled: C.red,
};

export default function ShipMine() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isExploring = useExploreStore((s) => s.isExploring);

  const query = trpc.parcel.mine.useQuery(undefined, { enabled: !isExploring, retry: false });
  const parcels = (query.data as Parcel[] | undefined) ?? [];

  const { shipments, returns } = useMemo(() => {
    const isReturn = (p: Parcel) => p.notes?.startsWith('RETURN');
    return {
      shipments: parcels.filter((p) => !isReturn(p)),
      returns: parcels.filter(isReturn),
    };
  }, [parcels]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My shipments</Text>
        <TouchableOpacity onPress={() => router.push('/ship/quote' as never)} style={styles.backBtn} hitSlop={8}>
          <Plus size={22} color={C.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} tintColor={C.accent} />}
      >
        {isExploring ? (
          <EmptyPrompt
            title="Sign in to see your shipments"
            desc="Your shipments and returns will show up here once you create an account."
            onPress={() => router.push('/auth/signup' as never)}
            cta="Create a free account"
          />
        ) : query.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
        ) : parcels.length === 0 ? (
          <EmptyPrompt
            title="No shipments yet"
            desc="Send a parcel or start a return to see it here."
            onPress={() => router.push('/ship/quote' as never)}
            cta="Send a parcel"
          />
        ) : (
          <>
            {shipments.length > 0 ? (
              <>
                <View style={styles.sectionRow}>
                  <Package size={15} color={C.accent} />
                  <Text style={styles.sectionLabel}>SHIPMENTS</Text>
                </View>
                {shipments.map((p) => <ParcelRow key={p.id} parcel={p} onPress={() => router.push(`/ship/label?id=${p.id}` as never)} />)}
              </>
            ) : null}

            {returns.length > 0 ? (
              <>
                <View style={[styles.sectionRow, { marginTop: 20 }]}>
                  <RotateCcw size={15} color={C.blue} />
                  <Text style={styles.sectionLabel}>RETURNS</Text>
                </View>
                {returns.map((p) => <ParcelRow key={p.id} parcel={p} isReturn onPress={() => router.push(`/ship/label?id=${p.id}` as never)} />)}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ParcelRow({ parcel, isReturn, onPress }: { parcel: Parcel; isReturn?: boolean; onPress: () => void }) {
  const color = STATUS_COLOR[parcel.status] ?? C.textMuted;
  const title = isReturn
    ? (parcel.notes.split('·')[1]?.trim() || 'Return')
    : parcel.to_name || 'Shipment';
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <View style={[styles.cardIcon, { backgroundColor: isReturn ? C.blueDim : C.accentDim }]}>
        {isReturn ? <RotateCcw size={18} color={C.blue} /> : <Package size={18} color={C.accent} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{parcel.tracking_number} · {parcel.to_city}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={styles.cardPrice}>{parcel.currency} {Number(parcel.price).toFixed(2)}</Text>
        <View style={[styles.statusPill, { backgroundColor: `${color}22` }]}>
          <Text style={[styles.statusText, { color }]}>{parcel.status}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={C.textMuted} />
    </TouchableOpacity>
  );
}

function EmptyPrompt({ title, desc, onPress, cta }: { title: string; desc: string; onPress: () => void; cta: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><PackageSearch size={30} color={C.textMuted} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDesc}>{desc}</Text>
      <Button label={cta} onPress={onPress} icon={<Plus size={16} color={C.white} />} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  center: { paddingVertical: 60, alignItems: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const, letterSpacing: 1.5 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  cardIcon: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  cardSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  cardPrice: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 10, paddingHorizontal: 20 },
});
