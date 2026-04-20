import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle, Shield } from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { Dispute, DisputeStatus, DisputeOutcome } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';

const OUTCOMES: DisputeOutcome[] = ['Refund', 'PartialRefund', 'Denied', 'Other'];

export default function AdminDisputes() {
  const insets = useSafeAreaInsets();
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const updateRecordMutation = trpc.dock.updateRecord.useMutation({
    onSuccess: async () => {
      await utils.dock.bootstrap.invalidate();
    },
  });
  const { disputes, users } = bootstrapQuery.data;

  const [filter, setFilter] = useState<DisputeStatus | 'All'>('All');
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [outcome, setOutcome] = useState<DisputeOutcome>('Denied');

  const filtered = useMemo(() => (filter === 'All' ? disputes : disputes.filter((d) => d.status === filter)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [disputes, filter]);

  const getUserName = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid;

  const handleReview = (d: Dispute) => {
    void updateRecordMutation.mutateAsync({ table: 'disputes', id: d.id, payload: { status: 'UnderReview' } }).then(() => {
      Alert.alert('Marked Under Review');
    }).catch((error: unknown) => {
      Alert.alert('Unable to update dispute', error instanceof Error ? error.message : 'Unknown error');
    });
  };

  const handleResolve = () => {
    if (!selected) return;
    if (!adminNotes.trim()) { Alert.alert('Notes required', 'Please add admin notes before resolving'); return; }
    void updateRecordMutation.mutateAsync({
      table: 'disputes',
      id: selected.id,
      payload: { status: 'Resolved', outcome, adminNotes },
    }).then(() => {
      setDetailModal(false);
      setAdminNotes('');
      Alert.alert('Dispute Resolved', `Outcome: ${outcome}`);
    }).catch((error: unknown) => {
      Alert.alert('Unable to resolve dispute', error instanceof Error ? error.message : 'Unknown error');
    });
  };

  const openDetail = (d: Dispute) => {
    setSelected(d);
    setAdminNotes(d.adminNotes ?? '');
    setOutcome(d.outcome ?? 'Denied');
    setDetailModal(true);
  };

  if (bootstrapQuery.isLoading) {
    return <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}><ScreenFeedback state="loading" title="Loading disputes" /></View>;
  }

  if (bootstrapQuery.isError) {
    return <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}><ScreenFeedback state="error" title="Unable to load disputes" onRetry={() => void bootstrapQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Disputes</Text>
        <Text style={styles.sub}>{disputes.filter((d) => d.status === 'Open').length} open · {disputes.length} total</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {(['All', 'Open', 'UnderReview', 'Resolved'] as (DisputeStatus | 'All')[]).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'UnderReview' ? 'In Review' : f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Shield size={40} color={C.green} />
            <Text style={styles.emptyText}>No disputes in this category</Text>
          </View>
        )}
        {filtered.map((d) => (
          <TouchableOpacity key={d.id} onPress={() => openDetail(d)} activeOpacity={0.85}>
            <Card style={[styles.card, d.status === 'Open' && styles.cardOpen]}>
              <View style={styles.cardTop}>
                <View style={[styles.icon, { backgroundColor: d.status === 'Open' ? C.redDim : d.status === 'UnderReview' ? C.yellowDim : C.greenDim }]}>
                  <AlertTriangle size={16} color={d.status === 'Open' ? C.red : d.status === 'UnderReview' ? C.yellow : C.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ref}>{d.referenceType} · #{d.referenceId.toUpperCase()}</Text>
                  <Text style={styles.openedBy}>Opened by: {getUserName(d.openedByUserId)}</Text>
                  <Text style={styles.created}>{d.createdAt.split('T')[0]}</Text>
                </View>
                <StatusBadge status={d.status} />
              </View>
              <Text style={styles.description} numberOfLines={2}>{d.description}</Text>
              {d.status === 'Open' && (
                <View style={styles.actionRow}>
                  <Button label="Mark Under Review" onPress={() => handleReview(d)} size="sm" variant="secondary" icon={<CheckCircle size={13} color={C.textSecondary} />} />
                </View>
              )}
              {d.outcome && (
                <View style={styles.outcomeRow}>
                  <Text style={styles.outcomeLabel}>Outcome:</Text>
                  <Text style={styles.outcomeValue}>{d.outcome}</Text>
                </View>
              )}
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={detailModal && !!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>Dispute #{selected.id.toUpperCase()}</Text>
                  <StatusBadge status={selected.status} size="md" />
                </View>

                <View style={styles.detailGrid}>
                  {[
                    ['Reference', `${selected.referenceType} #${selected.referenceId}`],
                    ['Opened By', getUserName(selected.openedByUserId)],
                    ['Date', selected.createdAt.split('T')[0]],
                    ['Current Outcome', selected.outcome ?? '—'],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.descBox}>
                  <Text style={styles.descLabel}>Dispute Description</Text>
                  <Text style={styles.descText}>{selected.description}</Text>
                </View>

                {selected.status !== 'Resolved' && (
                  <View style={styles.resolveSection}>
                    <Text style={styles.resolveSectionTitle}>Resolve Dispute</Text>

                    <Text style={styles.outcomePickLabel}>Select Outcome</Text>
                    <View style={styles.outcomeGrid}>
                      {OUTCOMES.map((o) => (
                        <TouchableOpacity key={o ?? 'null'} onPress={() => setOutcome(o)} style={[styles.outcomeChip, outcome === o && styles.outcomeChipActive]}>
                          <Text style={[styles.outcomeChipText, outcome === o && styles.outcomeChipTextActive]}>{o}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Input
                      label="Admin Resolution Notes *"
                      value={adminNotes}
                      onChangeText={setAdminNotes}
                      multiline
                      numberOfLines={4}
                      placeholder="Describe the resolution and reasoning…"
                    />

                    <Button
                      label="Resolve & Lock Dispute"
                      onPress={handleResolve}
                      fullWidth
                      size="lg"
                      icon={<Shield size={16} color={C.white} />}
                    />
                  </View>
                )}

                {selected.status === 'Resolved' && selected.adminNotes && (
                  <View style={styles.resolvedBox}>
                    <View style={styles.resolvedHeader}>
                      <CheckCircle size={16} color={C.green} />
                      <Text style={styles.resolvedTitle}>Resolution Notes</Text>
                    </View>
                    <Text style={styles.resolvedText}>{selected.adminNotes}</Text>
                    <Text style={styles.resolvedOutcome}>Outcome: {selected.outcome}</Text>
                  </View>
                )}

                {selected.status === 'Open' && (
                  <Button label="Mark Under Review" onPress={() => { handleReview(selected); setDetailModal(false); }} variant="secondary" fullWidth />
                )}

                <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 10 },
  card: {},
  cardOpen: { borderColor: C.red + '40', backgroundColor: C.redDim },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ref: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  openedBy: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  created: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  description: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: 8 },
  actionRow: { marginTop: 4 },
  outcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  outcomeLabel: { fontSize: 12, color: C.textMuted },
  outcomeValue: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 8 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
  descBox: { backgroundColor: C.bgSecondary, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  descLabel: { fontSize: 12, color: C.textMuted, marginBottom: 6 },
  descText: { fontSize: 14, color: C.text, lineHeight: 22 },
  resolveSection: { gap: 12, padding: 16, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  resolveSectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  outcomePickLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  outcomeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outcomeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  outcomeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  outcomeChipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  outcomeChipTextActive: { color: C.accent },
  resolvedBox: { backgroundColor: C.greenDim, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: C.green + '40' },
  resolvedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resolvedTitle: { fontSize: 14, fontWeight: '700' as const, color: C.green },
  resolvedText: { fontSize: 13, color: C.text, lineHeight: 20 },
  resolvedOutcome: { fontSize: 13, color: C.green, fontWeight: '700' as const },
});
