import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Building2, Database, LogOut, ShieldCheck, Users } from 'lucide-react-native';
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

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}><ShieldCheck size={15} color={C.red} /><Text style={styles.badgeText}>Super Admin Control</Text></View>
            <Text style={styles.title}>Platform overview</Text>
            <Text style={styles.subtitle}>Cross-tenant visibility from the production backend.</Text>
            {user?.name ? <Text style={styles.userName}>{user.name}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => void logout()} style={styles.logoutBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Log out">
            <LogOut size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          {[
            ['Users', data?.users.length ?? 0],
            ['Companies', data?.companies.length ?? 0],
            ['Bookings', data?.bookings.length ?? 0],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <Card elevated onPress={() => router.push('/super-admin/data-manager' as never)}>
          <View style={styles.managerRow}><View style={styles.managerIcon}><Database size={18} color={C.red} /></View><View style={{ flex: 1 }}><Text style={styles.itemTitle}>Global data manager</Text><Text style={styles.itemMeta}>Open cross-tenant entity controls for major backend records.</Text></View></View>
        </Card>

        <Text style={styles.sectionTitle}>Recent companies</Text>
        {(data?.companies ?? []).slice(0, 6).map((company) => (
          <Card key={String(company.id)} style={styles.itemCard}>
            <View style={styles.itemIcon}><Building2 size={16} color={C.blue} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{String(company.name)}</Text>
              <Text style={styles.itemMeta}>{String(company.type)} · {String(company.city)}</Text>
            </View>
            <StatusBadge status={String(company.status)} />
          </Card>
        ))}

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
  scroll: { paddingHorizontal: 20, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.redDim, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: C.red },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, marginTop: 10 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  userName: { fontSize: 12, color: C.textMuted, marginTop: 8, marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginTop: 6 },
  itemCard: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  managerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  managerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.redDim },
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim },
  itemTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
