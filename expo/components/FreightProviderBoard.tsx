import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Modal, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Package, Send, X, FileText, Clock } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { FREIGHT_MODE_LABEL, type FreightMode } from '@/constants/globalFreight';
import { formatMoney } from '@/constants/world';
import ScreenFeedback from '@/components/ui/ScreenFeedback';

type BoardRow = {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_country: string; origin_city: string; origin_port: string;
  dest_country: string; dest_city: string; dest_port: string;
  weight: number; weight_unit: string; volume: number; pieces: number;
  commodity: string; declared_value: number; currency: string;
  delivery_method: string; needs_container_pickup: boolean;
  status: string; customer_name: string; doc_count: number;
  my_offer_amount: number | null; my_offer_currency: string | null; my_offer_status: string | null;
  offer_kind: string; created_at: string;
};

/** Provider board used by freight forwarders/carriers (kind='freight') and by
 *  trucking/drayage companies quoting the ground leg (kind='ground'). */
export default function FreightProviderBoard({ kind }: { kind: 'freight' | 'ground' }) {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<'open' | 'mine'>('open');
  const boardQuery = trpc.freight.board.useQuery({ scope });
  const rows = (boardQuery.data ?? []) as BoardRow[];
  const submitMutation = trpc.freight.submitOffer.useMutation();

  const [target, setTarget] = useState<BoardRow | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [transit, setTransit] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const openQuote = useCallback((row: BoardRow) => {
    setTarget(row);
    setAmount(row.my_offer_amount ? String(row.my_offer_amount) : '');
    setCurrency(row.my_offer_currency ?? row.currency ?? 'USD');
    setTransit('');
    setNote('');
  }, []);

  const submit = useCallback(async () => {
    if (!target) return;
    if (!(Number(amount) > 0)) { Alert.alert('Enter an amount', 'Quote amount must be greater than zero.'); return; }
    try {
      await submitMutation.mutateAsync({
        quoteId: target.id, amount: Number(amount), currency,
        transitDays: Number(transit) || 0, note: note.trim(),
      });
      setTarget(null);
      await Promise.all([
        utils.freight.board.invalidate(),
      ]);
    } catch (e) {
      Alert.alert('Could not submit quote', e instanceof Error ? e.message : 'Try again.');
    }
  }, [target, amount, currency, transit, note, submitMutation, utils]);

  const heading = kind === 'ground' ? 'Container pickup requests' : 'Open freight requests';

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {(['open', 'mine'] as const).map((s) => (
          <TouchableOpacity key={s} onPress={() => setScope(s)} style={[styles.tab, scope === s && styles.tabActive]}>
            <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === 'open' ? heading : 'My quotes'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {boardQuery.isLoading ? (
        <ScreenFeedback state="loading" title="Loading board" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={boardQuery.isRefetching} onRefresh={() => void boardQuery.refetch()} tintColor={C.textSecondary} />}
        >
          {rows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Package size={28} color={C.textMuted} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyDesc}>Approved requests will appear for you to quote.</Text>
            </View>
          ) : (
            rows.map((r) => {
              const pendingReview = r.status === 'PendingReview';
              const hasOffer = r.my_offer_amount != null;
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.ref}>{r.reference_code}</Text>
                    {pendingReview ? (
                      <View style={styles.reviewChip}><Clock size={12} color={C.yellow} /><Text style={styles.reviewChipText}>Pending review</Text></View>
                    ) : hasOffer ? (
                      <Text style={styles.offerBadge}>{r.my_offer_status === 'Accepted' ? 'Won' : 'Quoted'} · {formatMoney(r.my_offer_amount ?? 0, r.my_offer_currency)}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.customer}>{r.customer_name}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{FREIGHT_MODE_LABEL[r.freight_mode]}</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.meta}>{r.origin_city || r.origin_country} → {r.dest_city || r.dest_country}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{r.weight} {r.weight_unit} · {r.pieces} pcs{r.volume ? ` · ${r.volume} CBM` : ''}</Text>
                    {r.doc_count > 0 ? <><Text style={styles.metaDot}>·</Text><View style={styles.docChip}><FileText size={12} color={C.textSecondary} /><Text style={styles.meta}>{r.doc_count}</Text></View></> : null}
                  </View>
                  {r.commodity ? <Text style={styles.commodity} numberOfLines={1}>{r.commodity}</Text> : null}

                  {pendingReview ? (
                    <Text style={styles.disabledNote}>Quoting opens once an admin approves this request.</Text>
                  ) : (
                    <Button
                      label={hasOffer ? 'Update quote' : 'Send quote'}
                      onPress={() => openQuote(r)}
                      variant={hasOffer ? 'secondary' : 'primary'}
                      icon={<Send size={16} color={hasOffer ? C.text : C.white} />}
                    />
                  )}
                </View>
              );
            })
          )}
          <View style={{ height: insets.bottom + 20 }} />
        </ScrollView>
      )}

      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{kind === 'ground' ? 'Quote pickup leg' : 'Send a quote'}</Text>
              <TouchableOpacity onPress={() => setTarget(null)}><X size={22} color={C.text} /></TouchableOpacity>
            </View>
            <Text style={styles.modalDesc} numberOfLines={1}>{target?.title}</Text>
            <View style={styles.row}>
              <View style={{ flex: 2 }}><Input label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" /></View>
              <View style={{ flex: 1 }}><Input label="Currency" value={currency} onChangeText={setCurrency} autoCapitalize="characters" placeholder="USD" /></View>
            </View>
            <Input label="Transit days (optional)" value={transit} onChangeText={setTransit} keyboardType="numeric" placeholder="0" />
            <Input label="Note (optional)" value={note} onChangeText={setNote} placeholder="Routing, conditions, validity…" multiline numberOfLines={2} />
            {submitMutation.isPending ? (
              <View style={styles.submitLoading}><ActivityIndicator color={C.accent} /></View>
            ) : (
              <Button label="Submit quote" onPress={() => void submit()} icon={<Send size={16} color={C.white} />} fullWidth />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.blueDim, borderColor: C.blue },
  tabText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  tabTextActive: { color: C.blue },
  scroll: { gap: 12 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 30, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
  card: { gap: 6, padding: 16, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ref: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, letterSpacing: 0.5 },
  reviewChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.yellowDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  reviewChipText: { fontSize: 11, fontWeight: '700' as const, color: C.yellow },
  offerBadge: { fontSize: 12, fontWeight: '700' as const, color: C.green },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  customer: { fontSize: 13, color: C.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 13, color: C.textSecondary },
  metaDot: { fontSize: 13, color: C.textMuted },
  docChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  commodity: { fontSize: 13, color: C.textMuted, fontStyle: 'italic' },
  disabledNote: { fontSize: 12, color: C.yellow, marginTop: 6 },
  modalRoot: { flex: 1, backgroundColor: C.overlay, justifyContent: 'center', paddingHorizontal: 20 },
  modalCard: { backgroundColor: C.cardElevated, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalDesc: { fontSize: 13, color: C.textSecondary },
  row: { flexDirection: 'row', gap: 10 },
  submitLoading: { paddingVertical: 12, alignItems: 'center' },
});
