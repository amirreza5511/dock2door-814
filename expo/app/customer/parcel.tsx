import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Svg, { Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';
import * as Print from 'expo-print';
import {
  Package, X, ChevronLeft, Printer, MapPin, Truck, CheckCircle2, Clock,
} from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Service = 'regular' | 'expedited' | 'xpresspost' | 'priority';
const SERVICES: { key: Service; label: string; eta: string }[] = [
  { key: 'regular', label: 'Regular', eta: '5–9 business days' },
  { key: 'expedited', label: 'Expedited', eta: '2–5 business days' },
  { key: 'xpresspost', label: 'Xpresspost', eta: '1–2 business days' },
  { key: 'priority', label: 'Priority', eta: 'Next business day' },
];
const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AED', 'CNY'] as const;

type Parcel = {
  id: string; tracking_number: string; status: string;
  to_name: string; to_city: string; to_region: string; to_country: string;
  from_city: string; from_country: string;
  service: string; price: number; currency: string;
  weight: number; weight_unit: string;
  length_cm: number; width_cm: number; height_cm: number; dim_unit: string;
  is_placeholder: boolean; created_at: string;
};

type Quote = { chargeable_kg: number; price: number; currency: string; is_placeholder: boolean };

/** Scannable QR barcode of the tracking number, rendered with react-native-svg. */
function TrackingBarcode({ value, size = 150 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const rects: { x: number; y: number }[] = [];
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) rects.push({ x: c, y: r });
      }
    }
    return { count, rects };
  }, [value]);
  const unit = size / cells.count;
  return (
    <Svg width={size} height={size}>
      <Rect x={0} y={0} width={size} height={size} fill="#fff" />
      {cells.rects.map((p, i) => (
        <Rect key={i} x={p.x * unit} y={p.y * unit} width={unit + 0.5} height={unit + 0.5} fill="#000" />
      ))}
    </Svg>
  );
}

export default function CustomerParcelScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const listQuery = trpc.parcel.mine.useQuery();
  const parcels = (listQuery.data ?? []) as Parcel[];
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [labelParcel, setLabelParcel] = useState<Parcel | null>(null);
  const onCreated = useCallback(async (parcel: Parcel | null) => {
    setWizardOpen(false);
    await utils.parcel.mine.invalidate();
    if (parcel) setLabelParcel(parcel);
  }, [utils]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Parcel Counter</Text>
            <Text style={styles.headerSub}>Ship a parcel, print a label</Text>
          </View>
          <Button label="New" size="sm" onPress={() => setWizardOpen(true)} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={listQuery.isFetching} onRefresh={() => listQuery.refetch()} tintColor={C.accent} />}
      >
        {listQuery.isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : parcels.length === 0 ? (
          <View style={styles.emptyState}>
            <Package size={44} color={C.textMuted} />
            <Text style={styles.emptyText}>No parcels yet</Text>
            <Text style={styles.emptySub}>Tap "New" to size a parcel, get a price, and print a drop-off label with a scannable barcode.</Text>
          </View>
        ) : parcels.map((p) => (
          <TouchableOpacity key={p.id} style={styles.card} activeOpacity={0.85} onPress={() => setLabelParcel(p)}>
            <View style={styles.cardHeader}>
              <View style={styles.trackingWrap}>
                <Package size={14} color={C.accent} />
                <Text style={styles.trackingText}>{p.tracking_number}</Text>
              </View>
              <StatusBadge status={p.status} />
            </View>
            <View style={styles.routeRow}>
              <MapPin size={13} color={C.textMuted} />
              <Text style={styles.routeText} numberOfLines={1}>
                {p.from_city || p.from_country} → {p.to_city}, {p.to_region || p.to_country}
              </Text>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.svcText}>{SERVICES.find((s) => s.key === p.service)?.label ?? p.service} · {p.weight} {p.weight_unit}</Text>
              <Text style={styles.priceText}>{p.currency} {Number(p.price).toFixed(2)}</Text>
            </View>
            <View style={styles.labelHint}>
              <Printer size={12} color={C.accent} />
              <Text style={styles.labelHintText}>Tap to view / print label</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {wizardOpen && (
        <ParcelWizard onClose={() => setWizardOpen(false)} onCreated={onCreated} />
      )}
      {labelParcel && <LabelModal parcel={labelParcel} onClose={() => setLabelParcel(null)} />}
    </View>
  );
}

function ParcelWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (parcel: Parcel | null) => void }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<number>(0);

  const [toName, setToName] = useState<string>('');
  const [toLine1, setToLine1] = useState<string>('');
  const [toCity, setToCity] = useState<string>('');
  const [toRegion, setToRegion] = useState<string>('');
  const [toPostal, setToPostal] = useState<string>('');
  const [toCountry, setToCountry] = useState<string>('CA');

  const [fromCity, setFromCity] = useState<string>('');
  const [fromRegion, setFromRegion] = useState<string>('');
  const [fromPostal, setFromPostal] = useState<string>('');

  const [length, setLength] = useState<string>('');
  const [width, setWidth] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [dimUnit, setDimUnit] = useState<'cm' | 'in'>('cm');
  const [weight, setWeight] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [service, setService] = useState<Service>('regular');
  const [currency, setCurrency] = useState<string>('CAD');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);

  const quoteMutation = trpc.parcel.quote.useMutation();
  const createMutation = trpc.parcel.create.useMutation();

  const refreshQuote = useCallback(async () => {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) { setQuote(null); return; }
    setQuoting(true);
    try {
      const q = await quoteMutation.mutateAsync({
        length: Number(length) || 0, width: Number(width) || 0, height: Number(height) || 0,
        dimUnit, weight: w, weightUnit, service, currency,
      });
      setQuote(q as Quote);
    } catch {
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }, [length, width, height, dimUnit, weight, weightUnit, service, currency, quoteMutation]);

  const goToPricing = useCallback(async () => {
    if (!toName.trim() || !toCity.trim()) { Alert.alert('Missing info', 'Recipient name and city are required.'); return; }
    setStep(1);
    await refreshQuote();
  }, [toName, toCity, refreshQuote]);

  const handleCreate = useCallback(async () => {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) { Alert.alert('Missing weight', 'Enter the parcel weight.'); return; }
    setCreating(true);
    try {
      const res = await createMutation.mutateAsync({
        toName: toName.trim(), toLine1, toCity: toCity.trim(), toRegion, toPostal, toCountry,
        fromCity, fromRegion, fromPostal,
        length: Number(length) || 0, width: Number(width) || 0, height: Number(height) || 0,
        dimUnit, weight: w, weightUnit, service, currency,
      });
      onCreated((res.parcel ?? null) as Parcel | null);
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to create parcel.');
    } finally {
      setCreating(false);
    }
  }, [toName, toLine1, toCity, toRegion, toPostal, toCountry, fromCity, fromRegion, fromPostal,
    length, width, height, dimUnit, weight, weightUnit, service, currency, createMutation, onCreated]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalTopBar}>
          <Text style={styles.modalTitle}>{step === 0 ? 'Addresses' : 'Size, service & price'}</Text>
          <TouchableOpacity onPress={onClose}><X size={24} color={C.text} /></TouchableOpacity>
        </View>
        <View style={styles.stepper}>
          {[0, 1].map((s) => <View key={s} style={[styles.stepDot, step >= s && styles.stepDotActive]} />)}
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {step === 0 ? (
            <>
              <Text style={styles.groupLabel}>Ship to</Text>
              <Input label="Recipient name *" value={toName} onChangeText={setToName} placeholder="Jane Doe" />
              <Input label="Address" value={toLine1} onChangeText={setToLine1} placeholder="123 King St W" />
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><Input label="City *" value={toCity} onChangeText={setToCity} placeholder="Toronto" /></View>
                <View style={{ flex: 1 }}><Input label="Region" value={toRegion} onChangeText={setToRegion} placeholder="ON" /></View>
              </View>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><Input label="Postal / ZIP" value={toPostal} onChangeText={setToPostal} placeholder="M5V 1J2" /></View>
                <View style={{ flex: 1 }}><Input label="Country" value={toCountry} onChangeText={setToCountry} placeholder="CA" /></View>
              </View>
              <Text style={[styles.groupLabel, { marginTop: 8 }]}>Ship from (optional)</Text>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><Input label="City" value={fromCity} onChangeText={setFromCity} placeholder="Vancouver" /></View>
                <View style={{ flex: 1 }}><Input label="Region" value={fromRegion} onChangeText={setFromRegion} placeholder="BC" /></View>
              </View>
              <Input label="Postal / ZIP" value={fromPostal} onChangeText={setFromPostal} placeholder="V6B 1A1" />
              <Button label="Continue" onPress={goToPricing} fullWidth size="lg" />
            </>
          ) : (
            <>
              <Text style={styles.groupLabel}>Dimensions</Text>
              <View style={styles.row3}>
                <View style={{ flex: 1 }}><Input label="L" value={length} onChangeText={setLength} keyboardType="numeric" placeholder="40" /></View>
                <View style={{ flex: 1 }}><Input label="W" value={width} onChangeText={setWidth} keyboardType="numeric" placeholder="30" /></View>
                <View style={{ flex: 1 }}><Input label="H" value={height} onChangeText={setHeight} keyboardType="numeric" placeholder="20" /></View>
              </View>
              <View style={styles.toggleRow}>
                {(['cm', 'in'] as const).map((u) => (
                  <TouchableOpacity key={u} onPress={() => setDimUnit(u)} style={[styles.togglePill, dimUnit === u && styles.togglePillActive]}>
                    <Text style={[styles.toggleText, dimUnit === u && styles.toggleTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.groupLabel}>Weight</Text>
              <View style={styles.row2}>
                <View style={{ flex: 2 }}><Input label="Weight *" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="3" /></View>
                <View style={styles.toggleRow}>
                  {(['kg', 'lb'] as const).map((u) => (
                    <TouchableOpacity key={u} onPress={() => setWeightUnit(u)} style={[styles.togglePill, weightUnit === u && styles.togglePillActive]}>
                      <Text style={[styles.toggleText, weightUnit === u && styles.toggleTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Text style={styles.groupLabel}>Service</Text>
              {SERVICES.map((s) => (
                <TouchableOpacity key={s.key} onPress={() => setService(s.key)} style={[styles.svcCard, service === s.key && styles.svcCardActive]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.svcTitle, service === s.key && { color: C.accent }]}>{s.label}</Text>
                    <Text style={styles.svcEta}>{s.eta}</Text>
                  </View>
                  {service === s.key && <CheckCircle2 size={20} color={C.accent} />}
                </TouchableOpacity>
              ))}
              <Text style={styles.groupLabel}>Currency</Text>
              <View style={styles.chipRow}>
                {CURRENCIES.map((cur) => (
                  <TouchableOpacity key={cur} onPress={() => setCurrency(cur)} style={[styles.chip, currency === cur && styles.chipActive]}>
                    <Text style={[styles.chipText, currency === cur && styles.chipTextActive]}>{cur}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Button label="Get price" variant="secondary" onPress={refreshQuote} fullWidth loading={quoting} />
              {quote && (
                <View style={styles.quoteCard}>
                  <Text style={styles.quoteLabel}>Estimated price</Text>
                  <Text style={styles.quotePrice}>{quote.currency} {Number(quote.price).toFixed(2)}</Text>
                  <Text style={styles.quoteMeta}>Chargeable weight {Number(quote.chargeable_kg).toFixed(1)} kg</Text>
                  {quote.is_placeholder && <Text style={styles.placeholderNote}>Placeholder rate — live Canada Post rates apply once API keys are added.</Text>}
                </View>
              )}
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><Button label="Back" variant="ghost" onPress={() => setStep(0)} fullWidth /></View>
                <View style={{ flex: 2 }}><Button label="Create & get label" onPress={handleCreate} loading={creating} fullWidth size="lg" /></View>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function LabelModal({ parcel, onClose }: { parcel: Parcel; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [printing, setPrinting] = useState<boolean>(false);
  const setStatusMutation = trpc.parcel.setStatus.useMutation({
    onSuccess: async () => { await utils.parcel.mine.invalidate(); },
  });

  const handlePrint = useCallback(async () => {
    setPrinting(true);
    try {
      const qr = qrcode(0, 'M');
      qr.addData(parcel.tracking_number);
      qr.make();
      const qrImg = qr.createDataURL(6, 8);
      const svc = SERVICES.find((s) => s.key === parcel.service)?.label ?? parcel.service;
      const html = `
        <html><head><meta name="viewport" content="width=device-width, initial-scale=1"/>
        <style>
          body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px;color:#111}
          .label{border:2px solid #111;border-radius:12px;padding:20px;max-width:420px;margin:0 auto}
          .row{display:flex;justify-content:space-between;align-items:flex-start}
          .svc{font-size:22px;font-weight:800;text-transform:uppercase}
          .ph{background:#ffe08a;color:#7a5900;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px}
          .sec{margin-top:14px;padding-top:14px;border-top:1px dashed #999}
          .lbl{font-size:10px;letter-spacing:1px;color:#666;text-transform:uppercase}
          .val{font-size:15px;font-weight:600;margin-top:2px}
          .qr{text-align:center;margin-top:16px}
          .track{font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;text-align:center;margin-top:6px}
        </style></head>
        <body><div class="label">
          <div class="row"><div class="svc">${svc}</div>${parcel.is_placeholder ? '<div class="ph">PLACEHOLDER</div>' : ''}</div>
          <div class="sec"><div class="lbl">To</div><div class="val">${parcel.to_name}</div>
            <div class="val">${parcel.to_city}, ${parcel.to_region || ''} ${parcel.to_country}</div></div>
          <div class="sec"><div class="lbl">Weight / Price</div>
            <div class="val">${parcel.weight} ${parcel.weight_unit} · ${parcel.currency} ${Number(parcel.price).toFixed(2)}</div></div>
          <div class="qr"><img src="${qrImg}" width="180" height="180"/></div>
          <div class="track">${parcel.tracking_number}</div>
        </div></body></html>`;
      await Print.printAsync({ html });
    } catch (e) {
      Alert.alert('Print failed', e instanceof Error ? e.message : 'Unable to open print dialog.');
    } finally {
      setPrinting(false);
    }
  }, [parcel]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalTopBar}>
          <Text style={styles.modalTitle}>Shipping Label</Text>
          <TouchableOpacity onPress={onClose}><X size={24} color={C.text} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <View style={styles.labelSheet}>
            <View style={styles.labelHeaderRow}>
              <Text style={styles.labelSvc}>{(SERVICES.find((s) => s.key === parcel.service)?.label ?? parcel.service).toUpperCase()}</Text>
              {parcel.is_placeholder && <View style={styles.phBadge}><Text style={styles.phBadgeText}>PLACEHOLDER</Text></View>}
            </View>
            <View style={styles.labelSec}>
              <Text style={styles.labelFieldLabel}>TO</Text>
              <Text style={styles.labelFieldVal}>{parcel.to_name}</Text>
              <Text style={styles.labelFieldVal}>{parcel.to_city}, {parcel.to_region || ''} {parcel.to_country}</Text>
            </View>
            <View style={styles.labelSec}>
              <Text style={styles.labelFieldLabel}>WEIGHT / PRICE</Text>
              <Text style={styles.labelFieldVal}>{parcel.weight} {parcel.weight_unit} · {parcel.currency} {Number(parcel.price).toFixed(2)}</Text>
            </View>
            <View style={styles.qrWrap}>
              <TrackingBarcode value={parcel.tracking_number} size={170} />
            </View>
            <Text style={styles.trackMono}>{parcel.tracking_number}</Text>
          </View>

          {parcel.is_placeholder && (
            <Text style={styles.placeholderNote}>
              This is a placeholder label & barcode so you can test the full flow. Real Canada Post labels + rates activate once you add your Canada Post API keys.
            </Text>
          )}

          <Button label="Print / share label" icon={<Printer size={18} color={C.white} />} onPress={handlePrint} loading={printing} fullWidth size="lg" />

          <Text style={styles.groupLabel}>Update status</Text>
          <View style={styles.statusRow}>
            {([
              { s: 'DroppedOff' as const, icon: Package, label: 'Dropped off' },
              { s: 'InTransit' as const, icon: Truck, label: 'In transit' },
              { s: 'Delivered' as const, icon: CheckCircle2, label: 'Delivered' },
            ]).map(({ s, icon: Icon, label }) => (
              <TouchableOpacity
                key={s}
                onPress={() => setStatusMutation.mutate({ id: parcel.id, status: s })}
                style={[styles.statusBtn, parcel.status === s && styles.statusBtnActive]}
              >
                <Icon size={16} color={parcel.status === s ? C.accent : C.textSecondary} />
                <Text style={[styles.statusBtnText, parcel.status === s && { color: C.accent }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.currentStatus}>
            <Clock size={14} color={C.textMuted} />
            <Text style={styles.currentStatusText}>Current: {parcel.status}</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  trackingWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trackingText: { fontSize: 14, fontWeight: '700' as const, color: C.text, fontFamily: 'monospace' as const },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  routeText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  svcText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  priceText: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  labelHint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  labelHintText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 17, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 19 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  stepper: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingTop: 12 },
  stepDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.border },
  stepDotActive: { backgroundColor: C.accent },
  groupLabel: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary, marginBottom: -4 },
  row2: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  row3: { flexDirection: 'row', gap: 8 },
  toggleRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  togglePill: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  togglePillActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  toggleText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  toggleTextActive: { color: C.accent, fontWeight: '700' as const },
  svcCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  svcCardActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  svcTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  svcEta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  quoteCard: { backgroundColor: C.accentDim, borderRadius: 14, borderWidth: 1, borderColor: C.accent, padding: 16, alignItems: 'center', gap: 2 },
  quoteLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  quotePrice: { fontSize: 30, fontWeight: '800' as const, color: C.accent, letterSpacing: -0.5 },
  quoteMeta: { fontSize: 12, color: C.textSecondary },
  placeholderNote: { fontSize: 12, color: C.yellow, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  labelSheet: { backgroundColor: C.white, borderRadius: 16, borderWidth: 2, borderColor: C.text, padding: 20 },
  labelHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelSvc: { fontSize: 22, fontWeight: '800' as const, color: '#111' },
  phBadge: { backgroundColor: '#ffe08a', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  phBadgeText: { fontSize: 10, fontWeight: '800' as const, color: '#7a5900' },
  labelSec: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#ddd' },
  labelFieldLabel: { fontSize: 10, letterSpacing: 1, color: '#777', fontWeight: '700' as const },
  labelFieldVal: { fontSize: 15, fontWeight: '600' as const, color: '#111', marginTop: 2 },
  qrWrap: { alignItems: 'center', marginTop: 16 },
  trackMono: { fontFamily: 'monospace' as const, fontSize: 18, fontWeight: '700' as const, letterSpacing: 2, color: '#111', textAlign: 'center', marginTop: 8 },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  statusBtnActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  statusBtnText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  currentStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  currentStatusText: { fontSize: 13, color: C.textMuted },
});
