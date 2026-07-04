import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, Package, Plus, Truck, UserRound, Container, Copy, Check } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SearchField from '@/components/ui/SearchField';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type FleetEntity = 'drivers' | 'trucks' | 'trailers' | 'containers';

interface FleetItem {
  id: string;
  status: string;
  data?: Record<string, unknown> | null;
  license_number?: string | null;
  phone?: string | null;
  unit_number?: string | null;
  plate_number?: string | null;
  trailer_number?: string | null;
  container_number?: string | null;
  container_type?: string | null;
}

interface FleetFormState {
  id: string | null;
  name: string;
  unitNumber: string;
  plateNumber: string;
  trailerNumber: string;
  containerNumber: string;
  containerType: string;
  trailerType: string;
  truckNumber: string;
  chassisNumber: string;
  licenseNumber: string;
  phone: string;
  email: string;
  status: string;
  notes: string;
}

const INITIAL_FORM: FleetFormState = {
  id: null,
  name: '',
  unitNumber: '',
  plateNumber: '',
  trailerNumber: '',
  containerNumber: '',
  containerType: '',
  trailerType: '',
  truckNumber: '',
  chassisNumber: '',
  licenseNumber: '',
  phone: '',
  email: '',
  status: 'Active',
  notes: '',
};

const TRAILER_TYPE_OPTIONS: string[] = ['20ft', '40ft', '53ft', 'Chassis 20/40 Combo', 'Tri-axle'];
const CONTAINER_TYPE_OPTIONS: string[] = ['20GP', '40GP', '40HC', '45HC', 'Reefer'];

function readText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function getEntityIcon(entity: FleetEntity) {
  if (entity === 'drivers') {
    return UserRound;
  }
  if (entity === 'trucks') {
    return Truck;
  }
  if (entity === 'trailers') {
    return Package;
  }
  return Container;
}

function getPrimaryLabel(entity: FleetEntity, item: FleetItem): string {
  const data = item.data ?? {};
  if (entity === 'drivers') {
    return readText(data.name, 'Driver');
  }
  if (entity === 'trucks') {
    return readText(item.unit_number, 'Truck');
  }
  if (entity === 'trailers') {
    return readText(item.trailer_number, 'Trailer');
  }
  return readText(item.container_number, 'Container');
}

function getSecondaryLabel(entity: FleetEntity, item: FleetItem): string {
  const data = item.data ?? {};
  if (entity === 'drivers') {
    return [readText(item.license_number), readText(item.phone), readText(data.email)].filter(Boolean).join(' · ');
  }
  if (entity === 'trucks') {
    return [readText(item.plate_number), readText(data.notes)].filter(Boolean).join(' · ');
  }
  if (entity === 'trailers') {
    return [readText(item.plate_number), readText(data.notes)].filter(Boolean).join(' · ');
  }
  return [readText(item.container_type), readText(data.plateNumber), readText(data.notes)].filter(Boolean).join(' · ');
}

function mapItemToForm(entity: FleetEntity, item: FleetItem): FleetFormState {
  const data = item.data ?? {};
  return {
    id: item.id,
    name: readText(data.name),
    unitNumber: readText(item.unit_number),
    plateNumber: readText(item.plate_number, readText(data.plateNumber)),
    trailerNumber: readText(item.trailer_number),
    containerNumber: readText(item.container_number),
    containerType: readText(item.container_type),
    trailerType: readText(data.trailerType, readText(item.container_type)),
    truckNumber: readText(data.truckNumber),
    chassisNumber: readText(data.chassisNumber),
    licenseNumber: readText(item.license_number),
    phone: readText(item.phone),
    email: readText(data.email),
    status: readText(item.status, 'Active'),
    notes: readText(data.notes),
  };
}

