import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  ArrowLeft, MapPin, Star, Building2, DollarSign, ChevronRight,
  Wrench, Forklift, Hammer, ShieldCheck,
} from 'lucide-react-native';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { serviceTypeLabel, subcategoryLabel, type ServiceType } from '@/constants/serviceMarketplace';

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

type Listing = {
  id: string;
  serviceType: ServiceType;
  subcategory: string;
  title: string;
  description: string;
  coverageArea: string[];
  hourlyRate: number;
  perJobRate: number | null;
  dailyRate: number | null;
  weeklyRate: number | null;
  cargoRatePercent: number | null;
  minPremium: number | null;
  negotiable: boolean;
};

function priceLabel(l: Listing): string {
  if (l.serviceType === 'cargo_insurance') {
    if (l.cargoRatePercent) return `${l.cargoRatePercent}% of value`;
    if (l.minPremium) return `from $${l.minPremium}`;
    return l.negotiable ? 'Negotiable' : '—';
  }
  if (l.serviceType === 'equipment_rental') {
    if (l.dailyRate) return `$${l.dailyRate}/day`;
    if (l.weeklyRate) return `$${l.weeklyRate}/wk`;
    if (l.hourlyRate) return `$${l.hourlyRate}/hr`;
    return l.negotiable ? 'Negotiable' : '—';
  }
  if (l.hourlyRate) return `$${l.hourlyRate}/hr`;
  if (l.perJobRate) return `$${l.perJobRate}/job`;
  return l.negotiable ? 'Negotiable' : '—';
}

export default function ProviderProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const profileQuery = trpc.marketplace.providerProfile.useQuery({ companyId: id! }, { enabled: !!id });
  const data = profileQuery.data;
  const listings = useMemo(() => (data?.listings ?? []) as Listing[], [data]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{data?.company?.name ?? 'Provider'}</Text>
          <Text style={styles.headerSub}>Marketplace provider</Text>
        </View>
      </View>

      {profileQuery.isLoading ? (
        <View style={styles.centerFill}><ScreenFeedback state="loading" title="Loading provider" /></View>
      ) : !data?.company ? (
        <View style={styles.centerFill}><ScreenFeedback state="error" title="Provider not found" /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Building2 size={28} color={C.yellow} />
            </View>
            <Text style={styles.name}>{data.company.name}</Text>
            {data.company.city ? (
              <View style={styles.metaRow}>
                <MapPin size={13} color={C.textMuted} />
                <Text style={styles.metaText}>{data.company.city}</Text>
              </View>
            ) : null}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <View style={styles.ratingRow}>
                  <Star size={15} color={C.yellow} fill={data.reviewCount > 0 ? C.yellow : 'transparent'} />
                  <Text style={styles.statValue}>{data.reviewCount > 0 ? data.rating.toFixed(1) : '—'}</Text>
                </View>
                <Text style={styles.statLabel}>{data.reviewCount} reviews</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{listings.length}</Text>
                <Text style={styles.statLabel}>listings</Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Listings</Text>
          {listings.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No active listings</Text>
            </View>
          ) : (
            listings.map((l) => {
              const Icon = TYPE_ICON[l.serviceType];
              const color = TYPE_COLOR[l.serviceType];
              return (
                <TouchableOpacity
                  key={l.id}
                  style={styles.card}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/marketplace/browse', params: { type: l.serviceType } } as never)}
                >
                  <View style={styles.cardHeader}>
                    <View style={[styles.typeBadge, { backgroundColor: color + '20' }]}>
                      <Icon size={13} color={color} />
                      <Text style={[styles.typeBadgeText, { color }]}>{serviceTypeLabel(l.serviceType)}</Text>
                    </View>
                    <ChevronRight size={16} color={C.textMuted} />
                  </View>
                  <Text style={styles.cardTitle}>{l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(l.serviceType)}</Text>
                  {l.description ? <Text style={styles.cardDesc} numberOfLines={2}>{l.description}</Text> : null}
                  <View style={styles.priceRow}>
                    <DollarSign size={14} color={C.green} />
                    <Text style={styles.priceText}>{priceLabel(l)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
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
  headerTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  centerFill: { flex: 1, justifyContent: 'center', padding: 20 },
  scroll: { padding: 16 },
  profileCard: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 20, alignItems: 'center', marginBottom: 20 },
  avatar: { width: 64, height: 64, borderRadius: 18, backgroundColor: C.yellowDim, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  name: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  metaText: { fontSize: 13, color: C.textSecondary },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 20 },
  statItem: { alignItems: 'center' },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' as const },
  cardTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  cardDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18, marginBottom: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  priceText: { fontSize: 15, fontWeight: '800' as const, color: C.green },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: C.textMuted },
});
