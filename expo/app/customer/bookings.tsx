import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Warehouse, Wrench, AlertCircle, CheckCircle, Package, Star } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { WarehouseBooking } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import ReviewModal from '@/components/ReviewModal';
import type { ServiceJob } from '@/constants/types';

type TabType = 'Warehouse' | 'Services';

export default function CustomerBookings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const invalidate = async () => {
    await utils.dock.bootstrap.invalidate();
    await utils.bookings.listMine.invalidate();
  };
  const declineMutation = trpc.bookings.decline.useMutation({ onSuccess: invalidate });
  const respondCounterMutation = trpc.bookings.respondToCounterOffer.useMutation({ onSuccess: invalidate });
  const createRecordMutation = trpc.dock.createRecord.useMutation({ onSuccess: invalidate });
  const { warehouseBookings, serviceJobs, warehouseListings, serviceListings, companies, messages } = bootstrapQuery.data;

  const [tab, setTab] = useState<TabType>('Warehouse');
  const [selectedBooking, setSelectedBooking] = useState<WarehouseBooking | null>(null);
  const [msgText, setMsgText] = useState('');
  const [detailModal, setDetailModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{
    kind: 'warehouse_booking' | 'service_job';
    id: string;
    targetCompanyId: string;
    title: string;
  } | null>(null);

  const completedBookingIds = useMemo(() => warehouseBookings.filter((b) => b.status === 'Completed' && b.customerCompanyId === user?.companyId).map((b) => b.id), [warehouseBookings, user]);
  const completedJobIds = useMemo(() => serviceJobs.filter((j) => j.status === 'Completed' && j.customerCompanyId === user?.companyId).map((j) => j.id), [serviceJobs, user]);
  const myBookingReviewsQuery = trpc.reviews.listMineByContext.useQuery({ contextKind: 'warehouse_booking', contextIds: completedBookingIds }, { enabled: completedBookingIds.length > 0 });
  const myJobReviewsQuery = trpc.reviews.listMineByContext.useQuery({ contextKind: 'service_job', contextIds: completedJobIds }, { enabled: completedJobIds.length > 0 });
  const reviewedBookingIds = useMemo(() => new Set(((myBookingReviewsQuery.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)), [myBookingReviewsQuery.data]);
  const reviewedJobIds = useMemo(() => new Set(((myJobReviewsQuery.data as { contextId: string }[] | undefined) ?? []).map((r) => r.contextId)), [myJobReviewsQuery.data]);

  const getWarehouseCompanyId = (listingId: string) => warehouseListings.find((l) => l.id === listingId)?.companyId ?? null;
  const getServiceCompanyId = (serviceId: string) => serviceListings.find((l) => l.id === serviceId)?.companyId ?? null;

  const myBookings = useMemo(() => warehouseBookings.filter((b) => b.customerCompanyId === user?.companyId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [warehouseBookings, user]);
  const myJobs = useMemo(() => serviceJobs.filter((j) => j.customerCompanyId === user?.companyId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [serviceJobs, user]);

  const bookingMessages = useMemo(() => selectedBooking ? messages.filter((m) => m.referenceType === 'WarehouseBooking' && m.referenceId === selectedBooking.id) : [], [messages, selectedBooking]);

  const handleAcceptCounterOffer = (b: WarehouseBooking) => {
    const offerId = (b as unknown as { pendingCounterOfferId?: string }).pendingCounterOfferId;
    Alert.alert('Confirm Counter Offer', `Accept ${b.counterOfferPrice?.toLocaleString()} as the final price?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept',
        onPress: () => {
          if (!offerId) {
            Alert.alert('Unable to accept counter offer', 'Counter offer reference missing. Please reload.');
            return;
          }
          void respondCounterMutation.mutateAsync({ counterOfferId: offerId, action: 'accept' })
            .then(() => { setDetailModal(false); })
            .catch((error: unknown) => {
              Alert.alert('Unable to accept counter offer', error instanceof Error ? error.message : 'Unknown error');
            });
        },
      },
    ]);
  };

  const handleCancel = (id: string, type: 'booking' | 'job') => {
    Alert.alert('Cancel', 'Are you sure you want to cancel?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: () => {
          if (type === 'booking') {
            void declineMutation.mutateAsync({ id })
              .then(() => { setDetailModal(false); })
              .catch((error: unknown) => {
                Alert.alert('Unable to cancel booking', error instanceof Error ? error.message : 'Unknown error');
              });
          }
        },
      },
    ]);
  };

  const sendMessage = () => {
    if (!msgText.trim() || !selectedBooking || !user) {
      return;
    }
    void createRecordMutation.mutateAsync({
      table: 'messages',
      payload: {
        referenceType: 'WarehouseBooking',
        referenceId: selectedBooking.id,
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

  const getListingName = (listingId: string) => warehouseListings.find((l) => l.id === listingId)?.name ?? listingId;
  const getServiceName = (serviceId: string) => {
    const sl = serviceListings.find((l) => l.id === serviceId);
    return sl?.name ?? `Dock2Door Service ${serviceId.slice(0, 6)}`;
  };

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading bookings" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load bookings" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>My Bookings</Text>
        <View style={styles.tabs}>
          {(['Warehouse', 'Services'] as TabType[]).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {tab === 'Warehouse' && (
          myBookings.length === 0 ? (
            <View style={styles.empty}>
              <Warehouse size={40} color={C.textMuted} />
              <Text style={styles.emptyText}>No warehouse bookings yet</Text>
            </View>
          ) : myBookings.map((b) => (
            <TouchableOpacity key={b.id} onPress={() => { setSelectedBooking(b); setDetailModal(true); }} activeOpacity={0.85}>
              <Card style={styles.bookingCard}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.typeIcon, { backgroundColor: C.blueDim }]}>
                    <Warehouse size={16} color={C.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listingName}>{getListingName(b.listingId)}</Text>
                    <Text style={styles.bookingMeta}>{b.palletsRequested} pallets · {b.startDate} → {b.endDate}</Text>
                  </View>
                  <StatusBadge status={b.status} />
                </View>
                <View style={styles.cardBottom}>
                  <View>
                    <Text style={styles.priceLabel}>Price</Text>
                    <Text style={styles.priceValue}>${(b.finalPrice ?? b.counterOfferPrice ?? b.proposedPrice).toLocaleString()}</Text>
                  </View>
                  <StatusBadge status={b.paymentStatus} />
                </View>
                {b.status === 'CounterOffered' && (
                  <View style={styles.alertBanner}>
                    <AlertCircle size={14} color={C.accent} />
                    <Text style={styles.alertText}>Counter offer: ${b.counterOfferPrice?.toLocaleString()} — tap to review</Text>
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          ))
        )}

        {tab === 'Services' && (
          myJobs.length === 0 ? (
            <View style={styles.empty}>
              <Wrench size={40} color={C.textMuted} />
              <Text style={styles.emptyText}>No service jobs yet</Text>
            </View>
          ) : myJobs.map((j: ServiceJob) => (
            <Card key={j.id} style={styles.bookingCard}>
              <View style={styles.cardTopRow}>
                <View style={[styles.typeIcon, { backgroundColor: C.accentDim }]}>
                  <Wrench size={16} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listingName}>{getServiceName(j.serviceId)}</Text>
                  <Text style={styles.bookingMeta}>{j.locationCity} · {j.durationHours}h · {j.dateTimeStart.split('T')[0]}</Text>
                </View>
                <StatusBadge status={j.status} />
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.priceValue}>${j.totalPrice}</Text>
                <StatusBadge status={j.paymentStatus} />
              </View>
              {j.checkInTs && (
                <View style={styles.checkInRow}>
                  <CheckCircle size={13} color={C.green} />
                  <Text style={styles.checkInText}>Checked in {j.checkInTs.replace('T', ' ').slice(0, 16)}</Text>
                </View>
              )}
              {j.status === 'Completed' && !reviewedJobIds.has(j.id) && (() => {
                const spCoId = getServiceCompanyId(j.serviceId);
                if (!spCoId) return null;
                return (
                  <View style={{ marginTop: 8 }}>
                    <Button
                      label="Rate Service Provider"
                      onPress={() => setReviewTarget({ kind: 'service_job', id: j.id, targetCompanyId: spCoId, title: getServiceName(j.serviceId) })}
                      variant="outline"
                      size="sm"
                      icon={<Star size={13} color={C.accent} />}
                    />
                  </View>
                );
              })()}
              {j.status === 'Completed' && reviewedJobIds.has(j.id) && (
                <View style={styles.checkInRow}>
                  <Star size={13} color={C.yellow} fill={C.yellow} />
                  <Text style={styles.checkInText}>Reviewed</Text>
                </View>
              )}
            </Card>
          ))
        )}
      </ScrollView>

      {/* Booking Detail Modal */}
      <Modal visible={detailModal && !!selectedBooking} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selectedBooking && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>{getListingName(selectedBooking.listingId)}</Text>
                  <StatusBadge status={selectedBooking.status} size="md" />
                </View>

                <View style={styles.detailGrid}>
                  {[
                    ['Pallets', `${selectedBooking.palletsRequested}`],
                    ['Start Date', selectedBooking.startDate],
                    ['End Date', selectedBooking.endDate],
                    ['Handling', selectedBooking.handlingRequired ? 'Yes' : 'No'],
                    ['Proposed Price', `$${selectedBooking.proposedPrice.toLocaleString()}`],
                    ['Counter Offer', selectedBooking.counterOfferPrice ? `$${selectedBooking.counterOfferPrice.toLocaleString()}` : '—'],
                    ['Final Price', selectedBooking.finalPrice ? `$${selectedBooking.finalPrice.toLocaleString()}` : '—'],
                    ['Payment', selectedBooking.paymentStatus],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {selectedBooking.providerResponseNotes ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>Provider Notes</Text>
                    <Text style={styles.notesText}>{selectedBooking.providerResponseNotes}</Text>
                  </View>
                ) : null}

                {selectedBooking.status === 'CounterOffered' && (
                  <View style={styles.counterBox}>
                    <Text style={styles.counterTitle}>Counter Offer Received</Text>
                    <Text style={styles.counterPrice}>${selectedBooking.counterOfferPrice?.toLocaleString()}</Text>
                    <Button label="Accept Counter Offer" onPress={() => handleAcceptCounterOffer(selectedBooking)} fullWidth />
                  </View>
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
                <View style={styles.msgInputRow}>
                  <View style={{ flex: 1 }}>
                    <Input value={msgText} onChangeText={setMsgText} placeholder="Send a message…" />
                  </View>
                  <Button label="Send" onPress={sendMessage} size="sm" disabled={!msgText.trim()} />
                </View>

                <View style={styles.actionBtns}>
                  {['Accepted', 'Confirmed', 'Scheduled', 'InProgress'].includes(selectedBooking.status) && (
                    <Button
                      label="Open Fulfillment"
                      onPress={() => { setDetailModal(false); router.push(`/fulfillment/${selectedBooking.id}` as never); }}
                      fullWidth
                      icon={<Package size={15} color={C.white} />}
                    />
                  )}
                  {['Requested', 'CounterOffered'].includes(selectedBooking.status) && (
                    <Button label="Cancel Booking" onPress={() => handleCancel(selectedBooking.id, 'booking')} variant="danger" fullWidth />
                  )}
                  {selectedBooking.status === 'Completed' && !reviewedBookingIds.has(selectedBooking.id) && (() => {
                    const whCoId = getWarehouseCompanyId(selectedBooking.listingId);
                    if (!whCoId) return null;
                    return (
                      <Button
                        label="Rate Warehouse"
                        onPress={() => setReviewTarget({ kind: 'warehouse_booking', id: selectedBooking.id, targetCompanyId: whCoId, title: getListingName(selectedBooking.listingId) })}
                        variant="outline"
                        fullWidth
                        icon={<Star size={15} color={C.accent} />}
                      />
                    );
                  })()}
                  {selectedBooking.status === 'Completed' && reviewedBookingIds.has(selectedBooking.id) && (
                    <View style={styles.alertBanner}>
                      <CheckCircle size={14} color={C.green} />
                      <Text style={[styles.alertText, { color: C.green }]}>You rated this warehouse</Text>
                    </View>
                  )}
                  <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      <ReviewModal
        visible={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        title={reviewTarget?.kind === 'warehouse_booking' ? 'Rate this warehouse' : 'Rate this service provider'}
        subtitle={reviewTarget?.title}
        contextKind={reviewTarget?.kind ?? 'warehouse_booking'}
        contextId={reviewTarget?.id ?? ''}
        targetKind="company"
        targetCompanyId={reviewTarget?.targetCompanyId ?? null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 0, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 12 },
  tabs: { flexDirection: 'row', gap: 0 },
  tab: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.accent },
  tabText: { fontSize: 14, color: C.textMuted, fontWeight: '600' as const },
  tabTextActive: { color: C.accent },
  list: { padding: 16, gap: 10 },
  bookingCard: { marginBottom: 0 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  typeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listingName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  bookingMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  priceLabel: { fontSize: 11, color: C.textMuted },
  priceValue: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.accentDim, borderRadius: 8, padding: 8 },
  alertText: { fontSize: 12, color: C.accent, flex: 1 },
  checkInRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  checkInText: { fontSize: 12, color: C.green },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '600' as const },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalBody: { padding: 20, gap: 12 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 10 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  notesBox: { backgroundColor: C.card, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  notesLabel: { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  notesText: { fontSize: 13, color: C.textSecondary },
  counterBox: { backgroundColor: C.accentDim, borderRadius: 12, padding: 16, gap: 8, borderWidth: 1, borderColor: C.accent + '40' },
  counterTitle: { fontSize: 14, color: C.accent, fontWeight: '700' as const },
  counterPrice: { fontSize: 28, fontWeight: '800' as const, color: C.text },
  msgTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginTop: 4 },
  msgList: { gap: 8, minHeight: 20 },
  msgBubble: { backgroundColor: C.card, borderRadius: 12, padding: 10, alignSelf: 'flex-start', maxWidth: '80%', borderWidth: 1, borderColor: C.border },
  msgBubbleMine: { alignSelf: 'flex-end', backgroundColor: C.accentDim, borderColor: C.accent + '40' },
  msgText: { fontSize: 13, color: C.text },
  msgTime: { fontSize: 10, color: C.textMuted, marginTop: 4, textAlign: 'right' },
  msgInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  actionBtns: { gap: 8, marginTop: 8 },
});
