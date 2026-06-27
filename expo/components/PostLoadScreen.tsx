import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Crosshair, MapPin, Truck, Zap } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import LoadsMap, { type MapPoint } from '@/components/LoadsMap';
import C from '@/constants/colors';
import { DeliverySpeed, VEHICLE_OPTIONS, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

type LatLng = { lat: number; lng: number };
type Quote = {
  distanceKm: number; freightPrice: number; commissionPct: number; commissionAmount: number;
  bookingFee: number; platformEarnings: number; providerNet: number; totalPrice: number;
};

interface PostLoadScreenProps {
  /** Where to send the user after a successful post (e.g. '/trucking-company/loads'). */
  doneRoute: string;
  title?: string;
}

export default function PostLoadScreen({ doneRoute, title = 'Post a load' }: PostLoadScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [placing, setPlacing] = useState<'pickup' | 'dropoff'>('pickup');
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [dropoff, setDropoff] = useState<LatLng | null>(null);
  const [pickupAddr, setPickupAddr] = useState<string>('');
  const [dropoffAddr, setDropoffAddr] = useState<string>('');
  const [vehicle, setVehicle] = useState<VehicleType>('Pickup');
  const [pallets, setPallets] = useState<number>(1);
  const [speed, setSpeed] = useState<DeliverySpeed>('NextDay');
  const [notes, setNotes] = useState<string>('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState<boolean>(false);

  const quoteMutation = trpc.loads.quote.useMutation();
  const postMutation = trpc.loads.post.useMutation();

  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (pickup) out.push({ id: 'pickup', lat: pickup.lat, lng: pickup.lng, kind: 'pickup', label: 'Pickup' });
    if (dropoff) out.push({ id: 'dropoff', lat: dropoff.lat, lng: dropoff.lng, kind: 'dropoff', label: 'Drop-off' });
    return out;
  }, [pickup, dropoff]);

  const routes = useMemo(
    () => (pickup && dropoff ? [{ from: pickup, to: dropoff }] : []),
    [pickup, dropoff],
  );

  const handleMapPress = (lat: number, lng: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setQuote(null);
    if (placing === 'pickup') {
      setPickup({ lat, lng });
      setPlacing('dropoff');
    } else {
      setDropoff({ lat, lng });
    }
  };

  const useMyLocation = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Not available', 'Use the map to drop a pickup pin on web.');
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Enable Location to use your position.'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPickup({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      setPlacing('dropoff');
      setQuote(null);
    } catch (err) {
      Alert.alert('Location error', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const getQuote = async () => {
    if (!pickup || !dropoff) { Alert.alert('Set both points', 'Drop a pickup and a drop-off pin first.'); return; }
    try {
      setQuoting(true);
      const q = await quoteMutation.mutateAsync({
        pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
        vehicleType: vehicle, pallets, deliverySpeed: speed,
      });
      setQuote(q as unknown as Quote);
    } catch (err) {
      Alert.alert('Unable to price', err instanceof Error ? err.message : 'Unknown');
    } finally {
      setQuoting(false);
    }
  };

  const submit = async () => {
    if (!pickup || !dropoff) { Alert.alert('Set both points', 'Drop a pickup and a drop-off pin first.'); return; }
    try {
      await postMutation.mutateAsync({
        pickupLat: pickup.lat, pickupLng: pickup.lng, pickupAddress: pickupAddr, pickupCity: '',
        dropoffLat: dropoff.lat, dropoffLng: dropoff.lng, dropoffAddress: dropoffAddr, dropoffCity: '',
        vehicleType: vehicle, pallets, deliverySpeed: speed, notes,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Load posted', 'Your load is now live on the marketplace.', [
        { text: 'OK', onPress: () => router.replace(doneRoute as never) },
      ]);
    } catch (err) {
      Alert.alert('Unable to post', err instanceof Error ? err.message : 'Unknown');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.segRow}>
          <Chip active={placing === 'pickup'} color={C.green} label={pickup ? '✓ Pickup set' : 'Set pickup'} onPress={() => setPlacing('pickup')} />
          <Chip active={placing === 'dropoff'} color={C.red} label={dropoff ? '✓ Drop-off set' : 'Set drop-off'} onPress={() => setPlacing('dropoff')} />
          <TouchableOpacity style={styles.locBtn} onPress={() => void useMyLocation()}>
            <Crosshair size={14} color={C.accent} />
          </TouchableOpacity>
        </View>

        <LoadsMap points={points} routes={routes} placing height={300} onMapPress={handleMapPress} />

        <Card style={styles.addrCard}>
          <View style={styles.addrRow}>
            <MapPin size={14} color={C.green} />
            <TextInput style={styles.addrInput} placeholder="Pickup address (optional)" placeholderTextColor={C.textMuted} value={pickupAddr} onChangeText={setPickupAddr} />
          </View>
          <View style={styles.addrRow}>
            <MapPin size={14} color={C.red} />
            <TextInput style={styles.addrInput} placeholder="Drop-off address (optional)" placeholderTextColor={C.textMuted} value={dropoffAddr} onChangeText={setDropoffAddr} />
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Vehicle type</Text>
        <View style={styles.vehicleGrid}>
          {VEHICLE_OPTIONS.map((v) => {
            const active = vehicle === v.type;
            return (
              <TouchableOpacity key={v.type} style={[styles.vehicleCard, active && styles.vehicleCardActive]} onPress={() => { setVehicle(v.type); setQuote(null); }}>
                <Text style={styles.vehicleEmoji}>{v.emoji}</Text>
                <Text style={[styles.vehicleLabel, active && { color: C.accent }]}>{v.label}</Text>
                <Text style={styles.vehicleDesc}>{v.description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Pallets</Text>
        <View style={styles.stepRow}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => { setPallets((p) => Math.max(1, p - 1)); setQuote(null); }}><Text style={styles.stepBtnText}>−</Text></TouchableOpacity>
          <Text style={styles.stepValue}>{pallets} {pallets === 1 ? 'pallet' : 'pallets'}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => { setPallets((p) => Math.min(60, p + 1)); setQuote(null); }}><Text style={styles.stepBtnText}>+</Text></TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Delivery speed</Text>
        <View style={styles.segRow}>
          <Chip active={speed === 'NextDay'} color={C.blue} label="Next day" onPress={() => { setSpeed('NextDay'); setQuote(null); }} />
          <Chip active={speed === 'SameDay'} color={C.accent} label="Same day (+40%)" onPress={() => { setSpeed('SameDay'); setQuote(null); }} />
        </View>

        <Card style={styles.notesCard}>
          <TextInput style={styles.notesInput} placeholder="Notes for the driver (optional)" placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline />
        </Card>

        {quote ? (
          <Card elevated style={styles.quoteCard}>
            <View style={styles.quoteHead}>
              <Zap size={16} color={C.accent} />
              <Text style={styles.quoteTitle}>Price estimate</Text>
              <Text style={styles.quoteDist}>{quote.distanceKm} km</Text>
            </View>
            <QuoteLine label="Freight price" value={quote.freightPrice} />
            <QuoteLine label="Booking fee" value={quote.bookingFee} />
            <View style={styles.quoteDivider} />
            <QuoteLine label="Total (shipper pays)" value={quote.totalPrice} bold />
            <View style={styles.platformNote}>
              <Text style={styles.platformNoteText}>
                Platform earns ${quote.platformEarnings.toFixed(2)} ({quote.commissionPct}% commission + ${quote.bookingFee.toFixed(2)} fee)
              </Text>
            </View>
          </Card>
        ) : null}

        <View style={styles.actions}>
          <Button label="Get price" variant="secondary" onPress={() => void getQuote()} loading={quoting} fullWidth icon={<Zap size={15} color={C.accent} />} />
          <Button label="Post load" onPress={() => void submit()} loading={postMutation.isPending} fullWidth icon={<Truck size={15} color={C.white} />} />
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({ active, color, label, onPress }: { active: boolean; color: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.chipText, active && { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function QuoteLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={styles.quoteLine}>
      <Text style={[styles.quoteLabel, bold && { color: C.text, fontWeight: '800' as const }]}>{label}</Text>
      <Text style={[styles.quoteValue, bold && { fontSize: 18 }]}>${value.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 16, gap: 14 },
  segRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  chipText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  locBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  addrCard: { gap: 10, padding: 12 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addrInput: { flex: 1, color: C.text, fontSize: 13, paddingVertical: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text, marginTop: 4 },
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleCard: { width: '31%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, gap: 2 },
  vehicleCardActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  vehicleEmoji: { fontSize: 22 },
  vehicleLabel: { fontSize: 12, fontWeight: '800' as const, color: C.text, marginTop: 2 },
  vehicleDesc: { fontSize: 10, color: C.textMuted, lineHeight: 13 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, justifyContent: 'center' },
  stepBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 22, color: C.text, fontWeight: '700' as const },
  stepValue: { fontSize: 15, fontWeight: '800' as const, color: C.text, minWidth: 100, textAlign: 'center' as const },
  notesCard: { padding: 12 },
  notesInput: { color: C.text, fontSize: 13, minHeight: 44 },
  quoteCard: { gap: 8, padding: 14 },
  quoteHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quoteTitle: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: C.text },
  quoteDist: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  quoteLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quoteLabel: { fontSize: 13, color: C.textSecondary },
  quoteValue: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  quoteDivider: { height: 1, backgroundColor: C.border, marginVertical: 4 },
  platformNote: { backgroundColor: C.greenDim, borderRadius: 10, padding: 10, marginTop: 6 },
  platformNoteText: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  actions: { gap: 10, marginTop: 8 },
});
