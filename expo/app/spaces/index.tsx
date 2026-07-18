import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Ruler, X, MapPin, CalendarClock, CheckCircle2, Percent } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface TierInfo { id: string; min_sqft: number; rate: number }
interface AddonInfo { id: string; name: string; pricing_unit: string; rate: number; required: boolean }
interface SpaceRow {
  id: string;
  name: string;
  space_kind: string;
  city: string;
  address: string;
  provider_name: string;
  total_sqft: number;
  available_sqft: number;
  min_sqft: number;
  max_sqft: number | null;
  base_rate_per_sqft_month: number;
  currency: string;
  min_term_months: number;
  term_discount_3m_pct: number;
  term_discount_6m_pct: number;
  term_discount_12m_pct: number;
  ceiling_height_ft: number | null;
  features: string[];
  notes: string;
  tiers: TierInfo[];
  addons: AddonInfo[];
}
interface QuoteResult {
  applied_rate: number;
  base_rate: number;
  tier_min_sqft: number | null;
  term_discount_pct: number;
  term_discount_label: string;
  space_monthly: number;
  addons: { id: string; name: string; monthly: number; one_time: number; required: boolean }[];
  monthly_total: number;
  one_time_total: number;
  contract_total: number;
  currency: string;
}
interface MyBooking {
  id: string;
  space_name: string;
  provider_name: string;
  sqft: number;
  term_months: number;
  start_date: string;
  monthly_total: number;
  contract_total: number;
  currency: string;
  status: string;
  months_billed: number;
}

