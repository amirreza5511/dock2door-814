import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Database, Trash2 } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type AdminEntity = 'companies' | 'users' | 'bookings' | 'drivers' | 'trucks' | 'trailers' | 'containers' | 'payments' | 'invoices' | 'payouts' | 'message_threads' | 'dock_appointments';

interface EntityItem {
  id: string;
  status?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  invoice_number?: string | null;
}

export default function SuperAdminDataManagerScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [entity, setEntity] = useState<AdminEntity>('companies');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const listQuery = trpc.admin.listEntity.useQuery({ entity });
  const detailQuery = trpc.admin.getEntityRecord.useQuery({ entity, id: selectedId ?? '' }, { enabled: Boolean(selectedId) });
  const updateStatusMutation = trpc.admin.updateEntityStatus.useMutation();
  const archiveMutation = trpc.admin.archiveEntity.useMutation();

  const items: EntityItem[] = (listQuery.data ?? []) as EntityItem[];

  const applyStatus = async (newStatus: string) => {
    if (!selectedId) {
      Alert.alert('Select a record first');
      return;
    }
    try {
      await updateStatusMutation.mutateAsync({ entity, id: selectedId, status: newStatus });
      setStatus(newStatus);
      await Promise.all([utils.admin.listEntity.invalidate({ entity }), utils.admin.getEntityRecord.invalidate({ entity, id: selectedId })]);
    } catch (error) {
      Alert.alert('Unable to update status', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const archiveRecord = async (id: string) => {
    try {
      await archiveMutation.mutateAsync({ entity, id });
      if (selectedId === id) {
        setSelectedId(null);
        setStatus('');
      }
      await utils.admin.listEntity.invalidate({ entity });
    } catch (error) {
      Alert.alert('Unable to archive record', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (listQuery.isLoading && items.length === 0) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading data manager" /></View>;
  }

  if (listQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load data manager" onRetry={() => void listQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Global Data Manager</Text>
        <Text style={styles.subtitle}>Cross-tenant backend entity management for operations and admin support.</Text>

        <View style={styles.segmentRow}>
          {([
            ['companies', 'Companies'],
            ['users', 'Users'],
            ['bookings', 'Bookings'],
            ['drivers', 'Drivers'],
            ['trucks', 'Trucks'],
            ['trailers', 'Trailers'],
            ['containers', 'Containers'],
            ['payments', 'Payments'],
            ['invoices', 'Invoices'],
            ['payouts', 'Payouts'],
            ['message_threads', 'Threads'],
            ['dock_appointments', 'Appointments'],
          ] as [AdminEntity, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.segment, entity === key && styles.segmentActive]} onPress={() => { setEntity(key); setSelectedId(null); setStatus(''); }}>
              <Text style={[styles.segmentText, entity === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {items.length === 0 ? <EmptyState icon={Database} title={`No ${entity}`} description="Backend records for this entity will appear here automatically." /> : items.map((item) => (
          <Card key={item.id} style={styles.listCard} onPress={() => { setSelectedId(item.id); setStatus(String(item.status ?? '')); }}>
            <View style={styles.listTop}>
              <View style={styles.iconWrap}><Database size={16} color={C.red} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{String(item.name ?? item.email ?? item.invoice_number ?? item.id)}</Text>
                <Text style={styles.itemMeta}>{String(item.role ?? item.id)}</Text>
              </View>
              <StatusBadge status={String(item.status ?? 'Record')} />
            </View>
            <View style={styles.actionRow}>
              <Button label="Select" variant="secondary" onPress={() => { setSelectedId(item.id); setStatus(String(item.status ?? '')); }} />
              <Button label="Archive" variant="danger" onPress={() => void archiveRecord(item.id)} icon={<Trash2 size={14} color={C.red} />} loading={archiveMutation.isPending} />
            </View>
          </Card>
        ))}

        {selectedId ? (
          <Card elevated>
            <Text style={styles.sectionTitle}>Record actions</Text>
            {detailQuery.isLoading ? <ScreenFeedback state="loading" title="Loading record" /> : null}
            {detailQuery.data ? (
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryLabel}>Current status</Text>
                <View style={{ marginTop: 6 }}><StatusBadge status={String(status || 'Unknown')} /></View>
              </View>
            ) : null}
            <View style={styles.formGap}>
              <Button label="Approve" onPress={() => void applyStatus('Approved')} loading={updateStatusMutation.isPending} testID="data-manager-approve" />
              <Button label="Set Active" variant="secondary" onPress={() => void applyStatus('Active')} loading={updateStatusMutation.isPending} testID="data-manager-active" />
              <Button label="Suspend" variant="danger" onPress={() => void applyStatus('Suspended')} loading={updateStatusMutation.isPending} testID="data-manager-suspend" />
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4 },
  segmentRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  segment: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.redDim, borderColor: C.red },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.red },
  listCard: { gap: 10 },
  listTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.redDim },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  detailText: { marginTop: 12, color: C.textSecondary, fontSize: 12, lineHeight: 18 },
  formGap: { gap: 12, marginTop: 12 },
  summaryBlock: { marginTop: 12 },
  summaryLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
});
