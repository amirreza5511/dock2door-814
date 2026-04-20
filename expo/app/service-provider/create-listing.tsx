import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { CheckCircle, ArrowLeft } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const CATEGORIES = ['Labour', 'Forklift', 'PalletRework', 'Devanning', 'LocalTruck', 'IndustrialCleaning'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_LABELS: Record<Category, string> = {
  Labour: 'Labour',
  Forklift: 'Forklift',
  PalletRework: 'Pallet Rework',
  Devanning: 'Devanning',
  LocalTruck: 'Local Truck',
  IndustrialCleaning: 'Cleaning',
};

export default function CreateServiceListing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const createMutation = trpc.services.createListing.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.services.listMine.invalidate(),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });

  const [category, setCategory] = useState<Category>('Labour');
  const [city, setCity] = useState<string>('');
  const [hourlyRate, setHourlyRate] = useState<string>('');
  const [perJobRate, setPerJobRate] = useState<string>('');
  const [minimumHours, setMinimumHours] = useState<string>('2');
  const [coverage, setCoverage] = useState<string>('');
  const [certifications, setCertifications] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const handleSubmit = async () => {
    if (!city || !hourlyRate) {
      Alert.alert('Missing Fields', 'City and hourly rate are required.');
      return;
    }
    const coverageArea = coverage
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await createMutation.mutateAsync({
        category,
        city,
        hourlyRate: Number(hourlyRate),
        perJobRate: perJobRate ? Number(perJobRate) : null,
        minimumHours: Number(minimumHours) || 1,
        coverageArea: coverageArea.length > 0 ? coverageArea : [city],
        certifications,
        description,
        status: 'Draft',
      });
      Alert.alert('Service Listing Created', 'Saved as Draft. Submit for approval from Services to go live.', [
        {
          text: 'OK',
          onPress: () => {
            setCity(''); setHourlyRate(''); setPerJobRate('');
            setCoverage(''); setCertifications(''); setDescription('');
            router.push('/service-provider/listings' as never);
          },
        },
      ]);
    } catch (error) {
      Alert.alert('Unable to create listing', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>New Service</Text>
          <Text style={styles.sub}>List a service your team offers</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Category</Text>
          <View style={styles.optionRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.optionChip, category === c && styles.optionChipActive]}>
                <Text style={[styles.optionText, category === c && styles.optionTextActive]}>{CATEGORY_LABELS[c]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location & Coverage</Text>
          <View style={styles.formGap}>
            <Input label="Primary City *" value={city} onChangeText={setCity} placeholder="Vancouver" />
            <Input label="Coverage Cities (comma separated)" value={coverage} onChangeText={setCoverage} placeholder="Vancouver, Burnaby, Richmond" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pricing</Text>
          <View style={styles.formGap}>
            <Input label="Hourly Rate ($) *" value={hourlyRate} onChangeText={setHourlyRate} keyboardType="numeric" placeholder="65" />
            <Input label="Per Job Rate ($) — optional" value={perJobRate} onChangeText={setPerJobRate} keyboardType="numeric" placeholder="450" />
            <Input label="Minimum Hours" value={minimumHours} onChangeText={setMinimumHours} keyboardType="numeric" placeholder="2" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.formGap}>
            <Input label="Certifications" value={certifications} onChangeText={setCertifications} multiline numberOfLines={3} placeholder="Forklift license, WHMIS, etc." />
            <Input label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={4} placeholder="Describe what you offer…" />
          </View>
        </View>

        <View style={styles.section}>
          <Button
            label="Create Service Listing (Draft)"
            onPress={handleSubmit}
            loading={createMutation.isPending}
            fullWidth
            size="lg"
            icon={<CheckCircle size={16} color={C.white} />}
            testID="create-service-listing-submit"
          />
          <Text style={styles.hint}>Listing saved as Draft. Submit for approval from Services.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  formGap: { gap: 12 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  optionText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  optionTextActive: { color: C.accent },
  hint: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10 },
});
