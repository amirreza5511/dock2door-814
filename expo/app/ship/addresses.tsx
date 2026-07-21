import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, MapPin, Plus, Star, Trash2, Check, X } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { useShipStore, type SavedAddress } from '@/store/shipStore';

export default function ShipAddresses() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hydrate = useShipStore((s) => s.hydrate);
  const addresses = useShipStore((s) => s.addresses);
  const saveAddress = useShipStore((s) => s.saveAddress);
  const removeAddress = useShipStore((s) => s.removeAddress);
  const setDefaultAddress = useShipStore((s) => s.setDefaultAddress);

  const [adding, setAdding] = useState<boolean>(false);
  const [label, setLabel] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [line1, setLine1] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [postal, setPostal] = useState<string>('');
  const [country, setCountry] = useState<string>('CA');

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const reset = () => {
    setLabel(''); setName(''); setLine1(''); setCity(''); setPostal(''); setCountry('CA'); setAdding(false);
  };

  const canSave = Boolean(label.trim() && name.trim() && city.trim());

  const onSave = () => {
    if (!canSave) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    saveAddress({
      label: label.trim(),
      name: name.trim(),
      line1: line1.trim(),
      city: city.trim(),
      postal: postal.trim(),
      country: country.trim() || 'CA',
      isDefault: addresses.length === 0,
    });
    reset();
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved addresses</Text>
        <TouchableOpacity onPress={() => setAdding((v) => !v)} style={styles.iconBtn} hitSlop={8}>
          {adding ? <X size={22} color={C.text} /> : <Plus size={22} color={C.accent} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {adding ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>New address</Text>
            <View style={{ gap: 10 }}>
              <Input label="Label" value={label} onChangeText={setLabel} placeholder="Home · Office · Warehouse" />
              <Input label="Full name" value={name} onChangeText={setName} placeholder="Jane Doe" />
              <Input label="Address" value={line1} onChangeText={setLine1} placeholder="123 Main St" />
              <View style={styles.row}>
                <View style={{ flex: 2 }}><Input label="City" value={city} onChangeText={setCity} placeholder="Vancouver" /></View>
                <View style={{ flex: 1 }}><Input label="Postal" value={postal} onChangeText={setPostal} placeholder="V6B" autoCapitalize="characters" /></View>
              </View>
              <Input label="Country" value={country} onChangeText={(t) => setCountry(t.toUpperCase())} placeholder="CA" autoCapitalize="characters" />
            </View>
            <View style={{ marginTop: 16 }}>
              <Button label="Save address" onPress={onSave} disabled={!canSave} fullWidth icon={<Check size={16} color={C.white} />} />
            </View>
          </View>
        ) : null}

        {addresses.length === 0 && !adding ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MapPin size={30} color={C.textMuted} /></View>
            <Text style={styles.emptyTitle}>No saved addresses</Text>
            <Text style={styles.emptyDesc}>Save the addresses you ship from and to so you can reuse them in one tap.</Text>
            <Button label="Add an address" onPress={() => setAdding(true)} icon={<Plus size={16} color={C.white} />} />
          </View>
        ) : (
          addresses.map((a) => <AddressRow key={a.id} a={a} onDelete={() => removeAddress(a.id)} onDefault={() => setDefaultAddress(a.id)} />)
        )}
      </ScrollView>
    </View>
  );
}

function AddressRow({ a, onDelete, onDefault }: { a: SavedAddress; onDelete: () => void; onDefault: () => void }) {
  return (
    <View style={styles.card}>
      <View style={[styles.cardIcon, { backgroundColor: a.isDefault ? C.accentDim : C.bgSecondary }]}>
        <MapPin size={18} color={a.isDefault ? C.accent : C.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>{a.label}</Text>
          {a.isDefault ? <View style={styles.defaultPill}><Text style={styles.defaultText}>Default</Text></View> : null}
        </View>
        <Text style={styles.cardSub} numberOfLines={1}>{a.name}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{[a.line1, a.city, a.postal, a.country].filter(Boolean).join(', ')}</Text>
      </View>
      <View style={{ gap: 8 }}>
        {!a.isDefault ? (
          <TouchableOpacity onPress={onDefault} hitSlop={8} style={styles.smallBtn}>
            <Star size={16} color={C.yellow} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onDelete} hitSlop={8} style={styles.smallBtn}>
          <Trash2 size={16} color={C.red} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  form: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 16 },
  formTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  cardIcon: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  defaultPill: { backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  defaultText: { fontSize: 10, color: C.accent, fontWeight: '700' as const },
  cardSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  smallBtn: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 10, paddingHorizontal: 20 },
});
