import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckCircle } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type WarehouseType = 'Dry' | 'Chill' | 'Frozen';
type StorageTerm = 'Daily' | 'Weekly' | 'Monthly';

const WH_TYPES: WarehouseType[] = ['Dry', 'Chill', 'Frozen'];
const TERMS: StorageTerm[] = ['Daily', 'Weekly', 'Monthly'];

export default function CreateListing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const createMutation = trpc.warehouses.createListing.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.warehouses.listMine.invalidate(),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });

  const [name, setName] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [warehouseType, setWarehouseType] = useState<WarehouseType>('Dry');
  const [capacity, setCapacity] = useState<string>('');
  const [minPallets, setMinPallets] = useState<string>('10');
  const [maxPallets, setMaxPallets] = useState<string>('');
  const [term, setTerm] = useState<StorageTerm>('Monthly');
  const [rate, setRate] = useState<string>('');
  const [inbound, setInbound] = useState<string>('');
  const [outbound, setOutbound] = useState<string>('');
  const [receivingHours, setReceivingHours] = useState<string>('Mon–Fri 07:00–17:00');
  const [access, setAccess] = useState<string>('');
  const [insurance, setInsurance] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const handleSubmit = async () => {
    if (!name || !address || !city || !capacity || !rate) {
      Alert.alert('Missing Fields', 'Please fill in all required fields');
      return;
    }
    try {
      await createMutation.mutateAsync({
        name,
        address,
        city,
        warehouseType,
        availablePalletCapacity: Number(capacity),
        storageRatePerPallet: Number(rate),
        minPallets: Number(minPallets) || 0,
        maxPallets: Number(maxPallets || capacity),
        storageTerm: term,
        inboundHandlingFeePerPallet: Number(inbound || 0),
        outboundHandlingFeePerPallet: Number(outbound || 0),
        receivingHours,
        accessRestrictions: access,
        insuranceRequirements: insurance,
        notes,
        status: 'Draft',
      });
      Alert.alert('Listing Created', 'Your listing is saved as Draft. Submit it for approval from Listings to go live.', [
        {
          text: 'OK',
          onPress: () => {
            setName(''); setAddress(''); setCity(''); setCapacity('');
            setRate(''); setInbound(''); setOutbound(''); setNotes('');
            router.push('/warehouse-provider/listings' as never);
          },
        },
      ]);
    } catch (error) {
      Alert.alert('Unable to create listing', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>New Listing</Text>
        <Text style={styles.sub}>Create a warehouse space listing</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basic Info</Text>
          <View style={styles.formGap}>
            <Input label="Listing Name *" value={name} onChangeText={setName} placeholder="e.g. Vancouver Dry Storage" />
            <Input label="Address *" value={address} onChangeText={setAddress} placeholder="8800 Bridgeport Rd" />
            <Input label="City *" value={city} onChangeText={setCity} placeholder="Vancouver" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Warehouse Type</Text>
          <View style={styles.optionRow}>
            {WH_TYPES.map((t) => (
              <TouchableOpacity key={t} onPress={() => setWarehouseType(t)} style={[styles.optionChip, warehouseType === t && styles.optionChipActive]}>
                <Text style={[styles.optionText, warehouseType === t && styles.optionTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Capacity & Pricing</Text>
          <View style={styles.formGap}>
            <Input label="Total Pallet Capacity *" value={capacity} onChangeText={setCapacity} keyboardType="numeric" placeholder="500" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="Min Pallets" value={minPallets} onChangeText={setMinPallets} keyboardType="numeric" placeholder="10" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Max Pallets" value={maxPallets} onChangeText={setMaxPallets} keyboardType="numeric" placeholder="500" />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Storage Term</Text>
          <View style={styles.optionRow}>
            {TERMS.map((t) => (
              <TouchableOpacity key={t} onPress={() => setTerm(t)} style={[styles.optionChip, term === t && styles.optionChipActive]}>
                <Text style={[styles.optionText, term === t && styles.optionTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[styles.formGap, { marginTop: 12 }]}>
            <Input label={`Storage Rate per Pallet ($ / ${term.toLowerCase()}) *`} value={rate} onChangeText={setRate} keyboardType="numeric" placeholder="28" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="Inbound Fee ($/pallet)" value={inbound} onChangeText={setInbound} keyboardType="numeric" placeholder="12" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Outbound Fee ($/pallet)" value={outbound} onChangeText={setOutbound} keyboardType="numeric" placeholder="12" />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Facility Details</Text>
          <View style={styles.formGap}>
            <Input label="Receiving Hours" value={receivingHours} onChangeText={setReceivingHours} placeholder="Mon–Fri 07:00–17:00" />
            <Input label="Access Restrictions" value={access} onChangeText={setAccess} placeholder="Appointment required" />
            <Input label="Insurance Requirements" value={insurance} onChangeText={setInsurance} placeholder="Minimum $2M liability" />
            <Input label="Additional Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={4} placeholder="Dock doors, ceiling height, special certifications…" />
          </View>
        </View>

        <View style={styles.section}>
          <Button
            label="Create Listing (Draft)"
            onPress={handleSubmit}
            loading={createMutation.isPending}
            fullWidth
            size="lg"
            icon={<CheckCircle size={16} color={C.white} />}
            testID="create-listing-submit"
          />
          <Text style={styles.hint}>Listing will be saved as Draft. Go to Listings to submit for approval.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  formGap: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  optionText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  optionTextActive: { color: C.accent },
  hint: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10 },
});
