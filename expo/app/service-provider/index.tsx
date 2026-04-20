import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Wrench, DollarSign, Clock, CheckCircle } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function ServiceProviderDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceListings, serviceJobs, companies, payments } = bootstrapQuery.data;

  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user]);
  const myListings = useMemo(() => serviceListings.filter((l) => l.companyId === user?.companyId), [serviceListings, user]);
  const myListingIds = useMemo(() => myListings.map((l) => l.id), [myListings]);
  const myJobs = useMemo(() => serviceJobs.filter((j) => myListingIds.includes(j.serviceId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [serviceJobs, myListingIds]);

  const stats = useMemo(() => ({
    activeServices: myListings.filter((l) => l.status === 'Active').length,
    pendingJobs: myJobs.filter((j) => j.status === 'Requested').length,
    completedJobs: myJobs.filter((j) => j.status === 'Completed').length,
    revenue: payments.filter((p) => p.referenceType === 'ServiceJob' && myJobs.some((j) => j.id === p.referenceId)).reduce((sum, p) => sum + p.netAmount, 0),
  }), [myListings, myJobs, payments]);

  const getCustomerName = (cid: string) => companies.find((c) => c.id === cid)?.name ?? cid;

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading service dashboard" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load service dashboard" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>Service Provider</Text>
          <Text style={styles.name}>{user?.name}</Text>
          {company && <Text style={styles.company}>{company.name}</Text>}
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}><Wrench size={18} color={C.textMuted} /></TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <View style={styles.statsGrid}>
          {[
            { label: 'Active Services', value: stats.activeServices, icon: Wrench, color: C.blue },
            { label: 'Pending Jobs', value: stats.pendingJobs, icon: Clock, color: C.yellow, hl: stats.pendingJobs > 0 },
            { label: 'Completed', value: stats.completedJobs, icon: CheckCircle, color: C.green },
            { label: 'Net Revenue', value: `$${stats.revenue.toLocaleString()}`, icon: DollarSign, color: C.accent },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, s.hl && styles.statCardHighlight]}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                <s.icon size={18} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {stats.pendingJobs > 0 && (
          <TouchableOpacity onPress={() => router.push('/service-provider/jobs' as any)} style={styles.alertBanner}>
            <Clock size={16} color={C.yellow} />
            <Text style={styles.alertText}>{stats.pendingJobs} new job request(s) — tap to respond</Text>
          </TouchableOpacity>
        )}

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Jobs</Text>
            <TouchableOpacity onPress={() => router.push('/service-provider/jobs' as any)}><Text style={styles.seeAll}>See All</Text></TouchableOpacity>
          </View>
          {myJobs.length === 0 ? (
            <Card><Text style={styles.emptyText}>No jobs yet.</Text></Card>
          ) : myJobs.slice(0, 5).map((j) => (
            <Card key={j.id} style={styles.jobCard}>
              <View style={styles.jobRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobCustomer}>{getCustomerName(j.customerCompanyId)}</Text>
                  <Text style={styles.jobMeta}>{j.locationCity} · {j.durationHours}h · {j.dateTimeStart.split('T')[0]}</Text>
                </View>
                <StatusBadge status={j.status} />
              </View>
              <View style={styles.jobFooter}>
                <Text style={styles.jobPrice}>${j.totalPrice}</Text>
                <StatusBadge status={j.paymentStatus} />
              </View>
            </Card>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>My Services</Text>
            <TouchableOpacity onPress={() => router.push('/service-provider/listings' as any)}><Text style={styles.seeAll}>Manage</Text></TouchableOpacity>
          </View>
          {myListings.map((l) => (
            <Card key={l.id} style={styles.listingCard}>
              <View style={styles.listingRow}>
                <View style={[styles.catBadge, { backgroundColor: C.accentDim }]}>
                  <Wrench size={14} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listingCat}>{l.category}</Text>
                  <Text style={styles.listingDetail}>${l.hourlyRate}/hr · Min {l.minimumHours}h</Text>
                </View>
                <StatusBadge status={l.status} />
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
  greeting: { fontSize: 13, color: C.textSecondary },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  company: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statCardHighlight: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 16, backgroundColor: C.yellowDim, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.yellow + '40' },
  alertText: { flex: 1, fontSize: 13, color: C.yellow },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  jobCard: { marginBottom: 8 },
  jobRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  jobCustomer: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  jobMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  jobFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  jobPrice: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  listingCard: { marginBottom: 8 },
  listingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listingCat: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  listingDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
});
