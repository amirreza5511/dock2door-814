import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform, Modal } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, Package, Ship, Zap, DollarSign, X, CheckCircle2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };

export default function DrayageBoardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<'open' | 'mine'>('open');
  const companyId = useAuthStore((s) => s.user?.companyId ?? null);

  const ordersQuery = trpc.drayage.listOrders.useQuery({ filter });
  const myQuotesQuery = trpc.drayage.myQuotes.useQuery(undefined, { refetchInterval: 30000 });
  const assignMutation = trpc.drayage.assignOrder.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.listOrders.invalidate();
      await utils.drayage.dashboard.invalidate();
    },
  });

  const [quoteOrder, setQuoteOrder] = useState<any | null>(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [quoteEta, setQuoteEta] = useState('');
  const [quoteMsg, setQuoteMsg] = useState('');
  const quoteMutation = trpc.drayage.submitQuote.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.myQuotes.invalidate();
      await utils.drayage.listOrders.invalidate();
      setQuoteOrder(null); setQuotePrice(''); setQuoteEta(''); setQuoteMsg('');
    },
  });

  const orders = useMemo(() => (ordersQuery.data ?? []) as any[], [ordersQuery.data]);
  const myQuotes = useMemo(() => (myQuotesQuery.data ?? []) as any[], [myQuotesQuery.data]);
  const quoteByOrder = useMemo(() => {
    const m: Record<string, any> = {};
    for (const q of myQuotes) m[q.order_id] = q;
    return m;
  }, [myQuotes]);

  const openQuoteSheet = (o: any) => {
    const existing = quoteByOrder[o.id];
    setQuotePrice(existing?.price ? String(existing.price) : '');
    setQuoteEta(existing?.eta_note ?? '');
    setQuoteMsg(existing?.message ?? '');
    setQuoteOrder(o);
  };

  const submitQuote = () => {
    if (!quoteOrder) return;
    const price = Number(quotePrice);
    if (!price || price <= 0) { Alert.alert('Price required', 'Enter your quoted price.'); return; }
    void quoteMutation
      .mutateAsync({ orderId: quoteOrder.id, price, etaNote: quoteEta.trim(), message: quoteMsg.trim() })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  };

  const claimOrder = (orderId: string, ref: string) => {
    Alert.alert(
      'Claim this order?',
      'You will be assigned to ' + ref + '. You can then dispatch drivers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Claim',
          onPress: () =>
            void assignMutation
              .mutateAsync({ orderId })
              .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown')),
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Drayage Orders Board</Text>
          <Text style={styles.headerSub}>
            {filter === 'open' ? 'Available to claim' : 'My assigned orders'}
          </Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          onPress={() => setFilter('open')}
          style={[styles.tab, filter === 'open' && styles.tabActive]}
        >
          <Zap size={14} color={filter === 'open' ? C.white : C.textMuted} />
          <Text style={[styles.tabText, filter === 'open' && styles.tabTextActive]}>Open</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFilter('mine')}
          style={[styles.tab, filter === 'mine' && styles.tabActive]}
        >
          <Package size={14} color={filter === 'mine' ? C.white : C.textMuted} />
          <Text style={[styles.tabText, filter === 'mine' && styles.tabTextActive]}>Mine</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={ordersQuery.isFetching}
            onRefresh={() => void ordersQuery.refetch()}
            tintColor={C.accent}
          />
        }
      >
        {ordersQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading orders" />
        ) : ordersQuery.isError ? (
          <ScreenFeedback
            state="error"
            title="Unable to load orders"
            onRetry={() => void ordersQuery.refetch()}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Ship}
            title={filter === 'open' ? 'No open orders' : 'No assigned orders'}
            description={
              filter === 'open'
                ? 'When forwarders post container orders, they appear here.'
                : 'Claim an open order to get started.'
            }
          />
        ) : (
          orders.map((o) => (
            <Card key={o.id} style={styles.orderCard}>
              <View style={styles.orderTop}>
                <View
                  style={[
                    styles.dirBadge,
                    { backgroundColor: (DIRECTION_COLOR[o.direction] ?? C.blue) + '20' },
                  ]}
                >
                  <Text
                    style={[styles.dirBadgeText, { color: DIRECTION_COLOR[o.direction] ?? C.blue }]}
                  >
                    {o.direction}
                  </Text>
                </View>
                <StatusBadge status={o.status} />
              </View>

              <Text style={styles.orderRef}>{o.reference_code}</Text>

              <View style={styles.infoGrid}>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Container</Text>
                  <Text style={styles.infoValue}>{o.container_number || 'TBD'}</Text>
                </View>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Size</Text>
                  <Text style={styles.infoValue}>{o.container_size}</Text>
                </View>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Weight</Text>
                  <Text style={styles.infoValue}>
                    {o.weight_kg ? o.weight_kg + 'kg' : '\u2014'}
                  </Text>
                </View>
              </View>

              {o.commodity ? <Text style={styles.commodity}>{o.commodity}</Text> : null}
              {o.bol_number ? (
                <Text style={styles.metaLine}>BOL: {o.bol_number}</Text>
              ) : null}
              {o.booking_number ? (
                <Text style={styles.metaLine}>Booking: {o.booking_number}</Text>
              ) : null}

              {o.port_reservation_date ? (
                <View style={styles.apptRow}>
                  <CalendarClock size={12} color={C.green} />
                  <Text style={styles.apptText}>
                    Port appt: {o.port_reservation_date} {o.port_reservation_time}
                  </Text>
                </View>
              ) : null}

              {o.is_prepull ? (
                <View style={styles.prepullBadge}>
                  <Text style={styles.prepullText}>
                    PREPULL — pickup {o.prepull_pickup_date ?? 'TBD'}
                  </Text>
                </View>
              ) : null}

              {o.is_hazmat || o.is_overweight || o.is_oversized ? (
                <View style={styles.flagsRow}>
                  {o.is_hazmat ? (
                    <Text style={[styles.flag, { color: C.red, backgroundColor: C.redDim }]}>
                      Hazmat
                    </Text>
                  ) : null}
                  {o.is_overweight ? (
                    <Text style={[styles.flag, { color: C.yellow, backgroundColor: C.yellowDim }]}>
                      Overweight
                    </Text>
                  ) : null}
                  {o.is_oversized ? (
                    <Text style={[styles.flag, { color: C.orange, backgroundColor: C.orangeDim }]}>
                      Oversized
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {o.target_drayage_company_id && companyId && o.target_drayage_company_id === companyId ? (
                <View style={styles.invitedBadge}>
                  <CheckCircle2 size={12} color={C.accent} />
                  <Text style={styles.invitedText}>Invited directly to you</Text>
                </View>
              ) : null}

              {o.status === 'Open' ? (
                <>
                  {quoteByOrder[o.id] ? (
                    <View style={styles.myQuoteRow}>
                      <DollarSign size={13} color={C.green} />
                      <Text style={styles.myQuoteText}>
                        Your quote: {quoteByOrder[o.id].currency} {quoteByOrder[o.id].price}
                        {quoteByOrder[o.id].status !== 'Pending' ? ` · ${quoteByOrder[o.id].status}` : ''}
                      </Text>
                    </View>
                  ) : null}
                  <Button
                    label={quoteByOrder[o.id] ? 'Update quote' : 'Send a quote'}
                    onPress={() => openQuoteSheet(o)}
                    fullWidth
                    size="md"
                    icon={<DollarSign size={16} color={C.white} />}
                  />
                  <Button
                    label="Claim instantly"
                    variant="ghost"
                    onPress={() => claimOrder(o.id, o.reference_code)}
                    loading={assignMutation.isPending}
                    fullWidth
                    size="sm"
                  />
                </>
              ) : (
                <Button
                  label="View details"
                  variant="ghost"
                  onPress={() =>
                    router.push({
                      pathname: '/drayage-company/[orderId]',
                      params: { orderId: o.id },
                    } as never)
                  }
                  fullWidth
                  size="md"
                />
              )}
            </Card>
          ))
        )}
      </ScrollView>

      {/* Quote submission sheet */}
      <Modal visible={quoteOrder !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setQuoteOrder(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Send a Quote</Text>
              {quoteOrder ? <Text style={styles.modalSub}>{quoteOrder.reference_code} · {quoteOrder.direction}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => setQuoteOrder(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Input label="Your price (CAD)" value={quotePrice} onChangeText={setQuotePrice} placeholder="e.g. 650" keyboardType="numeric" />
            <Input label="ETA / availability" value={quoteEta} onChangeText={setQuoteEta} placeholder="e.g. Pickup tomorrow AM, deliver same day" />
            <Input label="Message (optional)" value={quoteMsg} onChangeText={setQuoteMsg} placeholder="Anything the customer should know..." multiline numberOfLines={3} />
            <Button
              label="Submit quote"
              onPress={submitQuote}
              loading={quoteMutation.isPending}
              fullWidth
              size="lg"
              icon={<DollarSign size={16} color={C.white} />}
            />
            <Button label="Cancel" variant="ghost" onPress={() => setQuoteOrder(null)} fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabActive: { backgroundColor: C.accent, borderColor: C.accent },
  tabText: { fontSize: 13, fontWeight: '700' as const, color: C.textMuted },
  tabTextActive: { color: C.white },
  scroll: { paddingHorizontal: 20, gap: 12 },
  orderCard: { gap: 10 },
  orderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dirBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  dirBadgeText: { fontSize: 11, fontWeight: '800' as const },
  orderRef: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  infoGrid: { flexDirection: 'row', gap: 8 },
  infoCell: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10 },
  infoLabel: {
    fontSize: 10,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  infoValue: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 3 },
  commodity: { fontSize: 13, color: C.textSecondary },
  metaLine: { fontSize: 12, color: C.textMuted },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  prepullBadge: {
    backgroundColor: C.purpleDim,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  prepullText: { fontSize: 11, fontWeight: '700' as const, color: C.purple },
  flagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const },
  flag: {
    fontSize: 10,
    fontWeight: '700' as const,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden' as const,
  },
  invitedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  invitedText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  myQuoteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.greenDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  myQuoteText: { fontSize: 12, fontWeight: '700' as const, color: C.green },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
});
