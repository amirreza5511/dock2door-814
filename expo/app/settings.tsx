import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { ArrowLeft, Check, Ruler, Globe, Coins, PlayCircle } from 'lucide-react-native';
import C from '@/constants/colors';
import { usePreferences } from '@/store/preferences';
import { usePromo } from '@/store/promo';
import { CURRENCIES, type UnitSystem } from '@/constants/world';

const UNIT_OPTIONS: { id: UnitSystem; label: string; detail: string }[] = [
  { id: 'metric', label: 'Metric', detail: 'Kilograms (kg) · Centimeters (cm)' },
  { id: 'imperial', label: 'Imperial', detail: 'Pounds (lb) · Inches (in)' },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currency = usePreferences((s) => s.currency);
  const unitSystem = usePreferences((s) => s.unitSystem);
  const setCurrency = usePreferences((s) => s.setCurrency);
  const setUnitSystem = usePreferences((s) => s.setUnitSystem);
  const playPromo = usePromo((s) => s.play);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Preferences</Text>
          <Text style={styles.sub}>Currency & units apply across the app</Text>
        </View>
        <Globe size={22} color={C.accent} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Ruler size={16} color={C.text} />
            <Text style={styles.sectionTitle}>Units</Text>
          </View>
          {UNIT_OPTIONS.map((o) => {
            const selected = o.id === unitSystem;
            return (
              <TouchableOpacity key={o.id} style={[styles.row, selected && styles.rowSelected]} onPress={() => setUnitSystem(o.id)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{o.label}</Text>
                  <Text style={styles.rowSub}>{o.detail}</Text>
                </View>
                {selected ? <Check size={20} color={C.accent} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <PlayCircle size={16} color={C.text} />
            <Text style={styles.sectionTitle}>About</Text>
          </View>
          <TouchableOpacity style={styles.row} onPress={() => { playPromo(); }} activeOpacity={0.8} testID="replay-intro">
            <View style={styles.symbolWrap}><PlayCircle size={18} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Watch intro video</Text>
              <Text style={styles.rowSub}>Replay the 15-second Dock2Door promo</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Coins size={16} color={C.text} />
            <Text style={styles.sectionTitle}>Display currency</Text>
          </View>
          {CURRENCIES.map((cur) => {
            const selected = cur.code === currency;
            return (
              <TouchableOpacity key={cur.code} style={[styles.row, selected && styles.rowSelected]} onPress={() => setCurrency(cur.code)} activeOpacity={0.8}>
                <View style={styles.symbolWrap}>
                  <Text style={styles.symbol}>{cur.symbol}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{cur.code}</Text>
                  <Text style={styles.rowSub}>{cur.name}</Text>
                </View>
                {selected ? <Check size={20} color={C.accent} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16 },
  section: { marginBottom: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 14, marginBottom: 8,
  },
  rowSelected: { borderColor: C.accent, backgroundColor: C.accentDim },
  rowLabel: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  rowSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  symbolWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  symbol: { fontSize: 16, fontWeight: '800' as const, color: C.accent },
});
