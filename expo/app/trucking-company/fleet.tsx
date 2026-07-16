import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, Package, Plus, Truck, UserRound, Container, Copy, Check, Link2, Unlink, CircleDot, ShieldAlert, X, Layers } from 'lucide-react-native';
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

type FleetEntity = 'drivers' | 'trucks' | 'trailers' | 'containers' | 'chassis';

interface FleetItem {
  id: string;
  status: string;
  data?: Record<string, unknown> | null;
  license_number?: string | null;
  phone?: string | null;
  unit_number?: string | null;
  plate?: string | null;
  plate_number?: string | null;
  trailer_number?: string | null;
  container_number?: string | null;
  container_type?: string | null;
  trailer_type?: string | null;
  chassis_number?: string | null;
  chassis_type?: string | null;
  is_rental?: boolean | null;
  rental_daily_rate?: number | null;
  rental_return_date?: string | null;
  is_dropped?: boolean | null;
  dropped_label?: string | null;
}

type ActiveLoad = { id: string; status: string; accepted_driver_user_id?: string | null; dropoff_address?: string | null; pickup_address?: string | null };

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
  chassisType: string;
  isRental: boolean;
  rentalDailyRate: string;
  rentalReturnDate: string;
  licenseNumber: string;
  phone: string;
  email: string;
  status: string;
  notes: string;
  insuranceExpiry: string;
  inspectionExpiry: string;
  driverType: string;
  defaultHourlyRate: string;
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
  chassisType: '',
  isRental: false,
  rentalDailyRate: '',
  rentalReturnDate: '',
  licenseNumber: '',
  phone: '',
  email: '',
  status: 'Active',
  notes: '',
  insuranceExpiry: '',
  inspectionExpiry: '',
  driverType: 'Company',
  defaultHourlyRate: '',
};

