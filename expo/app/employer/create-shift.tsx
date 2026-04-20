import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import type { ShiftCategory } from '@/constants/types';

const CATEGORIES: ShiftCategory[] = ['General', 'Driver', 'Forklift', 'HighReach'];

export default function CreateShift() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { addShiftPost } = useDockData();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ShiftCategory>('General');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [minHours, setMinHours] = useState('4');
  const [workersNeeded, setWorkersNeeded] = useState('1');
  const [requirements, setRequirements] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!title || !address || !city || !date || !startTime || !endTime || !hourlyRate) {
      Alert.alert('Missing Fields', 'Please fill all required fields');
      return;
    }
    setSubmitting(true);
    setTimeout(() => {
      addShiftPost({
        id: `sp${Date.now()}`,
        employerCompanyId: user?.companyId ?? '',
        title,
        category,
        locationAddress: address,
        locationCity: city,
        date,
        startTime,
        endTime,
        hourlyRate: Number(hourlyRate),
        flatRate: null,
        minimumHours: Number(minHours),
        workersNeeded: Number(workersNeeded),
        requirements,
        notes,
        status: 'Posted',
        createdAt: new Date().toISOString(),
      });
      setSubmitting(false);
      Alert.alert('Shift Posted!', 'Workers can now apply to your shift.');
      setTitle(''); setAddress(''); setCity(''); setDate(''); setStartTime(''); setEndTime(''); setHourlyRate(''); setRequirements(''); setNotes('');
    }, 600);
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Post a Shift</Text>
        <Text style={styles.sub}>Find workers for your operation</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shift Details</Text>
          <View style={styles.formGap}>
            <Input label="Shift Title *" value={title} onChangeText={setTitle} placeholder="e.g. Forklift Operator – Racking" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Category</Text>
          <View style={styles.optionRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.optionChip, category === c && styles.optionActive]}>
                <Text style={[styles.optionText, category === c && styles.optionTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location & Timing</Text>
          <View style={styles.formGap}>
            <Input label="Address *" value={address} onChangeText={setAddress} placeholder="6200 Tilbury Ave" />
            <Input label="City *" value={city} onChangeText={setCity} placeholder="Delta" />
            <Input label="Date (YYYY-MM-DD) *" value={date} onChangeText={setDate} placeholder="2025-04-01" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="Start Time *" value={startTime} onChangeText={setStartTime} placeholder="07:00" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="End Time *" value={endTime} onChangeText={setEndTime} placeholder="12:00" />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pay & Staffing</Text>
          <View style={styles.formGap}>
            <Input label="Hourly Rate ($/hr) *" value={hourlyRate} onChangeText={setHourlyRate} keyboardType="numeric" placeholder="22" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input label="Minimum Hours" value={minHours} onChangeText={setMinHours} keyboardType="numeric" placeholder="4" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Workers Needed" value={workersNeeded} onChangeText={setWorkersNeeded} keyboardType="numeric" placeholder="1" />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requirements & Notes</Text>
          <View style={styles.formGap}>
            <Input label="Requirements" value={requirements} onChangeText={setRequirements} placeholder="Safety boots, hi-vis vest required" multiline numberOfLines={2} />
            <Input label="Additional Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} placeholder="Job details, parking info, special instructions…" />
          </View>
        </View>

        <View style={styles.section}>
          <Button label="Post Shift" onPress={handleSubmit} loading={submitting} fullWidth size="lg" icon={<CheckCircle size={16} color={C.white} />} />
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
  optionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  optionChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  optionText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  optionTextActive: { color: C.accent },
});
