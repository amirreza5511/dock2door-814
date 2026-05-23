import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Award, Building2, ClipboardCheck, Database, LogOut, ShieldCheck, Users } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';
import { useAuthStore } from '@/store/auth';

export default function SuperAdminOverviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const dashboardQuery = trpc.admin.dashboard.useQuery();

  if (dashboardQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading control tower" /></View>;
  }

  if (dashboardQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load super admin overview" onRetry={() => void dashboardQuery.refetch()} /></View>;
  }

  const data = dashboardQuery.data;
  const pendingCertCount    = data?.pendingCertCount    ?? 0;
  const pendingCompanyCount = data?.pendingCompanyCount ?? 0;
  const pendingListingCount = data?.pendingListingCount ?? 0;
  const openDisputeCount    = data?.openDisputeCount    ?? 0;
  const totalPending = pendingCertCount + pendingCompanyCount + pendingListingCount + openDisputeCount;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>

        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}><ShieldCheck size={15} color={C.red} /><Text style={styles.badgeText}>Super Admin</Text></View>
            <Text style={styles.title}>Platform overview</Text>
            <Text style={styles.subtitle}>Cross-tenant visibility — production backend.</Text>
            {user?.name ? <Text style={styles.userName}>{user.name}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => void logout()} style={styles.logoutBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Log out">
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Platform stats */}
        <View style={styles.statsRow}>
          {[
            ['Users',     data?.users.length ?? 0],
            ['Companies', data?.companies.length ?? 0],
            ['Bookings',  data?.bookings.length ?? 0],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Pending approval work queue */}
        {totalPending > 0 ? (
          <View style={styles.attentionBanner}>
            <ShieldCheck size={15} color={C.red} />
            <Text style={styles.attentionBannerText}>{totalPending} item{totalPending !== 1 ? 's' : ''} need attention</Text>
          </View>
        ) : null}

        <View style={styles.workQueueGrid}>
          <TouchableOpacity
            style={[styles.workQueueCard, pendingCertCount > 0 && styles.workQueueCardAlert]}
            onPress={() => router.push('/super-admin/certifications' as never)}
            activeOpacity={0.8}
          >
            <View style={[styles.workQueueIcon, { backgroundColor: pendingCertCount > 0 ? C.yellowDim : C.bgSecondary }]}>
              <Award size={18} color={pendingCertCount > 0 ? C.yellow : C.textMuted} />
            </View>
            <Text style={[styles.workQueueValue, pendingCertCount > 0 && { color: C.yellow }]}>{pendingCertCount}</Text>
            <Text style={styles.workQueueLabel}>Pending certs</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.workQueueCard, pendingCompanyCount > 0 && styles.workQueueCardAlert]}
            onPress={() => router.push('/super-admin/companies' as never)}
            activeOpacity={0.8}
          >
            <View style={[styles.workQueueIcon, { backgroundColor: pendingCompanyCount > 0 ? C.yellowDim : C.bgSecondary }]}>
              <Building2 size={18} color={pendingCompanyCount > 0 ? C.yellow : C.textMuted} />
            </View>
            <Text style={[styles.workQueueValue, pendingCompanyCount > 0 && { color: C.yellow }]}>{pendingCompanyCount}</Text>
            <Text style={styles.workQueueLabel}>Pending companies</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.workQueueCard, pendingListingCount > 0 && styles.workQueueCardAlert]}
            onPress={() => router.push('/super-admin/compliance' as never)}
            activeOpacity={0.8}
          >
            <View style={[styles.workQueueIcon, { backgroundColor: pendingListingCount > 0 ? C.yellowDim : C.bgSecondary }]}>
              <ClipboardCheck size={18} color={pendingListingCount > 0 ? C.yellow : C.textMuted} />
            </View>
            <Text style={[styles.workQueueValue, pendingListingCount > 0 && { color: C.yellow }]}>{pendingListingCount}</Text>
            <Text style={styles.workQueueLabel}>Pending listings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.workQueueCard, openDisputeCount > 0 && styles.workQueueCardDanger]}
            onPress={() => router.push('/super-admin/compliance' as never)}
            activeOpacity={0.8}
          >
            <View style={[styles.workQueueIcon, { backgroundColor: openDisputeCount > 0 ? C.redDim : C.bgSecondary }]}>
              <ShieldCheck size={18} color={openDisputeCount > 0 ? C.red : C.textMuted} />
            </View>
            <Text style={[styles.workQueueValue, openDisputeCount > 0 && { color: C.red }]}>{openDisputeCount}</Text>
            <Text style={styles.workQueueLabel}>Open disputes</Text>
          </TouchableOpacity>
        </View>

        {/* Data manager */}
        <Card elevated onPress={() => router.push('/super-admin/data-manager' as never)}>
          <View style={styles.managerRow}>
            <View style={styles.managerIcon}><Database size={18} color={C.red} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>Global data manager</Text>
              <Text style={styles.itemMeta}>Cross-tenant entity controls for backend records.</Text>
            </View>
          </View>
        </Card>

        {/* Recent companies */}
        <Text style={styles.sectionTitle}>Recent companies</Text>
        {(data?.companies ?? []).slice(0, 6).map((company) => (
          <Card key={String(company.id)} style={styles.itemCard}>
            <View style={[styles.itemIcon, { backgroundColor: C.blueDim }]}><Building2 size={16} color={C.blue} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{String(company.name)}</Text>
              <Text style={styles.itemMeta}>{String(company.type)} · {String(company.city ?? '—')}</Text>
            </View>
            <StatusBadge status={String(company.status)} />
          </Card>
        ))}

        {/* Recent users */}
        <Text style={styles.sectionTitle}>Recent users</Text>
        {(data?.users ?? []).slice(0, 6).map((entry) => (
          <Card key={String(entry.id)} style={styles.itemCard}>
            <View style={[styles.itemIcon, { backgroundColor: C.greenDim }]}><Users size={16} color={C.green} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{String(entry.name)}</Text>
              <Text style={styles.itemMeta}>{String(entry.email)}</Text>
            </View>
            <StatusBadge status={String(entry.status)} />
          </Card>
        ))}

        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.redDim, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: C.red },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, marginTop: 8 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  userName: { fontSize: 12, color: C.textMuted, marginTop: 6 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 3 },
  attentionBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redDim, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.red + '40' },
  attentionBannerText: { fontSize: 13, fontWeight: '700' as const, color: C.red },
  workQueueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  workQueueCard: { width: '47%', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 6 },
  workQueueCardAlert: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim + '80' },
  workQueueCardDanger: { borderColor: C.red + '60', backgroundColor: C.redDim },
  workQueueIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  workQueueValue: { fontSize: 26, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  workQueueLabel: { fontSize: 11, color: C.textSecondary },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginTop: 4 },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  managerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  managerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.redDim },
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