/** Days until an ISO/date string; null when unset/invalid. Negative = expired. */
function daysUntil(dateStr: string): number | null {
  const s = (dateStr || '').trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

type DocState = { level: 'expired' | 'soon' | 'ok'; label: string } | null;
function docState(dateStr: string, kind: string): DocState {
  const d = daysUntil(dateStr);
  if (d === null) return null;
  if (d < 0) return { level: 'expired', label: `${kind} expired ${-d}d ago` };
  if (d <= 30) return { level: 'soon', label: `${kind} expires in ${d}d` };
  return { level: 'ok', label: `${kind} ok` };
}

const STATUS_OPTIONS: string[] = ['Active', 'Maintenance', 'Out of service', 'Inactive'];
const DRIVER_TYPE_OPTIONS: string[] = ['Company', 'Owner-operator'];
const TRAILER_TYPE_OPTIONS: string[] = ['20ft', '40ft', '53ft', 'Chassis 20/40 Combo', 'Tri-axle'];
const CHASSIS_TYPE_OPTIONS: string[] = ['20ft', '40ft', '40/45 Slider', 'Tri-axle', 'Gooseneck', 'Combo'];
const CONTAINER_TYPE_OPTIONS: string[] = ['20GP', '40GP', '40HC', '45HC', 'Reefer'];
const ACTIVE_LOAD_STATUS = ['Accepted', 'EnRoute', 'Arrived'];

function readText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function getEntityIcon(entity: FleetEntity) {
  if (entity === 'drivers') return UserRound;
  if (entity === 'trucks') return Truck;
  if (entity === 'trailers') return Package;
  if (entity === 'chassis') return Layers;
  return Container;
}

function getPrimaryLabel(entity: FleetEntity, item: FleetItem): string {
  const data = item.data ?? {};
  if (entity === 'drivers') return readText(data.name, readText((item as { name?: string }).name, 'Driver'));
  if (entity === 'trucks') return readText(item.plate, readText(item.unit_number, 'Truck'));
  if (entity === 'trailers') return readText(item.plate, readText(item.trailer_number, 'Trailer'));
  if (entity === 'chassis') return readText(item.chassis_number, 'Chassis');
  return readText(item.container_number, 'Container');
}

function getSecondaryLabel(entity: FleetEntity, item: FleetItem): string {
  const data = item.data ?? {};
  if (entity === 'drivers') return [readText(item.license_number), readText(item.phone), readText(data.email)].filter(Boolean).join(' · ');
  if (entity === 'trucks') return [readText(item.plate_number), readText(data.notes)].filter(Boolean).join(' · ');
  if (entity === 'trailers') return [readText(item.trailer_type), readText(data.notes)].filter(Boolean).join(' · ');
  if (entity === 'chassis') return [readText(item.chassis_type), readText(item.plate), item.is_rental ? 'Rental' : 'Owned'].filter(Boolean).join(' · ');
  return [readText(item.container_type), readText(data.notes)].filter(Boolean).join(' · ');
}

function driverLinkedUserId(item: FleetItem): string | null {
  const uid = item.data?.userId;
  return typeof uid === 'string' && uid ? uid : null;
}

function mapItemToForm(entity: FleetEntity, item: FleetItem): FleetFormState {
  const data = item.data ?? {};
  return {
    id: item.id,
    name: readText(data.name, readText((item as { name?: string }).name)),
    unitNumber: readText(item.unit_number),
    plateNumber: readText(item.plate, readText(item.plate_number, readText(data.plateNumber))),
    trailerNumber: readText(item.trailer_number),
    containerNumber: readText(item.container_number),
    containerType: readText(item.container_type),
    trailerType: readText(item.trailer_type, readText(data.trailerType)),
    truckNumber: readText(data.truckNumber),
    chassisNumber: readText(item.chassis_number, readText(data.chassisNumber)),
    chassisType: readText(item.chassis_type),
    isRental: !!item.is_rental,
    rentalDailyRate: item.rental_daily_rate != null ? String(item.rental_daily_rate) : '',
    rentalReturnDate: readText(item.rental_return_date),
    licenseNumber: readText(item.license_number),
    phone: readText(item.phone),
    email: readText(data.email),
    status: readText(item.status, 'Active'),
    notes: readText(data.notes),
    insuranceExpiry: readText(data.insuranceExpiry),
    inspectionExpiry: readText(data.inspectionExpiry),
    driverType: readText(data.driverType, 'Company'),
    defaultHourlyRate: data.defaultHourlyRate != null ? String(data.defaultHourlyRate) : '',
  };
}

function RentalFields({ form, setForm }: { form: FleetFormState; setForm: React.Dispatch<React.SetStateAction<FleetFormState>> }) {
  return (
    <View style={{ gap: 12 }}>
      <View>
        <Text style={styles.chipLabel}>Ownership</Text>
        <View style={styles.chipRow}>
          {([['Owned', false], ['Rental', true]] as [string, boolean][]).map(([lbl, val]) => {
            const selected = form.isRental === val;
            return (
              <TouchableOpacity key={lbl} activeOpacity={0.8} onPress={() => setForm((c) => ({ ...c, isRental: val }))} style={[styles.chip, selected && styles.chipActive]} testID={`fleet-ownership-${lbl}`}>
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {form.isRental ? (
        <>
          <Input label="Rental daily rate ($/day)" value={form.rentalDailyRate} onChangeText={(value) => setForm((c) => ({ ...c, rentalDailyRate: value }))} placeholder="e.g. 25" keyboardType="numeric" testID="fleet-rental-rate" />
          <Input label="Rental return date (YYYY-MM-DD)" value={form.rentalReturnDate} onChangeText={(value) => setForm((c) => ({ ...c, rentalReturnDate: value }))} placeholder="2026-08-31" autoCapitalize="none" testID="fleet-rental-return" />
        </>
      ) : null}
    </View>
  );
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
    try { router.back(); } catch { router.replace('/' as never); }
  }, [router]);
  const [entity, setEntity] = useState<FleetEntity>('drivers');
  const [search, setSearch] = useState<string>('');
  const [form, setForm] = useState<FleetFormState>(INITIAL_FORM);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);

  const fleetCodeQuery = trpc.operations.myFleetCode.useQuery();
  const fleetCode = fleetCodeQuery.data?.fleetCode ?? null;

  const copyCode = useCallback(async () => {
    if (!fleetCode) return;
    try {
      await Clipboard.setStringAsync(fleetCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    } catch { /* no-op */ }
  }, [fleetCode]);

  const driversQuery = trpc.operations.listFleet.useQuery({ entity: 'drivers', search });
  const trucksQuery = trpc.operations.listFleet.useQuery({ entity: 'trucks', search });
  const trailersQuery = trpc.operations.listFleet.useQuery({ entity: 'trailers', search });
  const chassisQuery = trpc.operations.listFleet.useQuery({ entity: 'chassis', search });
  const containersQuery = trpc.operations.listFleet.useQuery({ entity: 'containers', search });
  // Active loads let us show which drivers are currently busy vs available.
  const loadsQuery = trpc.loads.listAccepted.useQuery(undefined, { enabled: entity === 'drivers' });

  const createMutation = trpc.operations.createFleetRecord.useMutation();
  const updateMutation = trpc.operations.updateFleetRecord.useMutation();
  const archiveMutation = trpc.operations.archiveFleetRecord.useMutation();

  const activeQuery = useMemo(() => {
    if (entity === 'drivers') return driversQuery;
    if (entity === 'trucks') return trucksQuery;
    if (entity === 'trailers') return trailersQuery;
    if (entity === 'chassis') return chassisQuery;
    return containersQuery;
  }, [chassisQuery, containersQuery, driversQuery, entity, trailersQuery, trucksQuery]);

  const items: FleetItem[] = activeQuery.data ?? [];
  const Icon = getEntityIcon(entity);

  // driverUserId -> the active load they are currently running.
  const busyByDriver = useMemo(() => {
    const map = new Map<string, ActiveLoad>();
    for (const l of (loadsQuery.data ?? []) as ActiveLoad[]) {
      if (l.accepted_driver_user_id && ACTIVE_LOAD_STATUS.includes(l.status)) {
        map.set(l.accepted_driver_user_id, l);
      }
    }
    return map;
  }, [loadsQuery.data]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      utils.operations.listFleet.invalidate({ entity: 'drivers', search }),
      utils.operations.listFleet.invalidate({ entity: 'trucks', search }),
      utils.operations.listFleet.invalidate({ entity: 'trailers', search }),
      utils.operations.listFleet.invalidate({ entity: 'chassis', search }),
      utils.operations.listFleet.invalidate({ entity: 'containers', search }),
      utils.operations.truckingDashboard.invalidate(),
    ]);
  }, [utils, search]);

  const openCreate = useCallback(() => { setForm({ ...INITIAL_FORM }); setModalOpen(true); }, []);
  const openEdit = useCallback((item: FleetItem) => { setForm(mapItemToForm(entity, item)); setModalOpen(true); }, [entity]);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const submit = useCallback(async () => {
    const payload = {
      name: form.name,
      unitNumber: form.unitNumber,
      plateNumber: form.plateNumber || null,
      trailerNumber: form.trailerNumber,
      containerNumber: form.containerNumber,
      containerType: form.containerType || null,
      trailerType: form.trailerType || null,
      truckNumber: form.truckNumber || null,
      chassisNumber: form.chassisNumber || null,
      chassisType: form.chassisType || null,
      isRental: form.isRental,
      rentalDailyRate: form.rentalDailyRate.trim() === '' ? 0 : Number(form.rentalDailyRate),
      rentalReturnDate: form.rentalReturnDate || null,
      licenseNumber: form.licenseNumber || null,
      phone: form.phone || null,
      email: form.email || null,
      status: form.status,
      notes: form.notes || null,
      insuranceExpiry: form.insuranceExpiry || null,
      inspectionExpiry: form.inspectionExpiry || null,
      driverType: form.driverType || 'Company',
      defaultHourlyRate: form.defaultHourlyRate.trim() === '' ? 0 : Number(form.defaultHourlyRate),
    };
    try {
      if (form.id) await updateMutation.mutateAsync({ entity, id: form.id, payload });
      else await createMutation.mutateAsync({ entity, payload });
      setModalOpen(false);
      await refetchAll();
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unable to save fleet record');
    }
  }, [form, entity, updateMutation, createMutation, refetchAll]);

  const archive = useCallback(async (id: string) => {
    try {
      await archiveMutation.mutateAsync({ entity, id });
      await refetchAll();
    } catch (error) {
      Alert.alert('Archive failed', error instanceof Error ? error.message : 'Unable to archive record');
    }
  }, [archiveMutation, entity, refetchAll]);

  if (activeQuery.isLoading && items.length === 0) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading fleet" /></View>;
  }
  if (activeQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load fleet" onRetry={() => void activeQuery.refetch()} /></View>;
  }

  const singular = entity.slice(0, -1);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} testID="fleet-back">
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fleet</Text>
          <Text style={styles.subtitle}>Drivers, trucks, trailers, chassis & containers</Text>
        </View>
        <TouchableOpacity onPress={openCreate} style={styles.addBtn} testID="fleet-add">
          <Plus size={18} color={C.white} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: 12, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.segmentRow}>
          {([
            ['drivers', 'Drivers'],
            ['trucks', 'Trucks'],
            ['trailers', 'Trailers'],
            ['chassis', 'Chassis'],
            ['containers', 'Containers'],
          ] as [FleetEntity, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => setEntity(key)} style={[styles.segment, entity === key && styles.segmentActive]} testID={`fleet-segment-${key}`}>
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
            <Text style={styles.codeHint}>Share this code with your drivers. When they sign up as a Driver and enter it, they join your fleet — and become assignable on the dispatch board.</Text>
          </Card>
        ) : null}

        <SearchField value={search} onChangeText={setSearch} placeholder={`Search ${entity}`} testID="fleet-search" />

        <Text style={styles.sectionTitle}>{entity.charAt(0).toUpperCase() + entity.slice(1)}</Text>
        {items.length === 0 ? (
          <EmptyState icon={Package} title={`No ${entity} yet`} description={`Tap the + button to add your first ${singular}.`} actionLabel={`Add ${singular}`} onAction={openCreate} />
        ) : items.map((item) => {
          const linkedUid = entity === 'drivers' ? driverLinkedUserId(item) : null;
          const busy = linkedUid ? busyByDriver.get(linkedUid) : undefined;
          return (
            <Card key={String(item.id)} style={styles.itemCard}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => openEdit(item)}>
                <View style={styles.itemTop}>
                  <View style={[styles.iconWrap, styles.iconAlt]}><Icon size={16} color={C.blue} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{getPrimaryLabel(entity, item)}</Text>
                    {getSecondaryLabel(entity, item) ? <Text style={styles.itemMeta}>{getSecondaryLabel(entity, item)}</Text> : null}
                  </View>
                  <StatusBadge status={readText(item.status, 'Active')} />
                </View>

                {entity === 'drivers' ? (
                  <View style={styles.driverTags}>
                    {linkedUid ? (
                      <View style={[styles.tag, styles.tagLinked]}><Link2 size={12} color={C.green} /><Text style={[styles.tagText, { color: C.green }]}>Linked · assignable</Text></View>
                    ) : (
                      <View style={[styles.tag, styles.tagUnlinked]}><Unlink size={12} color={C.textMuted} /><Text style={[styles.tagText, { color: C.textMuted }]}>Not linked</Text></View>
                    )}
                    {linkedUid ? (
                      busy ? (
                        <View style={[styles.tag, styles.tagBusy]}><CircleDot size={12} color={C.yellow} /><Text style={[styles.tagText, { color: C.yellow }]}>On a load</Text></View>
                      ) : (
                        <View style={[styles.tag, styles.tagFree]}><CircleDot size={12} color={C.accent} /><Text style={[styles.tagText, { color: C.accent }]}>Available</Text></View>
                      )
                    ) : null}
                  </View>
                ) : null}

                {(entity === 'trucks' || entity === 'trailers') ? (() => {
                  const data = item.data ?? {};
                  const badges = [docState(readText(data.insuranceExpiry), 'Insurance'), docState(readText(data.inspectionExpiry), 'Inspection')].filter((b): b is NonNullable<DocState> => b !== null && b.level !== 'ok');
                  if (badges.length === 0) return null;
                  return (
                    <View style={styles.driverTags}>
                      {badges.map((b) => (
                        <View key={b.label} style={[styles.tag, b.level === 'expired' ? styles.tagExpired : styles.tagSoon]}>
                          <ShieldAlert size={12} color={b.level === 'expired' ? C.red : C.yellow} />
                          <Text style={[styles.tagText, { color: b.level === 'expired' ? C.red : C.yellow }]}>{b.label}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })() : null}

                {(entity === 'chassis' || entity === 'trailers') ? (() => {
                  const tags: { key: string; label: string; level: 'expired' | 'soon' | 'ok' | 'info' }[] = [];
                  if (item.is_rental) {
                    const rs = docState(readText(item.rental_return_date), 'Rental due');
                    if (rs) tags.push({ key: 'rental', label: rs.label, level: rs.level });
                    else tags.push({ key: 'rental', label: `Rental $${item.rental_daily_rate ?? 0}/day`, level: 'info' });
                  }
                  if (item.is_dropped) tags.push({ key: 'dropped', label: `Dropped${item.dropped_label ? ` · ${item.dropped_label}` : ''}`, level: 'soon' });
                  if (tags.length === 0) return null;
                  return (
                    <View style={styles.driverTags}>
                      {tags.map((t) => (
                        <View key={t.key} style={[styles.tag, t.level === 'expired' ? styles.tagExpired : t.level === 'soon' ? styles.tagSoon : styles.tagUnlinked]}>
                          <Text style={[styles.tagText, { color: t.level === 'expired' ? C.red : t.level === 'soon' ? C.yellow : C.textSecondary }]}>{t.label}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })() : null}

                {entity === 'drivers' && !linkedUid ? (
                  <Text style={styles.linkHint}>Add the email this driver signed up with (or share your fleet code) so they can be dispatched.</Text>
                ) : null}
                {busy ? (
                  <Text style={styles.busyHint} numberOfLines={1}>Running: {busy.dropoff_address || busy.pickup_address || 'active load'}</Text>
                ) : null}
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <Button label="Edit" variant="secondary" onPress={() => openEdit(item)} />
                <Button label="Archive" variant="danger" onPress={() => void archive(String(item.id))} loading={archiveMutation.isPending} />
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <View style={styles.iconWrap}><Icon size={18} color={C.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{form.id ? `Edit ${singular}` : `Add ${singular}`}</Text>
              </View>
              <TouchableOpacity onPress={closeModal} style={styles.modalClose}><X size={18} color={C.text} /></TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.formGrid}>
                {entity === 'drivers' ? (
                  <>
                    <Input label="Driver name" value={form.name} onChangeText={(value) => setForm((c) => ({ ...c, name: value }))} placeholder="Ava Singh" testID="fleet-driver-name" />
                    <Input label="License number" value={form.licenseNumber} onChangeText={(value) => setForm((c) => ({ ...c, licenseNumber: value }))} placeholder="DL-7781" testID="fleet-driver-license" />
                    <Input label="Phone" value={form.phone} onChangeText={(value) => setForm((c) => ({ ...c, phone: value }))} placeholder="604-555-0101" keyboardType="phone-pad" testID="fleet-driver-phone" />
                    <Input label="Account email (to link for dispatch)" value={form.email} onChangeText={(value) => setForm((c) => ({ ...c, email: value }))} placeholder="driver@dock2door.com" autoCapitalize="none" keyboardType="email-address" testID="fleet-driver-email" />
                    <Input label="Truck number" value={form.truckNumber} onChangeText={(value) => setForm((c) => ({ ...c, truckNumber: value }))} placeholder="TRK-102" testID="fleet-driver-truck" />
                    <Input label="Chassis number" value={form.chassisNumber} onChangeText={(value) => setForm((c) => ({ ...c, chassisNumber: value }))} placeholder="CH-2201" testID="fleet-driver-chassis" />
                    <ChipSelect label="Driver type" options={DRIVER_TYPE_OPTIONS} value={form.driverType} onChange={(v) => setForm((c) => ({ ...c, driverType: v || 'Company' }))} testID="fleet-driver-type" />
                    <Input label="Default hourly rate ($/h)" value={form.defaultHourlyRate} onChangeText={(value) => setForm((c) => ({ ...c, defaultHourlyRate: value }))} placeholder="e.g. 28" keyboardType="numeric" testID="fleet-driver-rate" />
                  </>
                ) : null}
                {entity === 'trucks' ? (
                  <>
                    <Input label="Unit number" value={form.unitNumber} onChangeText={(value) => setForm((c) => ({ ...c, unitNumber: value }))} placeholder="TRK-102" testID="fleet-truck-unit" />
                    <Input label="Plate number" value={form.plateNumber} onChangeText={(value) => setForm((c) => ({ ...c, plateNumber: value }))} placeholder="e.g. ABC 1234" testID="fleet-truck-plate" />
                    <Input label="Insurance expiry (YYYY-MM-DD)" value={form.insuranceExpiry} onChangeText={(value) => setForm((c) => ({ ...c, insuranceExpiry: value }))} placeholder="2026-12-31" autoCapitalize="none" testID="fleet-truck-insurance" />
                    <Input label="Inspection expiry (YYYY-MM-DD)" value={form.inspectionExpiry} onChangeText={(value) => setForm((c) => ({ ...c, inspectionExpiry: value }))} placeholder="2026-06-30" autoCapitalize="none" testID="fleet-truck-inspection" />
                  </>
                ) : null}
                {entity === 'trailers' ? (
                  <>
                    <Input label="Trailer number" value={form.trailerNumber} onChangeText={(value) => setForm((c) => ({ ...c, trailerNumber: value }))} placeholder="TRL-88" testID="fleet-trailer-number" />
                    <Input label="Plate number" value={form.plateNumber} onChangeText={(value) => setForm((c) => ({ ...c, plateNumber: value }))} placeholder="e.g. XYZ 5678" testID="fleet-trailer-plate" />
                    <ChipSelect label="Trailer type" options={TRAILER_TYPE_OPTIONS} value={form.trailerType} onChange={(v) => setForm((c) => ({ ...c, trailerType: v }))} testID="fleet-trailer-type" />
                    <RentalFields form={form} setForm={setForm} />
                    <Input label="Insurance expiry (YYYY-MM-DD)" value={form.insuranceExpiry} onChangeText={(value) => setForm((c) => ({ ...c, insuranceExpiry: value }))} placeholder="2026-12-31" autoCapitalize="none" testID="fleet-trailer-insurance" />
                    <Input label="Inspection expiry (YYYY-MM-DD)" value={form.inspectionExpiry} onChangeText={(value) => setForm((c) => ({ ...c, inspectionExpiry: value }))} placeholder="2026-06-30" autoCapitalize="none" testID="fleet-trailer-inspection" />
                  </>
                ) : null}
                {entity === 'chassis' ? (
                  <>
                    <Input label="Chassis number" value={form.chassisNumber} onChangeText={(value) => setForm((c) => ({ ...c, chassisNumber: value }))} placeholder="CH-2201" testID="fleet-chassis-number" />
                    <Input label="Plate number" value={form.plateNumber} onChangeText={(value) => setForm((c) => ({ ...c, plateNumber: value }))} placeholder="e.g. CHS 4421" testID="fleet-chassis-plate" />
                    <ChipSelect label="Chassis type" options={CHASSIS_TYPE_OPTIONS} value={form.chassisType} onChange={(v) => setForm((c) => ({ ...c, chassisType: v }))} testID="fleet-chassis-type" />
                    <Text style={styles.chassisNote}>Chassis number is tracked separately from the truck number. Assign a chassis to a container when you dispatch.</Text>
                    <RentalFields form={form} setForm={setForm} />
                  </>
                ) : null}
                {entity === 'containers' ? (
                  <>
                    <Input label="Container number" value={form.containerNumber} onChangeText={(value) => setForm((c) => ({ ...c, containerNumber: value }))} placeholder="MSKU1234567" testID="fleet-container-number" />
                    <ChipSelect label="Container type" options={CONTAINER_TYPE_OPTIONS} value={form.containerType} onChange={(v) => setForm((c) => ({ ...c, containerType: v }))} testID="fleet-container-type" />
                    <Text style={styles.chassisNote}>Chassis is assigned per move, not stored on the container — the same box rides a different chassis each trip.</Text>
                  </>
                ) : null}
                <ChipSelect label="Status" options={STATUS_OPTIONS} value={form.status} onChange={(v) => setForm((c) => ({ ...c, status: v || 'Active' }))} testID="fleet-status" />
                <Input label="Notes" value={form.notes} onChangeText={(value) => setForm((c) => ({ ...c, notes: value }))} placeholder="Inspection passed" multiline numberOfLines={3} testID="fleet-notes" />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <Button label="Cancel" onPress={closeModal} variant="secondary" />
              <Button label={form.id ? 'Save changes' : `Add ${singular}`} onPress={() => void submit()} loading={createMutation.isPending || updateMutation.isPending} icon={<Plus size={16} color={C.white} />} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  addBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent },
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
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  iconAlt: { backgroundColor: C.blueDim },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  formGrid: { gap: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  itemCard: { gap: 12 },
  itemTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  driverTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  tagText: { fontSize: 11.5, fontWeight: '800' as const },
  tagLinked: { backgroundColor: C.green + '18', borderColor: C.green + '55' },
  tagUnlinked: { backgroundColor: C.bgSecondary, borderColor: C.border },
  tagBusy: { backgroundColor: C.yellow + '18', borderColor: C.yellow + '55' },
  tagFree: { backgroundColor: C.accentDim, borderColor: C.accent + '55' },
  tagExpired: { backgroundColor: C.red + '18', borderColor: C.red + '55' },
  tagSoon: { backgroundColor: C.yellow + '18', borderColor: C.yellow + '55' },
  linkHint: { fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 8 },
  busyHint: { fontSize: 12, color: C.textSecondary, marginTop: 6 },
  codeCard: { gap: 8, borderColor: C.accent + '55', backgroundColor: C.accentDim },
  codeLabel: { fontSize: 11, fontWeight: '800' as const, color: C.accent, letterSpacing: 1.2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  codeValue: { fontSize: 30, fontWeight: '900' as const, color: C.text, letterSpacing: 4 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  copyText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  codeHint: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, borderTopWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalClose: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  modalBody: { flexGrow: 0 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
