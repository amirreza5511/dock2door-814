import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckCircle, Building2 } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { DEFAULT_RATES, encodeListingRates } from '@/lib/listingRates';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

type WarehouseType = 'Dry' | 'Chill' | 'Frozen';
type StorageTerm = 'Daily' | 'Weekly' | 'Monthly';

const WH_TYPES: WarehouseType[] = ['Dry', 'Chill', 'Frozen'];
const TERMS: StorageTerm[] = ['Daily', 'Weekly', 'Monthly'];

export default function CreateListing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { activeCompany, memberships, isLoading: companyLoading, refresh: refreshCompanies, setActiveCompanyId } = useActiveCompany();
  const user = useAuthStore((s) => s.user);

  const [setupName, setSetupName] = useState<string>('');
  const [setupCity, setSetupCity] = useState<string>('');
  const [settingUp, setSettingUp] = useState<boolean>(false);

  const handleSetupCompany = async () => {
    const name = setupName.trim();
    if (!name) {
      Alert.alert('Company name required', 'Please enter your company name to continue.');
      return;
    }
    setSettingUp(true);
    try {
      console.log('[create-listing] calling setup_my_company', { name, city: setupCity });
      const { data, error } = await supabase.rpc('setup_my_company', {
        p_name: name,
        p_city: setupCity.trim() || '',
        p_type: 'WarehouseProvider',
      });
      console.log('[create-listing] setup_my_company result', { data, error });
      if (error) {
        const anyErr = error as { message?: string; details?: string; hint?: string; code?: string };
        const msg = anyErr?.message || anyErr?.details || anyErr?.hint || anyErr?.code || 'Database error';
        throw new Error(msg);
      }
      const newCompanyId = typeof data === 'string' ? data : null;
      await refreshCompanies();
      if (newCompanyId) {
        await setActiveCompanyId(newCompanyId);
      }
      Alert.alert('Company created', 'Your company is pending admin approval. You can start creating listings now.');
    } catch (e) {
      console.log('[create-listing] setup_my_company failed', e);
      const anyErr = e as { message?: string; details?: string; hint?: string; code?: string };
      const msg = (e instanceof Error && e.message) || anyErr?.message || anyErr?.details || anyErr?.hint || anyErr?.code || 'Unknown error';
      Alert.alert('Unable to create company', msg);
    } finally {
      setSettingUp(false);
    }
  };

  const createMutation = trpc.warehouses.createListing.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.warehouses.listMine.invalidate(),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });
  const setStatusMutation = trpc.warehouses.setListingStatus.useMutation({
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

  // Provider-defined add-on rates (offloading / gate / labour / special handling).
  const [rateC20, setRateC20] = useState<string>(String(DEFAULT_RATES.c20));
  const [rateC40, setRateC40] = useState<string>(String(DEFAULT_RATES.c40));
  const [rateT5, setRateT5] = useState<string>(String(DEFAULT_RATES.t5));
  const [rateGate, setRateGate] = useState<string>(String(DEFAULT_RATES.gate));
  const [rateLabour, setRateLabour] = useState<string>(String(DEFAULT_RATES.labour));
  const [rateSpecial, setRateSpecial] = useState<string>(String(DEFAULT_RATES.special));

  const toRate = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const handleSubmit = async (submitForApproval: boolean) => {
    if (!name || !address || !city || !capacity || !rate) {
      Alert.alert('Missing Fields', 'Please fill in all required fields');
      return;
    }
    if (!activeCompany) {
      Alert.alert('No active company', 'Please set up your company first.');
      return;
    }
    try {
      const notesWithRates = encodeListingRates(notes, {
        c20: toRate(rateC20, DEFAULT_RATES.c20),
        c40: toRate(rateC40, DEFAULT_RATES.c40),
        t5: toRate(rateT5, DEFAULT_RATES.t5),
        gate: toRate(rateGate, DEFAULT_RATES.gate),
        labour: toRate(rateLabour, DEFAULT_RATES.labour),
        special: toRate(rateSpecial, DEFAULT_RATES.special),
      });
      const created = await createMutation.mutateAsync({
        companyId: activeCompany.companyId,
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
        notes: notesWithRates,
        status: 'Draft',
      });

      if (submitForApproval && created?.id) {
        await setStatusMutation.mutateAsync({ id: created.id, status: 'PendingApproval' });
      }

      const message = submitForApproval
        ? 'Your listing was submitted for admin approval. Once an admin approves it, it goes live for customers.'
        : 'Your listing is saved as Draft. Submit it for approval from Listings to go live.';

      Alert.alert(submitForApproval ? 'Submitted for Approval' : 'Listing Saved', message, [
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

  if (companyLoading && !activeCompany) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!activeCompany) {
    const hasMemberships = memberships.length > 0;
    return (
      <View style={[styles.root, { backgroundColor: C.bg }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.title}>New Listing</Text>
          <Text style={styles.sub}>Set up your warehouse company first</Text>
        </View>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.setupCard}>
            <View style={styles.setupIconWrap}>
              <Building2 size={28} color={C.accent} />
            </View>
            <Text style={styles.setupTitle}>{hasMemberships ? 'Select an active company' : 'Create your company'}</Text>
            <Text style={styles.setupDesc}>
              {hasMemberships
                ? 'Pick a company from the switcher, then try again.'
                : 'Your account has no warehouse company yet. Create one to start listing warehouse space on Dock2Door.'}
            </Text>

            {!hasMemberships && (
              <View style={[styles.formGap, { width: '100%', marginTop: 8 }]}>
                <Input
                  label="Company Name *"
                  value={setupName}
                  onChangeText={setSetupName}
                  placeholder={user?.name ? `${user.name}'s Warehouse` : 'Dock2Door Logistics Ltd.'}
                  testID="setup-company-name"
                />
                <Input label="City" value={setupCity} onChangeText={setSetupCity} placeholder="Vancouver" testID="setup-company-city" />
                <Button
                  label={settingUp ? 'Creating…' : 'Create Company'}
                  onPress={handleSetupCompany}
                  loading={settingUp}
                  fullWidth
                  size="lg"
                  icon={<Building2 size={16} color={C.white} />}
                  testID="setup-company-submit"
                />
                <Text style={styles.hint}>Company is submitted for admin approval. You can still create draft listings immediately.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>New Listing</Text>
        <Text style={styles.sub}>Create a warehouse space listing · {activeCompany.companyName}</Text>
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
          <Text style={styles.sectionTitle}>Offloading & Add-on Rates</Text>
          <Text style={styles.sectionHint}>Set the prices customers pay for offloading and extra services. Leave defaults if unsure.</Text>
          <View style={[styles.formGap, { marginTop: 12 }]}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="20' Container ($)" value={rateC20} onChangeText={setRateC20} keyboardType="numeric" placeholder="250" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="40' Container ($)" value={rateC40} onChangeText={setRateC40} keyboardType="numeric" placeholder="400" />
              </View>
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="5-Ton Truck ($)" value={rateT5} onChangeText={setRateT5} keyboardType="numeric" placeholder="150" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Gate Fee ($)" value={rateGate} onChangeText={setRateGate} keyboardType="numeric" placeholder="45" />
              </View>
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="Labour ($/hour)" value={rateLabour} onChangeText={setRateLabour} keyboardType="numeric" placeholder="38" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Special Unload/Load ($)" value={rateSpecial} onChangeText={setRateSpecial} keyboardType="numeric" placeholder="120" />
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
            label="Submit for Approval"
            onPress={() => handleSubmit(true)}
            loading={createMutation.isPending || setStatusMutation.isPending}
            fullWidth
            size="lg"
            icon={<CheckCircle size={16} color={C.white} />}
            testID="create-listing-submit"
          />
          <View style={{ height: 10 }} />
          <Button
            label="Save as Draft"
            onPress={() => handleSubmit(false)}
            loading={createMutation.isPending && !setStatusMutation.isPending}
            variant="secondary"
            fullWidth
            size="lg"
            testID="create-listing-draft"
          />
          <Text style={styles.hint}>Submit for Approval sends your listing to an admin to review. Once approved, it goes live for customers.</Text>
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
  sectionHint: { fontSize: 12, color: C.textMuted, marginTop: -6, marginBottom: 2, lineHeight: 17 },
  formGap: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  optionText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  optionTextActive: { color: C.accent },
  hint: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10 },
  setupCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 24, alignItems: 'center', gap: 8 },
  setupIconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  setupTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text, textAlign: 'center' },
  setupDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 8 },
});
