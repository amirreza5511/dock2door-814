import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Modal, Platform, KeyboardAvoidingView, TextInput } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { PackageOpen, ArrowLeft, CheckCircle2, AlertTriangle, History, ScanLine, Building2, Truck, QrCode, X, CalendarClock, ClipboardCheck, ChevronRight, Boxes, MapPin, Plus, Search } from 'lucide-react-native';
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

interface ReceiptRow { id: string; reference_code?: string | null; status: string; supplier?: string | null; created_at: string }

interface VariantRow { id: string; sku: string; name?: string | null; barcode?: string | null; product_id?: string; products?: { name?: string | null; company_id?: string | null } | null }

interface LocationRow { id: string; code?: string | null; zone?: string | null; aisle?: string | null; rack?: string | null; level?: string | null; bin?: string | null; pallet_capacity?: number; accepts_oversize?: boolean; pallets_used?: number }

type PalletType = 'standard' | 'oversize';
interface PlacedPallet { n: number; location: string; type: PalletType; sku: string }

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
  const variants = trpc.inventory.listAllVariants.useQuery();
  const issuedGrns = trpc.grn.listIssued.useQuery();
  const createLoc = trpc.wms.createLocation.useMutation({ onSuccess: async () => { await utils.wms.listLocations.invalidate(); } });
  const createProduct = trpc.inventory.createProduct.useMutation();
  const upsertVariant = trpc.inventory.upsertVariant.useMutation({ onSuccess: async () => { await utils.inventory.listAllVariants.invalidate(); } });
  const putaway = trpc.wms.putawayPallet.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wms.listReceipts.invalidate(), utils.wms.listStockLevels.invalidate(), utils.wms.listLocations.invalidate()]);
    },
  });
  const autoPutaway = trpc.wms.autoPutaway.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wms.listReceipts.invalidate(), utils.wms.listStockLevels.invalidate(), utils.wms.listLocations.invalidate()]);
    },
  });
  const lookup = trpc.bookings.lookupByReference.useMutation();
  const confirmArrival = trpc.bookings.confirmArrival.useMutation({
    onSuccess: async () => { await utils.wms.listReceipts.invalidate(); },
  });

  const [variantId, setVariantId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const [bulkCount, setBulkCount] = useState<string>('');
  const [lot, setLot] = useState<string>('');
  const [palletType, setPalletType] = useState<PalletType>('standard');
  const [autoMode, setAutoMode] = useState<'auto' | 'choose'>('auto');
  const [placed, setPlaced] = useState<PlacedPallet[]>([]);
  const [reference, setReference] = useState<string>('');
  const [receiptId, setReceiptId] = useState<string>('');
  const [refInput, setRefInput] = useState<string>('');
  const [found, setFound] = useState<LookupResult | null>(null);
  const [scanOpen, setScanOpen] = useState<boolean>(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [skuPickerOpen, setSkuPickerOpen] = useState<boolean>(false);
  const [locPickerOpen, setLocPickerOpen] = useState<boolean>(false);
  const [skuSearch, setSkuSearch] = useState<string>('');
  const [newSku, setNewSku] = useState<string>('');
  const [newSkuName, setNewSkuName] = useState<string>('');
  const [newLoc, setNewLoc] = useState<{ code: string; zone: string; aisle: string; rack: string; level: string; bin: string; capacity: string; oversize: boolean }>({ code: '', zone: '', aisle: '', rack: '', level: '', bin: '', capacity: '1', oversize: false });

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

  // Map booking_id -> issued GRN so lists can show a persisted "inspected" (green) state.
  const grnByBooking = useMemo(() => {
    const rows = (issuedGrns.data ?? []) as { booking_id?: string | null; inspection_status?: string; grn_number?: string }[];
    const map = new Map<string, { status: string; grnNumber: string }>();
    for (const r of rows) {
      if (r.booking_id && !map.has(r.booking_id)) {
        map.set(r.booking_id, { status: r.inspection_status ?? 'good', grnNumber: r.grn_number ?? '' });
      }
    }
    return map;
  }, [issuedGrns.data]);
  const foundGrn = found?.booking?.id ? grnByBooking.get(found.booking.id) ?? null : null;

  const openJob = (ref: string) => { setRefInput(ref); void runLookup(ref); };
  const openGrn = (id: string) => router.push(`/fulfillment/grn/${id}` as never);

  const variantList = useMemo<VariantRow[]>(() => (variants.data ?? []) as VariantRow[], [variants.data]);
  const locationList = useMemo<LocationRow[]>(() => (locations.data ?? []) as LocationRow[], [locations.data]);
  const selectedVariant = useMemo(() => variantList.find((v) => v.id === variantId) ?? null, [variantList, variantId]);
  const selectedLocation = useMemo(() => locationList.find((l) => l.id === locationId) ?? null, [locationList, locationId]);
  const locIsFull = (l: LocationRow): boolean => (l.pallets_used ?? 0) >= Math.max(l.pallet_capacity ?? 1, 1);
  const locFreeSlots = (l: LocationRow): number => Math.max((l.pallet_capacity ?? 1) - (l.pallets_used ?? 0), 0);
  // Slots the operator can actually use for the current pallet type.
  const availableLocations = useMemo(
    () => locationList.filter((l) => !locIsFull(l) && (palletType === 'standard' || l.accepts_oversize)),
    [locationList, palletType],
  );
  const filteredVariants = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    const base = q ? variantList.filter((v) => (v.sku ?? '').toLowerCase().includes(q) || (v.name ?? '').toLowerCase().includes(q)) : variantList;
    return base.slice(0, 50);
  }, [variantList, skuSearch]);
  const varLabel = (v: VariantRow): string => `${v.sku}${v.name ? ` · ${v.name}` : ''}`;
  const locLabel = (l: LocationRow): string => [l.zone, l.aisle, l.rack, l.level, l.bin].map((x) => (x ?? '').trim()).filter(Boolean).join('-') || (l.code ?? '').trim() || l.id.slice(0, 6);

  const handleCreateSku = async (): Promise<void> => {
    const sku = newSku.trim();
    if (!sku) { Alert.alert('SKU required', 'Enter a SKU code (e.g. ACME-001).'); return; }
    try {
      const prod = await createProduct.mutateAsync({ name: newSkuName.trim() || sku });
      const v = await upsertVariant.mutateAsync({ productId: prod.id, sku, name: newSkuName.trim() });
      setVariantId(v.id);
      setNewSku(''); setNewSkuName(''); setSkuSearch(''); setSkuPickerOpen(false);
    } catch (err) {
      Alert.alert('Could not add SKU', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleCreateLoc = async (): Promise<void> => {
    if (!newLoc.zone.trim() && !newLoc.rack.trim() && !newLoc.code.trim()) {
      Alert.alert('Location needs a label', 'Enter at least a zone, rack, or code.');
      return;
    }
    try {
      const res = await createLoc.mutateAsync({
        listingId: myListingIds[0] ?? undefined,
        code: newLoc.code.trim(), zone: newLoc.zone.trim(), aisle: newLoc.aisle.trim(),
        rack: newLoc.rack.trim(), level: newLoc.level.trim(), bin: newLoc.bin.trim(),
        palletCapacity: Math.max(Number(newLoc.capacity) || 1, 1),
        acceptsOversize: newLoc.oversize,
      });
      setLocationId(res.id);
      setNewLoc({ code: '', zone: '', aisle: '', rack: '', level: '', bin: '', capacity: '1', oversize: false });
      setLocPickerOpen(false);
    } catch (err) {
      Alert.alert('Could not add location', err instanceof Error ? err.message : 'Unknown error');
    }
  };

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

  const totalFreeSlots = useMemo(
    () => availableLocations.reduce((sum, l) => sum + locFreeSlots(l), 0),
    [availableLocations],
  );

  const autoSubmit = async () => {
    const count = Math.max(Math.floor(Number(bulkCount)) || 0, 0);
    if (count <= 0) { Alert.alert('How many pallets?', 'Enter the number of pallets to put away (e.g. 22).'); return; }
    if (totalFreeSlots <= 0) { Alert.alert('No free slots', 'Add more racking locations below — every empty slot holds one pallet.'); return; }
    if (autoMode === 'choose' && !locationId.trim()) {
      Alert.alert('Pick a start location', 'Choose which shelf/rack to fill first — pallets fill it, then continue to the next open slots.');
      return;
    }
    try {
      const res = await autoPutaway.mutateAsync({
        count,
        variantId: variantId.trim() || undefined,
        palletType,
        unitsPerPallet: Math.max(Number(qty) || 1, 1),
        receiptId: receiptId.trim() || undefined,
        lotCode: lot.trim() || undefined,
        reference: reference.trim() || undefined,
        startLocationId: autoMode === 'choose' ? locationId.trim() || undefined : undefined,
      });
      // Mirror the placements into the session list so the operator sees them.
      setPlaced((prev) => {
        const base = prev.length;
        const rows: PlacedPallet[] = Array.from({ length: res.placed }, (_, i) => ({
          n: base + i + 1,
          location: 'auto-assigned',
          type: palletType,
          sku: selectedVariant ? selectedVariant.sku : '—',
        }));
        return [...rows.reverse(), ...prev];
      });
      setBulkCount('');
      if (res.remaining > 0) {
        Alert.alert('Partly put away', `Placed ${res.placed} of ${res.requested} pallets — ran out of free slots. Add ${res.remaining} more slot${res.remaining > 1 ? 's' : ''} of racking to finish.`);
      } else {
        Alert.alert('Put away ✅', `All ${res.placed} pallets were auto-assigned to open slots and added to inventory.`);
      }
    } catch (err) {
      Alert.alert('Auto putaway failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const submit = async () => {
    if (!locationId.trim()) {
      Alert.alert('Pick a slot', 'Select the shelf/rack slot to place this pallet in.');
      return;
    }
    const loc = selectedLocation;
    if (loc && locIsFull(loc)) {
      Alert.alert('Slot full', 'That slot already holds a pallet. Pick an empty slot — each slot holds one pallet.');
      return;
    }
    if (palletType === 'oversize' && loc && !loc.accepts_oversize) {
      Alert.alert('Not an oversize slot', 'This over-standard pallet needs a slot marked as oversize-capable.');
      return;
    }
    try {
      await putaway.mutateAsync({
        receiptId: receiptId.trim() || undefined,
        variantId: variantId.trim() || undefined,
        locationId: locationId.trim(),
        palletType,
        units: Math.max(Number(qty) || 1, 1),
        lotCode: lot.trim() || undefined,
        reference: reference.trim() || undefined,
      });
      setPlaced((prev) => [
        { n: prev.length + 1, location: loc ? locLabel(loc) : '—', type: palletType, sku: selectedVariant ? selectedVariant.sku : '—' },
        ...prev,
      ]);
      // Clear the slot for the next pallet; keep SKU + pallet type for speed.
      setLocationId('');
    } catch (err) {
      Alert.alert('Putaway failed', err instanceof Error ? err.message : 'Unknown error');
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 60}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={receipts.isFetching} onRefresh={() => void receipts.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.statRow}>
          <View style={styles.stat}><Text style={styles.statValue}>{open.length}</Text><Text style={styles.statLabel}>Open ASNs</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{list.length - open.length}</Text><Text style={styles.statLabel}>Completed</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: putaway.isError ? C.red : C.text }]}>{placed.length}</Text><Text style={styles.statLabel}>Put away</Text></View>
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
          <TouchableOpacity key={r.id} onPress={() => { setReceiptId(r.id); setReference(r.reference_code ?? ''); }} style={[styles.row, receiptId === r.id && styles.rowActive]}>
            <PackageOpen size={14} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.reference_code || r.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{r.supplier ?? 'Unknown supplier'} · {new Date(r.created_at).toLocaleDateString()}</Text>
            </View>
            <StatusBadge status={r.status} size="sm" />
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Auto putaway — whole shipment</Text>
        <View style={styles.card}>
          <Text style={styles.helpText}>Same SKU on every pallet? Enter the count, pick the SKU, and tap once — each pallet goes into its own open slot and is added to inventory. One pallet per slot, no hand-typing.</Text>

          <Text style={styles.fieldLabel}>Placement</Text>
          <View style={styles.typeRow}>
            {([['auto', 'Auto-assign slots'], ['choose', 'Choose location']] as const).map(([m, label]) => (
              <TouchableOpacity
                key={m}
                style={[styles.typeChip, autoMode === m && styles.typeChipActive]}
                onPress={() => { setAutoMode(m); if (m === 'auto') setLocationId(''); }}
                testID={`auto-mode-${m}`}
              >
                <Text style={[styles.typeChipText, autoMode === m && styles.typeChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {autoMode === 'choose' ? (
            <>
              <Text style={styles.fieldLabel}>Start location</Text>
              <TouchableOpacity style={styles.picker} onPress={() => setLocPickerOpen(true)} testID="auto-pick-location">
                <MapPin size={16} color={selectedLocation ? C.accent : C.textMuted} />
                <Text style={[styles.pickerText, !selectedLocation && styles.pickerPlaceholder]} numberOfLines={1}>
                  {selectedLocation ? `${locLabel(selectedLocation)} · ${locFreeSlots(selectedLocation)} free` : `Pick where to start (${availableLocations.length} open)`}
                </Text>
                <ChevronRight size={16} color={C.textMuted} />
              </TouchableOpacity>
              <Text style={styles.helpTextMuted}>Pallets fill this location first, then spill over to the next open slots automatically.</Text>
            </>
          ) : null}

          <Text style={styles.fieldLabel}>Pallet type</Text>
          <View style={styles.typeRow}>
            {(['standard', 'oversize'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, palletType === t && styles.typeChipActive]}
                onPress={() => { setPalletType(t); setLocationId(''); }}
                testID={`auto-pallet-type-${t}`}
              >
                <Text style={[styles.typeChipText, palletType === t && styles.typeChipTextActive]}>{t === 'standard' ? 'Standard pallet' : 'Over-standard'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>SKU (optional)</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setSkuPickerOpen(true)} testID="auto-pick-sku">
            <Boxes size={16} color={selectedVariant ? C.accent : C.textMuted} />
            <Text style={[styles.pickerText, !selectedVariant && styles.pickerPlaceholder]} numberOfLines={1}>
              {selectedVariant ? varLabel(selectedVariant) : 'Select or add a SKU'}
            </Text>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}><Input label="Number of pallets" value={bulkCount} onChangeText={setBulkCount} keyboardType="numeric" placeholder="22" /></View>
            <View style={{ flex: 1 }}><Input label="Units per pallet" value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="48" /></View>
          </View>
          <View style={styles.slotHint}>
            <MapPin size={13} color={C.textSecondary} />
            <Text style={styles.slotHintText}>{totalFreeSlots} open slot{totalFreeSlots === 1 ? '' : 's'} available{palletType === 'oversize' ? ' (oversize-capable)' : ''}</Text>
          </View>
          <Button label={`Auto put away${bulkCount ? ` ${bulkCount} pallets` : ' all pallets'}`} onPress={() => void autoSubmit()} loading={autoPutaway.isPending} fullWidth icon={<Boxes size={15} color={C.white} />} />
          {autoPutaway.error ? (
            <View style={styles.errBox}>
              <AlertTriangle size={13} color={C.red} />
              <Text style={styles.errText}>{autoPutaway.error.message}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Putaway — one pallet per slot</Text>
        <View style={styles.card}>
          <Text style={styles.helpText}>Need to place a single pallet in a specific slot? Use this. Each shelf slot holds one standard pallet. Over-standard pallets need an oversize-capable slot.</Text>

          {reference ? (
            <View style={styles.linkedRef}>
              <ClipboardCheck size={14} color={C.green} />
              <Text style={styles.linkedRefText}>Receipt: {reference}</Text>
            </View>
          ) : (
            <Text style={styles.helpTextMuted}>Tip: check in a booking above first to link this putaway to its receipt.</Text>
          )}

          {placed.length > 0 ? (
            <View style={styles.progressBox}>
              <Text style={styles.progressText}>{placed.length} pallet{placed.length > 1 ? 's' : ''} put away this session</Text>
              {placed.slice(0, 4).map((p) => (
                <Text key={p.n} style={styles.progressLine}>#{p.n} · {p.location} · {p.type === 'oversize' ? 'Oversize' : 'Standard'}{p.sku !== '—' ? ` · ${p.sku}` : ''}</Text>
              ))}
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Pallet type</Text>
          <View style={styles.typeRow}>
            {(['standard', 'oversize'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, palletType === t && styles.typeChipActive]}
                onPress={() => { setPalletType(t); setLocationId(''); }}
                testID={`pallet-type-${t}`}
              >
                <Text style={[styles.typeChipText, palletType === t && styles.typeChipTextActive]}>{t === 'standard' ? 'Standard pallet' : 'Over-standard'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>SKU (optional)</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setSkuPickerOpen(true)} testID="pick-sku">
            <Boxes size={16} color={selectedVariant ? C.accent : C.textMuted} />
            <Text style={[styles.pickerText, !selectedVariant && styles.pickerPlaceholder]} numberOfLines={1}>
              {selectedVariant ? varLabel(selectedVariant) : 'Select or add a SKU'}
            </Text>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>Pallet slot</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setLocPickerOpen(true)} testID="pick-location">
            <MapPin size={16} color={selectedLocation ? C.accent : C.textMuted} />
            <Text style={[styles.pickerText, !selectedLocation && styles.pickerPlaceholder]} numberOfLines={1}>
              {selectedLocation ? `${locLabel(selectedLocation)} · ${locFreeSlots(selectedLocation)} free` : `Pick an empty slot (${availableLocations.length} available)`}
            </Text>
            <ChevronRight size={16} color={C.textMuted} />
          </TouchableOpacity>

          <Input label="Units on this pallet (optional)" value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="48" />
          <Input label="Lot / batch (optional)" value={lot} onChangeText={setLot} placeholder="LOT-2026-04" autoCapitalize="characters" />
          <Button label="Put away this pallet" onPress={() => void submit()} loading={putaway.isPending} fullWidth icon={<CheckCircle2 size={15} color={C.white} />} />
          {putaway.error ? (
            <View style={styles.errBox}>
              <AlertTriangle size={13} color={C.red} />
              <Text style={styles.errText}>{putaway.error.message}</Text>
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
              <Text style={styles.rowTitle}>{r.reference_code || r.id.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{new Date(r.created_at).toLocaleString()}</Text>
            </View>
            <StatusBadge status={r.status} size="sm" />
          </View>
        ))}
      </ScrollView>
      </KeyboardAvoidingView>

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

      <Modal visible={skuPickerOpen} animationType="slide" transparent onRequestClose={() => setSkuPickerOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={() => setSkuPickerOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Select a SKU</Text>
              <TouchableOpacity onPress={() => setSkuPickerOpen(false)} style={styles.sheetClose}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Search size={15} color={C.textMuted} />
              <TextInput value={skuSearch} onChangeText={setSkuSearch} placeholder="Search SKU or name" placeholderTextColor={C.textMuted} style={styles.searchInput} autoCapitalize="characters" />
            </View>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="none">
              {filteredVariants.length === 0 ? (
                <Text style={styles.emptyHint}>No SKUs found. Add a new one below.</Text>
              ) : filteredVariants.map((v) => (
                <TouchableOpacity key={v.id} style={styles.optRow} onPress={() => { setVariantId(v.id); setSkuPickerOpen(false); }}>
                  <Boxes size={15} color={C.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optTitle}>{v.sku}</Text>
                    {v.name ? <Text style={styles.optMeta}>{v.name}</Text> : null}
                  </View>
                  {variantId === v.id ? <CheckCircle2 size={16} color={C.green} /> : null}
                </TouchableOpacity>
              ))}
              <View style={styles.addBox}>
                <Text style={styles.addTitle}>Add a new SKU</Text>
                <Input label="SKU code" value={newSku} onChangeText={setNewSku} placeholder="e.g. ACME-001" autoCapitalize="characters" />
                <Input label="Name" value={newSkuName} onChangeText={setNewSkuName} placeholder="e.g. Blue widget, 12oz" />
                <Button label="Add SKU" onPress={() => void handleCreateSku()} loading={createProduct.isPending || upsertVariant.isPending} fullWidth variant="outline" icon={<Plus size={15} color={C.accent} />} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={locPickerOpen} animationType="slide" transparent onRequestClose={() => setLocPickerOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={() => setLocPickerOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Shelf / rack location</Text>
              <TouchableOpacity onPress={() => setLocPickerOpen(false)} style={styles.sheetClose}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="none">
              {locationList.length === 0 ? (
                <Text style={styles.emptyHint}>No slots yet. Build your racking below.</Text>
              ) : locationList.map((l) => {
                const full = locIsFull(l);
                const blockedOversize = palletType === 'oversize' && !l.accepts_oversize;
                const disabled = full || blockedOversize;
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.optRow, disabled && styles.optRowDisabled]}
                    disabled={disabled}
                    onPress={() => { setLocationId(l.id); setLocPickerOpen(false); }}
                  >
                    <MapPin size={15} color={disabled ? C.textMuted : C.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optTitle, disabled && { color: C.textMuted }]}>{locLabel(l)}</Text>
                      <Text style={styles.optMeta}>
                        {(l.pallets_used ?? 0)}/{Math.max(l.pallet_capacity ?? 1, 1)} used{l.accepts_oversize ? ' · oversize-ok' : ''}{full ? ' · FULL' : blockedOversize ? ' · not oversize' : ''}
                      </Text>
                    </View>
                    {locationId === l.id ? <CheckCircle2 size={16} color={C.green} /> : null}
                  </TouchableOpacity>
                );
              })}
              <View style={styles.addBox}>
                <Text style={styles.addTitle}>Add a location</Text>
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}><Input label="Zone" value={newLoc.zone} onChangeText={(t) => setNewLoc((s) => ({ ...s, zone: t }))} placeholder="A" autoCapitalize="characters" /></View>
                  <View style={{ flex: 1 }}><Input label="Aisle" value={newLoc.aisle} onChangeText={(t) => setNewLoc((s) => ({ ...s, aisle: t }))} placeholder="01" autoCapitalize="characters" /></View>
                </View>
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}><Input label="Rack" value={newLoc.rack} onChangeText={(t) => setNewLoc((s) => ({ ...s, rack: t }))} placeholder="R3" autoCapitalize="characters" /></View>
                  <View style={{ flex: 1 }}><Input label="Level" value={newLoc.level} onChangeText={(t) => setNewLoc((s) => ({ ...s, level: t }))} placeholder="2" autoCapitalize="characters" /></View>
                  <View style={{ flex: 1 }}><Input label="Bin" value={newLoc.bin} onChangeText={(t) => setNewLoc((s) => ({ ...s, bin: t }))} placeholder="B" autoCapitalize="characters" /></View>
                </View>
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}><Input label="Pallet slots" value={newLoc.capacity} onChangeText={(t) => setNewLoc((s) => ({ ...s, capacity: t }))} keyboardType="numeric" placeholder="1" /></View>
                  <TouchableOpacity style={[styles.oversizeToggle, newLoc.oversize && styles.oversizeToggleActive]} onPress={() => setNewLoc((s) => ({ ...s, oversize: !s.oversize }))}>
                    <Text style={[styles.oversizeToggleText, newLoc.oversize && styles.oversizeToggleTextActive]}>{newLoc.oversize ? '✓ Oversize-ok' : 'Oversize?'}</Text>
                  </TouchableOpacity>
                </View>
                <Button label="Add slot" onPress={() => void handleCreateLoc()} loading={createLoc.isPending} fullWidth variant="outline" icon={<Plus size={15} color={C.accent} />} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  helpTextMuted: { fontSize: 12, color: C.textMuted, lineHeight: 17, fontStyle: 'italic' as const },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, letterSpacing: 0.3, marginTop: 2 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  typeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  typeChipText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  typeChipTextActive: { color: C.accent },
  progressBox: { backgroundColor: C.green + '12', borderRadius: 10, borderWidth: 1, borderColor: C.green + '33', padding: 10, gap: 3 },
  progressText: { fontSize: 12, fontWeight: '800' as const, color: C.green },
  progressLine: { fontSize: 11, color: C.textSecondary },
  optRowDisabled: { opacity: 0.5 },
  oversizeToggle: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, marginTop: 22 },
  oversizeToggleActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  oversizeToggleText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  oversizeToggleTextActive: { color: C.accent },
  linkedRef: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.green + '14', borderRadius: 10, borderWidth: 1, borderColor: C.green + '44', paddingHorizontal: 10, paddingVertical: 8 },
  linkedRefText: { fontSize: 12, fontWeight: '700' as const, color: C.green, letterSpacing: 0.4 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, minHeight: 48 },
  pickerText: { flex: 1, fontSize: 15, color: C.text, fontWeight: '600' as const },
  pickerPlaceholder: { color: C.textMuted, fontWeight: '400' as const },
  twoCol: { flexDirection: 'row', gap: 8 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12, borderTopWidth: 1, borderColor: C.border },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  sheetClose: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 10 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  optTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  optMeta: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  emptyHint: { fontSize: 12, color: C.textMuted, textAlign: 'center' as const, paddingVertical: 18 },
  addBox: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  addTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  slotHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotHintText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
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