const KIND_LABEL: Record<string, string> = {
  Floor: 'Floor storage', Rack: 'Racked', ClimateControlled: 'Climate controlled',
  Secured: 'Secured cage', Outdoor: 'Outdoor yard', Hazmat: 'Hazmat certified',
};
const STATUS_TINT: Record<string, string> = {
  Requested: C.yellow, Active: C.green, Declined: C.red, Cancelled: C.textMuted, Completed: C.blue,
};

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Shared flex-space marketplace: rent warehouse square footage with transparent pricing. */
export default function SpacesBrowseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const browseQuery = trpc.spaces.browse.useQuery(undefined, { refetchInterval: 30000 });
  const mineQuery = trpc.spaces.bookings.useQuery({ scope: 'customer' }, { refetchInterval: 20000 });
  const requestMutation = trpc.spaces.requestBooking.useMutation({
    onSuccess: () => {
      utils.spaces.bookings.invalidate();
      utils.spaces.browse.invalidate();
    },
  });
  const endMutation = trpc.spaces.endBooking.useMutation({ onSuccess: () => utils.spaces.bookings.invalidate() });

  const spaces = useMemo(() => (browseQuery.data as SpaceRow[] | undefined) ?? [], [browseQuery.data]);
  const myBookings = useMemo(() => (mineQuery.data as MyBooking[] | undefined) ?? [], [mineQuery.data]);

  // ── Booking modal state ──
  const [selected, setSelected] = useState<SpaceRow | null>(null);
  const [sqft, setSqft] = useState<string>('');
  const [term, setTerm] = useState<string>('1');
  const [startDate, setStartDate] = useState<string>(todayPlus(3));
  const [pickedAddons, setPickedAddons] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');

  const sqftNum = Number(sqft) || 0;
  const termNum = Number(term) || 0;
  const quoteEnabled = !!selected && sqftNum >= (selected?.min_sqft ?? 1) && sqftNum <= (selected?.available_sqft ?? 0) && termNum >= (selected?.min_term_months ?? 1);
  const quoteQuery = trpc.spaces.quote.useQuery(
    { spaceId: selected?.id ?? '', sqft: sqftNum, termMonths: termNum, addonIds: pickedAddons },
    { enabled: quoteEnabled },
  );
  const quote = quoteQuery.data as QuoteResult | undefined;

  const openBooking = (s: SpaceRow) => {
    setSelected(s);
    setSqft(String(s.min_sqft));
    setTerm(String(s.min_term_months));
    setStartDate(todayPlus(3));
    setPickedAddons(s.addons.filter((a) => a.required).map((a) => a.id));
    setNotes('');
  };

  const toggleAddon = (a: AddonInfo) => {
    if (a.required) return;
    setPickedAddons((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]));
  };

  const submit = async () => {
    if (!selected || !quoteEnabled) {
      Alert.alert('Check your numbers', 'Enter a footprint and term within this space\u2019s limits to get a price.');
      return;
    }
    try {
      await requestMutation.mutateAsync({
        spaceId: selected.id, sqft: sqftNum, termMonths: termNum,
        startDate, addonIds: pickedAddons, notes: notes.trim(),
      });
      setSelected(null);
      Alert.alert('Request sent', 'The warehouse will review your request. Once approved, the footprint is reserved and your first invoice is issued.');
    } catch (e) {
      Alert.alert('Could not send request', e instanceof Error ? e.message : 'Try again');
    }
  };

  const cancelPending = (b: MyBooking) => {
    Alert.alert('Withdraw request?', `Cancel your ${b.sqft} sqft request at ${b.space_name}?`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive',
        onPress: async () => {
          try { await endMutation.mutateAsync({ bookingId: b.id }); }
          catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Try again'); }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as never))} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Warehouse space</Text>
          <Text style={styles.subtitle}>Rent by the square foot — pay only for what you use</Text>
        </View>
        <SupportMenu />
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
        {/* My rentals */}
        {myBookings.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>My rentals</Text>
            {myBookings.map((b) => {
              const tint = STATUS_TINT[b.status] ?? C.textMuted;
              return (
                <Card key={b.id} style={styles.myCard}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.spaceName}>{b.space_name}</Text>
                      <Text style={styles.meta}>
                        {b.provider_name} · {Number(b.sqft).toLocaleString()} sqft · ${Number(b.monthly_total).toFixed(2)}/mo × {b.term_months} mo
                      </Text>
                    </View>
                    <View style={[styles.pill, { backgroundColor: tint + '22' }]}>
                      <Text style={[styles.pillText, { color: tint }]}>{b.status}</Text>
                    </View>
                  </View>
                  {b.status === 'Active' ? (
                    <Text style={styles.meta}>Billed {b.months_billed} of {b.term_months} months · from {b.start_date}</Text>
                  ) : null}
                  {b.status === 'Requested' ? (
                    <TouchableOpacity style={styles.withdrawBtn} onPress={() => cancelPending(b)} disabled={endMutation.isPending}>
                      <Text style={styles.withdrawText}>Withdraw request</Text>
                    </TouchableOpacity>
                  ) : null}
                </Card>
              );
            })}
          </>
        ) : null}

        {/* Browse */}
        <Text style={styles.sectionTitle}>Available spaces</Text>
        {browseQuery.isLoading ? (
          <View style={styles.centerPad}><ScreenFeedback state="loading" title="Finding spaces" /></View>
        ) : spaces.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ruler size={22} color={C.accent} />
            <Text style={styles.emptyTitle}>No spaces listed yet</Text>
            <Text style={styles.emptyMsg}>
              Warehouse providers publish square footage here — floor, racked, climate-controlled, secured and outdoor space. Check back soon.
            </Text>
          </Card>
        ) : (
          spaces.map((s) => (
            <Card key={s.id} style={styles.spaceCard}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.spaceName}>{s.name}</Text>
                  <Text style={styles.meta}>{s.provider_name}</Text>
                </View>
                <View style={styles.kindPill}>
                  <Text style={styles.kindPillText}>{KIND_LABEL[s.space_kind] ?? s.space_kind}</Text>
                </View>
              </View>

              {(s.city || s.address) ? (
                <View style={styles.metaRow}>
                  <MapPin size={12} color={C.textMuted} />
                  <Text style={styles.meta}>{[s.address, s.city].filter(Boolean).join(', ')}</Text>
                </View>
              ) : null}

              <View style={styles.priceRow}>
                <View>
                  <Text style={styles.priceValue}>${Number(s.base_rate_per_sqft_month).toFixed(2)}<Text style={styles.priceUnit}> /sqft/mo</Text></Text>
                  <Text style={styles.meta}>{Number(s.available_sqft).toLocaleString()} sqft available · min {Number(s.min_sqft).toLocaleString()}</Text>
                </View>
                <TouchableOpacity style={styles.quoteBtn} onPress={() => openBooking(s)}>
                  <Text style={styles.quoteBtnText}>Get a price</Text>
                </TouchableOpacity>
              </View>

              {(s.tiers.length > 0 || s.term_discount_3m_pct > 0 || s.term_discount_6m_pct > 0 || s.term_discount_12m_pct > 0) ? (
                <View style={styles.discountRow}>
                  <Percent size={12} color={C.green} />
                  <Text style={styles.discountText}>
                    {[
                      s.tiers.length > 0 ? `volume tiers from $${Math.min(...s.tiers.map((t) => Number(t.rate))).toFixed(2)}` : '',
                      s.term_discount_12m_pct > 0 ? `up to −${s.term_discount_12m_pct}% on 12-mo terms` : s.term_discount_6m_pct > 0 ? `−${s.term_discount_6m_pct}% on 6-mo terms` : s.term_discount_3m_pct > 0 ? `−${s.term_discount_3m_pct}% on 3-mo terms` : '',
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ) : null}

              {s.features.length > 0 ? (
                <View style={styles.featRow}>
                  {s.features.slice(0, 4).map((f) => (
                    <View key={f} style={styles.featChip}><Text style={styles.featChipText}>{f}</Text></View>
                  ))}
                </View>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>

      {/* Quote + booking modal */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{selected?.name}</Text>
                <Text style={styles.meta}>{selected?.provider_name} · {Number(selected?.available_sqft ?? 0).toLocaleString()} sqft available</Text>
              </View>
              <TouchableOpacity onPress={() => setSelected(null)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Square feet (min {Number(selected?.min_sqft ?? 0).toLocaleString()})</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={sqft} onChangeText={setSqft} placeholder="500" placeholderTextColor={C.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Term (months, min {selected?.min_term_months ?? 1})</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={term} onChangeText={setTerm} placeholder="3" placeholderTextColor={C.textMuted} />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Start date (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-08-01" placeholderTextColor={C.textMuted} />

              {(selected?.addons ?? []).length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Add-on services</Text>
                  {(selected?.addons ?? []).map((a) => {
                    const on = pickedAddons.includes(a.id);
                    return (
                      <TouchableOpacity key={a.id} style={[styles.addonRow, on && styles.addonRowOn]} onPress={() => toggleAddon(a)} disabled={a.required}>
                        <CheckCircle2 size={16} color={on ? C.accent : C.textMuted} />
                        <Text style={[styles.addonName, on && { color: C.text }]}>
                          {a.name}{a.required ? ' (required)' : ''}
                        </Text>
                        <Text style={styles.addonRate}>
                          ${Number(a.rate).toFixed(2)} {a.pricing_unit === 'per_sqft_month' ? '/sqft/mo' : a.pricing_unit === 'per_month' ? '/mo' : 'once'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : null}

              <Text style={styles.fieldLabel}>Notes for the warehouse</Text>
              <TextInput style={[styles.input, styles.inputMultiline]} value={notes} onChangeText={setNotes} multiline placeholder="What are you storing? Any handling needs?" placeholderTextColor={C.textMuted} />

              {/* Live quote breakdown */}
              <View style={styles.quoteBox}>
                {!quoteEnabled ? (
                  <Text style={styles.quoteHint}>
                    Enter at least {Number(selected?.min_sqft ?? 0).toLocaleString()} sqft (max {Number(selected?.available_sqft ?? 0).toLocaleString()}) and {selected?.min_term_months ?? 1}+ months to see your price.
                  </Text>
                ) : quoteQuery.isLoading ? (
                  <Text style={styles.quoteHint}>Calculating…</Text>
                ) : quoteQuery.error ? (
                  <Text style={[styles.quoteHint, { color: C.red }]}>{quoteQuery.error.message}</Text>
                ) : quote ? (
                  <>
                    <View style={styles.quoteLine}>
                      <Text style={styles.quoteLabel}>Rate</Text>
                      <Text style={styles.quoteValue}>
                        ${Number(quote.applied_rate).toFixed(2)}/sqft/mo
                        {quote.tier_min_sqft ? ` (volume tier ${Number(quote.tier_min_sqft).toLocaleString()}+)` : ''}
                      </Text>
                    </View>
                    {quote.term_discount_pct > 0 ? (
                      <View style={styles.quoteLine}>
                        <Text style={styles.quoteLabel}>{quote.term_discount_label}</Text>
                        <Text style={[styles.quoteValue, { color: C.green }]}>−{quote.term_discount_pct}%</Text>
                      </View>
                    ) : null}
                    <View style={styles.quoteLine}>
                      <Text style={styles.quoteLabel}>Space ({sqftNum.toLocaleString()} sqft)</Text>
                      <Text style={styles.quoteValue}>${Number(quote.space_monthly).toFixed(2)}/mo</Text>
                    </View>
                    {(quote.addons ?? []).map((a) => (
                      <View key={a.id} style={styles.quoteLine}>
                        <Text style={styles.quoteLabel}>{a.name}</Text>
                        <Text style={styles.quoteValue}>
                          {a.monthly > 0 ? `$${Number(a.monthly).toFixed(2)}/mo` : `$${Number(a.one_time).toFixed(2)} once`}
                        </Text>
                      </View>
                    ))}
                    <View style={[styles.quoteLine, styles.quoteTotalLine]}>
                      <Text style={styles.quoteTotalLabel}>Monthly total</Text>
                      <Text style={styles.quoteTotalValue}>${Number(quote.monthly_total).toFixed(2)} {quote.currency}</Text>
                    </View>
                    <View style={styles.quoteLine}>
                      <Text style={styles.quoteLabel}>Contract ({termNum} mo{Number(quote.one_time_total) > 0 ? ' + one-time' : ''})</Text>
                      <Text style={styles.quoteValue}>${Number(quote.contract_total).toFixed(2)} {quote.currency}</Text>
                    </View>
                  </>
                ) : null}
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, (!quoteEnabled || requestMutation.isPending) && { opacity: 0.5 }]}
                onPress={submit}
                disabled={!quoteEnabled || requestMutation.isPending}
              >
                <CalendarClock size={16} color={C.bg} />
                <Text style={styles.submitText}>{requestMutation.isPending ? 'Sending…' : 'Request this space'}</Text>
              </TouchableOpacity>
              <Text style={styles.finePrint}>
                The warehouse reviews your request. On approval the footprint is reserved and your first monthly invoice is issued — the price above is locked in.
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  list: { paddingHorizontal: 16 },
  centerPad: { paddingTop: 40, alignItems: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text, marginTop: 8, marginBottom: 10 },
  emptyCard: { padding: 20, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  myCard: { padding: 14, marginBottom: 10, gap: 8 },
  spaceCard: { padding: 14, marginBottom: 10, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  spaceName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  meta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11, fontWeight: '700' as const },
  kindPill: { backgroundColor: C.accentDim, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  kindPillText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  priceUnit: { fontSize: 12, fontWeight: '600' as const, color: C.textMuted },
  quoteBtn: { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  quoteBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.bg },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  discountText: { flex: 1, fontSize: 11, fontWeight: '600' as const, color: C.green },
  featRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  featChip: { backgroundColor: C.bgSecondary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  featChipText: { fontSize: 10, fontWeight: '600' as const, color: C.textSecondary },
  withdrawBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  withdrawText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '92%' as const },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: C.text },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' as const },
  twoCol: { flexDirection: 'row', gap: 10 },
  addonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  addonRowOn: { borderColor: C.accent, backgroundColor: C.accentDim },
  addonName: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  addonRate: { fontSize: 11, fontWeight: '700' as const, color: C.text },
  quoteBox: { backgroundColor: C.bgSecondary, borderRadius: 12, padding: 14, gap: 7, marginTop: 14 },
  quoteHint: { fontSize: 12, color: C.textMuted, textAlign: 'center' as const, lineHeight: 17 },
  quoteLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  quoteLabel: { flex: 1, fontSize: 12, color: C.textSecondary },
  quoteValue: { fontSize: 12, fontWeight: '600' as const, color: C.text },
  quoteTotalLine: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 7, marginTop: 2 },
  quoteTotalLabel: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  quoteTotalValue: { fontSize: 15, fontWeight: '800' as const, color: C.green },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, marginTop: 14 },
  submitText: { fontSize: 14, fontWeight: '800' as const, color: C.bg },
  finePrint: { fontSize: 10, color: C.textMuted, textAlign: 'center' as const, marginTop: 10, marginBottom: 6, lineHeight: 15 },
});
