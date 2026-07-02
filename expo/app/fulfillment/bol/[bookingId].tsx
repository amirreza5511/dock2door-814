import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as Print from 'expo-print';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Printer, Truck, User, Package, FileText, CheckCircle2, Building2 } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { useAuthStore } from '@/store/auth';
import type { TransportMode } from '@/constants/types';

const MODES: { key: Exclude<TransportMode, 'unspecified'>; label: string; hint: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { key: 'own_driver', label: 'Dock2Door driver', hint: 'One of our carriers hauls it', icon: Truck },
  { key: 'self_delivery', label: 'I bring it myself', hint: 'Own car / van, no carrier', icon: User },
  { key: 'third_party', label: 'Third-party carrier', hint: 'An outside trucking company', icon: Building2 },
];

const MODE_LABEL: Record<TransportMode, string> = {
  unspecified: 'Not specified',
  own_driver: 'Dock2Door driver',
  self_delivery: 'Self delivery',
  third_party: 'Third-party carrier',
};

function qrUrl(data: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}

export default function BillOfLadingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const bootstrap = useDockBootstrapData();
  const utils = trpc.useUtils();

  const { warehouseBookings, warehouseListings, companies } = bootstrap.data;
  const booking = useMemo(() => warehouseBookings.find((b) => b.id === bookingId) ?? null, [warehouseBookings, bookingId]);
  const listing = useMemo(() => warehouseListings.find((l) => l.id === booking?.listingId) ?? null, [warehouseListings, booking]);
  const warehouseCo = useMemo(() => companies.find((c) => c.id === listing?.companyId) ?? null, [companies, listing]);
  const customerCo = useMemo(() => companies.find((c) => c.id === booking?.customerCompanyId) ?? null, [companies, booking]);

  const isCustomer = booking?.customerCompanyId === user?.companyId;

  const [mode, setMode] = useState<TransportMode>(booking?.transportMode ?? 'unspecified');
  const [carrier, setCarrier] = useState<string>(booking?.carrierName ?? '');
  const [driver, setDriver] = useState<string>(booking?.driverName ?? '');
  const [plate, setPlate] = useState<string>(booking?.vehiclePlate ?? '');
  const [cargo, setCargo] = useState<string>(booking?.cargoDescription ?? '');
  const [pieces, setPieces] = useState<string>(booking?.declaredPieces != null ? String(booking.declaredPieces) : '');
  const [weight, setWeight] = useState<string>(booking?.declaredWeightKg != null ? String(booking.declaredWeightKg) : '');

  const setTransport = trpc.bookings.setTransport.useMutation({
    onSuccess: async () => {
      await utils.dock.bootstrap.invalidate();
      await utils.bookings.listMine.invalidate();
    },
  });

  if (bootstrap.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading document" /></View>;
  }
  if (!booking) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg, paddingTop: insets.top + 40 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenFeedback state="error" title="Booking not found" message="This booking is no longer available." />
        <View style={{ padding: 16 }}><Button label="Back" variant="secondary" onPress={() => router.back()} /></View>
      </View>
    );
  }

  const ref = booking.referenceNumber || `WB-${booking.id.slice(0, 8).toUpperCase()}`;
  const issued = booking.bolIssuedAt;

  const save = async (issue: boolean) => {
    try {
      await setTransport.mutateAsync({
        bookingId: booking.id,
        transportMode: mode === 'unspecified' ? undefined : mode,
        carrierName: carrier.trim(),
        driverName: driver.trim(),
        vehiclePlate: plate.trim().toUpperCase(),
        cargoDescription: cargo.trim(),
        declaredPieces: pieces.trim() ? Number(pieces) : null,
        declaredWeightKg: weight.trim() ? Number(weight) : null,
        issueBol: issue,
      });
      Alert.alert(issue ? 'Bill of Lading issued ✅' : 'Saved', issue ? 'The BOL is ready to print or hand to the driver.' : 'Transport details updated.');
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const printHtml = (): string => {
    const row = (label: string, value: string) => `<tr><td class="l">${label}</td><td class="v">${value || '—'}</td></tr>`;
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { font-family: -apple-system, Helvetica, Arial, sans-serif; }
      body { padding: 28px; color: #111; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111; padding-bottom: 12px; }
      .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
      .doc { text-align: right; }
      .doc h1 { font-size: 16px; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
      .ref { font-size: 24px; font-weight: 800; margin-top: 4px; }
      .grid { display: flex; gap: 16px; margin-top: 20px; }
      .box { flex: 1; border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
      .box h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
      .box p { margin: 2px 0; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      td { padding: 9px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
      td.l { color: #666; width: 42%; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
      td.v { font-weight: 600; }
      .qr { text-align: center; margin-top: 24px; }
      .qr img { width: 150px; height: 150px; }
      .qr p { font-size: 11px; color: #666; margin-top: 6px; }
      .sign { display: flex; gap: 16px; margin-top: 40px; }
      .sign div { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 11px; color: #666; }
      .foot { margin-top: 30px; font-size: 10px; color: #999; text-align: center; }
    </style></head><body>
      <div class="top">
        <div><div class="brand">Dock2Door</div><div style="font-size:11px;color:#666">Warehouse Bill of Lading</div></div>
        <div class="doc"><h1>Bill of Lading</h1><div class="ref">${ref}</div>
        <div style="font-size:11px;color:#666">${new Date().toLocaleDateString()}</div></div>
      </div>
      <div class="grid">
        <div class="box"><h3>Shipper (Customer)</h3>
          <p><b>${customerCo?.name ?? '—'}</b></p>
          <p>${customerCo?.address ?? ''} ${customerCo?.city ?? ''}</p>
        </div>
        <div class="box"><h3>Consignee (Warehouse)</h3>
          <p><b>${warehouseCo?.name ?? listing?.name ?? '—'}</b></p>
          <p>${listing?.address ?? ''} ${listing?.city ?? ''}</p>
        </div>
      </div>
      <table>
        ${row('Transport mode', MODE_LABEL[mode])}
        ${row('Carrier', carrier)}
        ${row('Driver', driver)}
        ${row('Vehicle plate', plate)}
        ${row('Cargo description', cargo)}
        ${row('Pallets booked', String(booking.palletsRequested))}
        ${row('Pieces declared', pieces)}
        ${row('Weight (kg)', weight)}
        ${row('Handling required', booking.handlingRequired ? 'Yes' : 'No')}
        ${row('Storage window', `${booking.startDate} → ${booking.endDate}`)}
      </table>
      <div class="qr">
        <img src="${qrUrl(ref, 300)}" />
        <p>Receiving: scan or enter <b>${ref}</b> to check in this cargo.</p>
      </div>
      <div class="sign">
        <div>Driver signature</div>
        <div>Received by (warehouse)</div>
      </div>
      <div class="foot">Generated by Dock2Door · This document travels with the cargo.</div>
    </body></html>`;
  };

  const doPrint = async () => {
    try {
      if (Platform.OS === 'web') {
        await Print.printAsync({ html: printHtml() });
      } else {
        const { uri } = await Print.printToFileAsync({ html: printHtml() });
        await Print.printAsync({ uri });
      }
    } catch (err) {
      if (err instanceof Error && /cancel/i.test(err.message)) return;
      Alert.alert('Print failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back">
          <ArrowLeft size={18} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Bill of Lading</Text>
          <Text style={styles.subtitle}>{ref}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.accent + '20' }]}>
          <FileText size={20} color={C.accent} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 90 }]}>
        {/* BOL document card */}
        <View style={styles.docCard}>
          <View style={styles.docTop}>
            <View>
              <Text style={styles.brand}>Dock2Door</Text>
              <Text style={styles.docKind}>Warehouse Bill of Lading</Text>
            </View>
            {issued ? (
              <View style={styles.issuedTag}>
                <CheckCircle2 size={12} color={C.green} />
                <Text style={styles.issuedText}>Issued</Text>
              </View>
            ) : (
              <View style={styles.draftTag}><Text style={styles.draftText}>Draft</Text></View>
            )}
          </View>

          <View style={styles.refBlock}>
            <View style={{ flex: 1 }}>
              <Text style={styles.refLabel}>BOL / Reference #</Text>
              <Text style={styles.refValue}>{ref}</Text>
            </View>
            <Image source={{ uri: qrUrl(ref) }} style={styles.qr} contentFit="contain" transition={150} />
          </View>

          <View style={styles.partyRow}>
            <View style={styles.party}>
              <Text style={styles.partyLabel}>Shipper</Text>
              <Text style={styles.partyName}>{customerCo?.name ?? '—'}</Text>
              <Text style={styles.partyMeta}>{[customerCo?.address, customerCo?.city].filter(Boolean).join(', ') || '—'}</Text>
            </View>
            <View style={styles.party}>
              <Text style={styles.partyLabel}>Consignee</Text>
              <Text style={styles.partyName}>{warehouseCo?.name ?? listing?.name ?? '—'}</Text>
              <Text style={styles.partyMeta}>{[listing?.address, listing?.city].filter(Boolean).join(', ') || '—'}</Text>
            </View>
          </View>

          <View style={styles.cargoRow}>
            <Package size={13} color={C.textSecondary} />
            <Text style={styles.cargoText}>{booking.palletsRequested} pallets · {booking.startDate} → {booking.endDate}{booking.handlingRequired ? ' · handling' : ''}</Text>
          </View>
        </View>

        {/* Transport declaration (customer editable) */}
        <Text style={styles.sectionTitle}>How the cargo arrives</Text>
        {isCustomer ? (
          <>
            <View style={styles.modeRow}>
              {MODES.map((m) => {
                const active = mode === m.key;
                const Icon = m.icon;
                return (
                  <TouchableOpacity key={m.key} onPress={() => setMode(m.key)} style={[styles.modeCard, active && styles.modeCardActive]}>
                    <Icon size={18} color={active ? C.accent : C.textSecondary} />
                    <Text style={[styles.modeLabel, active && { color: C.accent }]}>{m.label}</Text>
                    <Text style={styles.modeHint}>{m.hint}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.card}>
              {mode === 'third_party' ? (
                <Input label="Carrier / trucking company" value={carrier} onChangeText={setCarrier} placeholder="ACME Freight" />
              ) : null}
              {mode !== 'self_delivery' ? (
                <Input label="Driver name" value={driver} onChangeText={setDriver} placeholder="Driver full name" />
              ) : null}
              <Input label="Vehicle plate" value={plate} onChangeText={setPlate} placeholder="ABC-1234" autoCapitalize="characters" />
              <Input label="Cargo description" value={cargo} onChangeText={setCargo} placeholder="e.g. 12 pallets dry goods" />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}><Input label="Pieces" value={pieces} onChangeText={setPieces} keyboardType="numeric" placeholder="0" /></View>
                <View style={{ flex: 1 }}><Input label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="0" /></View>
              </View>
              <Button label={issued ? 'Update & re-issue BOL' : 'Issue Bill of Lading'} onPress={() => void save(true)} loading={setTransport.isPending} fullWidth icon={<FileText size={15} color={C.white} />} />
              <Button label="Save draft" onPress={() => void save(false)} variant="ghost" fullWidth />
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <ReadRow label="Transport" value={MODE_LABEL[mode]} />
            {carrier ? <ReadRow label="Carrier" value={carrier} /> : null}
            {driver ? <ReadRow label="Driver" value={driver} /> : null}
            {plate ? <ReadRow label="Vehicle" value={plate} /> : null}
            {cargo ? <ReadRow label="Cargo" value={cargo} /> : null}
            {pieces ? <ReadRow label="Pieces" value={pieces} /> : null}
            {weight ? <ReadRow label="Weight" value={`${weight} kg`} /> : null}
          </View>
        )}

        <Button label="Print / Save PDF" onPress={() => void doPrint()} fullWidth size="lg" icon={<Printer size={16} color={C.white} />} />
        <Text style={styles.footNote}>The driver shows reference {ref} (or its QR) at the warehouse gate. Receiving scans or types it to check the cargo in.</Text>
      </ScrollView>
    </View>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readRow}>
      <Text style={styles.readLabel}>{label}</Text>
      <Text style={styles.readValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBubble: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textMuted, marginTop: 2, letterSpacing: 0.5 },
  body: { padding: 16, gap: 12 },
  docCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 14 },
  docTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  docKind: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  issuedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.green + '18', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  issuedText: { fontSize: 11, color: C.green, fontWeight: '700' as const },
  draftTag: { backgroundColor: C.bgSecondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  draftText: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const },
  refBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12 },
  refLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  refValue: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: 0.5, marginTop: 4 },
  qr: { width: 74, height: 74, borderRadius: 8, backgroundColor: C.white },
  partyRow: { flexDirection: 'row', gap: 10 },
  party: { flex: 1, gap: 2 },
  partyLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  partyName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  partyMeta: { fontSize: 11, color: C.textSecondary },
  cargoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  cargoText: { fontSize: 12, color: C.textSecondary },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 6 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeCard: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, gap: 4, alignItems: 'flex-start' },
  modeCardActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  modeLabel: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  modeHint: { fontSize: 10, color: C.textMuted, lineHeight: 13 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  twoCol: { flexDirection: 'row', gap: 10 },
  readRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  readLabel: { fontSize: 12, color: C.textMuted },
  readValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  footNote: { fontSize: 11, color: C.textMuted, textAlign: 'center' as const, lineHeight: 16, marginTop: 4 },
});
