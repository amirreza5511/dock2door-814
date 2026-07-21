import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import {
  X, ChevronLeft, ChevronRight, Check, MapPin, Plane, Ship, Truck, Boxes,
  Scale, Package, FileText, Upload, Trash2, Send,
} from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import WorldPicker, { type PickerOption } from '@/components/WorldPicker';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { usePreferences } from '@/store/preferences';
import {
  COUNTRIES, SEAPORTS, AIRPORTS, CURRENCIES, weightUnitFor, dimUnitFor,
} from '@/constants/world';
import {
  FREIGHT_MODES, type FreightMode, FREIGHT_MODE_LABEL,
  DELIVERY_METHODS, type DeliveryMethod,
  FREIGHT_DOC_TYPES, type FreightDocType,
} from '@/constants/globalFreight';

const COUNTRY_OPTIONS: PickerOption[] = COUNTRIES.map((c) => ({ value: c.name, label: c.name, sublabel: c.code, glyph: c.flag, keywords: c.code }));
const SEAPORT_OPTIONS: PickerOption[] = SEAPORTS.map((p) => ({ value: p.name, label: p.name, sublabel: `${p.code} · ${p.country}`, keywords: `${p.code} ${p.country}` }));
const AIRPORT_OPTIONS: PickerOption[] = AIRPORTS.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}`, sublabel: `${a.city}, ${a.country}`, keywords: `${a.city} ${a.name}` }));
const CITY_OPTIONS: PickerOption[] = AIRPORTS.map((a) => ({ value: a.city, label: a.city, sublabel: a.country, keywords: `${a.code} ${a.name}` }));
const CURRENCY_OPTIONS: PickerOption[] = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}`, sublabel: c.symbol, keywords: c.name }));

const MODE_ICON: Record<FreightMode, typeof Plane> = {
  air: Plane, ocean: Ship, truck: Truck, fcl: Boxes, lcl: Boxes,
};

type LocalDoc = { uri: string; name: string; mimeType: string; docType: FreightDocType };

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

const STEP_TITLES = ['Route', 'Mode', 'Measurements', 'Cargo', 'Delivery', 'Documents', 'Review'];

