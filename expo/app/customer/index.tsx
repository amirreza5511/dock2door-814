import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Warehouse, Wrench, TrendingUp, Clock, CheckCircle, AlertCircle, LogOut } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function CustomerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bootstrapQuery = useDockBootstrapData();
  const { warehouseBookings, serviceJobs, companies } = bootstrapQuery.data;

  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user]);
  const myBookings = useMemo(() => warehouseBookings.filter((b) => b.customerCompanyId === user?.companyId), [warehouseBookings, user]);
  const myJobs = useMemo(() => serviceJobs.filter((j) => j.customerCompanyId === user?.companyId), [serviceJobs, user]);

  const stats = useMemo(() => ({
    activeBookings: myBookings.filter((b) => ['Confirmed', 'InProgress'].includes(b.status)).length,
    pending: myBookings.filter((b) => ['Requested', 'CounterOffered'].includes(b.status)).length,
    completedJobs: myJobs.filter((j) => j.status === 'Completed').length,
    totalSpend: myBookings.filter((b) => b.paymentStatus === 'Paid').reduce((sum, b) => sum + (b.finalPrice ?? b.proposedPrice), 0),
  }), [myBookings, myJobs]);

  const recentBookings = useMemo(() => [...myBookings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4), [myBookings]);

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading customer dashboard" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="error" title="Unable to load customer dashboard" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>Good morning 👋</Text>
          <Text style={styles.name}>{user?.name}</Text>
          {company && <Text style={styles.company}>{company.name}</Text>}
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn} testID="logout-btn">
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Active Bookings', value: stats.activeBookings, icon: CheckCircle, color: C.green },
            { label: 'Pending', value: stats.pending, icon: Clock, color: C.yellow },
            { label: 'Jobs Done', value: stats.completedJobs, icon: TrendingUp, color: C.blue },
            { label: 'Total Spent', value: `$${stats.totalSpend.toLocaleString()}`, icon: AlertCircle, color: C.accent },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                <s.icon size={18} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={() => router.push('/customer/warehouses' as any)} style={[styles.actionCard, { borderColor: C.blue + '50' }]} activeOpacity={0.8}>
              <View style={[styles.actionIcon, { backgroundColor: C.blueDim }]}>
                <Warehouse size={24} color={C.blue} />
              </View>
              <Text style={styles.actionTitle}>Find Warehouse</Text>
              <Text style={styles.actionDesc}>Search available storage space</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/customer/services' as any)} style={[styles.actionCard, { borderColor: C.accent + '50' }]} activeOpacity={0.8}>
              <View style={[styles.actionIcon, { backgroundColor: C.accentDim }]}>
                <Wrench size={24} color={C.accent} />
              </View>
              <Text style={styles.actionTitle}>Book Services</Text>
              <Text style={styles.actionDesc}>On-demand industrial crews</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Bookings */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Bookings</Text>
            <TouchableOpacity onPress={() => router.push('/customer/bookings' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentBookings.length === 0 ? (
            <EmptyState icon={Warehouse} title="No bookings yet" description="Start by searching for warehouse space or booking a service." />
          ) : (
            recentBookings.map((b) => (
              <Card key={b.id} style={styles.bookingCard}>
                <View style={styles.bookingRow}>
                  <View style={styles.bookingLeft}>
                    <View style={[styles.bookingTypeIcon, { backgroundColor: C.blueDim }]}>
                      <Warehouse size={16} color={C.blue} />
                    </View>
                    <View>
                      <Text style={styles.bookingRef}>Booking #{b.id.toUpperCase()}</Text>
                      <Text style={styles.bookingDetail}>{b.palletsRequested} pallets · {b.startDate} → {b.endDate}</Text>
                    </View>
                  </View>
                  <StatusBadge status={b.status} />
                </View>
                <View style={styles.bookingFooter}>
                  <Text style={styles.bookingPrice}>${b.finalPrice ?? b.proposedPrice}</Text>
                  <StatusBadge status={b.paymentStatus} />
                </View>
                {b.status === 'CounterOffered' && (
                  <View style={styles.counterOfferAlert}>
                    <AlertCircle size={14} color={C.accent} />
                    <Text style={styles.counterOfferText}>Counter offer received — review in Bookings</Text>
                  </View>
                )}
              </Card>
            ))
          )}
        </View>

        {/* Service Jobs */}
        {myJobs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Service Jobs</Text>
            {myJobs.slice(0, 3).map((j) => (
              <Card key={j.id} style={styles.bookingCard}>
                <View style={styles.bookingRow}>
                  <View style={styles.bookingLeft}>
                    <View style={[styles.bookingTypeIcon, { backgroundColor: C.accentDim }]}>
                      <Wrench size={16} color={C.accent} />
                    </View>
                    <View>
                      <Text style={styles.bookingRef}>Job #{j.id.toUpperCase()}</Text>
                      <Text style={styles.bookingDetail}>{j.locationCity} · {j.durationHours}h</Text>
                    </View>
                  </View>
                  <StatusBadge status={j.status} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bgSecondary,
  },
  greeting: { fontSize: 13, color: C.textSecondary },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  company: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  logoutBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 24 },
  statCard: {
    flex: 1, minWidth: '45%',
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 4,
  },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: C.textSecondary },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 12, letterSpacing: -0.2 },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionCard: {
    flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1,
    padding: 16, gap: 6,
  },
  actionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  actionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  actionDesc: { fontSize: 12, color: C.textSecondary },
  bookingCard: { marginBottom: 8 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  bookingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  bookingTypeIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bookingRef: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  bookingDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  bookingFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  bookingPrice: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  counterOfferAlert: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.accentDim, borderRadius: 8, padding: 8 },
  counterOfferText: { fontSize: 12, color: C.accent, flex: 1 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', padding: 8 },
});
