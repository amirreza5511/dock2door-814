import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Clock, Crosshair, MapPin, Route as RouteIcon, Search, Truck, Zap } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import LoadsMap, { type MapPoint } from '@/components/LoadsMap';
import C from '@/constants/colors';
import { CARGO_OPTIONS, CargoType, DeliverySpeed, VEHICLE_OPTIONS, VehicleType } from '@/constants/loads';
import { autocompleteAddress, fetchRoute, geocodeAddress, reverseGeocode, type AddressSuggestion, type RouteResult } from '@/lib/geocode';
import { trpc } from '@/lib/trpc';

type LatLng = { lat: number; lng: number };

const num = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Format a duration in minutes into a compact "1 h 20 min" / "45 min" string. */
const formatDuration = (min: number): string => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};
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
  const [cargo, setCargo] = useState<CargoType>('Pallet');
  const [vehicle, setVehicle] = useState<VehicleType>('FiveTon');
  const [pallets, setPallets] = useState<number>(1);
  const [itemCount, setItemCount] = useState<number>(1);
  const [weightKg, setWeightKg] = useState<string>('');
  const [lengthCm, setLengthCm] = useState<string>('');
  const [widthCm, setWidthCm] = useState<string>('');
  const [heightCm, setHeightCm] = useState<string>('');
  const [itemDescription, setItemDescription] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientPhone, setRecipientPhone] = useState<string>('');
  const [speed, setSpeed] = useState<DeliverySpeed>('NextDay');
  const [notes, setNotes] = useState<string>('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState<boolean>(false);
  const [geocoding, setGeocoding] = useState<'pickup' | 'dropoff' | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [pickupSug, setPickupSug] = useState<AddressSuggestion[]>([]);
  const [dropoffSug, setDropoffSug] = useState<AddressSuggestion[]>([]);

  const quoteMutation = trpc.loads.quote.useMutation();
  const postMutation = trpc.loads.post.useMutation();

  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteReqId = useRef<number>(0);

  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (pickup) out.push({ id: 'pickup', lat: pickup.lat, lng: pickup.lng, kind: 'pickup', label: 'Pickup' });
    if (dropoff) out.push({ id: 'dropoff', lat: dropoff.lat, lng: dropoff.lng, kind: 'dropoff', label: 'Drop-off' });
    return out;
  }, [pickup, dropoff]);

  const routes = useMemo(
    () => (pickup && dropoff ? [{ from: pickup, to: dropoff, path: route?.coordinates }] : []),
    [pickup, dropoff, route],
  );

  // Fetch a real road-following route whenever both endpoints are set.
  useEffect(() => {
    if (!pickup || !dropoff) { setRoute(null); return; }
    let cancelled = false;
    void fetchRoute(pickup, dropoff).then((r) => { if (!cancelled) setRoute(r); });
    return () => { cancelled = true; };
  }, [pickup, dropoff]);

  // Auto-price: recompute the quote whenever pricing inputs change (debounced).
  useEffect(() => {
    if (!pickup || !dropoff) { setQuote(null); setQuoting(false); return; }
    const id = ++quoteReqId.current;
    setQuoting(true);
    const t = setTimeout(() => {
      void quoteMutation
        .mutateAsync({
          pickupLat: pickup.lat, pickupLng: pickup.lng,
          dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
          vehicleType: vehicle, pallets, deliverySpeed: speed,
          cargoType: cargo, weightKg: num(weightKg),
          distanceKm: route?.distanceKm,
        })
        .then((q) => { if (id === quoteReqId.current) setQuote(q as unknown as Quote); })
        .catch(() => { if (id === quoteReqId.current) setQuote(null); })
        .finally(() => { if (id === quoteReqId.current) setQuoting(false); });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dropoff, vehicle, cargo, pallets, weightKg, speed, route]);

  const selectCargo = (next: CargoType) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const opt = CARGO_OPTIONS.find((c) => c.type === next);
    setCargo(next);
    if (opt) setVehicle(opt.suggestedVehicle);
    setQuote(null);
  };

  const runAutocomplete = (which: 'pickup' | 'dropoff', text: string) => {
    if (acTimer.current) clearTimeout(acTimer.current);
    if (text.trim().length < 3) {
      if (which === 'pickup') setPickupSug([]); else setDropoffSug([]);
      return;
    }
    acTimer.current = setTimeout(() => {
      void autocompleteAddress(text).then((res) => {
        if (which === 'pickup') setPickupSug(res); else setDropoffSug(res);
      });
    }, 350);
  };

  const onChangePickup = (text: string) => { setPickupAddr(text); runAutocomplete('pickup', text); };
  const onChangeDropoff = (text: string) => { setDropoffAddr(text); runAutocomplete('dropoff', text); };

  const selectSuggestion = (which: 'pickup' | 'dropoff', s: AddressSuggestion) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (which === 'pickup') {
      setPickup({ lat: s.lat, lng: s.lng });
      setPickupAddr(s.label);
      setPickupSug([]);
      setPlacing('dropoff');
    } else {
      setDropoff({ lat: s.lat, lng: s.lng });
      setDropoffAddr(s.label);
      setDropoffSug([]);
    }
  };

  const handleMapPress = (lat: number, lng: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const which = placing;
    if (which === 'pickup') {
      setPickup({ lat, lng });
      setPickupSug([]);
      setPlacing('dropoff');
    } else {
      setDropoff({ lat, lng });
      setDropoffSug([]);
    }
    // Fill the matching address field from the dropped pin (best-effort).
    void reverseGeocode(lat, lng).then((label) => {
      if (!label) return;
      if (which === 'pickup') setPickupAddr((cur) => cur.trim() ? cur : label);
      else setDropoffAddr((cur) => cur.trim() ? cur : label);
    });
  };

  const searchAddress = async (which: 'pickup' | 'dropoff') => {
    const addr = which === 'pickup' ? pickupAddr : dropoffAddr;
    if (!addr.trim()) { Alert.alert('Type an address', `Enter a ${which === 'pickup' ? 'pickup' : 'drop-off'} address, then tap search.`); return; }
    try {
      setGeocoding(which);
      const res = await geocodeAddress(addr);
      if (!res) { Alert.alert('Address not found', 'Try adding a city or postal/ZIP code to narrow it down.'); return; }
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      if (which === 'pickup') {
        setPickup({ lat: res.lat, lng: res.lng });
        setPickupAddr(res.label);
        setPickupSug([]);
        setPlacing('dropoff');
      } else {
        setDropoff({ lat: res.lat, lng: res.lng });
        setDropoffAddr(res.label);
        setDropoffSug([]);
      }
    } catch (err) {
      Alert.alert('Search failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGeocoding(null);
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
      setPickupSug([]);
      setPlacing('dropoff');
    } catch (err) {
      Alert.alert('Location error', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const submit = async () => {
    if (!pickup || !dropoff) { Alert.alert('Set both points', 'Drop a pickup and a drop-off pin first.'); return; }
    try {
      await postMutation.mutateAsync({
        pickupLat: pickup.lat, pickupLng: pickup.lng, pickupAddress: pickupAddr, pickupCity: '',
        dropoffLat: dropoff.lat, dropoffLng: dropoff.lng, dropoffAddress: dropoffAddr, dropoffCity: '',
        vehicleType: vehicle, pallets, deliverySpeed: speed, notes,
        cargoType: cargo, itemCount, weightKg: num(weightKg),
        lengthCm: num(lengthCm), widthCm: num(widthCm), heightCm: num(heightCm),
        itemDescription, recipientName, recipientPhone,
        distanceKm: route?.distanceKm,
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

        {route ? (
          <View style={styles.routeBanner}>
            <View style={styles.routeStat}>
              <RouteIcon size={14} color={C.accent} />
              <Text style={styles.routeStatText}>{route.distanceKm} km by road</Text>
            </View>
            <View style={styles.routeDot} />
            <View style={styles.routeStat}>
              <Clock size={14} color={C.accent} />
              <Text style={styles.routeStatText}>{formatDuration(route.durationMin)} drive</Text>
            </View>
          </View>
        ) : null}

        <Card style={styles.addrCard}>
          <Text style={styles.addrHint}>Start typing an address and pick a suggestion — or tap the map directly.</Text>
          <View style={styles.addrRow}>
            <MapPin size={14} color={C.green} />
            <TextInput style={styles.addrInput} placeholder="Pickup address" placeholderTextColor={C.textMuted} value={pickupAddr} onChangeText={onChangePickup} returnKeyType="search" onSubmitEditing={() => void searchAddress('pickup')} />
            <TouchableOpacity style={[styles.addrSearchBtn, { borderColor: C.green }]} onPress={() => void searchAddress('pickup')} disabled={geocoding === 'pickup'} accessibilityLabel="Find pickup">
              <Search size={15} color={geocoding === 'pickup' ? C.textMuted : C.green} />
            </TouchableOpacity>
          </View>
          {pickupSug.length > 0 ? (
            <View style={styles.sugList}>
              {pickupSug.map((s) => (
                <TouchableOpacity key={s.id} style={styles.sugItem} onPress={() => selectSuggestion('pickup', s)}>
                  <MapPin size={13} color={C.green} />
                  <Text style={styles.sugText} numberOfLines={2}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <View style={styles.addrRow}>
            <MapPin size={14} color={C.red} />
            <TextInput style={styles.addrInput} placeholder="Drop-off address" placeholderTextColor={C.textMuted} value={dropoffAddr} onChangeText={onChangeDropoff} returnKeyType="search" onSubmitEditing={() => void searchAddress('dropoff')} />
            <TouchableOpacity style={[styles.addrSearchBtn, { borderColor: C.red }]} onPress={() => void searchAddress('dropoff')} disabled={geocoding === 'dropoff'} accessibilityLabel="Find drop-off">
              <Search size={15} color={geocoding === 'dropoff' ? C.textMuted : C.red} />
            </TouchableOpacity>
          </View>
          {dropoffSug.length > 0 ? (
            <View style={styles.sugList}>
              {dropoffSug.map((s) => (
                <TouchableOpacity key={s.id} style={styles.sugItem} onPress={() => selectSuggestion('dropoff', s)}>
                  <MapPin size={13} color={C.red} />
                  <Text style={styles.sugText} numberOfLines={2}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </Card>

        <Text style={styles.sectionTitle}>What are you shipping?</Text>
        <View style={styles.vehicleGrid}>
          {CARGO_OPTIONS.map((c) => {
            const active = cargo === c.type;
            return (
              <TouchableOpacity key={c.type} style={[styles.vehicleCard, active && styles.vehicleCardActive]} onPress={() => selectCargo(c.type)}>
                <Text style={styles.vehicleEmoji}>{c.emoji}</Text>
                <Text style={[styles.vehicleLabel, active && { color: C.accent }]}>{c.label}</Text>
                <Text style={styles.vehicleDesc}>{c.description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Card style={styles.dimCard}>
          <Text style={styles.dimTitle}>Dimensions & weight</Text>
          <View style={styles.dimRow}>
            <DimInput label="Length" unit="cm" value={lengthCm} onChangeText={(t) => { setLengthCm(t); }} />
            <DimInput label="Width" unit="cm" value={widthCm} onChangeText={(t) => { setWidthCm(t); }} />
            <DimInput label="Height" unit="cm" value={heightCm} onChangeText={(t) => { setHeightCm(t); }} />
          </View>
          <View style={styles.dimRow}>
            <DimInput label="Weight" unit="kg" value={weightKg} onChangeText={(t) => { setWeightKg(t); setQuote(null); }} />
            <View style={styles.dimField}>
              <Text style={styles.dimLabel}>Quantity</Text>
              <View style={styles.qtyRow}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => setItemCount((n) => Math.max(1, n - 1))}><Text style={styles.qtyBtnText}>−</Text></TouchableOpacity>
                <Text style={styles.qtyValue}>{itemCount}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => setItemCount((n) => Math.min(999, n + 1))}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
              </View>
            </View>
          </View>
          <TextInput style={styles.dimDesc} placeholder="Describe the goods (e.g. fragile electronics)" placeholderTextColor={C.textMuted} value={itemDescription} onChangeText={setItemDescription} />
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

        <Text style={styles.sectionTitle}>Recipient (optional)</Text>
        <Card style={styles.addrCard}>
          <View style={styles.addrRow}>
            <TextInput style={styles.addrInput} placeholder="Recipient name" placeholderTextColor={C.textMuted} value={recipientName} onChangeText={setRecipientName} />
          </View>
          <View style={styles.addrRow}>
            <TextInput style={styles.addrInput} placeholder="Recipient phone" placeholderTextColor={C.textMuted} value={recipientPhone} onChangeText={setRecipientPhone} keyboardType="phone-pad" />
          </View>
        </Card>

        <Card style={styles.notesCard}>
          <TextInput style={styles.notesInput} placeholder="Notes for the driver (optional)" placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline />
        </Card>

        {!quote && quoting ? (
          <Card style={styles.calcCard}>
            <ActivityIndicator size="small" color={C.accent} />
            <Text style={styles.calcText}>Calculating price…</Text>
          </Card>
        ) : null}

        {!quote && !quoting && (!pickup || !dropoff) ? (
          <Card style={styles.calcCard}>
            <Zap size={15} color={C.textMuted} />
            <Text style={styles.calcText}>Set pickup & drop-off to see the price.</Text>
          </Card>
        ) : null}

        {quote ? (
          <Card elevated style={styles.quoteCard}>
            <View style={styles.quoteHead}>
              <Zap size={16} color={C.accent} />
              <Text style={styles.quoteTitle}>Price estimate</Text>
              {quoting ? <ActivityIndicator size="small" color={C.accent} /> : <Text style={styles.quoteDist}>{quote.distanceKm} km</Text>}
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
          <Button label="Post load" onPress={() => void submit()} loading={postMutation.isPending} fullWidth icon={<Truck size={15} color={C.white} />} />
        </View>
      </ScrollView>
    </View>
  );
}

function DimInput({ label, unit, value, onChangeText }: { label: string; unit: string; value: string; onChangeText: (t: string) => void }) {
  return (
    <View style={styles.dimField}>
      <Text style={styles.dimLabel}>{label}</Text>
      <View style={styles.dimInputWrap}>
        <TextInput style={styles.dimInput} placeholder="0" placeholderTextColor={C.textMuted} value={value} onChangeText={onChangeText} keyboardType="numeric" />
        <Text style={styles.dimUnit}>{unit}</Text>
      </View>
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
  addrHint: { fontSize: 11, color: C.textMuted, lineHeight: 15 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addrInput: { flex: 1, color: C.text, fontSize: 13, paddingVertical: 6 },
  addrSearchBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  sugList: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' },
  sugItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  sugText: { flex: 1, fontSize: 12, color: C.text, lineHeight: 16 },
  routeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  routeStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeStatText: { fontSize: 12, fontWeight: '800' as const, color: C.text },
  routeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
  calcCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 },
  calcText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
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
  dimCard: { padding: 12, gap: 10 },
  dimTitle: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  dimRow: { flexDirection: 'row', gap: 8 },
  dimField: { flex: 1, gap: 4 },
  dimLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  dimInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10 },
  dimInput: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 9 },
  dimUnit: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  dimDesc: { color: C.text, fontSize: 13, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 18, color: C.text, fontWeight: '700' as const },
  qtyValue: { fontSize: 14, fontWeight: '800' as const, color: C.text },
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
