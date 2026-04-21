import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, XCircle, MapPin, Clock, LogIn, LogOut as LogOutIcon } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { ServiceJob, JobStatus } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';

const FILTERS: (JobStatus | 'All')[] = ['All', 'Requested', 'Accepted', 'Scheduled', 'InProgress', 'Completed', 'Cancelled'];

export default function SPJobs() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const invalidate = async () => { await utils.dock.bootstrap.invalidate(); };
  const acceptMutation = trpc.serviceJobs.accept.useMutation({ onSuccess: invalidate });
  const declineMutation = trpc.serviceJobs.decline.useMutation({ onSuccess: invalidate });
  const checkInMutation = trpc.serviceJobs.checkIn.useMutation({ onSuccess: invalidate });
  const completeMutation = trpc.serviceJobs.complete.useMutation({ onSuccess: invalidate });
  const { serviceListings, serviceJobs, companies } = bootstrapQuery.data;

  const [filter, setFilter] = useState<JobStatus | 'All'>('All');
  const [selected, setSelected] = useState<ServiceJob | null>(null);
  const [detailModal, setDetailModal] = useState(false);

  const myListingIds = useMemo(() => serviceListings.filter((l) => l.companyId === user?.companyId).map((l) => l.id), [serviceListings, user]);
  const myJobs = useMemo(() => serviceJobs.filter((j) => myListingIds.includes(j.serviceId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [serviceJobs, myListingIds]);
  const filtered = useMemo(() => filter === 'All' ? myJobs : myJobs.filter((j) => j.status === filter), [myJobs, filter]);

  const getCustomer = (cid: string) => companies.find((c) => c.id === cid)?.name ?? cid;

  const handleAccept = (j: ServiceJob) => {
    acceptMutation.mutate({ id: j.id }, {
      onSuccess: () => setDetailModal(false),
      onError: (e: Error) => Alert.alert('Unable to accept job', e.message),
    });
  };

  const handleDecline = (j: ServiceJob) => {
    Alert.alert('Decline Job?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive',
        onPress: () => declineMutation.mutate({ id: j.id, reason: 'Declined by provider' }, {
          onSuccess: () => setDetailModal(false),
          onError: (e: Error) => Alert.alert('Unable to decline', e.message),
        }),
      },
    ]);
  };

  const handleCheckIn = (j: ServiceJob) => {
    checkInMutation.mutate({ id: j.id }, {
      onError: (e: Error) => Alert.alert('Unable to check in', e.message),
    });
  };

  const handleCheckOut = (j: ServiceJob) => {
    completeMutation.mutate({ id: j.id }, {
      onSuccess: () => {
        Alert.alert('Job Complete', 'Check-out recorded. Awaiting customer confirmation.');
        setDetailModal(false);
      },
      onError: (e: Error) => Alert.alert('Unable to complete job', e.message),
    });
  };

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading service jobs" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load service jobs" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Service Jobs</Text>
        <Text style={styles.sub}>{myJobs.length} total</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 && <View style={styles.empty}><Text style={styles.emptyText}>No jobs here</Text></View>}
        {filtered.map((j) => (
          <TouchableOpacity key={j.id} onPress={() => { setSelected(j); setDetailModal(true); }} activeOpacity={0.85}>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customer}>{getCustomer(j.customerCompanyId)}</Text>
                  <View style={styles.metaRow}>
                    <MapPin size={12} color={C.textMuted} />
                    <Text style={styles.meta}>{j.locationCity}</Text>
                    <Clock size={12} color={C.textMuted} />
                    <Text style={styles.meta}>{j.durationHours}h</Text>
                    <Text style={styles.meta}>{j.dateTimeStart.split('T')[0]}</Text>
                  </View>
                </View>
                <StatusBadge status={j.status} />
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.price}>${j.totalPrice}</Text>
                {j.status === 'Requested' && <View style={styles.hint}><Text style={styles.hintText}>Respond →</Text></View>}
                {j.status === 'Accepted' && <View style={[styles.hint, { backgroundColor: C.greenDim }]}><Text style={[styles.hintText, { color: C.green }]}>Check In →</Text></View>}
                {j.status === 'InProgress' && <View style={[styles.hint, { backgroundColor: C.yellowDim }]}><Text style={[styles.hintText, { color: C.yellow }]}>In Progress</Text></View>}
              </View>
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
                  <Text style={styles.modalTitle}>{getCustomer(selected.customerCompanyId)}</Text>
                  <StatusBadge status={selected.status} size="md" />
                </View>

                <View style={styles.detailGrid}>
                  {[
                    ['Location', `${selected.locationAddress}, ${selected.locationCity}`],
                    ['Date/Time', selected.dateTimeStart.replace('T', ' ').slice(0, 16)],
                    ['Duration', `${selected.durationHours} hours`],
                    ['Total Price', `$${selected.totalPrice}`],
                    ['Payment', selected.paymentStatus],
                    ['Check-In', selected.checkInTs ? selected.checkInTs.replace('T', ' ').slice(0, 16) : '—'],
                    ['Check-Out', selected.checkOutTs ? selected.checkOutTs.replace('T', ' ').slice(0, 16) : '—'],
                    ['Customer Confirmed', selected.customerConfirmed ? 'Yes' : 'No'],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {selected.notes ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>Customer Notes</Text>
                    <Text style={styles.notesText}>{selected.notes}</Text>
                  </View>
                ) : null}

                <View style={styles.actionBtns}>
                  {selected.status === 'Requested' && (
                    <>
                      <Button label="Accept Job" onPress={() => handleAccept(selected)} fullWidth icon={<CheckCircle size={16} color={C.white} />} />
                      <Button label="Decline" onPress={() => handleDecline(selected)} variant="danger" fullWidth icon={<XCircle size={15} color={C.red} />} />
                    </>
                  )}
                  {selected.status === 'Accepted' && (
                    <Button label="Check In (Start Job)" onPress={() => { handleCheckIn(selected); setDetailModal(false); }} fullWidth size="lg" icon={<LogIn size={16} color={C.white} />} />
                  )}
                  {selected.status === 'InProgress' && (
                    <Button label="Check Out (End Job)" onPress={() => handleCheckOut(selected)} fullWidth size="lg" variant="outline" icon={<LogOutIcon size={16} color={C.accent} />} />
                  )}
                  <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                </View>
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
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  customer: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: C.textSecondary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  price: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  hint: { backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  hintText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  empty: { alignItems: 'center', paddingVertical: 60 },
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
  notesBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  notesLabel: { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  notesText: { fontSize: 13, color: C.textSecondary },
  actionBtns: { gap: 10 },
});
