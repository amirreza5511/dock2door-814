import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  Search, LogOut, Forklift, Hammer, ShieldCheck, Wrench, ClipboardList, ChevronRight, ShoppingBag, Construction, Truck, Trash2, TowerControl,
} from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import CompanySwitcher from '@/components/ui/CompanySwitcher';
import SupportMenu from '@/components/SupportMenu';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';
import { SERVICE_TYPES, serviceTypeLabel, type ServiceType } from '@/constants/serviceMarketplace';

const TYPE_ICON: Record<ServiceType, typeof Wrench> = {
  service: Wrench,
  equipment_rental: Forklift,
  crane_service: Construction,
  mobile_repair: Hammer,
  cargo_insurance: ShieldCheck,
  flat_deck: Truck,
  junk_removal: Trash2,
  tow_truck: TowerControl,
};
const TYPE_COLOR: Record<ServiceType, string> = {
  service: C.accent,
  equipment_rental: C.blue,
  crane_service: C.orange,
  mobile_repair: C.purple,
  cargo_insurance: C.yellow,
  flat_deck: C.green,
  junk_removal: C.red,
  tow_truck: C.yellow,
};

export default function MarketplaceBuyerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceJobs, companies } = bootstrapQuery.data;

  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user]);
  const myRequests = useMemo(
    () => serviceJobs
      .filter((j) => j.customerCompanyId === user?.companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [serviceJobs, user],
  );
  const activeCount = useMemo(
    () => myRequests.filter((j) => j.status !== 'Completed' && j.status !== 'Cancelled').length,
    [myRequests],
  );

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading marketplace" />
      </View>
    );
  }
  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load marketplace" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <View style={styles.kickerRow}>
            <View style={[styles.kickerBadge, { backgroundColor: C.accentDim }]}>
              <ShoppingBag size={14} color={C.accent} />
            </View>
            <Text style={styles.greeting}>Marketplace Buyer</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          {company ? <Text style={styles.company}>{company.name}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CompanySwitcher />
          <SupportMenu />
          <TouchableOpacity onPress={logout} style={styles.logoutBtn}><LogOut size={18} color={C.textMuted} /></TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
          <View style={styles.section}>
            <TouchableOpacity onPress={() => router.push('/marketplace/browse' as never)} style={styles.heroCard} activeOpacity={0.9}>
              <View style={[styles.heroIcon, { backgroundColor: C.accentDim }]}>
                <Search size={24} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Browse the marketplace</Text>
                <Text style={styles.heroDesc}>Rent equipment, book mobile repair & insure cargo</Text>
              </View>
              <ChevronRight size={20} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What do you need?</Text>
            <View style={styles.typeGrid}>
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
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>My requests</Text>
              {myRequests.length > 0 ? <Text style={styles.countPill}>{activeCount} active</Text> : null}
            </View>
            {myRequests.length === 0 ? (
              <Card style={styles.emptyCard} onPress={() => router.push('/marketplace/browse' as never)}>
                <ClipboardList size={20} color={C.textMuted} />
                <Text style={styles.emptyText}>No requests yet. Browse listings and send your first request.</Text>
              </Card>
            ) : myRequests.slice(0, 8).map((j) => (
              <Card key={j.id} style={styles.jobCard} onPress={() => router.push(`/marketplace/order/${j.id}` as never)}>
                <View style={styles.jobRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobTitle}>{serviceTypeLabel(undefined)} · {j.locationCity || '—'}</Text>
                    <Text style={styles.jobMeta}>{j.dateTimeStart?.split('T')[0] ?? ''}</Text>
                  </View>
                  <StatusBadge status={j.status} />
                </View>
                <View style={styles.jobFooter}>
                  <Text style={styles.jobPrice}>{j.quotedAmount != null ? `$${j.quotedAmount}` : j.totalPrice ? `$${j.totalPrice}` : 'Awaiting quote'}</Text>
                  <ChevronRight size={16} color={C.textMuted} />
                </View>
              </Card>
            ))}
          </View>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  kickerBadge: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const, color: C.accent },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  company: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  heroDesc: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  countPill: { fontSize: 12, fontWeight: '700' as const, color: C.accent, backgroundColor: C.accentDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  typeLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  typeBlurb: { fontSize: 11, color: C.textMuted, marginTop: 3, lineHeight: 15 },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 22 },
  emptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
  jobCard: { marginBottom: 8 },
  jobRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  jobTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  jobMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  jobFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  jobPrice: { fontSize: 15, fontWeight: '700' as const, color: C.text },
});
