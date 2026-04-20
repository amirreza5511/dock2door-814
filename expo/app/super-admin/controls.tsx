import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Building2, ShieldBan, UserCog } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function SuperAdminControlsScreen() {
  const insets = useSafeAreaInsets();
  const dashboardQuery = trpc.admin.dashboard.useQuery();
  const setCompanyStatus = trpc.admin.setCompanyStatus.useMutation();
  const setUserStatus = trpc.admin.setUserStatus.useMutation();

  const approveCompany = async (companyId: string) => {
    try {
      await setCompanyStatus.mutateAsync({ companyId, status: 'Approved' });
      await dashboardQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to update company', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const suspendUser = async (userId: string) => {
    try {
      await setUserStatus.mutateAsync({ userId, status: 'Suspended' });
      await dashboardQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to suspend user', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (dashboardQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading controls" /></View>;
  }

  if (dashboardQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load controls" onRetry={() => void dashboardQuery.refetch()} /></View>;
  }

  const pendingCompanies = (dashboardQuery.data?.companies ?? []).filter((item) => String(item.status) === 'PendingApproval');
  const activeUsers = (dashboardQuery.data?.users ?? []).filter((item) => String(item.status) === 'Active').slice(0, 8);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Admin Controls</Text>
        <Text style={styles.subtitle}>High-trust actions using protected backend routes.</Text>

        <Text style={styles.sectionTitle}>Pending companies</Text>
        {pendingCompanies.map((company) => (
          <Card key={String(company.id)} style={styles.itemCard}>
            <View style={styles.itemIcon}><Building2 size={16} color={C.blue} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{String(company.name)}</Text>
              <Text style={styles.itemMeta}>{String(company.type)} · {String(company.city)}</Text>
            </View>
            <StatusBadge status={String(company.status)} />
            <Button label="Approve" onPress={() => void approveCompany(String(company.id))} size="sm" />
          </Card>
        ))}

        <Text style={styles.sectionTitle}>Suspend users</Text>
        {activeUsers.map((entry) => (
          <Card key={String(entry.id)} style={styles.itemCard}>
            <View style={[styles.itemIcon, { backgroundColor: C.redDim }]}><UserCog size={16} color={C.red} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{String(entry.name)}</Text>
              <Text style={styles.itemMeta}>{String(entry.role)}</Text>
            </View>
            <Button label="Suspend" onPress={() => void suspendUser(String(entry.id))} size="sm" variant="danger" icon={<ShieldBan size={14} color={C.red} />} />
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginTop: 6 },
  itemCard: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim },
  itemTitle: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
