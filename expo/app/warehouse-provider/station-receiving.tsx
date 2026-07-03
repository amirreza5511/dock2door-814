import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Modal, Platform } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { PackageOpen, ArrowLeft, CheckCircle2, AlertTriangle, History, ScanLine, Building2, Truck, QrCode, X, CalendarClock, ClipboardCheck, ChevronRight } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

const ACTIVE_INBOUND_STATUSES = ['Accepted', 'Confirmed', 'Scheduled', 'InProgress'];

interface ReceiptRow { id: string; reference?: string | null; status: string; supplier?: string | null; created_at: string }

interface LookupResult {
  booking: { id: string; reference_number?: string; pallets_requested?: number; start_date?: string; end_date?: string; status?: string; customer_notes?: string; handling_required?: boolean } | null;
  listing: { name?: string; address?: string; city?: string } | null;
  customer: { name?: string; contact_phone?: string; contact_email?: string } | null;
  receipt: { id: string; status?: string; arrived_at?: string } | null;
}

export default function ReceivingStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'wms.receive');

  const bootstrap = useDockBootstrapData();
  const activeCompanyId = activeCompany?.companyId ?? user?.companyId ?? null;
  const receipts = trpc.wms.listReceipts.useQuery();
  const locations = trpc.wms.listLocations.useQuery();
  const receive = trpc.wms.receive.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wms.listReceipts.invalidate(), utils.wms.listStockLevels.invalidate()]);
    },
  });
  const lookup = trpc.bookings.lookupByReference.useMutation();
  const confirmArrival = trpc.bookings.confirmArrival.useMutation({
    onSuccess: async () => { await utils.wms.listReceipts.invalidate(); },
  });

  const [variantId, setVariantId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const [lot, setLot] = useState<string>('');
  const [reference, setReference] = useState<string>('');
  const [receiptId, setReceiptId] = useState<string>('');
  const [refInput, setRefInput] = useState<string>('');
  const [found, setFound] = useState<LookupResult | null>(null);
  const [scanOpen, setScanOpen] = useState<boolean>(false);
  const [permission, requestPermission] = useCameraPermissions();

  const runLookup = async (raw: string): Promise<void> => {
    const value = raw.trim();
    if (!value) { Alert.alert('Enter a reference', 'Type or scan the booking reference number from the customer.'); return; }
    setRefInput(value);
    try {
      const res = await lookup.mutateAsync({ reference: value });
      setFound(res as LookupResult);
    } catch (err) {
      setFound(null);
      Alert.alert('Not found', err instanceof Error ? err.message : 'No booking matched that reference.');
    }
  };

  const doLookup = async () => { await runLookup(refInput); };

  const openScanner = async () => {
    if (Platform.OS === 'web') { Alert.alert('Scan on device', 'QR scanning works on the iOS/Android app. Type the reference here on web.'); return; }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { Alert.alert('Camera needed', 'Enable camera access to scan the Bill of Lading QR code.'); return; }
    }
    setScanOpen(true);
  };

  const onScanned = (result: BarcodeScanningResult) => {
    setScanOpen(false);
    void runLookup(result.data ?? '');
  };

  const confirmReceived = async () => {
    const ref = found?.booking?.reference_number ?? refInput.trim();
    try {
      const res = await confirmArrival.mutateAsync({ reference: ref });
      setReceiptId(res.receiptId);
      setReference(found?.booking?.reference_number ?? ref);
      Alert.alert('Cargo received ✅', 'The shipment is checked in. Next: tap “Inspect & issue GRN” to inspect and accept it — that automatically adds the goods to the customer’s inventory.');
      // refresh the lookup so the receipt/status shows as arrived
      try { const again = await lookup.mutateAsync({ reference: ref }); setFound(again as LookupResult); } catch { /* noop */ }
    } catch (err) {
      Alert.alert('Could not confirm', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const list = useMemo<ReceiptRow[]>(() => (receipts.data ?? []) as ReceiptRow[], [receipts.data]);
  const open = useMemo(() => list.filter((r) => r.status !== 'Completed'), [list]);
  const recent = useMemo(() => list.slice(0, 10), [list]);

  // Inbound schedule: bookings for this warehouse that are accepted/active and
  // expected to arrive. Sorted by expected date so today's arrivals surface first.
  const { warehouseListings, warehouseBookings, companies } = bootstrap.data;
  const myListingIds = useMemo(
    () => warehouseListings.filter((l) => l.companyId === activeCompanyId).map((l) => l.id),
    [warehouseListings, activeCompanyId],
  );
  const today = new Date().toISOString().slice(0, 10);
  const inbound = useMemo(() => {
    return warehouseBookings
      .filter((b) => myListingIds.includes(b.listingId) && ACTIVE_INBOUND_STATUSES.includes(b.status))
      .map((b) => {
        const when = (b.startDate ?? '').slice(0, 10);
        const bucket: 'overdue' | 'today' | 'upcoming' = !when ? 'upcoming' : when < today ? 'overdue' : when === today ? 'today' : 'upcoming';
        return { ...b, when, bucket };
      })
      .sort((a, b) => (a.when || '9999').localeCompare(b.when || '9999'));
  }, [warehouseBookings, myListingIds, today]);
  const customerName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Customer';

  const openJob = (ref: string) => { setRefInput(ref); void runLookup(ref); };
  const openGrn = (id: string) => router.push(`/fulfillment/grn/${id}` as never);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ title: 'Receiving' }} />
        <ScreenFeedback state="error" title="Not allowed" message={`Your role (${role ? ROLE_LABEL[role] : 'none'}) does not have wms.receive.`} />
        <View style={{ padding: 16 }}>
          <Button label="Back" onPress={() => router.back()} variant="secondary" />
        </View>
      </View>
    );
  }

  const submit = async () => {
    if (!variantId.trim() || !locationId.trim() || !qty.trim()) {
      Alert.alert('Missing info', 'Variant ID, location, and quantity are required.');
      return;
    }
    try {
      await receive.mutateAsync({
        receiptId: receiptId.trim() || undefined,
        variantId: variantId.trim(),
        locationId: locationId.trim(),
        quantity: Number(qty) || 0,
        lotCode: lot.trim() || undefined,
        reference: reference.trim() || undefined,
      });
      Alert.alert('Received', `Logged by ${user?.name ?? user?.email ?? 'operator'}.`);
      setVariantId(''); setQty(''); setLot('');
    } catch (err) {
      Alert.alert('Receive failed', err instanceof Error ? err.message : 'Unknown error');
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
          <Text style={styles.title}>Receiving Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.green + '20' }]}>
          <PackageOpen size={20} color={C.green} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={receipts.isFetching} onRefresh={() => void receipts.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={styles.statValue}>{open.length}</Text><Text style={styles.statLabel}>Open ASNs</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{list.length - open.length}</Text><Text style={styles.statLabel}>Completed</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: receive.isError ? C.red : C.text }]}>{receive.data ? '1' : '0'}</Text><Text style={styles.statLabel}>Last submit</Text></View>
        </View>

        <View style={styles.inboundHead}>
          <CalendarClock size={13} color={C.textSecondary} />
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Inbound schedule</Text>
        </View>
        {inbound.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No inbound cargo scheduled" description="Accepted bookings expected to arrive will appear here." />
        ) : inbound.slice(0, 12).map((b) => (
          <TouchableOpacity key={b.id} onPress={() => openJob(b.referenceNumber || '')} style={styles.jobRow} testID={`inbound-${b.id}`}>
            <View style={[styles.jobDot, b.bucket === 'today' ? { backgroundColor: C.green } : b.bucket === 'overdue' ? { backgroundColor: C.red } : { backgroundColor: C.textMuted }]} />
            <View style={{ flex: 1 }}>
              <View style={styles.jobTopRow}>
                <Text style={styles.jobRef}>{b.referenceNumber || b.id.slice(0, 8)}</Text>
                <View style={[styles.bucketTag, b.bucket === 'today' ? { backgroundColor: C.green + '18' } : b.bucket === 'overdue' ? { backgroundColor: C.red + '18' } : { backgroundColor: C.bgSecondary }]}>
                  <Text style={[styles.bucketText, b.bucket === 'today' ? { color: C.green } : b.bucket === 'overdue' ? { color: C.red } : { color: C.textMuted }]}>
                    {b.bucket === 'today' ? 'Today' : b.bucket === 'overdue' ? 'Overdue' : (b.when || 'TBD')}
                  </Text>
                </View>
              </View>
              <Text style={styles.jobMeta}>{customerName(b.customerCompanyId)} · {b.palletsRequested} pallets</Text>
            </View>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Check in by reference #</Text>
        <View style={styles.card}>
          <Text style={styles.helpText}>Driver at the dock? Enter the booking reference the customer gave (e.g. WB-1A2B3C4D) to load their details before you accept the cargo.</Text>
          <View style={styles.refRow}>
            <View style={{ flex: 1 }}>
              <Input label="Reference #" value={refInput} onChangeText={setRefInput} placeholder="WB-XXXXXXXX" autoCapitalize="characters" />
            </View>
            <Button label="Look up" onPress={() => void doLookup()} loading={lookup.isPending} icon={<ScanLine size={15} color={C.white} />} />
          </View>
          <TouchableOpacity onPress={() => void openScanner()} style={styles.scanBtn} testID="scan-qr">
            <QrCode size={16} color={C.accent} />
            <Text style={styles.scanBtnText}>Scan Bill of Lading QR</Text>
          </TouchableOpacity>

          {found?.booking ? (
            <View style={styles.foundBox}>
              <View style={styles.foundHeader}>
                <Text style={styles.foundRef}>{found.booking.reference_number}</Text>
                <StatusBadge status={found.receipt?.status ?? found.booking.status ?? 'Requested'} size="sm" />
              </View>
              <View style={styles.foundRowLine}>
                <Building2 size={13} color={C.accent} />
                <Text style={styles.foundCustomer}>{found.customer?.name ?? 'Unknown customer'}</Text>
              </View>
              {found.customer?.contact_phone ? (
                <Text style={styles.foundMeta}>{found.customer.contact_phone}</Text>
              ) : null}
              <Text style={styles.foundMeta}>{found.listing?.name ?? ''}{found.listing?.city ? ` · ${found.listing.city}` : ''}</Text>
              <Text style={styles.foundMeta}>{found.booking.pallets_requested ?? 0} pallets · {found.booking.start_date ?? '?'} → {found.booking.end_date ?? '?'}{found.booking.handling_required ? ' · handling' : ''}</Text>
              {found.booking.customer_notes ? (
                <Text style={styles.foundNotes}>“{found.booking.customer_notes}”</Text>
              ) : null}
              {found.receipt?.arrived_at ? (
                <>
                  <View style={styles.arrivedTag}>
                    <CheckCircle2 size={13} color={C.green} />
                    <Text style={styles.arrivedText}>Checked in · {new Date(found.receipt.arrived_at).toLocaleString()}</Text>
                  </View>
                  <Button
                    label="Inspect & issue GRN"
                    onPress={() => found.booking?.id && openGrn(found.booking.id)}
                    fullWidth
                    variant="outline"
                    icon={<ClipboardCheck size={15} color={C.accent} />}
                  />
                </>
              ) : (
                <Button
                  label="Confirm cargo received"
                  onPress={() => void confirmReceived()}
                  loading={confirmArrival.isPending}
                  fullWidth
                  icon={<Truck size={15} color={C.white} />}
                />
              )}
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Open ASNs</Text>
        {open.length === 0 ? (
          <EmptyState icon={PackageOpen} title="No open receipts" description="ASNs will appear here when scheduled." />
        ) : open.map((r) => (
          <TouchableOpacity key={r.id} onPress={() => { setReceiptId(r.id); setReference(r.reference ?? ''); }} style={[styles.row, receiptId === r.id && styles.rowActive]}>
            <PackageOpen size={14} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.reference || r.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{r.supplier ?? 'Unknown supplier'} · {new Date(r.created_at).toLocaleDateString()}</Text>
            </View>
            <StatusBadge status={r.status} size="sm" />
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Advanced: bin-level putaway (optional)</Text>
        <View style={styles.card}>
          <Text style={styles.helpText}>Issuing the GRN already adds the received goods to the customer’s inventory. Use this only if you also track exact SKU + bin locations in the WMS.</Text>
          <Input label="Receipt / ASN id" value={receiptId} onChangeText={setReceiptId} placeholder="optional" />
          <Input label="Variant / SKU id" value={variantId} onChangeText={setVariantId} placeholder="variant_…" />
          <Input label="Location id" value={locationId} onChangeText={setLocationId} placeholder="location_…" />
          {(locations.data ?? []).length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {(locations.data as { id: string; label?: string; zone?: string }[]).slice(0, 12).map((l) => (
                <TouchableOpacity key={l.id} onPress={() => setLocationId(l.id)} style={[styles.chip, locationId === l.id && styles.chipActive]}>
                  <Text style={[styles.chipText, locationId === l.id && styles.chipTextActive]}>{l.label || l.zone || l.id.slice(0, 6)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="48" />
          <Input label="Lot / batch" value={lot} onChangeText={setLot} placeholder="LOT-2026-04" autoCapitalize="characters" />
          <Input label="Reference" value={reference} onChangeText={setReference} placeholder="Supplier note" />
          <Button label="Receive & putaway" onPress={() => void submit()} loading={receive.isPending} fullWidth icon={<CheckCircle2 size={15} color={C.white} />} />
          {receive.error ? (
            <View style={styles.errBox}>
              <AlertTriangle size={13} color={C.red} />
              <Text style={styles.errText}>{receive.error.message}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}><History size={11} color={C.textSecondary} /> Recent receipts</Text>
        {recent.length === 0 ? (
          <EmptyState icon={History} title="No history yet" description="Your station's recent receipts will show here." />
        ) : recent.map((r) => (
          <View key={r.id} style={styles.row}>
            <PackageOpen size={14} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.reference || r.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{new Date(r.created_at).toLocaleString()}</Text>
            </View>
            <StatusBadge status={r.status} size="sm" />
          </View>
        ))}
      </ScrollView>

      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={styles.scanRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanOpen ? onScanned : undefined}
          />
          <View style={[styles.scanOverlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.scanTopRow}>
              <Text style={styles.scanTitle}>Scan the BOL QR</Text>
              <TouchableOpacity onPress={() => setScanOpen(false)} style={styles.scanClose}><X size={20} color={C.white} /></TouchableOpacity>
            </View>
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>Point the camera at the QR code on the driver's Bill of Lading.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBubble: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  body: { padding: 16, gap: 10 },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  chipRow: { gap: 6, paddingVertical: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 11, fontWeight: '700' as const, color: C.textSecondary },
  chipTextActive: { color: C.accent },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: C.red + '15', borderRadius: 8, borderWidth: 1, borderColor: C.red },
  errText: { flex: 1, fontSize: 11, color: C.red },
  helpText: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  inboundHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  jobDot: { width: 8, height: 8, borderRadius: 4 },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobRef: { fontSize: 13, fontWeight: '800' as const, color: C.text, letterSpacing: 0.4 },
  jobMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  bucketTag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  bucketText: { fontSize: 10, fontWeight: '700' as const },
  refRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  foundBox: { backgroundColor: C.bgSecondary, borderRadius: 12, borderWidth: 1, borderColor: C.accent + '55', padding: 12, gap: 6 },
  foundHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  foundRef: { fontSize: 15, fontWeight: '800' as const, color: C.text, letterSpacing: 0.5 },
  foundRowLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  foundCustomer: { fontSize: 14, fontWeight: '700' as const, color: C.accent },
  foundMeta: { fontSize: 12, color: C.textSecondary },
  foundNotes: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const, marginTop: 2 },
  arrivedTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  arrivedText: { fontSize: 12, color: C.green, fontWeight: '600' as const },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.accent + '55', backgroundColor: C.accentDim },
  scanBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  scanRoot: { flex: 1, backgroundColor: '#000' },
  scanOverlay: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  scanTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scanTitle: { fontSize: 18, fontWeight: '800' as const, color: C.white },
  scanClose: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  scanFrame: { alignSelf: 'center', width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: C.white },
  scanHint: { fontSize: 13, color: C.white, textAlign: 'center' as const, opacity: 0.85, lineHeight: 19 },
});
