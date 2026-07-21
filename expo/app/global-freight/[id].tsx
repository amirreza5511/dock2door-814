import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, FileText, Check, Truck, Ship, Send, MessageCircle, XCircle } from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import {
  FREIGHT_STATUS_META, FREIGHT_MODE_LABEL, DELIVERY_METHOD_LABEL,
  freightRoleKind, type FreightQuoteStatus, type FreightMode, type DeliveryMethod,
} from '@/constants/globalFreight';
import { formatMoney } from '@/constants/world';
import ScreenFeedback from '@/components/ui/ScreenFeedback';

const TONE_COLOR: Record<'warning' | 'info' | 'success' | 'danger' | 'neutral', string> = {
  warning: C.yellow, info: C.blue, success: C.green, danger: C.red, neutral: C.textMuted,
};

type Offer = {
  id: string; provider_name: string; offer_kind: string; amount: number; currency: string;
  transit_days: number; valid_until: string | null; note: string; status: string; created_at: string;
};
type Msg = { id: string; sender_name: string; body: string; created_at: string };

export default function FreightRequestDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const quoteId = String(id);
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();

  const kind = useMemo(() => freightRoleKind(user?.role), [user?.role]);
  const isCustomer = kind === 'customer';

  const quoteQuery = trpc.freight.get.useQuery({ quoteId }, { enabled: !!quoteId });
  const docsQuery = trpc.freight.documents.useQuery({ quoteId }, { enabled: !!quoteId });
  const offersQuery = trpc.freight.offers.useQuery({ quoteId }, { enabled: !!quoteId });
  const messagesQuery = trpc.freight.messages.useQuery({ quoteId }, { enabled: !!quoteId });

  const q = quoteQuery.data as any;
  const docs = (docsQuery.data ?? []) as { id: string; file_path: string; file_name: string; doc_type: string }[];
  const offers = (offersQuery.data ?? []) as Offer[];
  const messages = (messagesQuery.data ?? []) as Msg[];

  const acceptMutation = trpc.freight.acceptOffer.useMutation();
  const cancelMutation = trpc.freight.cancel.useMutation();
  const sendMutation = trpc.freight.sendMessage.useMutation();

  const [draft, setDraft] = useState<string>('');

  const freightOffers = useMemo(() => offers.filter((o) => o.offer_kind === 'freight'), [offers]);
  const groundOffers = useMemo(() => offers.filter((o) => o.offer_kind === 'ground'), [offers]);
  const statusMeta = q ? FREIGHT_STATUS_META[q.status as FreightQuoteStatus] : null;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      utils.freight.get.invalidate({ quoteId }),
      utils.freight.offers.invalidate({ quoteId }),
      utils.freight.mine.invalidate(),
    ]);
  }, [utils, quoteId]);

  const accept = useCallback(async (offerId: string) => {
    try {
      await acceptMutation.mutateAsync({ offerId });
      await refreshAll();
    } catch (e) {
      Alert.alert('Could not accept', e instanceof Error ? e.message : 'Try again.');
    }
  }, [acceptMutation, refreshAll]);

  const cancel = useCallback(() => {
    Alert.alert('Cancel request', 'This closes the request for all providers. Continue?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel request', style: 'destructive', onPress: async () => {
          try { await cancelMutation.mutateAsync({ quoteId }); await refreshAll(); }
          catch (e) { Alert.alert('Could not cancel', e instanceof Error ? e.message : 'Try again.'); }
        },
      },
    ]);
  }, [cancelMutation, quoteId, refreshAll]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await sendMutation.mutateAsync({ quoteId, body });
      await utils.freight.messages.invalidate({ quoteId });
    } catch (e) {
      Alert.alert('Message failed', e instanceof Error ? e.message : 'Try again.');
    }
  }, [draft, sendMutation, quoteId, utils]);

  const canChat = q && (q.awarded_company_id || q.ground_awarded_company_id);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={24} color={C.text} /></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{q?.reference_code ?? 'Request'}</Text>
      </View>

      {quoteQuery.isLoading ? (
        <ScreenFeedback state="loading" title="Loading request" />
      ) : !q ? (
        <ScreenFeedback state="error" title="Request not found" />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
            refreshControl={<RefreshControl refreshing={quoteQuery.isRefetching} onRefresh={() => void refreshAll()} tintColor={C.textSecondary} />}
          >
            <View style={styles.topRow}>
              <Text style={styles.title}>{q.title}</Text>
              {statusMeta ? (
                <View style={[styles.pill, { backgroundColor: TONE_COLOR[statusMeta.tone] + '22', borderColor: TONE_COLOR[statusMeta.tone] }]}>
                  <Text style={[styles.pillText, { color: TONE_COLOR[statusMeta.tone] }]}>{statusMeta.label}</Text>
                </View>
              ) : null}
            </View>

            {q.status === 'Rejected' && q.rejected_reason ? (
              <View style={styles.rejectCard}><Text style={styles.rejectText}>Rejected: {q.rejected_reason}</Text></View>
            ) : null}

            <View style={styles.card}>
              <Row label="Mode" value={FREIGHT_MODE_LABEL[q.freight_mode as FreightMode]} />
              <Row label="From" value={`${q.origin_city || q.origin_country}${q.origin_port ? ` (${q.origin_port})` : ''}`} />
              <Row label="To" value={`${q.dest_city || q.dest_country}${q.dest_port ? ` (${q.dest_port})` : ''}`} />
              {q.dest_hub_city ? <Row label="Destination hub" value={`${q.dest_hub_city}${q.dest_hub_is_member ? ' · Partner' : ''}`} /> : null}
              <Row label="Weight" value={`${q.weight} ${q.weight_unit}${q.volume ? ` · ${q.volume} CBM` : ''}`} />
              <Row label="Pieces" value={String(q.pieces)} />
              {q.commodity ? <Row label="Commodity" value={q.commodity} /> : null}
              {q.declared_value ? <Row label="Declared value" value={formatMoney(q.declared_value, q.currency)} /> : null}
              <Row label="Delivery" value={DELIVERY_METHOD_LABEL[q.delivery_method as DeliveryMethod]} />
              {q.needs_container_pickup ? <Row label="Ground leg" value="Container pickup / drayage requested" /> : null}
            </View>

            {/* Documents */}
            <Text style={styles.sectionTitle}>Documents ({docs.length})</Text>
            {docs.length === 0 ? (
              <Text style={styles.empty}>No documents attached.</Text>
            ) : (
              docs.map((d) => (
                <View key={d.id} style={styles.docRow}>
                  <FileText size={18} color={C.blue} />
                  <Text style={styles.docName} numberOfLines={1}>{d.file_name || d.doc_type}</Text>
                </View>
              ))
            )}

            {/* Freight offers */}
            <View style={styles.sectionHead}>
              <Ship size={16} color={C.blue} />
              <Text style={styles.sectionTitle}>Freight quotes ({freightOffers.length})</Text>
            </View>
            {freightOffers.length === 0 ? (
              <Text style={styles.empty}>No freight quotes yet.</Text>
            ) : (
              freightOffers.map((o) => (
                <OfferCard key={o.id} offer={o} canAccept={isCustomer && q.status !== 'Accepted' && q.status !== 'Cancelled' && o.status === 'Pending'} onAccept={() => accept(o.id)} accepting={acceptMutation.isPending} />
              ))
            )}

            {/* Ground offers */}
            {q.needs_container_pickup ? (
              <>
                <View style={styles.sectionHead}>
                  <Truck size={16} color={C.green} />
                  <Text style={styles.sectionTitle}>Container pickup quotes ({groundOffers.length})</Text>
                </View>
                {groundOffers.length === 0 ? (
                  <Text style={styles.empty}>No pickup quotes yet.</Text>
                ) : (
                  groundOffers.map((o) => (
                    <OfferCard key={o.id} offer={o} canAccept={isCustomer && !q.ground_awarded_company_id && q.status !== 'Cancelled' && o.status === 'Pending'} onAccept={() => accept(o.id)} accepting={acceptMutation.isPending} />
                  ))
                )}
              </>
            ) : null}

            {/* Chat */}
            {canChat ? (
              <>
                <View style={styles.sectionHead}>
                  <MessageCircle size={16} color={C.blue} />
                  <Text style={styles.sectionTitle}>Messages</Text>
                </View>
                {messages.length === 0 ? (
                  <Text style={styles.empty}>No messages yet. Start the conversation.</Text>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_name === user?.name;
                    return (
                      <View key={m.id} style={[styles.msgBubble, mine ? styles.msgMine : styles.msgTheirs]}>
                        {!mine ? <Text style={styles.msgSender}>{m.sender_name}</Text> : null}
                        <Text style={styles.msgBody}>{m.body}</Text>
                      </View>
                    );
                  })
                )}
                <View style={styles.composer}>
                  <TextInput
                    style={styles.composerInput}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Type a message…"
                    placeholderTextColor={C.textMuted}
                    multiline
                  />
                  <TouchableOpacity style={styles.sendBtn} onPress={() => void send()} disabled={sendMutation.isPending}>
                    {sendMutation.isPending ? <ActivityIndicator color={C.white} size="small" /> : <Send size={18} color={C.white} />}
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {/* Cancel */}
            {isCustomer && ['PendingReview', 'Open', 'Quoted'].includes(q.status) ? (
              <TouchableOpacity style={styles.cancelBtn} onPress={cancel}>
                <XCircle size={16} color={C.red} />
                <Text style={styles.cancelText}>Cancel request</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function OfferCard({ offer, canAccept, onAccept, accepting }: { offer: Offer; canAccept: boolean; onAccept: () => void; accepting: boolean }) {
  const won = offer.status === 'Accepted';
  return (
    <View style={[styles.offerCard, won && styles.offerCardWon]}>
      <View style={styles.offerTop}>
        <Text style={styles.offerProvider}>{offer.provider_name}</Text>
        <Text style={styles.offerAmount}>{formatMoney(offer.amount, offer.currency)}</Text>
      </View>
      <View style={styles.offerMetaRow}>
        {offer.transit_days > 0 ? <Text style={styles.offerMeta}>{offer.transit_days} days transit</Text> : null}
        {won ? <View style={styles.wonChip}><Check size={12} color={C.white} /><Text style={styles.wonChipText}>Accepted</Text></View> : null}
      </View>
      {offer.note ? <Text style={styles.offerNote}>{offer.note}</Text> : null}
      {canAccept ? (
        <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} disabled={accepting}>
          {accepting ? <ActivityIndicator color={C.white} size="small" /> : <><Check size={16} color={C.white} /><Text style={styles.acceptText}>Accept</Text></>}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text, flex: 1 },
  scroll: { padding: 20, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text, flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' as const },
  rejectCard: { padding: 14, borderRadius: 12, backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red },
  rejectText: { fontSize: 13, color: C.red },
  card: { padding: 16, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  rowLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  rowValue: { fontSize: 14, color: C.text, fontWeight: '600' as const, flex: 1, textAlign: 'right' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  empty: { fontSize: 13, color: C.textMuted },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  docName: { fontSize: 14, color: C.text, flex: 1 },
  offerCard: { padding: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, gap: 8 },
  offerCardWon: { borderColor: C.green, backgroundColor: C.greenDim },
  offerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offerProvider: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  offerAmount: { fontSize: 16, fontWeight: '800' as const, color: C.blue },
  offerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offerMeta: { fontSize: 13, color: C.textSecondary },
  wonChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  wonChipText: { fontSize: 11, fontWeight: '700' as const, color: C.white },
  offerNote: { fontSize: 13, color: C.textSecondary },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.green, paddingVertical: 11, borderRadius: 10 },
  acceptText: { fontSize: 14, fontWeight: '700' as const, color: C.white },
  msgBubble: { maxWidth: '85%', padding: 12, borderRadius: 14 },
  msgMine: { alignSelf: 'flex-end', backgroundColor: C.blueDim, borderWidth: 1, borderColor: C.blue },
  msgTheirs: { alignSelf: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  msgSender: { fontSize: 11, fontWeight: '700' as const, color: C.textSecondary, marginBottom: 3 },
  msgBody: { fontSize: 14, color: C.text, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  composerInput: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: C.text, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red, marginTop: 8 },
  cancelText: { fontSize: 14, fontWeight: '700' as const, color: C.red },
});
