import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, Clock, Package, Plus, Ship, Train, X, Anchor } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const CONTAINER_SIZES = ['20ft', '40ft', '40HC', '45HC', '53ft'];
const CONTAINER_TYPES = ['Standard', 'Reefer', 'Flatrack', 'Tank', 'Open Top', 'High Cube'];

type Props = {
  /** Route pathname for the order detail screen, e.g. '/customer/drayage/[orderId]'. */
  detailPath: string;
  /** Whether to show a back button in the header (false when this screen is a role home). */
  showBack?: boolean;
  /** Optional header subtitle override. */
  subtitle?: string;
};

/**
 * Shared "post & track container orders" screen used by both the logistics Customer
 * (as a sub-screen) and the Freight Forwarder (as their home).
 */
export default function ContainerOrdersScreen({ detailPath, showBack = true, subtitle }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const ordersQuery = trpc.drayage.customerOrders.useQuery(undefined, { refetchInterval: 30000 });
  const createMutation = trpc.drayage.createOrder.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.customerOrders.invalidate();
      setShowForm(false);
      resetForm();
    },
  });
  const terminalsQuery = trpc.drayage.listTerminals.useQuery({});

  const [showForm, setShowForm] = useState(false);
  const [direction, setDirection] = useState<'Import' | 'Export'>('Import');
  const [containerNumber, setContainerNumber] = useState('');
  const [containerSize, setContainerSize] = useState('40ft');
  const [containerType, setContainerType] = useState('Standard');
  const [bolNumber, setBolNumber] = useState('');
  const [bookingNumber, setBookingNumber] = useState('');
  const [commodity, setCommodity] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [isHazmat, setIsHazmat] = useState(false);
  const [isOverweight, setIsOverweight] = useState(false);
  const [isOversized, setIsOversized] = useState(false);
  const [originTerminalId, setOriginTerminalId] = useState<string | null>(null);
  const [destinationTerminalId, setDestinationTerminalId] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [resDate, setResDate] = useState('');
  const [resTime, setResTime] = useState('');
  const [isPrepull, setIsPrepull] = useState(false);
  const [prepullDate, setPrepullDate] = useState('');
  const [notes, setNotes] = useState('');
  const [showTerminalPicker, setShowTerminalPicker] = useState<'origin' | 'destination' | null>(null);

  const terminals = useMemo(() => (terminalsQuery.data ?? []) as any[], [terminalsQuery.data]);
  const portAndRailTerminals = useMemo(() => terminals.filter((t) => t.terminal_type === 'Port' || t.terminal_type === 'Rail'), [terminals]);

  const resetForm = () => {
    setDirection('Import'); setContainerNumber(''); setContainerSize('40ft'); setContainerType('Standard');
    setBolNumber(''); setBookingNumber(''); setCommodity(''); setWeightKg('');
    setIsHazmat(false); setIsOverweight(false); setIsOversized(false);
    setOriginTerminalId(null); setDestinationTerminalId(null);
    setDeliveryAddress(''); setDeliveryCity(''); setPickupAddress(''); setPickupCity('');
    setResDate(''); setResTime(''); setIsPrepull(false); setPrepullDate(''); setNotes('');
  };

  const terminalName = (id: string | null) => {
    if (!id) return 'Select terminal';
    const t = terminals.find((t) => t.id === id);
    return t ? `${t.name} (${t.code})` : 'Select terminal';
  };

  const handleSubmit = async () => {
    if (!containerNumber.trim() && !bookingNumber.trim()) {
      Alert.alert('Required', 'Enter at least a container number or booking number.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        direction,
        containerNumber: containerNumber.trim(),
        containerSize,
        containerType,
        bolNumber: bolNumber.trim(),
        bookingNumber: bookingNumber.trim(),
        commodity: commodity.trim(),
        weightKg: Number(weightKg) || 0,
        isHazmat,
        isOverweight,
        isOversized,
        originTerminalId,
        destinationTerminalId,
        pickupAddress: pickupAddress.trim(),
        pickupCity: pickupCity.trim(),
        deliveryAddress: deliveryAddress.trim(),
        deliveryCity: deliveryCity.trim(),
        portReservationDate: resDate.trim() || null,
        portReservationTime: resTime.trim(),
        isPrepull,
        prepullPickupDate: prepullDate.trim() || null,
        prepullYardTerminalId: null,
        notes: notes.trim(),
      });
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const orders = useMemo(() => (ordersQuery.data ?? []) as any[], [ordersQuery.data]);

  const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        {showBack ? (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={20} color={C.text} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Container Drayage</Text>
          <Text style={styles.headerSub}>{subtitle ?? 'Post import/export container orders'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* CTA */}
        <TouchableOpacity style={styles.cta} onPress={() => setShowForm(true)} activeOpacity={0.85}>
          <View style={styles.ctaIcon}><Plus size={22} color={C.white} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Post a Container Order</Text>
            <Text style={styles.ctaDesc}>Import or export — port to warehouse</Text>
          </View>
          <Ship size={18} color={C.white} />
        </TouchableOpacity>

        {/* Orders list */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Your Container Orders</Text>
        </View>
        {ordersQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading orders" />
        ) : ordersQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load orders" onRetry={() => void ordersQuery.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState icon={Ship} title="No container orders yet" description="Post your first import or export container order to get drayage companies bidding." />
        ) : orders.map((o) => (
          <Card
            key={o.id}
            onPress={() => router.push({ pathname: detailPath as never, params: { orderId: o.id } } as never)}
            style={styles.orderCard}
          >
            <View style={styles.orderTop}>
              <View style={[styles.dirBadge, { backgroundColor: (DIRECTION_COLOR[o.direction] ?? C.blue) + '20' }]}>
                <Text style={[styles.dirBadgeText, { color: DIRECTION_COLOR[o.direction] ?? C.blue }]}>{o.direction}</Text>
              </View>
              <StatusBadge status={o.status} />
            </View>
            <Text style={styles.orderRef}>{o.reference_code}</Text>
            <View style={styles.orderMeta}>
              <Text style={styles.orderMetaText}>Container: {o.container_number || 'TBD'}</Text>
              <Text style={styles.orderMetaText}>{o.container_size}</Text>
            </View>
            {o.commodity ? <Text style={styles.orderCommodity}>{o.commodity}</Text> : null}
            {o.port_reservation_date ? (
              <View style={styles.apptRow}>
                <CalendarClock size={12} color={C.green} />
                <Text style={styles.apptText}>Port appt: {o.port_reservation_date} {o.port_reservation_time}</Text>
              </View>
            ) : null}
            {o.is_prepull ? (
              <View style={styles.prepullBadge}><Text style={styles.prepullText}>PREPULL</Text></View>
            ) : null}
          </Card>
        ))}
      </ScrollView>

      {/* Create Order Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Container Order</Text>
            <TouchableOpacity onPress={() => setShowForm(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            {/* Direction toggle */}
            <Text style={styles.fieldLabel}>Direction</Text>
            <View style={styles.dirToggle}>
              <TouchableOpacity
                onPress={() => setDirection('Import')}
                style={[styles.dirToggleBtn, direction === 'Import' && styles.dirToggleBtnActive]}
              >
                <Package size={16} color={direction === 'Import' ? C.white : C.textMuted} />
                <Text style={[styles.dirToggleText, direction === 'Import' && styles.dirToggleTextActive]}>Import</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDirection('Export')}
                style={[styles.dirToggleBtn, direction === 'Export' && styles.dirToggleBtnActive]}
              >
                <Ship size={16} color={direction === 'Export' ? C.white : C.textMuted} />
                <Text style={[styles.dirToggleText, direction === 'Export' && styles.dirToggleTextActive]}>Export</Text>
              </TouchableOpacity>
            </View>

            <Input label="Container number" value={containerNumber} onChangeText={setContainerNumber} placeholder="e.g. TCLU1234567" />

            <Text style={styles.fieldLabel}>Container size</Text>
            <View style={styles.chipsRow}>
              {CONTAINER_SIZES.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setContainerSize(s)}
                  style={[styles.chip, containerSize === s && styles.chipActive]}
                >
                  <Text style={[styles.chipText, containerSize === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Container type</Text>
            <View style={styles.chipsRow}>
              {CONTAINER_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setContainerType(t)}
                  style={[styles.chip, containerType === t && styles.chipActive]}
                >
                  <Text style={[styles.chipText, containerType === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input label="BOL number" value={bolNumber} onChangeText={setBolNumber} placeholder="Bill of lading" />
            <Input label="Booking number" value={bookingNumber} onChangeText={setBookingNumber} placeholder="Shipping line booking" />
            <Input label="Commodity" value={commodity} onChangeText={setCommodity} placeholder="What's in the container" />
            <Input label="Weight (kg)" value={weightKg} onChangeText={setWeightKg} placeholder="0" keyboardType="numeric" />

            {/* Flags */}
            <View style={styles.flagsToggleRow}>
              {[
                { label: 'Hazmat', val: isHazmat, set: setIsHazmat },
                { label: 'Overweight', val: isOverweight, set: setIsOverweight },
                { label: 'Oversized', val: isOversized, set: setIsOversized },
              ].map((f) => (
                <TouchableOpacity
                  key={f.label}
                  onPress={() => f.set(!f.val)}
                  style={[styles.flagToggle, f.val && styles.flagToggleActive]}
                >
                  <Text style={[styles.flagToggleText, f.val && styles.flagToggleTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Terminals */}
            <Text style={styles.fieldLabel}>{direction === 'Import' ? 'Pickup terminal (port/rail)' : 'Empty pickup terminal (depot)'}</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowTerminalPicker('origin')}
            >
              <Anchor size={16} color={C.accent} />
              <Text style={styles.pickerBtnText}>{terminalName(originTerminalId)}</Text>
            </TouchableOpacity>

            {direction === 'Export' ? (
              <>
                <Input label="Load at (warehouse address)" value={pickupAddress} onChangeText={setPickupAddress} placeholder="123 Industrial Way" />
                <Input label="City" value={pickupCity} onChangeText={setPickupCity} placeholder="Surrey" />
              </>
            ) : (
              <>
                <Input label="Deliver to (warehouse address)" value={deliveryAddress} onChangeText={setDeliveryAddress} placeholder="123 Industrial Way" />
                <Input label="City" value={deliveryCity} onChangeText={setDeliveryCity} placeholder="Surrey" />
              </>
            )}

            <Text style={styles.fieldLabel}>{direction === 'Export' ? 'Deliver to terminal (port/rail)' : 'Return terminal (if different)'}</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowTerminalPicker('destination')}
            >
              <Train size={16} color={C.green} />
              <Text style={styles.pickerBtnText}>{terminalName(destinationTerminalId)}</Text>
            </TouchableOpacity>

            {/* Port reservation */}
            <Text style={styles.fieldLabel}>Port reservation (optional — drayage company can enter later)</Text>
            <View style={styles.resInputs}>
              <Input label="Date" value={resDate} onChangeText={setResDate} placeholder="2026-07-15" containerStyle={{ flex: 1 }} />
              <Input label="Time" value={resTime} onChangeText={setResTime} placeholder="14:30" containerStyle={{ flex: 1 }} />
            </View>

            {/* Prepull */}
            <TouchableOpacity
              style={[styles.prepullToggle, isPrepull && styles.prepullToggleActive]}
              onPress={() => setIsPrepull(!isPrepull)}
            >
              <Clock size={16} color={isPrepull ? C.purple : C.textMuted} />
              <Text style={[styles.prepullToggleText, isPrepull && { color: C.purple }]}>Prepull (pick up day before)</Text>
            </TouchableOpacity>
            {isPrepull ? (
              <Input label="Prepull pickup date" value={prepullDate} onChangeText={setPrepullDate} placeholder="2026-07-14" />
            ) : null}

            <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="Special instructions..." multiline numberOfLines={3} />

            <Button
              label="Submit order"
              onPress={() => void handleSubmit()}
              loading={createMutation.isPending}
              fullWidth
              size="lg"
              icon={<Ship size={16} color={C.white} />}
            />
            <Button label="Cancel" onPress={() => setShowForm(false)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>

      {/* Terminal Picker Modal */}
      <Modal visible={showTerminalPicker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTerminalPicker(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Terminal</Text>
            <TouchableOpacity onPress={() => setShowTerminalPicker(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
            {portAndRailTerminals.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={styles.terminalItem}
                onPress={() => {
                  if (showTerminalPicker === 'origin') setOriginTerminalId(t.id);
                  else setDestinationTerminalId(t.id);
                  setShowTerminalPicker(null);
                }}
              >
                <View style={[styles.terminalItemIcon, { backgroundColor: (t.terminal_type === 'Port' ? C.blue : C.green) + '20' }]}>
                  {t.terminal_type === 'Port' ? <Ship size={16} color={C.blue} /> : <Train size={16} color={C.green} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.terminalItemName}>{t.name}</Text>
                  <Text style={styles.terminalItemMeta}>{t.code} · {t.city}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 16 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.accent, borderRadius: 16, padding: 16 },
  ctaIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontSize: 16, fontWeight: '800' as const, color: C.white },
  ctaDesc: { fontSize: 12, color: '#FFFFFFCC', marginTop: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  orderCard: { gap: 8 },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dirBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  dirBadgeText: { fontSize: 11, fontWeight: '800' as const },
  orderRef: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  orderMeta: { flexDirection: 'row', gap: 12 },
  orderMetaText: { fontSize: 12, color: C.textSecondary },
  orderCommodity: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  prepullBadge: { backgroundColor: C.purpleDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  prepullText: { fontSize: 10, fontWeight: '700' as const, color: C.purple },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12, paddingBottom: 60 },
  fieldLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text, marginBottom: 2, marginTop: 4 },
  dirToggle: { flexDirection: 'row', gap: 8 },
  dirToggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  dirToggleBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  dirToggleText: { fontSize: 14, fontWeight: '700' as const, color: C.textMuted },
  dirToggleTextActive: { color: C.white },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 12, fontWeight: '600' as const, color: C.textMuted },
  chipTextActive: { color: C.white },
  flagsToggleRow: { flexDirection: 'row', gap: 8 },
  flagToggle: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  flagToggleActive: { borderColor: C.yellow, backgroundColor: C.yellowDim },
  flagToggleText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
  flagToggleTextActive: { color: C.yellow },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 14 },
  pickerBtnText: { fontSize: 14, color: C.text, fontWeight: '600' as const, flex: 1 },
  resInputs: { flexDirection: 'row', gap: 10 },
  prepullToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  prepullToggleActive: { borderColor: C.purple + '55', backgroundColor: C.purpleDim },
  prepullToggleText: { fontSize: 13, fontWeight: '700' as const, color: C.textMuted },
  terminalItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  terminalItemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  terminalItemName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  terminalItemMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
