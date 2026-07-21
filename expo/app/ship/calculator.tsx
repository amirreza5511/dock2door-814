import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Calculator, Box, Info, ArrowRight, Sparkles, Camera, ImageIcon } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { estimatePackageFromPhoto, type PhotoParcelEstimate } from '@/lib/ai';

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
  const [scanning, setScanning] = useState<boolean>(false);
  const [aiEstimate, setAiEstimate] = useState<PhotoParcelEstimate | null>(null);

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

  const runPhotoEstimate = async (dataUrl: string) => {
    setScanning(true);
    try {
      const est = await estimatePackageFromPhoto(dataUrl);
      // AI always returns metric — switch the UI to metric so fields match.
      setUnit('metric');
      setLength(String(est.lengthCm));
      setWidth(String(est.widthCm));
      setHeight(String(est.heightCm));
      setWeight(String(est.weightKg));
      setAiEstimate(est);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Couldn’t scan', e instanceof Error ? e.message : 'Please try another photo.');
    } finally {
      setScanning(false);
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
        if (perm && !perm.granted) {
          Alert.alert('Camera needed', 'Allow camera access to scan a package, or pick a photo from your library.');
          return;
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true, mediaTypes: ['images'] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true, mediaTypes: ['images'] });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        Alert.alert('Couldn’t read photo', 'Please try again with another image.');
        return;
      }
      const mime = asset.mimeType ?? 'image/jpeg';
      await runPhotoEstimate(`data:${mime};base64,${asset.base64}`);
    } catch {
      Alert.alert('Something went wrong', 'Could not open the photo. Please try again.');
    }
  };

  const onScan = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'web') {
      void pickImage('library');
      return;
    }
    Alert.alert('Scan a package', 'Add a photo so the AI can estimate its size and weight.', [
      { text: 'Take a photo', onPress: () => void pickImage('camera') },
      { text: 'Choose from library', onPress: () => void pickImage('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
        {/* AI photo scan */}
        <TouchableOpacity style={styles.scanCard} activeOpacity={0.85} onPress={onScan} disabled={scanning} testID="calc-ai-scan">
          <View style={styles.scanIcon}>
            {scanning ? <ActivityIndicator color={C.accent} /> : <Sparkles size={22} color={C.accent} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.scanTitle}>{scanning ? 'Reading your photo…' : 'Scan with a photo'}</Text>
            <Text style={styles.scanDesc}>
              {scanning ? 'The AI is estimating size & weight' : 'Snap the package and let AI estimate its size & weight'}
            </Text>
          </View>
          {!scanning ? (
            <View style={styles.scanBtns}>
              <View style={styles.scanMini}><Camera size={16} color={C.textSecondary} /></View>
              <View style={styles.scanMini}><ImageIcon size={16} color={C.textSecondary} /></View>
            </View>
          ) : null}
        </TouchableOpacity>

        {aiEstimate ? (
          <View style={styles.aiResult}>
            <View style={styles.aiResultHead}>
              <Sparkles size={14} color={C.accent} />
              <Text style={styles.aiResultTitle} numberOfLines={1}>{aiEstimate.itemName}</Text>
              <View style={[styles.confPill, { backgroundColor: confColor(aiEstimate.confidence) + '22' }]}>
                <Text style={[styles.confText, { color: confColor(aiEstimate.confidence) }]}>{aiEstimate.confidence} confidence</Text>
              </View>
            </View>
            {aiEstimate.note ? <Text style={styles.aiNote}>{aiEstimate.note}</Text> : null}
            <Text style={styles.aiHint}>Fields below were filled in — adjust anything that looks off.</Text>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>UNITS</Text>
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

function confColor(c: PhotoParcelEstimate['confidence']): string {
  return c === 'high' ? C.green : c === 'low' ? C.red : C.yellow;
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
  scanCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.accentDim, borderRadius: 14, borderWidth: 1, borderColor: C.accent + '55',
    padding: 16, marginBottom: 4,
  },
  scanIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  scanTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  scanDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 16 },
  scanBtns: { flexDirection: 'row', gap: 6 },
  scanMini: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  aiResult: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginTop: 12 },
  aiResultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiResultTitle: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: C.text },
  confPill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  confText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  aiNote: { fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 8 },
  aiHint: { fontSize: 11, color: C.textMuted, marginTop: 8 },
});
