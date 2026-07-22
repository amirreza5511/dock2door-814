import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check, Send, Home, Sparkles } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import DateField from '@/components/ui/DateField';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { usePreferences } from '@/store/preferences';
import { weightUnitFor, formatMoney } from '@/constants/world';
import {
  COVERAGE_AREAS, type CoverageArea, COVERAGE_LABEL,
  LOAD_TYPES, type LoadType, LOAD_TYPE_MAP,
  estimateGroundLoad,
} from '@/constants/groundFreight';

interface Props {
  visible: boolean;
  initialCoverage?: CoverageArea;
  initialLoadType?: LoadType;
  onClose: () => void;
  onSubmitted: () => void;
}

/** Normalize a user weight into kg for the estimate math. */
function toKg(weight: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? weight * 0.453592 : weight;
}

/**
 * Post-a-load flow for the LTL & FTL Quotes world. A single-screen form with a
 * live ballpark estimate, backed by the shared freight quote engine
 * (freight.create). Load types map onto freight_mode via LOAD_TYPE_MAP.
 */
export default function GroundLoadWizard({
  visible, initialCoverage = 'canada', initialLoadType = 'ltl', onClose, onSubmitted,
}: Props) {
  const insets = useSafeAreaInsets();
  const prefUnits = usePreferences((s) => s.unitSystem);
  const createMutation = trpc.freight.create.useMutation();

  const [coverage, setCoverage] = useState<CoverageArea>(initialCoverage);
  const [loadType, setLoadType] = useState<LoadType>(initialLoadType);
  const [pickupCity, setPickupCity] = useState<string>('');
  const [dropoffCity, setDropoffCity] = useState<string>('');
  const [pickupCountry, setPickupCountry] = useState<string>('');
  const [dropoffCountry, setDropoffCountry] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(weightUnitFor(prefUnits));
  const [pallets, setPallets] = useState<string>('1');
  const [readyDate, setReadyDate] = useState<string>('');
  const [finalMile, setFinalMile] = useState<boolean>(false);
  const [commodity, setCommodity] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isInternational = coverage === 'international';

  const reset = useCallback(() => {
    setCoverage(initialCoverage); setLoadType(initialLoadType);
    setPickupCity(''); setDropoffCity(''); setPickupCountry(''); setDropoffCountry('');
    setWeight(''); setWeightUnit(weightUnitFor(prefUnits)); setPallets('1');
    setReadyDate(''); setFinalMile(false); setCommodity(''); setNotes('');
  }, [initialCoverage, initialLoadType, prefUnits]);

  const handleClose = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const estimate = useMemo(() => estimateGroundLoad({
    loadType,
    coverage,
    weightKg: toKg(Number(weight) || 0, weightUnit),
    pallets: Math.max(Number(pallets) || 1, 1),
    finalMile,
  }), [loadType, coverage, weight, weightUnit, pallets, finalMile]);

  const canSubmit = pickupCity.trim().length > 0 && dropoffCity.trim().length > 0 && Number(weight) > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const def = LOAD_TYPE_MAP[loadType];
      const originCountry = isInternational ? (pickupCountry.trim() || 'Canada') : 'Canada';
      const destCountry = isInternational ? (dropoffCountry.trim() || 'Canada') : 'Canada';
      const title = `${def.short} — ${pickupCity.trim()} → ${dropoffCity.trim()}`;
      const estLine = `Ballpark estimate: ${formatMoney(estimate.low, estimate.currency)}–${formatMoney(estimate.high, estimate.currency)}`;
      const noteParts = [
        `Coverage: ${COVERAGE_LABEL[coverage]}`,
        `Load: ${def.label}`,
        finalMile ? 'Final-mile delivery to the door requested' : null,
        notes.trim() ? notes.trim() : null,
        estLine,
      ].filter(Boolean);

      await createMutation.mutateAsync({
        title,
        originCountry, originCity: pickupCity.trim(),
        destCountry, destCity: dropoffCity.trim(),
        freightMode: def.freightMode,
        weight: Number(weight) || 0, weightUnit,
        pieces: Math.max(Number(pallets) || 1, 1),
        commodity: commodity.trim(),
        currency: estimate.currency,
        notes: noteParts.join('\n'),
        readyDate: readyDate.trim() || undefined,
        deliveryMethod: finalMile ? 'door_pickup' : 'booking_only',
        needsContainerPickup: finalMile,
      });
      reset();
      onSubmitted();
    } catch (e) {
      Alert.alert('Could not post your load', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, loadType, isInternational, pickupCountry, dropoffCountry, pickupCity, dropoffCity,
    coverage, finalMile, notes, estimate, weight, weightUnit, pallets, commodity, readyDate,
    createMutation, reset, onSubmitted,
  ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.iconBtn}><X size={22} color={C.text} /></TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Get quotes for my load</Text>
            <Text style={styles.headerSub}>Describe it once — carriers send competing prices</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {/* Coverage */}
            <Text style={styles.label}>Coverage</Text>
            <View style={styles.segRow}>
              {COVERAGE_AREAS.map((cov) => {
                const active = coverage === cov.value;
                return (
                  <TouchableOpacity key={cov.value} activeOpacity={0.85} onPress={() => setCoverage(cov.value)}
                    style={[styles.seg, active && styles.segActive]}>
                    <Text style={[styles.segText, active && styles.segTextActive]}>{cov.label}</Text>
                    <Text style={[styles.segSub, active && styles.segSubActive]}>{cov.sublabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Load type */}
            <Text style={styles.label}>Load type</Text>
            {LOAD_TYPES.map((l) => {
              const active = loadType === l.value;
              const Icon = l.icon;
              return (
                <TouchableOpacity key={l.value} activeOpacity={0.85} onPress={() => setLoadType(l.value)}
                  style={[styles.optionCard, active && styles.optionCardActive]}>
                  <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                    <Icon size={20} color={active ? C.white : C.green} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{l.label}</Text>
                    <Text style={styles.optionSub}>{l.sublabel}</Text>
                  </View>
                  {active ? <Check size={20} color={C.green} /> : null}
                </TouchableOpacity>
              );
            })}

            {/* Route */}
            <Text style={styles.label}>Route</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}><Input label="Pickup city" value={pickupCity} onChangeText={setPickupCity} placeholder="e.g. Toronto" /></View>
              <View style={{ flex: 1 }}><Input label="Drop-off city" value={dropoffCity} onChangeText={setDropoffCity} placeholder="e.g. Montreal" /></View>
            </View>
            {isInternational && (
              <View style={styles.row}>
                <View style={{ flex: 1 }}><Input label="Pickup country" value={pickupCountry} onChangeText={setPickupCountry} placeholder="e.g. USA" /></View>
                <View style={{ flex: 1 }}><Input label="Drop-off country" value={dropoffCountry} onChangeText={setDropoffCountry} placeholder="e.g. Canada" /></View>
              </View>
            )}

            {/* Size */}
            <Text style={styles.label}>Size</Text>
            <View style={styles.row}>
              <View style={{ flex: 2 }}><Input label={`Total weight (${weightUnit})`} value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="0" /></View>
              <View style={styles.unitToggle}>
                {(['kg', 'lb'] as const).map((u) => (
                  <TouchableOpacity key={u} onPress={() => setWeightUnit(u)} style={[styles.unitBtn, weightUnit === u && styles.unitBtnActive]}>
                    <Text style={[styles.unitBtnText, weightUnit === u && styles.unitBtnTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {loadType !== 'ftl' && (
              <Input label="Pallets / pieces" value={pallets} onChangeText={setPallets} keyboardType="numeric" placeholder="1" />
            )}
            <DateField label="Ready date (optional)" value={readyDate} onChange={setReadyDate} placeholder="Pick a date" minimumDate={new Date()} />
            <Input label="Commodity (optional)" value={commodity} onChangeText={setCommodity} placeholder="What are you shipping?" />

            {/* Final-mile */}
            <TouchableOpacity activeOpacity={0.85} onPress={() => setFinalMile((v) => !v)}
              style={[styles.optionCard, finalMile && styles.optionCardActive]}>
              <View style={[styles.checkbox, finalMile && styles.checkboxOn]}>
                {finalMile ? <Check size={14} color={C.white} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}><Home size={14} color={C.text} /> Deliver to the door (final-mile)</Text>
                <Text style={styles.optionSub}>Include last-mile delivery to the destination address</Text>
              </View>
            </TouchableOpacity>

            <Input label="Notes for providers (optional)" value={notes} onChangeText={setNotes} placeholder="Access, timing, special handling…" multiline numberOfLines={3} />

            {/* Instant estimate */}
            <View style={styles.estimateCard}>
              <View style={styles.estimateHead}>
                <Sparkles size={16} color={C.green} />
                <Text style={styles.estimateTitle}>Instant ballpark estimate</Text>
              </View>
              <Text style={styles.estimateRange}>
                {formatMoney(estimate.low, estimate.currency)} – {formatMoney(estimate.high, estimate.currency)}
              </Text>
              <Text style={styles.estimateNote}>
                A rough guide for a {LOAD_TYPE_MAP[loadType].short} · {COVERAGE_LABEL[coverage]} load. Real quotes from providers may differ.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {submitting ? (
            <View style={styles.submitLoading}><ActivityIndicator color={C.green} /></View>
          ) : (
            <Button label="Post load & get quotes" onPress={() => void handleSubmit()} disabled={!canSubmit}
              icon={<Send size={16} color={C.white} />} fullWidth />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  label: { fontSize: 13, fontWeight: '800' as const, color: C.textSecondary, letterSpacing: 0.4, textTransform: 'uppercase' as const, marginTop: 6 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, gap: 2 },
  segActive: { backgroundColor: C.greenDim, borderColor: C.green },
  segText: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  segTextActive: { color: C.green },
  segSub: { fontSize: 10, color: C.textMuted, lineHeight: 13 },
  segSubActive: { color: C.green },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionCardActive: { borderColor: C.green, backgroundColor: C.greenDim },
  optionIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenDim },
  optionIconActive: { backgroundColor: C.green },
  optionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  optionSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  unitToggle: { flexDirection: 'row', gap: 6, backgroundColor: C.card, borderRadius: 10, padding: 4, borderWidth: 1, borderColor: C.border },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  unitBtnActive: { backgroundColor: C.green },
  unitBtnText: { fontSize: 14, fontWeight: '700' as const, color: C.textSecondary },
  unitBtnTextActive: { color: C.white },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: C.green, borderColor: C.green },
  estimateCard: { padding: 16, borderRadius: 16, backgroundColor: C.greenDim, borderWidth: 1, borderColor: C.green + '55', gap: 6, marginTop: 6 },
  estimateHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  estimateTitle: { fontSize: 13, fontWeight: '800' as const, color: C.green, letterSpacing: 0.3 },
  estimateRange: { fontSize: 28, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  estimateNote: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  submitLoading: { flex: 1, paddingVertical: 12, alignItems: 'center' },
});
