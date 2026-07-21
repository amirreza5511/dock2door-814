import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Check, RotateCcw, Store, QrCode } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useActionGuard } from '@/store/explore';
import { usePreferences } from '@/store/preferences';

/** Popular stores with prefilled return addresses (illustrative). */
const STORES = [
  { key: 'amazon', name: 'Amazon', addr: 'Amazon Returns', city: 'Mississauga', postal: 'L5T 2T3', color: '#FF9900' },
  { key: 'temu', name: 'Temu', addr: 'Temu Returns Center', city: 'City of Industry', postal: '91746', color: '#FB7701' },
  { key: 'shein', name: 'SHEIN', addr: 'SHEIN Returns', city: 'Whittier', postal: '90601', color: '#222222' },
  { key: 'walmart', name: 'Walmart', addr: 'Walmart Returns', city: 'Brampton', postal: 'L6T 5V1', color: '#0071CE' },
  { key: 'bestbuy', name: 'Best Buy', addr: 'Best Buy Returns', city: 'Burnaby', postal: 'V5J 5J8', color: '#0046BE' },
  { key: 'other', name: 'Other store', addr: '', city: '', postal: '', color: C.textSecondary },
] as const;

const REASONS = ['Wrong item', 'Damaged / defective', 'No longer needed', 'Wrong size', 'Not as described'] as const;

export default function ShipReturn() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const guard = useActionGuard();
  const currency = usePreferences((s) => s.currency);

  const [storeKey, setStoreKey] = useState<string>('amazon');
  const [orderRef, setOrderRef] = useState<string>('');
  const [reason, setReason] = useState<string>('Wrong item');
  const [customStore, setCustomStore] = useState<string>('');
  const [customAddr, setCustomAddr] = useState<string>('');
  const [customCity, setCustomCity] = useState<string>('');
  const [customPostal, setCustomPostal] = useState<string>('');
  const [atCounter, setAtCounter] = useState<boolean>(true);

  const createMut = trpc.parcel.create.useMutation();
  const store = STORES.find((s) => s.key === storeKey) ?? STORES[0];
  const isOther = storeKey === 'other';

  const toName = isOther ? customStore.trim() : `${store.name} Returns`;
  const toCity = isOther ? customCity.trim() : store.city;

  const canCreate = Boolean(toName && toCity);

  const createReturn = async () => {
    if (!guard('Create a return label')) return; // gated in explore mode
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const label = atCounter ? 'QR at counter (no print)' : 'Prepaid return label';
    try {
      const res = await createMut.mutateAsync({
        toName,
        toLine1: isOther ? customAddr.trim() : store.addr,
        toCity,
        toPostal: isOther ? customPostal.trim() : store.postal,
        weight: 1,
        weightUnit: 'kg',
        service: 'regular',
        currency,
        notes: `RETURN · ${isOther ? customStore.trim() : store.name} · ${reason}${orderRef ? ` · Order ${orderRef}` : ''} · ${label}`,
      });
      const id = (res as { id?: string } | null)?.id;
      if (id) router.replace(`/ship/label?id=${id}` as never);
    } catch {
      // create surfaces its own error
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Start a return</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.introRow}>
          <View style={styles.introIcon}><RotateCcw size={20} color={C.blue} /></View>
          <Text style={styles.introText}>Return to any store. We’ll create a return label with a scannable code — print it or show the QR at the counter.</Text>
        </View>

        <Text style={styles.sectionLabel}>WHICH STORE?</Text>
        <View style={styles.storeGrid}>
          {STORES.map((s) => {
            const on = storeKey === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.storeChip, on && { borderColor: C.blue, backgroundColor: C.blueDim }]}
                activeOpacity={0.85}
                onPress={() => setStoreKey(s.key)}
              >
                <View style={[styles.storeDot, { backgroundColor: s.color }]} />
                <Text style={[styles.storeName, on && { color: C.text }]}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isOther ? (
          <View style={{ gap: 10, marginTop: 14 }}>
            <Input label="Store name" value={customStore} onChangeText={setCustomStore} placeholder="Store name" />
            <Input label="Return address" value={customAddr} onChangeText={setCustomAddr} placeholder="Returns dept address" />
            <View style={styles.row}>
              <View style={{ flex: 2 }}><Input label="City" value={customCity} onChangeText={setCustomCity} /></View>
              <View style={{ flex: 1 }}><Input label="Postal" value={customPostal} onChangeText={setCustomPostal} autoCapitalize="characters" /></View>
            </View>
          </View>
        ) : (
          <View style={styles.addrPreview}>
            <Store size={14} color={C.textMuted} />
            <Text style={styles.addrText}>{store.addr}, {store.city} {store.postal}</Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>ORDER REFERENCE (OPTIONAL)</Text>
        <Input value={orderRef} onChangeText={setOrderRef} placeholder="e.g. 112-3456789-0000000" />

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>REASON</Text>
        <View style={styles.reasonRow}>
          {REASONS.map((r) => {
            const on = reason === r;
            return (
              <TouchableOpacity
                key={r}
                style={[styles.reasonChip, on && { backgroundColor: C.blue, borderColor: C.blue }]}
                activeOpacity={0.85}
                onPress={() => setReason(r)}
              >
                <Text style={[styles.reasonText, on && { color: C.white }]}>{r}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>HOW TO SEND IT BACK</Text>
        {([
          { on: atCounter, set: true, icon: QrCode, title: 'Show QR at the counter', desc: 'No printer needed — staff scan your code' },
          { on: !atCounter, set: false, icon: RotateCcw, title: 'Print a return label', desc: 'Tape it on the box and drop it off' },
        ]).map((o, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.optCard, o.on && styles.optCardOn]}
            activeOpacity={0.85}
            onPress={() => setAtCounter(o.set)}
          >
            <View style={[styles.optIcon, o.on && { backgroundColor: C.blueDim }]}>
              <o.icon size={18} color={o.on ? C.blue : C.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.optTitle, o.on && { color: C.text }]}>{o.title}</Text>
              <Text style={styles.optDesc}>{o.desc}</Text>
            </View>
            {o.on ? <Check size={18} color={C.blue} /> : null}
          </TouchableOpacity>
        ))}

        <View style={{ marginTop: 22 }}>
          <Button
            label="Create return label"
            onPress={createReturn}
            loading={createMut.isPending}
            disabled={!canCreate}
            fullWidth
            icon={<RotateCcw size={16} color={C.white} />}
            testID="ship-create-return"
          />
          <Text style={styles.gateNote}>You’ll be asked to sign in to generate the return label.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  introRow: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 20 },
  introIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' },
  introText: { flex: 1, fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 10 },
  storeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  storeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 13, paddingVertical: 9,
  },
  storeDot: { width: 9, height: 9, borderRadius: 5 },
  storeName: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary },
  addrPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 4 },
  addrText: { fontSize: 13, color: C.textMuted },
  row: { flexDirection: 'row', gap: 10 },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: { backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 8 },
  reasonText: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary },
  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  optCardOn: { borderColor: C.blue },
  optIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  optTitle: { fontSize: 14, fontWeight: '700' as const, color: C.textSecondary },
  optDesc: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  gateNote: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10 },
});
