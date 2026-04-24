import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Building2, Users, AlertTriangle, CheckCircle, Clock, DollarSign, ShieldCheck, LogOut, Award } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const bootstrapQuery = useDockBootstrapData();
  const { companies, users, warehouseListings, serviceListings, shiftPosts, warehouseBookings, disputes, payments, workerCertifications } = bootstrapQuery.data;

  useFocusEffect(useCallback(() => {
    void bootstrapQuery.refetch();
  }, [bootstrapQuery]));

  const stats = useMemo(() => ({
    pendingCompanies: companies.filter((c) => c.status === 'PendingApproval').length,
    suspendedUsers: users.filter((u) => u.status === 'Suspended').length,
    openDisputes: disputes.filter((d) => d.status === 'Open').length,
    pendingListings: warehouseListings.filter((l) => l.status === 'PendingApproval').length + serviceListings.filter((l) => l.status === 'PendingApproval').length,
    totalRevenue: payments.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.commissionAmount, 0),
    pendingCerts: workerCertifications.filter((c) => c.status === 'Pending').length,
    totalCompanies: companies.length,
    totalUsers: users.length,
  }), [companies, users, warehouseListings, serviceListings, disputes, payments, workerCertifications]);

  const pendingCompanies = useMemo(() => companies.filter((c) => c.status === 'PendingApproval'), [companies]);
  const pendingListings = useMemo(() => [
    ...warehouseListings.filter((l) => l.status === 'PendingApproval').map((l) => ({ id: l.id, name: l.name, type: 'Warehouse', city: l.city })),
    ...serviceListings.filter((l) => l.status === 'PendingApproval').map((l) => ({ id: l.id, name: l.category, type: 'Service', city: '' })),
  ], [warehouseListings, serviceListings]);

  const recentDisputes = useMemo(() => [...disputes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3), [disputes]);

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading admin dashboard" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load admin dashboard" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <View style={styles.adminBadge}>
            <ShieldCheck size={14} color={C.red} />
            <Text style={styles.adminBadgeText}>Super Admin</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={bootstrapQuery.isFetching} onRefresh={() => void bootstrapQuery.refetch()} tintColor={C.accent} />}
      >
        <ResponsiveContainer padded={false}>
        {/* Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Pending Approvals', value: stats.pendingCompanies + stats.pendingListings + stats.pendingCerts, icon: Clock, color: C.yellow, hl: true },
            { label: 'Open Disputes', value: stats.openDisputes, icon: AlertTriangle, color: C.red, hl: stats.openDisputes > 0 },
            { label: 'GMV (Paid)', value: `${stats.totalRevenue.toFixed(0)}`, icon: DollarSign, color: C.green },
            { label: 'Active Companies', value: stats.totalCompanies, icon: Building2, color: C.blue },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, s.hl && styles.statHl]}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                <s.icon size={18} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Pending Companies */}
        {pendingCompanies.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Pending Company Approvals</Text>
              <TouchableOpacity onPress={() => router.push('/admin/companies' as any)}>
                <Text style={styles.seeAll}>All →</Text>
              </TouchableOpacity>
            </View>
            {pendingCompanies.map((c) => (
              <Card key={c.id} style={styles.alertCard}>
                <View style={styles.alertRow}>
                  <Building2 size={16} color={C.yellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertName}>{c.name}</Text>
                    <Text style={styles.alertMeta}>{c.type} · {c.city}</Text>
                  </View>
                  <StatusBadge status={c.status} />
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Pending Listings */}
        {pendingListings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Listings Awaiting Approval</Text>
            {pendingListings.map((l) => (
              <Card key={l.id} style={styles.alertCard}>
                <View style={styles.alertRow}>
                  <Clock size={16} color={C.yellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertName}>{l.name}</Text>
                    <Text style={styles.alertMeta}>{l.type}{l.city ? ` · ${l.city}` : ''}</Text>
                  </View>
                  <StatusBadge status="PendingApproval" />
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Disputes */}
        {recentDisputes.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Recent Disputes</Text>
              <TouchableOpacity onPress={() => router.push('/admin/disputes' as any)}>
                <Text style={styles.seeAll}>All →</Text>
              </TouchableOpacity>
            </View>
            {recentDisputes.map((d) => (
              <Card key={d.id} style={styles.disputeCard}>
                <View style={styles.disputeRow}>
                  <AlertTriangle size={14} color={d.status === 'Open' ? C.red : C.yellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.disputeRef}>{d.referenceType} #{d.referenceId}</Text>
                    <Text style={styles.disputeDesc} numberOfLines={2}>{d.description}</Text>
                  </View>
                  <StatusBadge status={d.status} />
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Platform Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Platform Overview</Text>
          <View style={styles.summaryGrid}>
            {[
              ['Total Users', stats.totalUsers],
              ['Companies', stats.totalCompanies],
              ['Warehouse Listings', warehouseListings.length],
              ['Service Listings', serviceListings.length],
              ['Posted Shifts', shiftPosts.filter((s) => s.status === 'Posted').length],
              ['Active Bookings', warehouseBookings.filter((b) => ['Confirmed', 'InProgress'].includes(b.status)).length],
            ].map(([label, val]) => (
              <View key={String(label)} style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{val}</Text>
                <Text style={styles.summaryLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Quick Nav */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin Panels</Text>
          <View style={styles.navGrid}>
            {[
              { label: 'Companies', icon: Building2, route: '/admin/companies', color: C.blue },
              { label: 'Users', icon: Users, route: '/admin/users', color: C.green },
              { label: 'Certifications', icon: Award, route: '/admin/certifications', color: C.yellow },
              { label: 'Disputes', icon: AlertTriangle, route: '/admin/disputes', color: C.red },
              { label: 'Platform Settings', icon: CheckCircle, route: '/admin/platform-settings', color: C.accent },
            ].map((n) => (
              <TouchableOpacity key={n.label} onPress={() => router.push(n.route as any)} style={styles.navCard} activeOpacity={0.8}>
                <View style={[styles.navIcon, { backgroundColor: n.color + '20' }]}>
                  <n.icon size={20} color={n.color} />
                </View>
                <Text style={styles.navLabel}>{n.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  adminBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.redDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 4 },
  adminBadgeText: { fontSize: 11, color: C.red, fontWeight: '700' as const },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 24 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statHl: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  alertCard: { marginBottom: 8 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  alertMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  disputeCard: { marginBottom: 8 },
  disputeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  disputeRef: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  disputeDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  summaryItem: { width: '33.33%', padding: 14, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.border, alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  summaryLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textAlign: 'center' },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  navCard: { width: '47%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10 },
  navIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
});