/** Upload one local file to the freight-docs bucket and return its public URL path. */
async function uploadFreightDoc(uri: string, name: string, mimeType: string): Promise<{ path: string; url: string }> {
  const resp = await fetch(uri);
  const arrayBuffer = await resp.arrayBuffer();
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `docs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const { error } = await supabase.storage.from('freight-docs').upload(path, arrayBuffer, {
    contentType: mimeType || 'application/octet-stream', upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('freight-docs').getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export default function FreightQuoteWizard({ visible, onClose, onSubmitted }: Props) {
  const insets = useSafeAreaInsets();
  const prefCurrency = usePreferences((s) => s.currency);
  const prefUnits = usePreferences((s) => s.unitSystem);
  const createMutation = trpc.freight.create.useMutation();
  const addDocMutation = trpc.freight.addDocument.useMutation();

  const [step, setStep] = useState<number>(0);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Step 1 — route
  const [originCountry, setOriginCountry] = useState<string>('');
  const [originCity, setOriginCity] = useState<string>('');
  const [originPort, setOriginPort] = useState<string>('');
  const [destCountry, setDestCountry] = useState<string>('');
  const [destCity, setDestCity] = useState<string>('');
  const [destPort, setDestPort] = useState<string>('');
  // Step 2 — mode
  const [mode, setMode] = useState<FreightMode>('ocean');
  // Step 3 — measurements
  const [weight, setWeight] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(weightUnitFor(prefUnits));
  const [volume, setVolume] = useState<string>('');
  const [len, setLen] = useState<string>('');
  const [wid, setWid] = useState<string>('');
  const [hei, setHei] = useState<string>('');
  const [dimUnit, setDimUnit] = useState<'cm' | 'in'>(dimUnitFor(prefUnits));
  const [pieces, setPieces] = useState<string>('1');
  // Step 4 — cargo
  const [commodity, setCommodity] = useState<string>('');
  const [declaredValue, setDeclaredValue] = useState<string>('');
  const [currency, setCurrency] = useState<string>(prefCurrency);
  const [hsCode, setHsCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  // Step 5 — delivery
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('port_delivery');
  const [pickupAddress, setPickupAddress] = useState<string>('');
  const [pickupCity, setPickupCity] = useState<string>('');
  const [needsContainerPickup, setNeedsContainerPickup] = useState<boolean>(false);
  // Step 6 — documents
  const [docs, setDocs] = useState<LocalDoc[]>([]);

  const usesPort = mode === 'air' || mode === 'ocean' || mode === 'fcl' || mode === 'lcl';
  const portOptions = mode === 'air' ? AIRPORT_OPTIONS : SEAPORT_OPTIONS;
  const portLabel = mode === 'air' ? 'airport' : 'port';

  const reset = useCallback(() => {
    setStep(0);
    setOriginCountry(''); setOriginCity(''); setOriginPort('');
    setDestCountry(''); setDestCity(''); setDestPort('');
    setMode('ocean');
    setWeight(''); setWeightUnit(weightUnitFor(prefUnits)); setVolume('');
    setLen(''); setWid(''); setHei(''); setDimUnit(dimUnitFor(prefUnits)); setPieces('1');
    setCommodity(''); setDeclaredValue(''); setCurrency(prefCurrency); setHsCode(''); setNotes('');
    setDeliveryMethod('port_delivery'); setPickupAddress(''); setPickupCity(''); setNeedsContainerPickup(false);
    setDocs([]);
  }, [prefCurrency, prefUnits]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const canProceed = useMemo(() => {
    if (step === 0) return originCountry.trim().length > 0 && destCountry.trim().length > 0;
    if (step === 2) return Number(weight) > 0;
    return true;
  }, [step, originCountry, destCountry, weight]);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      setDocs((prev) => [...prev, {
        uri: a.uri, name: a.name ?? 'document', mimeType: a.mimeType ?? 'application/octet-stream', docType: 'other',
      }]);
    } catch {
      Alert.alert('Upload failed', 'Could not pick that file. Try another.');
    }
  }, []);

  const setDocType = useCallback((idx: number, docType: FreightDocType) => {
    setDocs((prev) => prev.map((d, i) => (i === idx ? { ...d, docType } : d)));
  }, []);

  const removeDoc = useCallback((idx: number) => {
    setDocs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const routeFrom = originCity || originPort || originCountry;
      const routeTo = destCity || destPort || destCountry;
      const title = `${FREIGHT_MODE_LABEL[mode]} — ${routeFrom} → ${routeTo}`;
      const res = await createMutation.mutateAsync({
        title,
        originCountry, originCity, originPort: usesPort ? originPort : '',
        destCountry, destCity, destPort: usesPort ? destPort : '',
        freightMode: mode,
        weight: Number(weight) || 0, weightUnit,
        volume: Number(volume) || 0, volumeUnit: 'cbm',
        length: Number(len) || 0, width: Number(wid) || 0, height: Number(hei) || 0, dimUnit,
        pieces: Math.max(Number(pieces) || 1, 1),
        commodity, declaredValue: Number(declaredValue) || 0, currency, hsCode, notes,
        deliveryMethod, pickupAddress, pickupCity,
        needsContainerPickup: needsContainerPickup || deliveryMethod === 'door_pickup',
      });
      const quoteId = res.id;

      // Upload + attach documents (best-effort; a failed doc doesn't kill the request).
      for (const d of docs) {
        try {
          const { path } = await uploadFreightDoc(d.uri, d.name, d.mimeType);
          await addDocMutation.mutateAsync({ quoteId, filePath: path, fileName: d.name, docType: d.docType });
        } catch {
          // continue with remaining docs
        }
      }

      reset();
      onSubmitted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Please try again.';
      Alert.alert('Could not submit request', msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    originCountry, originCity, originPort, destCountry, destCity, destPort, usesPort,
    mode, weight, weightUnit, volume, len, wid, hei, dimUnit, pieces,
    commodity, declaredValue, currency, hsCode, notes, deliveryMethod, pickupAddress, pickupCity,
    needsContainerPickup, docs, createMutation, addDocMutation, reset, onSubmitted,
  ]);

  const goNext = useCallback(() => {
    if (step < STEP_TITLES.length - 1) setStep((s) => s + 1);
    else void handleSubmit();
  }, [step, handleSubmit]);

  const goBack = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  const progress = ((step + 1) / STEP_TITLES.length) * 100;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.iconBtn}><X size={22} color={C.text} /></TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Get a freight quote</Text>
            <Text style={styles.headerStep}>Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}</Text>
          </View>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {step === 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}><MapPin size={16} color={C.blue} /> Origin</Text>
                <WorldPicker label="Origin country" value={originCountry} options={COUNTRY_OPTIONS} placeholder="Select country" onSelect={setOriginCountry} />
                <WorldPicker label="Origin city" value={originCity} options={CITY_OPTIONS} placeholder="City" onSelect={setOriginCity} />
                <Text style={styles.sectionTitle}><MapPin size={16} color={C.green} /> Destination</Text>
                <WorldPicker label="Destination country" value={destCountry} options={COUNTRY_OPTIONS} placeholder="Select country" onSelect={setDestCountry} />
                <WorldPicker label="Destination city" value={destCity} options={CITY_OPTIONS} placeholder="City" onSelect={setDestCity} />
              </View>
            )}

            {step === 1 && (
              <View style={styles.section}>
                <Text style={styles.helpText}>How should this cargo move?</Text>
                {FREIGHT_MODES.map((m) => {
                  const Icon = MODE_ICON[m.value];
                  const selected = mode === m.value;
                  return (
                    <TouchableOpacity key={m.value} activeOpacity={0.8} onPress={() => setMode(m.value)}
                      style={[styles.optionCard, selected && styles.optionCardActive]}>
                      <View style={[styles.optionIcon, selected && styles.optionIconActive]}>
                        <Icon size={20} color={selected ? C.white : C.blue} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionTitle}>{m.label}</Text>
                        <Text style={styles.optionSub}>{m.sublabel}</Text>
                      </View>
                      {selected ? <Check size={20} color={C.blue} /> : null}
                    </TouchableOpacity>
                  );
                })}
                {usesPort && (
                  <>
                    <WorldPicker label={`Origin ${portLabel} (optional)`} value={originPort} options={portOptions} placeholder={`Select ${portLabel}`} onSelect={setOriginPort} />
                    <WorldPicker label={`Destination ${portLabel} (optional)`} value={destPort} options={portOptions} placeholder={`Select ${portLabel}`} onSelect={setDestPort} />
                  </>
                )}
              </View>
            )}

            {step === 2 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}><Scale size={16} color={C.blue} /> Weight & volume</Text>
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
                <Input label="Total volume (CBM, optional)" value={volume} onChangeText={setVolume} keyboardType="numeric" placeholder="0" />
                <Text style={styles.sectionTitle}><Boxes size={16} color={C.blue} /> Dimensions & pieces</Text>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}><Input label={`L (${dimUnit})`} value={len} onChangeText={setLen} keyboardType="numeric" placeholder="0" /></View>
                  <View style={{ flex: 1 }}><Input label={`W (${dimUnit})`} value={wid} onChangeText={setWid} keyboardType="numeric" placeholder="0" /></View>
                  <View style={{ flex: 1 }}><Input label={`H (${dimUnit})`} value={hei} onChangeText={setHei} keyboardType="numeric" placeholder="0" /></View>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.unitToggle}>
                      {(['cm', 'in'] as const).map((u) => (
                        <TouchableOpacity key={u} onPress={() => setDimUnit(u)} style={[styles.unitBtn, dimUnit === u && styles.unitBtnActive]}>
                          <Text style={[styles.unitBtnText, dimUnit === u && styles.unitBtnTextActive]}>{u}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View style={{ flex: 1 }}><Input label="Pieces" value={pieces} onChangeText={setPieces} keyboardType="numeric" placeholder="1" /></View>
                </View>
              </View>
            )}

            {step === 3 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}><Package size={16} color={C.blue} /> Cargo details</Text>
                <Input label="Commodity / description" value={commodity} onChangeText={setCommodity} placeholder="e.g. Furniture, electronics" />
                <View style={styles.row}>
                  <View style={{ flex: 2 }}><Input label="Declared value" value={declaredValue} onChangeText={setDeclaredValue} keyboardType="numeric" placeholder="0" /></View>
                  <View style={{ flex: 1 }}><WorldPicker label="Currency" value={currency} options={CURRENCY_OPTIONS} placeholder="USD" onSelect={setCurrency} /></View>
                </View>
                <Input label="HS code (optional)" value={hsCode} onChangeText={setHsCode} placeholder="e.g. 9403.60" />
                <Input label="Notes for providers (optional)" value={notes} onChangeText={setNotes} placeholder="Anything else they should know" multiline numberOfLines={3} />
              </View>
            )}

            {step === 4 && (
              <View style={styles.section}>
                <Text style={styles.helpText}>How should the cargo reach the carrier?</Text>
                {DELIVERY_METHODS.map((d) => {
                  const selected = deliveryMethod === d.value;
                  return (
                    <TouchableOpacity key={d.value} activeOpacity={0.8} onPress={() => setDeliveryMethod(d.value)}
                      style={[styles.optionCard, selected && styles.optionCardActive]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionTitle}>{d.label}</Text>
                        <Text style={styles.optionSub}>{d.sublabel}</Text>
                      </View>
                      {selected ? <Check size={20} color={C.blue} /> : null}
                    </TouchableOpacity>
                  );
                })}
                {deliveryMethod === 'door_pickup' && (
                  <>
                    <Input label="Pickup address" value={pickupAddress} onChangeText={setPickupAddress} placeholder="Street, unit" />
                    <Input label="Pickup city" value={pickupCity} onChangeText={setPickupCity} placeholder="City" />
                  </>
                )}
                <TouchableOpacity activeOpacity={0.8} onPress={() => setNeedsContainerPickup((v) => !v)}
                  style={[styles.optionCard, needsContainerPickup && styles.optionCardActive]}>
                  <View style={[styles.checkbox, needsContainerPickup && styles.checkboxOn]}>
                    {needsContainerPickup ? <Check size={14} color={C.white} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>I also need container pickup / drayage</Text>
                    <Text style={styles.optionSub}>Trucking & drayage companies can quote this leg separately</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {step === 5 && (
              <View style={styles.section}>
                <Text style={styles.helpText}>Attach invoices, packing lists or other documents (optional).</Text>
                <Button label="Add document" onPress={pickDocument} variant="secondary" icon={<Upload size={16} color={C.text} />} />
                {docs.map((d, idx) => (
                  <View key={`${d.uri}-${idx}`} style={styles.docCard}>
                    <FileText size={18} color={C.blue} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docName} numberOfLines={1}>{d.name}</Text>
                      <View style={styles.docTypeRow}>
                        {FREIGHT_DOC_TYPES.map((t) => (
                          <TouchableOpacity key={t.value} onPress={() => setDocType(idx, t.value)}
                            style={[styles.docTypeChip, d.docType === t.value && styles.docTypeChipActive]}>
                            <Text style={[styles.docTypeText, d.docType === t.value && styles.docTypeTextActive]}>{t.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => removeDoc(idx)}><Trash2 size={18} color={C.red} /></TouchableOpacity>
                  </View>
                ))}
                {docs.length === 0 && <Text style={styles.emptyDocs}>No documents added yet.</Text>}
              </View>
            )}

            {step === 6 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Review your request</Text>
                <ReviewRow label="Mode" value={FREIGHT_MODE_LABEL[mode]} />
                <ReviewRow label="Route" value={`${originCity || originCountry}${originPort ? ` (${originPort})` : ''}  →  ${destCity || destCountry}${destPort ? ` (${destPort})` : ''}`} />
                <ReviewRow label="Weight" value={`${weight || '0'} ${weightUnit}${volume ? ` · ${volume} CBM` : ''}`} />
                <ReviewRow label="Pieces" value={pieces || '1'} />
                {commodity ? <ReviewRow label="Commodity" value={commodity} /> : null}
                {declaredValue ? <ReviewRow label="Declared value" value={`${declaredValue} ${currency}`} /> : null}
                <ReviewRow label="Delivery" value={DELIVERY_METHODS.find((d) => d.value === deliveryMethod)?.label ?? ''} />
                {(needsContainerPickup || deliveryMethod === 'door_pickup') ? <ReviewRow label="Ground leg" value="Container pickup / drayage requested" /> : null}
                <ReviewRow label="Documents" value={`${docs.length} attached`} />
                <View style={styles.reviewNotice}>
                  <Text style={styles.reviewNoticeText}>
                    After you submit, an admin reviews the request. Once approved it opens for competing quotes.
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Footer nav */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {step > 0 ? (
            <Button label="Back" onPress={goBack} variant="ghost" icon={<ChevronLeft size={16} color={C.textSecondary} />} />
          ) : <View style={{ flex: 1 }} />}
          {submitting ? (
            <View style={styles.submitLoading}><ActivityIndicator color={C.accent} /></View>
          ) : (
            <Button
              label={step === STEP_TITLES.length - 1 ? 'Submit request' : 'Continue'}
              onPress={goNext}
              disabled={!canProceed}
              icon={step === STEP_TITLES.length - 1 ? <Send size={16} color={C.white} /> : <ChevronRight size={16} color={C.white} />}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerStep: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  progressTrack: { height: 4, backgroundColor: C.card, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: C.blue, borderRadius: 2 },
  scroll: { padding: 16, paddingBottom: 40 },
  section: { gap: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  helpText: { fontSize: 14, color: C.textSecondary, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionCardActive: { borderColor: C.blue, backgroundColor: C.blueDim },
  optionIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim },
  optionIconActive: { backgroundColor: C.blue },
  optionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  optionSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  unitToggle: { flexDirection: 'row', gap: 6, backgroundColor: C.card, borderRadius: 10, padding: 4, borderWidth: 1, borderColor: C.border },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  unitBtnActive: { backgroundColor: C.blue },
  unitBtnText: { fontSize: 14, fontWeight: '700' as const, color: C.textSecondary },
  unitBtnTextActive: { color: C.white },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: C.blue, borderColor: C.blue },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  docName: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  docTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  docTypeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  docTypeChipActive: { backgroundColor: C.blueDim, borderColor: C.blue },
  docTypeText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  docTypeTextActive: { color: C.blue },
  emptyDocs: { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingVertical: 20 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  reviewLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  reviewValue: { fontSize: 14, color: C.text, fontWeight: '600' as const, flex: 1, textAlign: 'right' },
  reviewNotice: { padding: 14, borderRadius: 12, backgroundColor: C.yellowDim, borderWidth: 1, borderColor: C.yellow, marginTop: 8 },
  reviewNoticeText: { fontSize: 13, color: C.text, lineHeight: 19 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  submitLoading: { paddingHorizontal: 24, paddingVertical: 12 },
});
