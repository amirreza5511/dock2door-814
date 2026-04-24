import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, XCircle, ArrowRightLeft, Package, Star } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { WarehouseBooking, BookingStatus } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import BookingDocs from '@/components/BookingDocs';
import ReviewModal from '@/components/ReviewModal';

const STATUS_FILTERS: (BookingStatus | 'All')[] = ['All', 'Requested', 'Accepted', 'CounterOffered', 'Confirmed', 'InProgress', 'Completed', 'Cancelled'];

export default function WPBookings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const activeCompanyId = activeCompany?.companyId ?? user?.companyId ?? null;
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const invalidate = async () => {
    await utils.dock.bootstrap.invalidate();
    await utils.bookings.listMine.invalidate();
  };
  const acceptMutation = trpc.bookings.accept.useMutation({ onSuccess: invalidate });
  const declineMutation = trpc.bookings.decline.useMutation({ onSuccess: invalidate });
  const counterMutation = trpc.bookings.submitCounterOffer.useMutation({ onSuccess: invalidate });
  const completeMutation = trpc.bookings.complete.useMutation({ onSuccess: invalidate });
  const createRecordMutation = trpc.dock.createRecord.useMutation({ onSuccess: invalidate });
  const { warehouseListings, warehouseBookings, messages, companies } = bootstrapQuery.data;

  const [filter, setFilter] = useState<BookingStatus | 'All'>('All');
  const [selected, setSelected] = useState<WarehouseBooking | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [counterPrice, setCounterPrice] = useState('');
  const [responseNotes, setResponseNotes] = useState('');
  const [msgText, setMsgText] = useState('');
  const [reviewFor, setReviewFor] = useState<WarehouseBooking | null>(null);

  const myListingIds = useMemo(() => warehouseListings.filter((l) => l.companyId === activeCompanyId).map((l) => l.id), [warehouseListings, activeCompanyId]);
  const myBookings = useMemo(() => warehouseBookings.filter((b) => myListingIds.includes(b.listingId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [warehouseBookings, myListingIds]);

  const completedBookingIds = useMemo(() => warehouseBookings.filter((b) => b.status === 'Completed' && myListingIds.includes(b.listingId)).map((b) => b.id), [warehouseBookings, myListingIds]);
  const myReviewsQuery = trpc.reviews.listMineByContext.useQuery(
    { contextKind: 'warehouse_booking', contextIds: completedBookingIds },
    { enabled: completedBookingIds.length > 0 },
  );
  const reviewedBookingIds = useMemo(
    () => new Set(((myReviewsQuery.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)),
    [myReviewsQuery.data],
  );
  const filtered = useMemo(() => filter === 'All' ? myBookings : myBookings.filter((b) => b.status === filter), [myBookings, filter]);

  const bookingMessages = useMemo(() => selected ? messages.filter((m) => m.referenceType === 'WarehouseBooking' && m.referenceId === selected.id) : [], [messages, selected]);

  const getListingName = (id: string) => warehouseListings.find((l) => l.id === id)?.name ?? id;
  const getCustomerName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? companyId;

  const handleAccept = (b: WarehouseBooking) => {
    void acceptMutation.mutateAsync({ id: b.id, note: responseNotes || undefined })
      .then(() => { setDetailModal(false); setResponseNotes(''); })
      .catch((error: unknown) => {
        Alert.alert('Unable to accept booking', error instanceof Error ? error.message : 'Unknown error');
      });
  };

  const handleDecline = (b: WarehouseBooking) => {
    Alert.alert('Decline Booking', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => {
          void declineMutation.mutateAsync({ id: b.id, note: responseNotes || undefined })
            .then(() => { setDetailModal(false); })
            .catch((error: unknown) => {
              Alert.alert('Unable to decline booking', error instanceof Error ? error.message : 'Unknown error');
            });
        },
      },
    ]);
  };

  const handleCounterOffer = (b: WarehouseBooking) => {
    if (!counterPrice) {
      Alert.alert('Enter a counter offer price');
      return;
    }
    void counterMutation.mutateAsync({ id: b.id, amount: Number(counterPrice), message: responseNotes || undefined })
      .then(() => { setDetailModal(false); setCounterPrice(''); setResponseNotes(''); })
      .catch((error: unknown) => {
        Alert.alert('Unable to send counter offer', error instanceof Error ? error.message : 'Unknown error');
      });
  };

  const handleComplete = (b: WarehouseBooking) => {
    void completeMutation.mutateAsync({ id: b.id })
      .then(() => { setDetailModal(false); })
      .catch((error: unknown) => {
        Alert.alert('Unable to complete booking', error instanceof Error ? error.message : 'Unknown error');
      });
  };

  const sendMsg = () => {
    if (!msgText.trim() || !selected || !user) {
      return;
    }
    void createRecordMutation.mutateAsync({
      table: 'messages',
      payload: {
        referenceType: 'WarehouseBooking',
        referenceId: selected.id,
        senderUserId: user.id,
        text: msgText.trim(),
        createdAt: new Date().toISOString(),
      },
    }).then(() => {
      setMsgText('');
    }).catch((error: unknown) => {
      Alert.alert('Unable to send message', error instanceof Error ? error.message : 'Unknown error');
    });
  };

  const openDetail = (b: WarehouseBooking) => {
    setSelected(b);
    setResponseNotes(b.providerResponseNotes);
    setDetailModal(true);
  };

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading booking requests" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load booking requests" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Booking Requests</Text>
        <Text style={styles.sub}>{myBookings.length} total</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {STATUS_FILTERS.slice(0, 6).map((s) => (
          <TouchableOpacity key={s} onPress={() => setFilter(s)} style={[styles.chip, filter === s && styles.chipActive]}>
            <Text style={[styles.chipText, filter === s && styles.chipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 && <View style={styles.empty}><Text style={styles.emptyText}>No bookings in this category</Text></View>}
        {filtered.map((b) => (
          <TouchableOpacity key={b.id} onPress={() => openDetail(b)} activeOpacity={0.85}>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listingName}>{getListingName(b.listingId)}</Text>
                  <Text style={styles.customerName}>{getCustomerName(b.customerCompanyId)}</Text>
                </View>
                <StatusBadge status={b.status} />
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>{b.palletsRequested} pallets</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{b.startDate} → {b.endDate}</Text>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.price}>${b.finalPrice ?? b.counterOfferPrice ?? b.proposedPrice}</Text>
                {b.status === 'Requested' && (
                  <View style={styles.actionHint}>
                    <Text style={styles.actionHintText}>Tap to respond →</Text>
                  </View>
                )}
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
                  <Text style={styles.modalTitle}>{getListingName(selected.listingId)}</Text>
                  <StatusBadge status={selected.status} size="md" />
                </View>
                <Text style={styles.customerLabel}>{getCustomerName(selected.customerCompanyId)}</Text>

                <View style={styles.detailGrid}>
                  {[
                    ['Pallets', `${selected.palletsRequested}`],
                    ['Start', selected.startDate],
                    ['End', selected.endDate],
                    ['Handling', selected.handlingRequired ? 'Yes' : 'No'],
                    ['Proposed', `$${selected.proposedPrice.toLocaleString()}`],
                    ['Counter', selected.counterOfferPrice ? `$${selected.counterOfferPrice.toLocaleString()}` : '—'],
                    ['Final', selected.finalPrice ? `$${selected.finalPrice.toLocaleString()}` : '—'],
                    ['Payment', selected.paymentStatus],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {selected.customerNotes ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>Customer Notes</Text>
                    <Text style={styles.notesText}>{selected.customerNotes}</Text>
                  </View>
                ) : null}

                {selected.status === 'Requested' && (
                  <View style={styles.responseSection}>
                    <Text style={styles.responseSectionTitle}>Respond to Request</Text>
                    <Input label="Response Notes (optional)" value={responseNotes} onChangeText={setResponseNotes} multiline numberOfLines={3} placeholder="Add notes for the customer…" />
                    <View style={styles.responseBtns}>
                      <Button label="Accept" onPress={() => handleAccept(selected)} icon={<CheckCircle size={15} color={C.white} />} size="sm" />
                      <Button label="Decline" onPress={() => handleDecline(selected)} variant="danger" icon={<XCircle size={15} color={C.red} />} size="sm" />
                    </View>
                    <View style={styles.counterSection}>
                      <Input label="Counter Offer Price ($)" value={counterPrice} onChangeText={setCounterPrice} keyboardType="numeric" placeholder="e.g. 1800" />
                      <Button label="Send Counter Offer" onPress={() => handleCounterOffer(selected)} variant="outline" fullWidth icon={<ArrowRightLeft size={15} color={C.accent} />} />
                    </View>
                  </View>
                )}

                {selected.status === 'Confirmed' && (
                  <Button label="Mark as Completed" onPress={() => handleComplete(selected)} fullWidth size="lg" icon={<CheckCircle size={16} color={C.white} />} />
                )}

                {selected.status === 'Completed' && !reviewedBookingIds.has(selected.id) && (
                  <Button
                    label="Rate Customer"
                    onPress={() => { setDetailModal(false); setReviewFor(selected); }}
                    variant="outline"
                    fullWidth
                    icon={<Star size={15} color={C.accent} />}
                  />
                )}
                {selected.status === 'Completed' && reviewedBookingIds.has(selected.id) && (
                  <Text style={{ color: C.green, textAlign: 'center', fontSize: 13, fontWeight: '600' as const }}>You rated this customer</Text>
                )}

                {['Accepted', 'Confirmed', 'Scheduled', 'InProgress'].includes(selected.status) && (
                  <Button
                    label="Open Fulfillment"
                    onPress={() => { setDetailModal(false); router.push(`/fulfillment/${selected.id}` as never); }}
                    variant="outline"
                    fullWidth
                    icon={<Package size={15} color={C.accent} />}
                  />
                )}

                {activeCompanyId && (
                  <BookingDocs bookingId={selected.id} uploaderCompanyId={activeCompanyId} />
                )}

                {/* Messages */}
                <Text style={styles.msgTitle}>Messages</Text>
                <View style={styles.msgList}>
                  {bookingMessages.map((m) => (
                    <View key={m.id} style={[styles.msgBubble, m.senderUserId === user?.id && styles.msgBubbleMine]}>
                      <Text style={styles.msgText}>{m.text}</Text>
                      <Text style={styles.msgTime}>{m.createdAt.replace('T', ' ').slice(0, 16)}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.msgRow}>
                  <View style={{ flex: 1 }}><Input value={msgText} onChangeText={setMsgText} placeholder="Message…" /></View>
                  <Button label="Send" onPress={sendMsg} size="sm" disabled={!msgText.trim()} />
                </View>
                <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <ReviewModal
        visible={!!reviewFor}
        onClose={() => setReviewFor(null)}
        title="Rate this customer"
        subtitle={reviewFor ? getCustomerName(reviewFor.customerCompanyId) : undefined}
        contextKind="warehouse_booking"
        contextId={reviewFor?.id ?? ''}
        targetKind="company"
        targetCompanyId={reviewFor?.customerCompanyId ?? null}
      />
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
  listingName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  customerName: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  metaText: { fontSize: 12, color: C.textSecondary },
  metaDot: { color: C.textMuted },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  price: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  actionHint: { backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  actionHintText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 8 },
  customerLabel: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  notesBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  notesLabel: { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  notesText: { fontSize: 13, color: C.textSecondary },
  responseSection: { gap: 12, padding: 16, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  responseSectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  responseBtns: { flexDirection: 'row', gap: 10 },
  counterSection: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  msgTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  msgList: { gap: 8 },
  msgBubble: { backgroundColor: C.card, borderRadius: 12, padding: 10, alignSelf: 'flex-start', maxWidth: '80%', borderWidth: 1, borderColor: C.border },
  msgBubbleMine: { alignSelf: 'flex-end', backgroundColor: C.accentDim, borderColor: C.accent + '40' },
  msgText: { fontSize: 13, color: C.text },
  msgTime: { fontSize: 10, color: C.textMuted, marginTop: 4, textAlign: 'right' },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
});
