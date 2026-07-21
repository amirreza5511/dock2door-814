import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Box, Check, Zap, Truck, Store, Home, Package, BadgeCheck,
} from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useActionGuard } from '@/store/explore';
import { usePreferences } from '@/store/preferences';
import {
  PRESET_BOXES, SERVICE_LEVELS, deriveCourierQuotes, FX_FROM_CAD,
  type CourierQuote,
} from '@/constants/couriers';

type ServiceLevel = 'regular' | 'expedited' | 'xpresspost' | 'priority';
type Fulfillment = 'dropoff' | 'pickup_carrier' | 'pickup_network';

export default function ShipQuote() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const guard = useActionGuard();
  const currency = usePreferences((s) => s.currency);

  // Parcel
  const [preset, setPreset] = useState<string>('small');
  const [length, setLength] = useState<string>('25');
  const [width, setWidth] = useState<string>('20');
  const [height, setHeight] = useState<string>('15');
  const [weight, setWeight] = useState<string>('1');
  const [service, setService] = useState<ServiceLevel>('regular');

  // Quotes
  const [quotes, setQuotes] = useState<CourierQuote[] | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // Recipient + fulfillment
  const [toName, setToName] = useState<string>('');
  const [toLine1, setToLine1] = useState<string>('');
  const [toCity, setToCity] = useState<string>('');
  const [toPostal, setToPostal] = useState<string>('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('dropoff');

  const quoteMut = trpc.parcel.quote.useMutation();
  const createMut = trpc.parcel.create.useMutation();
  const carriersQuery = trpc.carriers.list.useQuery(undefined, { retry: false });

  const activeCodes = useMemo(() => {
    const set = new Set<string>();
    const rows = (carriersQuery.data as { carrier_code?: string; is_active?: boolean }[] | undefined) ?? [];
    rows.forEach((r) => { if (r.is_active && r.carrier_code) set.add(r.carrier_code); });
    return set;
  }, [carriersQuery.data]);

  const fx = FX_FROM_CAD[currency] ?? 1;
  const curSymbol = currency;

  const applyPreset = (key: string) => {
    const box = PRESET_BOXES.find((b) => b.key === key);
    if (!box) return;
    setPreset(key);
    setLength(String(box.l));
    setWidth(String(box.w));
    setHeight(String(box.h));
    setWeight(String(box.kg));
    setQuotes(null);
    setSelectedCode(null);
  };

  const getQuotes = async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await quoteMut.mutateAsync({
        length: Number(length) || 0,
        width: Number(width) || 0,
        height: Number(height) || 0,
        dimUnit: 'cm',
        weight: Number(weight) || 0,
        weightUnit: 'kg',
        service,
        currency: 'CAD',
      });
      const baseCad = Number((res as { price?: number } | null)?.price ?? 0);
      const derived = deriveCourierQuotes(baseCad, activeCodes, fx, currency);
      setQuotes(derived);
      setSelectedCode(derived[0]?.courier.code ?? null);
    } catch {
      setQuotes([]);
    }
  };

  const fastest = useMemo(() => {
    if (!quotes || quotes.length === 0) return null;
    return [...quotes].sort((a, b) => a.courier.speedRank - b.courier.speedRank)[0]?.courier.code ?? null;
  }, [quotes]);

  const selected = quotes?.find((q) => q.courier.code === selectedCode) ?? null;

  const canCreate = Boolean(selected && toName.trim() && toCity.trim());

  const createLabel = async () => {
    if (!selected) return;
    if (!guard('Create a shipping label')) return; // gated in explore mode
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const fulfilLabel =
      fulfillment === 'dropoff' ? 'Drop-off at counter'
      : fulfillment === 'pickup_carrier' ? 'Carrier pickup requested'
      : 'Network pickup requested';
    try {
      const res = await createMut.mutateAsync({
        toName: toName.trim(),
        toLine1: toLine1.trim(),
        toCity: toCity.trim(),
        toPostal: toPostal.trim(),
        length: Number(length) || 0,
        width: Number(width) || 0,
        height: Number(height) || 0,
        dimUnit: 'cm',
        weight: Number(weight) || 0,
        weightUnit: 'kg',
        service,
        currency,
        notes: `Courier: ${selected.courier.name} · ${fulfilLabel} · Est ${curSymbol} ${selected.price.toFixed(2)}`,
      });
      const id = (res as { id?: string } | null)?.id;
      if (id) router.replace(`/ship/label?id=${id}` as never);
    } catch {
      // parcel_create surfaces its own error; keep the user on the form.
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send a parcel</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Preset boxes */}
        <Text style={styles.sectionLabel}>PICK A SIZE</Text>
        <View style={styles.presetGrid}>
          {PRESET_BOXES.map((b) => {
            const on = preset === b.key;
            return (
              <TouchableOpacity
                key={b.key}
                style={[styles.presetCard, on && styles.presetCardOn]}
                activeOpacity={0.85}
                onPress={() => applyPreset(b.key)}
              >
                <Box size={18} color={on ? C.accent : C.textSecondary} />
                <Text style={[styles.presetLabel, on && { color: C.text }]}>{b.label}</Text>
                <Text style={styles.presetSub}>{b.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom dims */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>OR ENTER EXACT SIZE (CM · KG)</Text>
        <View style={styles.dimRow}>
          <View style={{ flex: 1 }}><Input label="Length" value={length} onChangeText={(t) => { setLength(t); setPreset(''); }} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input label="Width" value={width} onChangeText={(t) => { setWidth(t); setPreset(''); }} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input label="Height" value={height} onChangeText={(t) => { setHeight(t); setPreset(''); }} keyboardType="numeric" /></View>
        </View>
        <View style={{ marginTop: 10 }}>
          <Input label="Weight (kg)" value={weight} onChangeText={(t) => { setWeight(t); setPreset(''); }} keyboardType="numeric" />
        </View>

        {/* Service */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>SPEED</Text>
        <View style={styles.serviceRow}>
          {SERVICE_LEVELS.map((s) => {
            const on = service === s.value;
            return (
              <TouchableOpacity
                key={s.value}
                style={[styles.serviceChip, on && styles.serviceChipOn]}
                activeOpacity={0.85}
                onPress={() => { setService(s.value); setQuotes(null); setSelectedCode(null); }}
              >
                <Text style={[styles.serviceLabel, on && { color: C.white }]}>{s.label}</Text>
                <Text style={[styles.serviceSub, on && { color: '#FFFFFFCC' }]}>{s.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginTop: 20 }}>
          <Button
            label={quoteMut.isPending ? 'Getting prices…' : quotes ? 'Refresh prices' : 'Compare couriers'}
            onPress={getQuotes}
            loading={quoteMut.isPending}
            fullWidth
            icon={<Zap size={16} color={C.white} />}
            testID="ship-get-quotes"
          />
        </View>

        {/* Courier comparison */}
        {quotes && quotes.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>CHOOSE A COURIER</Text>
            {quotes.map((q, i) => {
              const on = q.courier.code === selectedCode;
              const cheapest = i === 0;
              return (
                <TouchableOpacity
                  key={q.courier.code}
                  style={[styles.courierCard, on && { borderColor: q.courier.color, borderWidth: 2 }]}
                  activeOpacity={0.85}
                  onPress={() => setSelectedCode(q.courier.code)}
                  testID={`courier-${q.courier.code}`}
                >
                  <View style={[styles.courierBadge, { backgroundColor: q.courier.color }]}>
                    <Text style={styles.courierBadgeText}>{q.courier.short}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.courierNameRow}>
                      <Text style={styles.courierName}>{q.courier.name}</Text>
                      {q.isLive ? (
                        <View style={styles.liveTag}><BadgeCheck size={11} color={C.green} /><Text style={styles.liveText}>Live</Text></View>
                      ) : (
                        <Text style={styles.estTag}>Est.</Text>
                      )}
                    </View>
                    <View style={styles.tagRow}>
                      {cheapest ? <Text style={[styles.miniTag, { color: C.green }]}>Cheapest</Text> : null}
                      {fastest === q.courier.code ? <Text style={[styles.miniTag, { color: C.yellow }]}>Fastest</Text> : null}
                      <Text style={styles.etaText}>{q.etaLabel}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.price}>{curSymbol} {q.price.toFixed(2)}</Text>
                    {on ? <Check size={16} color={q.courier.color} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            {quotes.some((q) => !q.isLive) ? (
              <Text style={styles.estNote}>
                Prices marked “Est.” are estimates. Connect a courier account to get live rates and buy real labels.
              </Text>
            ) : null}

            {/* Recipient */}
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>SHIP TO</Text>
            <View style={{ gap: 10 }}>
              <Input label="Recipient name" value={toName} onChangeText={setToName} placeholder="Jane Doe" />
              <Input label="Address" value={toLine1} onChangeText={setToLine1} placeholder="123 Main St" />
              <View style={styles.dimRow}>
                <View style={{ flex: 2 }}><Input label="City" value={toCity} onChangeText={setToCity} placeholder="Vancouver" /></View>
                <View style={{ flex: 1 }}><Input label="Postal" value={toPostal} onChangeText={setToPostal} placeholder="V6B" autoCapitalize="characters" /></View>
              </View>
            </View>

            {/* Fulfillment */}
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>DROP-OFF OR PICKUP</Text>
            {([
              { key: 'dropoff' as const, icon: Store, title: 'Drop off', desc: 'Take it to a post office / courier point' },
              { key: 'pickup_carrier' as const, icon: Truck, title: 'Carrier pickup', desc: 'The courier picks it up from your door' },
              { key: 'pickup_network' as const, icon: Home, title: 'Network pickup', desc: 'One of our in-app couriers collects it' },
            ]).map((f) => {
              const on = fulfillment === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.fulfilCard, on && styles.fulfilCardOn]}
                  activeOpacity={0.85}
                  onPress={() => setFulfillment(f.key)}
                >
                  <View style={[styles.fulfilIcon, on && { backgroundColor: C.accentDim }]}>
                    <f.icon size={18} color={on ? C.accent : C.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fulfilTitle, on && { color: C.text }]}>{f.title}</Text>
                    <Text style={styles.fulfilDesc}>{f.desc}</Text>
                  </View>
                  {on ? <Check size={18} color={C.accent} /> : null}
                </TouchableOpacity>
              );
            })}

            <View style={{ marginTop: 22 }}>
              <Button
                label={selected ? `Create label · ${curSymbol} ${selected.price.toFixed(2)}` : 'Create label'}
                onPress={createLabel}
                loading={createMut.isPending}
                disabled={!canCreate}
                fullWidth
                icon={<Package size={16} color={C.white} />}
                testID="ship-create-label"
              />
              <Text style={styles.gateNote}>You’ll be asked to sign in to buy the label and ship.</Text>
            </View>
          </>
        ) : quotes && quotes.length === 0 ? (
          <View style={styles.emptyQuotes}>
            {quoteMut.isPending ? <ActivityIndicator color={C.accent} /> : <Text style={styles.emptyText}>Couldn’t price this parcel. Check the size & weight and try again.</Text>}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 10 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  presetCard: {
    width: '47%', flexGrow: 1,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 4,
  },
  presetCardOn: { borderColor: C.accent, backgroundColor: C.accentDim },
  presetLabel: { fontSize: 14, fontWeight: '700' as const, color: C.textSecondary, marginTop: 4 },
  presetSub: { fontSize: 11, color: C.textMuted },
  dimRow: { flexDirection: 'row', gap: 10 },
  serviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  serviceChip: {
    flexGrow: 1, minWidth: '46%',
    backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  serviceChipOn: { backgroundColor: C.accent, borderColor: C.accent },
  serviceLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  serviceSub: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  courierCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  courierBadge: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  courierBadgeText: { color: C.white, fontSize: 12, fontWeight: '800' as const },
  courierNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  courierName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  liveText: { fontSize: 10, color: C.green, fontWeight: '700' as const },
  estTag: { fontSize: 10, color: C.textMuted, fontWeight: '700' as const, backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  miniTag: { fontSize: 11, fontWeight: '700' as const },
  etaText: { fontSize: 12, color: C.textSecondary },
  price: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  estNote: { fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 2, marginBottom: 4 },
  fulfilCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  fulfilCardOn: { borderColor: C.accent },
  fulfilIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  fulfilTitle: { fontSize: 14, fontWeight: '700' as const, color: C.textSecondary },
  fulfilDesc: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  gateNote: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10 },
  emptyQuotes: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },
});
