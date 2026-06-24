import React, { useEffect, useState } from 'react';
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

// Only entities that exist in the ENTITY_TABLE allowlist inside trpc.ts are listed here.
// Removed: 'drivers', 'trucks', 'trailers', 'containers' — no standalone tables in schema.
// 'bookings' maps to warehouse_bookings.
// 'dock_appointments' maps to gate_events — READ ONLY (append-only log, no status mutations).
type AdminEntity =
  | 'companies'
  | 'users'
  | 'bookings'
  | 'disputes'
  | 'payments'
  | 'invoices'
  | 'payouts'
  | 'shift_posts'
  | 'message_threads'
  | 'dock_appointments'
  | 'service_listings'
  | 'warehouse_listings';

/**
 * Entities where status mutations (Approve / Set Active / Suspend) are not meaningful.
 * gate_events is an append-only audit log — records can't be status-patched.
 */
const READ_ONLY_ENTITIES = new Set<AdminEntity>(['dock_appointments', 'message_threads']);

const ENTITY_TABS: [AdminEntity, string][] = [
  ['companies', 'Companies'],
  ['users', 'Users'],
  ['bookings', 'Bookings'],
  ['disputes', 'Disputes'],
  ['payments', 'Payments'],
  ['invoices', 'Invoices'],
  ['payouts', 'Payouts'],
  ['shift_posts', 'Shifts'],
  ['message_threads', 'Threads'],
  ['dock_appointments', 'Gate Events'],
  ['service_listings', 'Svc Listings'],
  ['warehouse_listings', 'WH Listings'],
];

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
  const detailQuery = trpc.admin.getEntityRecord.useQuery(
    { entity, id: selectedId ?? '' },
    { enabled: Boolean(selectedId) },
  );
  const updateStatusMutation = trpc.admin.updateEntityStatus.useMutation();
  const archiveMutation = trpc.admin.archiveEntity.useMutation();

  const items: EntityItem[] = (listQuery.data ?? []) as EntityItem[];

  // Always log the real error to Metro / Rork console so it can be diagnosed.
  useEffect(() => {
    if (listQuery.isError && listQuery.error) {
      console.error('[DataManager] listEntity failed — entity:', entity, '— error:', listQuery.error.message);
    }
  }, [listQuery.isError, listQuery.error, entity]);

  /**
   * Maps generic UI intent (approve / active / suspend) to a valid DB enum value
   * for the currently-selected entity. Each entity uses its own status enum, so
   * a blanket 'Active' would crash on e.g. shift_posts (shift_status enum).
   */
  const resolveStatusValue = (intent: 'approve' | 'active' | 'suspend'): string => {
    const isSuspend = intent === 'suspend';
    switch (entity as string) {
      // company_status: 'PendingApproval' | 'Approved' | 'Suspended' (NO 'Active')
      case 'companies':
        return isSuspend ? 'Suspended' : 'Approved';

      // active_status: 'Active' | 'Suspended' | 'Inactive'
      case 'users':
        return isSuspend ? 'Suspended' : 'Active';

      // listing_status: 'Draft'|'PendingApproval'|'Available'|'Active'|'Hidden'|'Suspended'
      case 'warehouse_listings':
      case 'service_listings':
        return isSuspend ? 'Suspended' : 'Available';

      // booking_status: 'Requested'|'Accepted'|'CounterOffered'|'Confirmed'|'InProgress'|'Completed'|'Cancelled'
      case 'bookings':
        return isSuspend ? 'Cancelled' : 'Confirmed';

      // dispute_status: 'Open'|'UnderReview'|'Resolved'|'Rejected'|'Escalated'
      case 'disputes':
        return isSuspend ? 'Rejected' : 'Resolved';

      // invoice_status: 'Draft'|'Issued'|'Paid'|'Voided'|'Overdue'
      case 'invoices':
        return isSuspend ? 'Voided' : 'Issued';

      // payout_status: 'Pending'|'Processing'|'Paid'|'Failed'|'Cancelled'
      case 'payouts':
        return isSuspend ? 'Cancelled' : 'Processing';

      // payment_status varies; fall back to generic active_status-like values
      case 'payments':
        return isSuspend ? 'Cancelled' : 'Captured';

      // shift_status: 'Draft'|'Posted'|'Filled'|'InProgress'|'Completed'|'Cancelled'
      case 'shift_posts':
        return isSuspend ? 'Cancelled' : 'Posted';

      // shift_application_status: 'Applied'|'Accepted'|'Rejected'|'Withdrawn'
      case 'shift_applications':
        return isSuspend ? 'Rejected' : 'Accepted';

      // assignment_status: 'Scheduled'|'InProgress'|'Completed'|'NoShow'|'Cancelled'|'Disputed'
      case 'shift_assignments':
        return isSuspend ? 'Cancelled' : 'Scheduled';

      // gate_events is an append-only event log — no status column to update
      case 'dock_appointments':
        return isSuspend ? 'Cancelled' : 'Confirmed';

      default:
        return isSuspend ? 'Suspended' : 'Active';
    }
  };

  const applyStatus = async (intent: 'approve' | 'active' | 'suspend') => {
    if (!selectedId) {
      Alert.alert('Select a record first');
      return;
    }
    if (READ_ONLY_ENTITIES.has(entity)) {
      Alert.alert(
        'Read-only entity',
        entity === 'dock_appointments'
          ? 'Gate events (dock_appointments) is an append-only log. Status mutations are not applicable here.'
          : 'This entity is read-only and cannot be status-patched.',
      );
      return;
    }
    const newStatus = resolveStatusValue(intent);
    try {
      await updateStatusMutation.mutateAsync({ entity, id: selectedId, status: newStatus });
      setStatus(newStatus);
      await Promise.all([
        utils.admin.listEntity.invalidate({ entity }),
        utils.admin.getEntityRecord.invalidate({ entity, id: selectedId }),
      ]);
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
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading data manager" />
      </View>
    );
  }

  if (listQuery.isError) {
    // Surface the real query/RLS error instead of disguising it as "No records".
    const errMsg = listQuery.error?.message ?? 'Unknown error';
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback
          state="error"
          title={`Failed to load ${entity}`}
          description={errMsg}
          onRetry={() => void listQuery.refetch()}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Global Data Manager</Text>
        <Text style={styles.subtitle}>Cross-tenant backend entity management for operations and admin support.</Text>

        <View style={styles.segmentRow}>
          {ENTITY_TABS.map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.segment, entity === key && styles.segmentActive]}
              onPress={() => { setEntity(key); setSelectedId(null); setStatus(''); }}
            >
              <Text style={[styles.segmentText, entity === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {items.length === 0 ? (
          <EmptyState
            icon={Database}
            title={`No ${entity}`}
            description="Backend records for this entity will appear here automatically."
          />
        ) : (
          items.map((item) => (
            <Card
              key={item.id}
              style={styles.listCard}
              onPress={() => { setSelectedId(item.id); setStatus(String(item.status ?? '')); }}
            >
              <View style={styles.listTop}>
                <View style={styles.iconWrap}>
                  <Database size={16} color={C.red} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>
                    {String(item.name ?? item.email ?? item.invoice_number ?? item.id)}
                  </Text>
                  <Text style={styles.itemMeta}>{String(item.role ?? item.id)}</Text>
                </View>
                <StatusBadge status={String(item.status ?? 'Record')} />
              </View>
              <View style={styles.actionRow}>
                <Button
                  label="Select"
                  variant="secondary"
                  onPress={() => { setSelectedId(item.id); setStatus(String(item.status ?? '')); }}
                />
                <Button
                  label="Archive"
                  variant="danger"
                  onPress={() => void archiveRecord(item.id)}
                  icon={<Trash2 size={14} color={C.red} />}
                  loading={archiveMutation.isPending}
                />
              </View>
            </Card>
          ))
        )}

        {selectedId ? (
          <Card elevated>
            <Text style={styles.sectionTitle}>Record actions</Text>
            {detailQuery.isLoading ? <ScreenFeedback state="loading" title="Loading record" /> : null}
            {detailQuery.data ? (
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryLabel}>Current status</Text>
                <View style={{ marginTop: 6 }}>
                  <StatusBadge status={String(status || 'Unknown')} />
                </View>
              </View>
            ) : null}

            {READ_ONLY_ENTITIES.has(entity) ? (
              <View style={styles.readOnlyNote}>
                <Text style={styles.readOnlyText}>
                  {entity === 'dock_appointments'
                    ? 'Gate events is an append-only log. Status mutations are not applicable — records can only be added via the gate_record_event RPC, never status-patched.'
                    : 'This entity is read-only in the data manager.'}
                </Text>
              </View>
            ) : (
              <View style={styles.formGap}>
                <Button
                  label="Approve"
                  onPress={() => void applyStatus('approve')}
                  loading={updateStatusMutation.isPending}
                  testID="data-manager-approve"
                />
                <Button
                  label="Set Active"
                  variant="secondary"
                  onPress={() => void applyStatus('active')}
                  loading={updateStatusMutation.isPending}
                  testID="data-manager-active"
                />
                <Button
                  label="Suspend"
                  variant="danger"
                  onPress={() => void applyStatus('suspend')}
                  loading={updateStatusMutation.isPending}
                  testID="data-manager-suspend"
                />
              </View>
            )}
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
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: C.bgSecondary,
    borderWidth: 1,
    borderColor: C.border,
  },
  segmentActive: { backgroundColor: C.redDim, borderColor: C.red },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.red },
  listCard: { gap: 10 },
  listTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.redDim,
  },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  formGap: { gap: 12, marginTop: 12 },
  summaryBlock: { marginTop: 12 },
  summaryLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  readOnlyNote: { marginTop: 12, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  readOnlyText: { fontSize: 12, color: C.textMuted, lineHeight: 18 },
});
