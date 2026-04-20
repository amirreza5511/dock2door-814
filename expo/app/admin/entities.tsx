import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Archive, CheckCircle, Database } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Entity = 'bookings' | 'payments' | 'invoices' | 'payouts' | 'dock_appointments' | 'drivers' | 'trucks' | 'trailers' | 'containers' | 'disputes';

const ENTITIES: { key: Entity; label: string; statuses: string[] }[] = [
  { key: 'bookings', label: 'Bookings', statuses: ['Requested', 'Confirmed', 'InProgress', 'Completed', 'Cancelled', 'Rejected'] },
  { key: 'payments', label: 'Payments', statuses: ['Pending', 'Paid', 'Failed', 'Refunded', 'Cancelled'] },
  { key: 'invoices', label: 'Invoices', statuses: ['Draft', 'Issued', 'Paid', 'Void'] },
  { key: 'payouts', label: 'Payouts', statuses: ['Pending', 'Processing', 'Paid', 'Failed', 'Cancelled'] },
  { key: 'dock_appointments', label: 'Dock', statuses: ['Requested', 'Approved', 'CheckedIn', 'Completed', 'NoShow'] },
  { key: 'drivers', label: 'Drivers', statuses: ['Active', 'Suspended'] },
  { key: 'trucks', label: 'Trucks', statuses: ['Active', 'Maintenance', 'Retired'] },
  { key: 'trailers', label: 'Trailers', statuses: ['Active', 'Maintenance', 'Retired'] },
  { key: 'containers', label: 'Containers', statuses: ['Active', 'Retired'] },
  { key: 'disputes', label: 'Disputes', statuses: ['Open', 'UnderReview', 'Resolved', 'Closed'] },
];

interface RowShape {
  id: string;
  status: string | null;
  created_at: string;
  updated_at?: string;
  [key: string]: unknown;
}

export default function AdminEntities() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [entity, setEntity] = useState<Entity>('bookings');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const utils = trpc.useUtils();
  const listQuery = trpc.admin.listEntity.useQuery({ entity });
  const updateStatus = trpc.admin.updateEntityStatus.useMutation({
    onSuccess: async () => { await utils.admin.listEntity.invalidate({ entity }); },
  });
  const archive = trpc.admin.archiveEntity.useMutation({
    onSuccess: async () => { await utils.admin.listEntity.invalidate({ entity }); },
  });

  const rows = (listQuery.data as RowShape[] | undefined) ?? [];
  const currentDef = ENTITIES.find((e) => e.key === entity)!;

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(term));
  }, [rows, searchTerm]);

  const handleSetStatus = (id: string, status: string) => {
    updateStatus.mutate({ entity, id, status }, {
      onError: (error) => Alert.alert('Update failed', error.message),
    });
  };

  const handleArchive = (id: string) => {
    Alert.alert('Archive record', 'This will soft-delete the record. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => archive.mutate({ entity, id }, { onError: (e) => Alert.alert('Archive failed', e.message) }) },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Entity Manager</Text>
          <Text style={styles.sub}>{filtered.length} of {rows.length} {currentDef.label.toLowerCase()}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {ENTITIES.map((e) => (
          <TouchableOpacity key={e.key} onPress={() => setEntity(e.key)} style={[styles.tab, entity === e.key && styles.tabActive]}>
            <Text style={[styles.tabText, entity === e.key && styles.tabTextActive]}>{e.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {listQuery.isLoading ? (
          <ScreenFeedback state="loading" title={`Loading ${currentDef.label.toLowerCase()}`} />
        ) : listQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load records" onRetry={() => void listQuery.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Database} title={`No ${currentDef.label.toLowerCase()}`} description="Records will appear here when created." />
        ) : filtered.map((row) => (
          <Card key={row.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recordId}>{row.id.slice(0, 12).toUpperCase()}</Text>
                <Text style={styles.recordMeta}>{new Date(row.created_at).toLocaleString()}</Text>
              </View>
              {row.status ? <StatusBadge status={row.status} /> : null}
            </View>
            <View style={styles.statusBtns}>
              {currentDef.statuses.filter((s) => s !== row.status).slice(0, 4).map((status) => (
                <TouchableOpacity
                  key={status}
                  onPress={() => handleSetStatus(row.id, status)}
                  disabled={updateStatus.isPending}
                  style={styles.statusBtn}
                >
                  <CheckCircle size={12} color={C.accent} />
                  <Text style={styles.statusBtnText}>{status}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button
              label="Archive"
              onPress={() => handleArchive(row.id)}
              variant="danger"
              size="sm"
              icon={<Archive size={13} color={C.red} />}
            />
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabBar: { maxHeight: 48, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  tabTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 14, gap: 10 },
  card: { padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recordId: { fontSize: 13, color: C.text, fontWeight: '700' as const, fontFamily: 'monospace' as const },
  recordMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  statusBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  statusBtnText: { fontSize: 11, color: C.accent, fontWeight: '600' as const },
});
