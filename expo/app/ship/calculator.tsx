import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Calculator, Box, Info, ArrowRight } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

type Unit = 'metric' | 'imperial';

/** Common courier volumetric divisors (cm³ per kg). Air = 5000, ground ≈ 6000. */
const DIVISORS = [
  { key: 'air', label: 'Air / express', divisor: 5000 },
  { key: 'ground', label: 'Ground', divisor: 6000 },
] as const;

export default function ShipCalculator() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [unit, setUnit] = useState<Unit>('metric');
  const [length, setLength] = useState<string>('30');
  const [width, setWidth] = useState<string>('25');
  const [height, setHeight] = useState<string>('20');
  const [weight, setWeight] = useState<string>('2');
  const [divisorKey, setDivisorKey] = useState<string>('air');

  const dimLabel = unit === 'metric' ? 'cm' : 'in';
  const wtLabel = unit === 'metric' ? 'kg' : 'lb';

  const result = useMemo(() => {
    let l = Number(length) || 0;
    let w = Number(width) || 0;
    let h = Number(height) || 0;
    let actualKg = Number(weight) || 0;
    // Normalise everything to metric for the math.
    if (unit === 'imperial') {
      l *= 2.54; w *= 2.54; h *= 2.54;
      actualKg *= 0.453592;
    }
    const divisor = DIVISORS.find((d) => d.key === divisorKey)?.divisor ?? 5000;
    const volumeCm3 = l * w * h;
    const volumetricKg = volumeCm3 / divisor;
    const billableKg = Math.max(actualKg, volumetricKg);
    const girthCm = l + 2 * (w + h); // length + girth (longest side + 2×(w+h))
    const usesVolumetric = volumetricKg > actualKg;

    const toDisplayWt = (kg: number) => (unit === 'imperial' ? kg / 0.453592 : kg);
    const toDisplayLen = (cm: number) => (unit === 'imperial' ? cm / 2.54 : cm);

    return {
      volumetric: toDisplayWt(volumetricKg),
      actual: toDisplayWt(actualKg),
      billable: toDisplayWt(billableKg),
      girth: toDisplayLen(girthCm),
      usesVolumetric,
    };
  }, [length, width, height, weight, unit, divisorKey]);

  const goQuote = () => router.push('/ship/quote' as never);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Parcel calculator</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>UNITS</Text>
        <View style={styles.segRow}>
          {(['metric', 'imperial'] as const).map((u) => {
            const on = unit === u;
            return (
              <TouchableOpacity key={u} style={[styles.seg, on && styles.segOn]} activeOpacity={0.85} onPress={() => setUnit(u)}>
                <Text style={[styles.segText, on && { color: C.white }]}>{u === 'metric' ? 'Metric (cm · kg)' : 'Imperial (in · lb)'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>DIMENSIONS ({dimLabel.toUpperCase()})</Text>
        <View style={styles.dimRow}>
          <View style={{ flex: 1 }}><Input label={`Length`} value={length} onChangeText={setLength} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input label={`Width`} value={width} onChangeText={setWidth} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input label={`Height`} value={height} onChangeText={setHeight} keyboardType="numeric" /></View>
        </View>
        <View style={{ marginTop: 10 }}>
          <Input label={`Actual weight (${wtLabel})`} value={weight} onChangeText={setWeight} keyboardType="numeric" />
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>SHIPPING TYPE</Text>
        <View style={styles.segRow}>
          {DIVISORS.map((d) => {
            const on = divisorKey === d.key;
            return (
              <TouchableOpacity key={d.key} style={[styles.seg, on && styles.segOn]} activeOpacity={0.85} onPress={() => setDivisorKey(d.key)}>
                <Text style={[styles.segText, on && { color: C.white }]}>{d.label}</Text>
                <Text style={[styles.segSub, on && { color: '#FFFFFFCC' }]}>÷{d.divisor}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Result */}
        <View style={styles.resultCard}>
          <View style={styles.resultIconWrap}><Calculator size={20} color={C.accent} /></View>
          <Text style={styles.resultLabel}>BILLABLE WEIGHT</Text>
          <Text style={styles.resultBig}>{result.billable.toFixed(2)} {wtLabel}</Text>
          <Text style={styles.resultNote}>
            Couriers charge the greater of actual and volumetric weight.
            {result.usesVolumetric ? ' This parcel is priced on its size.' : ' This parcel is priced on its actual weight.'}
          </Text>

          <View style={styles.metricGrid}>
            <Metric label="Actual" value={`${result.actual.toFixed(2)} ${wtLabel}`} highlight={!result.usesVolumetric} />
            <Metric label="Volumetric" value={`${result.volumetric.toFixed(2)} ${wtLabel}`} highlight={result.usesVolumetric} />
            <Metric label="Length + girth" value={`${result.girth.toFixed(0)} ${dimLabel}`} />
          </View>
        </View>

        <View style={styles.hintRow}>
          <Info size={14} color={C.textMuted} />
          <Text style={styles.hint}>
            Volumetric weight = (L × W × H) ÷ divisor. Air/express uses 5000, ground uses 6000. Length + girth helps you check oversize surcharges.
          </Text>
        </View>

        <View style={{ marginTop: 22 }}>
          <Button label="Price this parcel" onPress={goQuote} fullWidth icon={<ArrowRight size={16} color={C.white} />} />
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[styles.metric, highlight && styles.metricOn]}>
      <Box size={14} color={highlight ? C.accent : C.textMuted} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight && { color: C.accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 10 },
  segRow: { flexDirection: 'row', gap: 10 },
  seg: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center' },
  segOn: { backgroundColor: C.accent, borderColor: C.accent },
  segText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  segSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  dimRow: { flexDirection: 'row', gap: 10 },
  resultCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 20, marginTop: 24, alignItems: 'center' },
  resultIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  resultLabel: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, letterSpacing: 1.5 },
  resultBig: { fontSize: 34, fontWeight: '800' as const, color: C.text, marginTop: 4, letterSpacing: -0.5 },
  resultNote: { fontSize: 12, color: C.textSecondary, textAlign: 'center', lineHeight: 18, marginTop: 8, paddingHorizontal: 8 },
  metricGrid: { flexDirection: 'row', gap: 8, marginTop: 18, alignSelf: 'stretch' },
  metric: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: 'center', gap: 4 },
  metricOn: { borderColor: C.accent, backgroundColor: C.accentDim },
  metricLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  metricValue: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  hintRow: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'flex-start' },
  hint: { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 17 },
});
