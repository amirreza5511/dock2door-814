import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft, Search, Plus, Store, Forklift, Hammer, Wrench,
  ClipboardList, Inbox, ChevronRight, Tag,
} from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { SERVICE_TYPES, type ServiceType } from '@/constants/serviceMarketplace';

const TYPE_ICON: Record<ServiceType, typeof Wrench> = {
  service: Wrench,
  equipment_rental: Forklift,
  mobile_repair: Hammer,
};

const TYPE_COLOR: Record<ServiceType, string> = {
  service: C.accent,
  equipment_rental: C.blue,
  mobile_repair: C.purple,
};

export default function MarketplaceHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceListings, serviceJobs } = bootstrapQuery.data;

  const myListings = useMemo(
    () => serviceListings.filter((l) => l.companyId === user?.companyId),
    [serviceListings, user],
  );
  const myListingIds = useMemo(() => new Set(myListings.map((l) => l.id)), [myListings]);

  const incoming = useMemo(
    () => serviceJobs.filter((j) => myListingIds.has(j.serviceId)),
    [serviceJobs, myListingIds],
  );
  const outgoing = useMemo(
    () => serviceJobs.filter((j) => j.customerCompanyId === user?.companyId),
    [serviceJobs, user],
  );
  const pendingIncoming = useMemo(
    () => incoming.filter((j) => j.status === 'Requested').length,
    [incoming],
  );

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading marketplace" />
      </View>
    );
  }

  const stats: { label: string; value: number; color: string }[] = [
    { label: 'My listings', value: myListings.length, color: C.accent },
    { label: 'Incoming', value: incoming.length, color: C.blue },
    { label: 'My requests', value: outgoing.length, color: C.green },
  ];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Rentals & Services</Text>
          <Text style={styles.headerSub}>Rent equipment, book mobile repair & post services</Text>
        </View>
        <View style={[styles.headerBadge, { backgroundColor: C.yellowDim }]}>
          <Store size={18} color={C.yellow} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity onPress={() => router.push('/marketplace/browse' as never)} style={styles.heroCard} activeOpacity={0.9}>
          <View style={[styles.heroIcon, { backgroundColor: C.accentDim }]}>
            <Search size={24} color={C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Browse the marketplace</Text>
            <Text style={styles.heroDesc}>Find equipment, mobile repair techs and services near you</Text>
          </View>
          <ChevronRight size={20} color={C.textMuted} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Browse by type</Text>
        <View style={styles.typeRow}>
          {SERVICE_TYPES.map((t) => {
            const Icon = TYPE_ICON[t.id];
            const color = TYPE_COLOR[t.id];
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => router.push({ pathname: '/marketplace/browse', params: { type: t.id } } as never)}
                style={styles.typeCard}
                activeOpacity={0.85}
              >
                <View style={[styles.typeIcon, { backgroundColor: color + '20' }]}>
                  <Icon size={22} color={color} />
                </View>
                <Text style={styles.typeLabel}>{t.label}</Text>
                <Text style={styles.typeBlurb} numberOfLines={2}>{t.blurb}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Manage</Text>
        <View style={styles.actionsCol}>
          <TouchableOpacity onPress={() => router.push('/marketplace/create' as never)} style={styles.actionRow} activeOpacity={0.85}>
            <View style={[styles.actionIcon, { backgroundColor: C.greenDim }]}>
              <Plus size={20} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Post a listing</Text>
              <Text style={styles.actionDesc}>Rent out equipment or offer a service</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/marketplace/my-listings' as never)} style={styles.actionRow} activeOpacity={0.85}>
            <View style={[styles.actionIcon, { backgroundColor: C.accentDim }]}>
              <Tag size={20} color={C.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>My listings</Text>
              <Text style={styles.actionDesc}>{myListings.length} published</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/marketplace/requests' as never)} style={styles.actionRow} activeOpacity={0.85}>
            <View style={[styles.actionIcon, { backgroundColor: C.blueDim }]}>
              <Inbox size={20} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Requests</Text>
              <Text style={styles.actionDesc}>{incoming.length} incoming · {outgoing.length} sent</Text>
            </View>
            {pendingIncoming > 0 ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{pendingIncoming}</Text></View>
            ) : (
              <ChevronRight size={18} color={C.textMuted} />
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/marketplace/browse' as never)} style={styles.actionRow} activeOpacity={0.85}>
            <View style={[styles.actionIcon, { backgroundColor: C.purpleDim }]}>
              <ClipboardList size={20} color={C.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>All listings</Text>
              <Text style={styles.actionDesc}>Everything on the marketplace</Text>
            </View>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  headerBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 4 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800' as const },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, marginTop: 8 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  heroDesc: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginTop: 22, marginBottom: 12 },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  typeLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  typeBlurb: { fontSize: 11, color: C.textMuted, marginTop: 3, lineHeight: 15 },
  actionsCol: { gap: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  actionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  actionDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  badgeText: { color: C.white, fontSize: 12, fontWeight: '800' as const },
});
