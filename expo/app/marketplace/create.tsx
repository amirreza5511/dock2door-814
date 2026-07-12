import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { CheckCircle, ArrowLeft } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import {
  SERVICE_TYPES, SUBCATEGORIES, serviceTypeLabel,
  type ServiceType,
} from '@/constants/serviceMarketplace';

export default function CreateMarketplaceListing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();
  const createMutation = trpc.services.createListing.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.marketplace.browse.invalidate(),
        utils.services.listMine.invalidate(),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });

  const [serviceType, setServiceType] = useState<ServiceType>('equipment_rental');
  const [subcategory, setSubcategory] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [coverage, setCoverage] = useState<string>('');
  const [hourlyRate, setHourlyRate] = useState<string>('');
  const [dailyRate, setDailyRate] = useState<string>('');
  const [weeklyRate, setWeeklyRate] = useState<string>('');
  const [perJobRate, setPerJobRate] = useState<string>('');
  const [minimumHours, setMinimumHours] = useState<string>('2');
  const [negotiable, setNegotiable] = useState<boolean>(false);
  const [certifications, setCertifications] = useState<string>('');

  const isRental = serviceType === 'equipment_rental';

  const num = (s: string): number | null => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? n : null;
  };

  const handleSubmit = async () => {
    if (!user?.companyId) {
      Alert.alert('Company required', 'You need a company account to publish a listing.');
      return;
    }
    if (!title.trim() && !subcategory) {
      Alert.alert('Missing info', 'Add a title or pick a category.');
      return;
    }
    if (!city.trim()) {
      Alert.alert('Missing info', 'Primary city is required.');
      return;
    }
    const hasPrice = num(hourlyRate) || num(dailyRate) || num(weeklyRate) || num(perJobRate);
    if (!hasPrice && !negotiable) {
      Alert.alert('Missing price', 'Set at least one rate, or mark the listing as negotiable.');
      return;
    }

    const coverageArea = coverage.split(',').map((s) => s.trim()).filter(Boolean);

    try {
      await createMutation.mutateAsync({
        serviceType,
        subcategory,
        title: title.trim(),
        description: description.trim(),
        city,
        coverageArea: coverageArea.length > 0 ? coverageArea : [city],
        hourlyRate: num(hourlyRate) ?? 0,
        perJobRate: num(perJobRate),
        dailyRate: num(dailyRate),
        weeklyRate: num(weeklyRate),
        minimumHours: num(minimumHours) ?? 1,
        negotiable,
        certifications: certifications.trim(),
        status: 'Active',
      });
      Alert.alert('Listing published', 'Your listing is now live on the marketplace.', [
        { text: 'OK', onPress: () => router.replace('/marketplace' as never) },
      ]);
    } catch (error) {
      Alert.alert('Unable to publish', error instanceof Error ? error.message : 'Unknown error');
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
          <Text style={styles.title}>New Listing</Text>
          <Text style={styles.sub}>Publish to the marketplace</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Type</Text>
          <View style={styles.optionRow}>
            {SERVICE_TYPES.map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => { setServiceType(t.id); setSubcategory(''); }}
                style={[styles.optionChip, serviceType === t.id && styles.optionChipActive]}
              >
                <Text style={[styles.optionText, serviceType === t.id && styles.optionTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Category</Text>
          <View style={styles.optionRow}>
            {SUBCATEGORIES[serviceType].map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => setSubcategory(s.id)}
                style={[styles.optionChip, subcategory === s.id && styles.optionChipActive]}
              >
                <Text style={[styles.optionText, subcategory === s.id && styles.optionTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.formGap}>
            <Input label="Title *" value={title} onChangeText={setTitle} placeholder={isRental ? 'e.g. Toyota 5,000 lb Forklift' : 'e.g. On-site forklift technician'} />
            <Input label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={4} placeholder="Describe specs, condition, what's included…" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location & Coverage</Text>
          <View style={styles.formGap}>
            <Input label="Primary City *" value={city} onChangeText={setCity} placeholder="e.g. Chicago" />
            <Input label="Coverage Cities (comma separated)" value={coverage} onChangeText={setCoverage} placeholder="Chicago, Aurora, Naperville" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pricing</Text>
          <View style={styles.formGap}>
            {isRental ? (
              <>
                <Input label="Daily Rate ($)" value={dailyRate} onChangeText={setDailyRate} keyboardType="numeric" placeholder="180" />
                <Input label="Weekly Rate ($)" value={weeklyRate} onChangeText={setWeeklyRate} keyboardType="numeric" placeholder="750" />
                <Input label="Hourly Rate ($) — optional" value={hourlyRate} onChangeText={setHourlyRate} keyboardType="numeric" placeholder="35" />
              </>
            ) : (
              <>
                <Input label="Hourly Rate ($)" value={hourlyRate} onChangeText={setHourlyRate} keyboardType="numeric" placeholder="65" />
                <Input label="Per Job Rate ($) — optional" value={perJobRate} onChangeText={setPerJobRate} keyboardType="numeric" placeholder="450" />
                <Input label="Minimum Hours" value={minimumHours} onChangeText={setMinimumHours} keyboardType="numeric" placeholder="2" />
              </>
            )}
            <TouchableOpacity onPress={() => setNegotiable((v) => !v)} style={[styles.toggle, negotiable && styles.toggleActive]}>
              <View style={[styles.checkbox, negotiable && styles.checkboxActive]}>
                {negotiable && <CheckCircle size={14} color={C.white} />}
              </View>
              <Text style={styles.toggleText}>Price negotiable</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Certifications / Notes</Text>
          <Input label="" value={certifications} onChangeText={setCertifications} multiline numberOfLines={3} placeholder="Operator license, insurance, WHMIS…" />
        </View>

        <View style={styles.section}>
          <Button
            label="Publish Listing"
            onPress={handleSubmit}
            loading={createMutation.isPending}
            fullWidth
            size="lg"
            icon={<CheckCircle size={16} color={C.white} />}
            testID="create-marketplace-listing-submit"
          />
          <Text style={styles.hint}>Your listing goes live immediately and can be requested by any company.</Text>
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
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  toggleActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: C.accent, borderColor: C.accent },
  toggleText: { fontSize: 14, color: C.text, fontWeight: '600' as const },
  hint: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10 },
});
