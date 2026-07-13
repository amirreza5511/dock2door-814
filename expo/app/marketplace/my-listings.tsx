import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { ArrowLeft, Plus, Tag, MapPin, DollarSign, Forklift, Hammer, Wrench, ShieldCheck } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { serviceTypeLabel, subcategoryLabel, type ServiceType } from '@/constants/serviceMarketplace';
import type { ServiceListing } from '@/constants/types';

const TYPE_ICON: Record<ServiceType, typeof Wrench> = {
  service: Wrench,
  equipment_rental: Forklift,
  mobile_repair: Hammer,
  cargo_insurance: ShieldCheck,
};

const TYPE_COLOR: Record<ServiceType, string> = {
  service: C.accent,
  equipment_rental: C.blue,
  mobile_repair: C.purple,
  cargo_insurance: C.yellow,
};

function priceLabel(l: ServiceListing): string {
  if (l.serviceType === 'cargo_insurance') {
    if (l.cargoRatePercent) return `${l.cargoRatePercent}% of value`;
    if (l.minPremium) return `from $${l.minPremium}`;
    return l.negotiable ? 'Negotiable' : '—';
  }
  if (l.serviceType === 'equipment_rental') {
    if (l.dailyRate) return `$${l.dailyRate}/day`;
    if (l.weeklyRate) return `$${l.weeklyRate}/wk`;
  }
  if (l.hourlyRate) return `$${l.hourlyRate}/hr`;
  if (l.perJobRate) return `$${l.perJobRate}/job`;
  return l.negotiable ? 'Negotiable' : '—';
}

export default function MyListings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceListings } = bootstrapQuery.data;

  const myListings = useMemo(
    () => serviceListings.filter((l) => l.companyId === user?.companyId),
    [serviceListings, user],
  );

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My listings</Text>
          <Text style={styles.headerSub}>{myListings.length} published</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/marketplace/create' as never)} style={styles.newBtn}>
          <Plus size={16} color={C.white} />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {bootstrapQuery.isLoading ? (
        <View style={styles.centerFill}><ScreenFeedback state="loading" title="Loading listings" /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          {myListings.map((l) => {
            const type = (l.serviceType ?? 'service') as ServiceType;
            const Icon = TYPE_ICON[type];
            const color = TYPE_COLOR[type];
            return (
              <View key={l.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: color + '20' }]}>
                    <Icon size={13} color={color} />
                    <Text style={[styles.typeBadgeText, { color }]}>{serviceTypeLabel(type)}</Text>
                  </View>
                  <View style={[styles.statusBadge, l.status === 'Active' ? styles.statusActive : styles.statusHidden]}>
                    <Text style={[styles.statusText, { color: l.status === 'Active' ? C.green : C.textMuted }]}>{l.status}</Text>
                  </View>
                </View>
                <Text style={styles.cardTitle}>{l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(type)}</Text>
                {l.coverageArea.length > 0 && (
                  <View style={styles.metaRow}>
                    <MapPin size={12} color={C.textMuted} />
                    <Text style={styles.metaText}>{l.coverageArea.join(' · ')}</Text>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <DollarSign size={13} color={C.green} />
                  <Text style={styles.priceText}>{priceLabel(l)}</Text>
                  {l.negotiable && <Text style={styles.negotiableTag}>Negotiable</Text>}
                </View>
              </View>
            );
          })}
          {myListings.length === 0 && (
            <View style={styles.emptyState}>
              <Tag size={40} color={C.textMuted} />
              <Text style={styles.emptyText}>No listings yet</Text>
              <Text style={styles.emptySub}>Publish equipment, mobile repair or a service to start getting requests.</Text>
              <TouchableOpacity onPress={() => router.push('/marketplace/create' as never)} style={styles.emptyBtn}>
                <Plus size={16} color={C.white} />
                <Text style={styles.newBtnText}>Post a listing</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, paddingHorizontal: 12, height: 36, borderRadius: 10 },
  newBtnText: { color: C.white, fontWeight: '700' as const, fontSize: 13 },
  centerFill: { flex: 1, justifyContent: 'center', padding: 20 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' as const },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusActive: { backgroundColor: C.greenDim },
  statusHidden: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  cardTitle: { fontSize: 17, fontWeight: '700' as const, color: C.text, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  metaText: { fontSize: 12, color: C.textSecondary, flex: 1 },
  priceText: { fontSize: 15, fontWeight: '800' as const, color: C.green },
  negotiableTag: { fontSize: 11, color: C.yellow, fontWeight: '700' as const, backgroundColor: C.yellowDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 4 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '700' as const },
  emptySub: { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, paddingHorizontal: 16, height: 42, borderRadius: 12, marginTop: 10 },
});
