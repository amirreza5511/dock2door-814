import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Alert, RefreshControl, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Ship, X, ChevronLeft, MapPin, Package, Anchor, Send, MessageCircle,
} from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'AED', 'CNY', 'GBP'] as const;

type BoardRow = {
  id: string; title: string; origin_country: string; origin_port: string;
  dest_country: string; dest_port: string; container_size: string; cargo_type: string;
  weight: number; weight_unit: string; ready_date: string | null; incoterms: string;
  currency: string; notes: string; status: string; customer_name: string;
  my_offer_amount: number | null; my_offer_status: string | null; awarded_amount: number;
  created_at: string;
};

type OceanMessage = { id: string; sender_name: string; body: string; created_at: string };

export default function ForwarderOceanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<'open' | 'mine'>('open');
  const boardQuery = trpc.ocean.board.useQuery({ scope });
  const rows = (boardQuery.data ?? []) as BoardRow[];
  const [offerRow, setOfferRow] = useState<BoardRow | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  const submitMutation = trpc.ocean.submitOffer.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.ocean.board.invalidate({ scope: 'open' }), utils.ocean.board.invalidate({ scope: 'mine' })]);
    },
  });

  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('CAD');
  const [transit, setTransit] = useState<string>('');
  const [sailing, setSailing] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const openOffer = useCallback((row: BoardRow) => {
    setAmount(row.my_offer_amount ? String(row.my_offer_amount) : '');
    setCurrency(row.currency || 'CAD');
    setTransit(''); setSailing(''); setNote('');
    setOfferRow(row);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!offerRow) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { Alert.alert('Invalid amount', 'Enter a quote greater than zero.'); return; }
    setSubmitting(true);
    try {
      await submitMutation.mutateAsync({
        requestId: offerRow.id, amount: amt, currency,
        transitDays: Number(transit) || 0, sailingDate: sailing || undefined, note,
      });
      setOfferRow(null);
      Alert.alert('Offer sent!', 'The customer will be notified of your quote.');
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to send offer.');
    } finally {
      setSubmitting(false);
    }
  }, [offerRow, amount, currency, transit, sailing, note, submitMutation]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Ocean Board</Text>
            <Text style={styles.headerSub}>Bid on container shipping requests</Text>
          </View>
        </View>
        <View style={styles.tabs}>
          {(['open', 'mine'] as const).map((s) => (
            <TouchableOpacity key={s} onPress={() => setScope(s)} style={[styles.tab, scope === s && styles.tabActive]}>
              <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === 'open' ? 'Open board' : 'My offers'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={boardQuery.isFetching} onRefresh={() => boardQuery.refetch()} tintColor={C.accent} />}
      >
        {boardQuery.isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <View style={styles.emptyState}>
            <Ship size={44} color={C.textMuted} />
            <Text style={styles.emptyText}>{scope === 'open' ? 'No open requests' : 'No offers yet'}</Text>
            <Text style={styles.emptySub}>{scope === 'open' ? 'New ocean freight requests will appear here.' : 'Requests you have quoted appear here.'}</Text>
          </View>
        ) : rows.map((r) => {
          const won = r.my_offer_status === 'Accepted';
          return (
            <View key={r.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.badge}>
                  <Ship size={13} color={C.blue} />
                  <Text style={styles.badgeText}>{r.container_size}</Text>
                </View>
                <StatusBadge status={r.status} />
              </View>
              <Text style={styles.cardName}>{r.title}</Text>
              <Text style={styles.customerName}>{r.customer_name}</Text>
              <View style={styles.routeRow}>
                <MapPin size={13} color={C.textMuted} />
                <Text style={styles.routeText} numberOfLines={1}>
                  {r.origin_port || r.origin_country || '—'} → {r.dest_port || r.dest_country || '—'}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <View style={styles.metaPill}><Package size={12} color={C.textSecondary} /><Text style={styles.metaText}>{r.weight} {r.weight_unit}</Text></View>
                {r.cargo_type ? <View style={styles.metaPill}><Text style={styles.metaText}>{r.cargo_type}</Text></View> : null}
              </View>
              {r.notes ? <Text style={styles.notes} numberOfLines={2}>{r.notes}</Text> : null}
              <View style={styles.cardActions}>
                {r.my_offer_amount ? (
                  <Text style={[styles.myOffer, won && { color: C.green }]}>
                    Your offer: {r.currency} {r.my_offer_amount}{r.my_offer_status ? ` · ${r.my_offer_status}` : ''}
                  </Text>
                ) : <View style={{ flex: 1 }} />}
                {won ? (
                  <Button label="Chat" size="sm" variant="secondary" onPress={() => setChatId(r.id)} />
                ) : r.status === 'Open' ? (
                  <Button label={r.my_offer_amount ? 'Update offer' : 'Send offer'} size="sm" onPress={() => openOffer(r)} />
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* OFFER MODAL */}
      <Modal visible={!!offerRow} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalTopBar}>
            <Text style={styles.modalTitle} numberOfLines={1}>Offer — {offerRow?.title}</Text>
            <TouchableOpacity onPress={() => setOfferRow(null)}><X size={24} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {offerRow && (
              <View style={styles.detailCard}>
                <View style={styles.routeRow}>
                  <Anchor size={14} color={C.blue} />
                  <Text style={styles.detailRoute}>{offerRow.origin_port || offerRow.origin_country} → {offerRow.dest_port || offerRow.dest_country}</Text>
                </View>
                <Text style={styles.detailNotes}>{offerRow.container_size} · {offerRow.weight} {offerRow.weight_unit}{offerRow.cargo_type ? ` · ${offerRow.cargo_type}` : ''}</Text>
              </View>
            )}
            <Input label="Quote amount *" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="3200" />
            <Text style={styles.fieldLabel}>Currency</Text>
            <View style={styles.chipRow}>
              {CURRENCIES.map((cur) => (
                <TouchableOpacity key={cur} onPress={() => setCurrency(cur)} style={[styles.chip, currency === cur && styles.chipActive]}>
                  <Text style={[styles.chipText, currency === cur && styles.chipTextActive]}>{cur}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><Input label="Transit (days)" value={transit} onChangeText={setTransit} keyboardType="numeric" placeholder="21" /></View>
              <View style={{ flex: 1 }}><Input label="Sailing date" value={sailing} onChangeText={setSailing} placeholder="2026-08-01" /></View>
            </View>
            <Input label="Note" value={note} onChangeText={setNote} multiline numberOfLines={3} placeholder="Direct sailing, includes THC…" />
            <Button label="Send offer" onPress={handleSubmit} loading={submitting} fullWidth size="lg" />
          </ScrollView>
        </View>
      </Modal>

      {chatId && <ForwarderChatModal requestId={chatId} onClose={() => setChatId(null)} />}
    </View>
  );
}

function ForwarderChatModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const messagesQuery = trpc.ocean.messages.useQuery({ requestId });
  const messages = (messagesQuery.data ?? []) as OceanMessage[];
  const sendMutation = trpc.ocean.sendMessage.useMutation({
    onSuccess: async () => { await utils.ocean.messages.invalidate({ requestId }); },
  });
  const [msg, setMsg] = useState<string>('');

  const handleSend = useCallback(async () => {
    if (!msg.trim()) return;
    const body = msg.trim();
    setMsg('');
    try { await sendMutation.mutateAsync({ requestId, body }); }
    catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to send.'); }
  }, [msg, requestId, sendMutation]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalTopBar}>
          <Text style={styles.modalTitle}><MessageCircle size={16} color={C.text} /> Chat</Text>
          <TouchableOpacity onPress={onClose}><X size={24} color={C.text} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <Text style={styles.emptySub}>No messages yet.</Text>
          ) : messages.map((m) => (
            <View key={m.id} style={styles.msgBubble}>
              <Text style={styles.msgSender}>{m.sender_name}</Text>
              <Text style={styles.msgBody}>{m.body}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={[styles.chatBar, { paddingBottom: insets.bottom + 8 }]}>
          <Input value={msg} onChangeText={setMsg} placeholder="Message customer…" containerStyle={{ flex: 1, marginBottom: 0 }} />
          <TouchableOpacity onPress={handleSend} style={styles.sendBtn}><Send size={18} color={C.bg} /></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  tabTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.blue + '20' },
  badgeText: { fontSize: 12, fontWeight: '700' as const, color: C.blue },
  cardName: { fontSize: 17, fontWeight: '700' as const, color: C.text },
  customerName: { fontSize: 13, color: C.textSecondary, marginBottom: 6 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  routeText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.bgSecondary },
  metaText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  notes: { fontSize: 13, color: C.textSecondary, marginBottom: 10, lineHeight: 18 },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  myOffer: { fontSize: 13, fontWeight: '700' as const, color: C.accent, flex: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 17, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 19 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text, flex: 1 },
  detailCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 8 },
  detailRoute: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  detailNotes: { fontSize: 13, color: C.textSecondary },
  row2: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: -4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  msgBubble: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  msgSender: { fontSize: 11, fontWeight: '700' as const, color: C.accent, marginBottom: 3 },
  msgBody: { fontSize: 14, color: C.text, lineHeight: 20 },
  chatBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bgSecondary },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});
