import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Warehouse, TrendingUp, DollarSign, Clock, CheckCircle, LogOut } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';

export default function WarehouseProviderDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bootstrapQuery = useDockBootstrapData();
  const { activeCompany } = useActiveCompany();
  const { warehouseListings, warehouseBookings, companies, payments } = bootstrapQuery.data;

  const activeCompanyId = activeCompany?.companyId ?? user?.companyId ?? null;
  const company = useMemo(() => companies.find((c) => c.id === activeCompanyId), [companies, activeCompanyId]);
  const myListings = useMemo(() => warehouseListings.filter((l) => l.companyId === activeCompanyId), [warehouseListings, activeCompanyId]);
  const myListingIds = useMemo(() => myListings.map((l) => l.id), [myListings]);
  const myBookings = useMemo(() => warehouseBookings.filter((b) => myListingIds.includes(b.listingId)), [warehouseBookings, myListingIds]);

  const stats = useMemo(() => ({
    activeListings: myListings.filter((l) => l.status === 'Available').length,
    pendingBookings: myBookings.filter((b) => b.status === 'Requested').length,
    activeBookings: myBookings.filter((b) => ['Confirmed', 'InProgress'].includes(b.status)).length,
    revenue: payments.filter((p) => p.referenceType === 'WarehouseBooking' && myListingIds.some((id) => myBookings.find((b) => b.id === p.referenceId && b.listingId === id))).reduce((sum, p) => sum + p.netAmount, 0),
  }), [myListings, myBookings, payments, myListingIds]);

  const recentBookings = useMemo(() => [...myBookings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5), [myBookings]);

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading warehouse dashboard" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load warehouse dashboard" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>Warehouse Provider</Text>
          <Text style={styles.name}>{user?.name}</Text>
          {company && <Text style={styles.company}>{company.name}</Text>}
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <View style={styles.statsGrid}>
          {[
            { label: 'Active Listings', value: stats.activeListings, icon: Warehouse, color: C.blue },
            { label: 'New Requests', value: stats.pendingBookings, icon: Clock, color: C.yellow, highlight: stats.pendingBookings > 0 },
            { label: 'Active Bookings', value: stats.activeBookings, icon: CheckCircle, color: C.green },
            { label: 'Net Revenue', value: `$${stats.revenue.toLocaleString()}`, icon: DollarSign, color: C.accent },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, s.highlight && styles.statCardHighlight]}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                <s.icon size={18} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {stats.pendingBookings > 0 && (
          <View style={styles.alertBanner}>
            <Clock size={16} color={C.yellow} />
            <Text style={styles.alertText}>{stats.pendingBookings} booking request(s) need your response</Text>
            <TouchableOpacity onPress={() => router.push('/warehouse-provider/bookings' as any)}>
              <Text style={styles.alertAction}>Review →</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Bookings</Text>
            <TouchableOpacity onPress={() => router.push('/warehouse-provider/bookings' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentBookings.length === 0 ? (
            <Card><Text style={styles.emptyText}>No bookings yet.</Text></Card>
          ) : recentBookings.map((b) => {
            const listing = myListings.find((l) => l.id === b.listingId);
            return (
              <Card key={b.id} style={styles.bookingCard}>
                <View style={styles.bookingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bookingListing}>{listing?.name ?? b.listingId}</Text>
                    <Text style={styles.bookingMeta}>{b.palletsRequested} pallets · {b.startDate} → {b.endDate}</Text>
                  </View>
                  <StatusBadge status={b.status} />
                </View>
                <View style={styles.bookingFooter}>
                  <Text style={styles.bookingPrice}>${b.finalPrice ?? b.proposedPrice}</Text>
                  <StatusBadge status={b.paymentStatus} />
                </View>
              </Card>
            );
          })}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>My Listings</Text>
            <TouchableOpacity onPress={() => router.push('/warehouse-provider/listings' as any)}>
              <Text style={styles.seeAll}>Manage</Text>
            </TouchableOpacity>
          </View>
          {myListings.slice(0, 3).map((l) => (
            <Card key={l.id} style={styles.listingCard}>
              <View style={styles.listingRow}>
                <View style={[styles.typeIcon, { backgroundColor: C.blueDim }]}>
                  <Warehouse size={16} color={C.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listingName}>{l.name}</Text>
                  <Text style={styles.listingDetail}>{l.warehouseType} · {l.availablePalletCapacity} pallets · {l.city}</Text>
                </View>
                <StatusBadge status={l.status} />
              </View>
            </Card>
          ))}
        </View>

        <View style={styles.section}>
          <Card onPress={() => router.push('/warehouse-provider/create-listing' as any)} elevated>
            <View style={styles.createRow}>
              <View style={[styles.createIcon, { backgroundColor: C.accentDim }]}>
                <TrendingUp size={22} color={C.accent} />
              </View>
              <View>
                <Text style={styles.createTitle}>Add New Listing</Text>
                <Text style={styles.createDesc}>List your warehouse space</Text>
              </View>
            </View>
          </Card>
        </View>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  greeting: { fontSize: 13, color: C.textSecondary },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  company: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statCardHighlight: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: C.textSecondary },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 16, backgroundColor: C.yellowDim, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.yellow + '40' },
  alertText: { flex: 1, fontSize: 13, color: C.yellow },
  alertAction: { fontSize: 13, color: C.yellow, fontWeight: '700' as const },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  bookingCard: { marginBottom: 8 },
  bookingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  bookingListing: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  bookingMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  bookingFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  bookingPrice: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  listingCard: { marginBottom: 8 },
  listingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listingName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  listingDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  createIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  createTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  createDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
});