function ChipSelect({ label, options, value, onChange, testID }: { label: string; options: string[]; value: string; onChange: (v: string) => void; testID?: string }) {
  return (
    <View>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <TouchableOpacity key={opt} activeOpacity={0.8} onPress={() => onChange(selected ? '' : opt)} style={[styles.chip, selected && styles.chipActive]} testID={testID ? `${testID}-${opt}` : undefined}>
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TruckingFleetScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const handleBack = useCallback(() => {
    try {
      router.back();
    } catch {
      router.replace('/' as never);
    }
  }, [router]);
  const [entity, setEntity] = useState<FleetEntity>('drivers');
  const [search, setSearch] = useState<string>('');
  const [form, setForm] = useState<FleetFormState>(INITIAL_FORM);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);

  const fleetCodeQuery = trpc.operations.myFleetCode.useQuery();
  const fleetCode = fleetCodeQuery.data?.fleetCode ?? null;

  const copyCode = useCallback(async () => {
    if (!fleetCode) return;
    try {
      await Clipboard.setStringAsync(fleetCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    } catch {
      // no-op
    }
  }, [fleetCode]);

  const driversQuery = trpc.operations.listFleet.useQuery({ entity: 'drivers', search });
  const trucksQuery = trpc.operations.listFleet.useQuery({ entity: 'trucks', search });
  const trailersQuery = trpc.operations.listFleet.useQuery({ entity: 'trailers', search });
  const containersQuery = trpc.operations.listFleet.useQuery({ entity: 'containers', search });

  const createMutation = trpc.operations.createFleetRecord.useMutation();
  const updateMutation = trpc.operations.updateFleetRecord.useMutation();
  const archiveMutation = trpc.operations.archiveFleetRecord.useMutation();

  const activeQuery = useMemo(() => {
    if (entity === 'drivers') {
      return driversQuery;
    }
    if (entity === 'trucks') {
      return trucksQuery;
    }
    if (entity === 'trailers') {
      return trailersQuery;
    }
    return containersQuery;
  }, [containersQuery, driversQuery, entity, trailersQuery, trucksQuery]);

  const items: FleetItem[] = activeQuery.data ?? [];
  const Icon = getEntityIcon(entity);

  const refetchAll = async () => {
    await Promise.all([
      utils.operations.listFleet.invalidate({ entity: 'drivers', search }),
      utils.operations.listFleet.invalidate({ entity: 'trucks', search }),
      utils.operations.listFleet.invalidate({ entity: 'trailers', search }),
      utils.operations.listFleet.invalidate({ entity: 'containers', search }),
      utils.operations.truckingDashboard.invalidate(),
    ]);
  };

  const resetForm = () => setForm(INITIAL_FORM);

  const submit = async () => {
    try {
      if (form.id) {
        await updateMutation.mutateAsync({
          entity,
          id: form.id,
          payload: {
            name: form.name,
            unitNumber: form.unitNumber,
            plateNumber: form.plateNumber || null,
            trailerNumber: form.trailerNumber,
            containerNumber: form.containerNumber,
            containerType: form.containerType || null,
            trailerType: form.trailerType || null,
            truckNumber: form.truckNumber || null,
            chassisNumber: form.chassisNumber || null,
            licenseNumber: form.licenseNumber || null,
            phone: form.phone || null,
            email: form.email || null,
            status: form.status,
            notes: form.notes || null,
          },
        });
      } else {
        await createMutation.mutateAsync({
          entity,
          payload: {
            name: form.name,
            unitNumber: form.unitNumber,
            plateNumber: form.plateNumber || null,
            trailerNumber: form.trailerNumber,
            containerNumber: form.containerNumber,
            containerType: form.containerType || null,
            trailerType: form.trailerType || null,
            truckNumber: form.truckNumber || null,
            chassisNumber: form.chassisNumber || null,
            licenseNumber: form.licenseNumber || null,
            phone: form.phone || null,
            email: form.email || null,
            status: form.status,
            notes: form.notes || null,
          },
        });
      }
      resetForm();
      await refetchAll();
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unable to save fleet record');
    }
  };

  const archive = async (id: string) => {
    try {
      await archiveMutation.mutateAsync({ entity, id });
      if (form.id === id) {
        resetForm();
      }
      await refetchAll();
    } catch (error) {
      Alert.alert('Archive failed', error instanceof Error ? error.message : 'Unable to archive record');
    }
  };

  if (activeQuery.isLoading && items.length === 0) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading fleet" /></View>;
  }

  if (activeQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load fleet" onRetry={() => void activeQuery.refetch()} /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} testID="fleet-back">
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fleet</Text>
          <Text style={styles.subtitle}>Drivers, trucks, trailers & containers</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: 12, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>

        <View style={styles.segmentRow}>
          {([
            ['drivers', 'Drivers'],
            ['trucks', 'Trucks'],
            ['trailers', 'Trailers'],
            ['containers', 'Containers'],
          ] as [FleetEntity, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => { setEntity(key); resetForm(); }} style={[styles.segment, entity === key && styles.segmentActive]} testID={`fleet-segment-${key}`}>
              <Text style={[styles.segmentText, entity === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {entity === 'drivers' && fleetCode ? (
          <Card elevated style={styles.codeCard}>
            <Text style={styles.codeLabel}>YOUR FLEET CODE</Text>
            <View style={styles.codeRow}>
              <Text style={styles.codeValue} testID="fleet-code-value">{fleetCode}</Text>
              <TouchableOpacity onPress={() => void copyCode()} style={styles.copyBtn} activeOpacity={0.8} testID="fleet-code-copy">
                {codeCopied ? <Check size={16} color={C.green} /> : <Copy size={16} color={C.accent} />}
                <Text style={[styles.copyText, codeCopied && { color: C.green }]}>{codeCopied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.codeHint}>Share this code with your drivers. When they sign up as a Driver and enter it, they join your fleet automatically and appear in this list.</Text>
          </Card>
        ) : null}

        <Card elevated>
          <View style={styles.cardHeader}>
            <View style={styles.iconWrap}><Icon size={18} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>{form.id ? 'Edit record' : `Create ${entity.slice(0, -1)}`}</Text>
              <Text style={styles.sectionMeta}>Real create and update flow using production backend routers.</Text>
            </View>
          </View>
          <View style={styles.formGrid}>
            {entity === 'drivers' ? (
              <>
                <Input label="Driver name" value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Ava Singh" testID="fleet-driver-name" />
                <Input label="License number" value={form.licenseNumber} onChangeText={(value) => setForm((current) => ({ ...current, licenseNumber: value }))} placeholder="DL-7781" testID="fleet-driver-license" />
                <Input label="Phone" value={form.phone} onChangeText={(value) => setForm((current) => ({ ...current, phone: value }))} placeholder="604-555-0101" keyboardType="phone-pad" testID="fleet-driver-phone" />
                <Input label="Email" value={form.email} onChangeText={(value) => setForm((current) => ({ ...current, email: value }))} placeholder="driver@dock2door.com" autoCapitalize="none" keyboardType="email-address" testID="fleet-driver-email" />
                <Input label="Truck number" value={form.truckNumber} onChangeText={(value) => setForm((current) => ({ ...current, truckNumber: value }))} placeholder="TRK-102" testID="fleet-driver-truck" />
                <Input label="Chassis number" value={form.chassisNumber} onChangeText={(value) => setForm((current) => ({ ...current, chassisNumber: value }))} placeholder="CH-2201" testID="fleet-driver-chassis" />
              </>
            ) : null}
            {entity === 'trucks' ? (
              <>
                <Input label="Unit number" value={form.unitNumber} onChangeText={(value) => setForm((current) => ({ ...current, unitNumber: value }))} placeholder="TRK-102" testID="fleet-truck-unit" />
                <Input label="Plate number" value={form.plateNumber} onChangeText={(value) => setForm((current) => ({ ...current, plateNumber: value }))} placeholder="e.g. ABC 1234" testID="fleet-truck-plate" />
              </>
            ) : null}
            {entity === 'trailers' ? (
              <>
                <Input label="Trailer number" value={form.trailerNumber} onChangeText={(value) => setForm((current) => ({ ...current, trailerNumber: value }))} placeholder="TRL-88" testID="fleet-trailer-number" />
                <Input label="Plate number" value={form.plateNumber} onChangeText={(value) => setForm((current) => ({ ...current, plateNumber: value }))} placeholder="e.g. XYZ 5678" testID="fleet-trailer-plate" />
                <ChipSelect label="Trailer type" options={TRAILER_TYPE_OPTIONS} value={form.trailerType} onChange={(v) => setForm((current) => ({ ...current, trailerType: v }))} testID="fleet-trailer-type" />
              </>
            ) : null}
            {entity === 'containers' ? (
              <>
                <Input label="Container number" value={form.containerNumber} onChangeText={(value) => setForm((current) => ({ ...current, containerNumber: value }))} placeholder="MSKU1234567" testID="fleet-container-number" />
                <ChipSelect label="Container type" options={CONTAINER_TYPE_OPTIONS} value={form.containerType} onChange={(v) => setForm((current) => ({ ...current, containerType: v }))} testID="fleet-container-type" />
                <Text style={styles.chassisNote}>Chassis is assigned per move, not stored on the container — the same box rides a different chassis each trip.</Text>
              </>
            ) : null}
            <Input label="Status" value={form.status} onChangeText={(value) => setForm((current) => ({ ...current, status: value }))} placeholder="Active" testID="fleet-status" />
            <Input label="Notes" value={form.notes} onChangeText={(value) => setForm((current) => ({ ...current, notes: value }))} placeholder="Inspection passed" multiline numberOfLines={3} testID="fleet-notes" />
          </View>
          <View style={styles.actionRow}>
            <Button label={form.id ? 'Update' : 'Create'} onPress={() => void submit()} loading={createMutation.isPending || updateMutation.isPending} icon={<Plus size={16} color={C.white} />} />
            <Button label="Reset" onPress={resetForm} variant="secondary" />
          </View>
        </Card>

        <SearchField value={search} onChangeText={setSearch} placeholder={`Search ${entity}`} testID="fleet-search" />

        <Text style={styles.sectionTitle}>Records</Text>
        {items.length === 0 ? (
          <EmptyState icon={Package} title={`No ${entity} found`} description="Create the first record or adjust your search." />
        ) : items.map((item) => (
          <Card key={String(item.id)} style={styles.itemCard}>
            <View style={styles.itemTop}>
              <View style={[styles.iconWrap, styles.iconAlt]}><Icon size={16} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{getPrimaryLabel(entity, item)}</Text>
                <Text style={styles.itemMeta}>{getSecondaryLabel(entity, item) || 'No secondary details yet'}</Text>
                <Text style={styles.itemMeta}>ID: {String(item.id)}</Text>
              </View>
              <StatusBadge status={readText(item.status, 'Active')} />
            </View>
            <View style={styles.actionRow}>
              <Button label="Detail / Edit" variant="secondary" onPress={() => setForm(mapItemToForm(entity, item))} />
              <Button label="Archive" variant="danger" onPress={() => void archive(String(item.id))} loading={archiveMutation.isPending} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  chipLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 8 },
  chassisNote: { fontSize: 12, color: C.textSecondary, fontStyle: 'italic' as const, lineHeight: 17 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  segment: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.accent },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  iconAlt: { backgroundColor: C.blueDim },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  sectionMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  formGrid: { gap: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  itemCard: { gap: 12 },
  itemTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  codeCard: { gap: 8, borderColor: C.accent + '55', backgroundColor: C.accentDim },
  codeLabel: { fontSize: 11, fontWeight: '800' as const, color: C.accent, letterSpacing: 1.2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  codeValue: { fontSize: 30, fontWeight: '900' as const, color: C.text, letterSpacing: 4 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  copyText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  codeHint: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
});
