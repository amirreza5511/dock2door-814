import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity,
  Platform, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, Upload, Calendar, Clock, ChevronDown, Repeat, Zap } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import { buildShiftAttachmentPath, uploadFileWithMetadata } from '@/lib/storage-files';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import type { ShiftCategory } from '@/constants/types';

const CATEGORIES: ShiftCategory[] = ['General', 'Driver', 'Forklift', 'HighReach'];

const PPE_OPTIONS = [
  'Steel-toe boots',
  'Hi-vis vest',
  'Hard hat',
  'Gloves',
  'Safety glasses',
  'Forklift licence',
  'Criminal record check',
];

// Generate next 30 days
function getNext30Days(): { label: string; value: string }[] {
  const result = [];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const label = `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    result.push({ label, value: iso });
  }
  return result;
}

// Generate times from 5:00 AM to 11:00 PM in 30-min increments
function getTimeOptions(): { label: string; value: string }[] {
  const result = [];
  for (let h = 5; h <= 23; h++) {
    for (const m of [0, 30]) {
      if (h === 23 && m === 30) break;
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const ap = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      const label = m === 0 ? `${h12}:00 ${ap}` : `${h12}:30 ${ap}`;
      result.push({ label, value: `${hh}:${mm}` });
    }
  }
  return result;
}

const DATE_OPTIONS = getNext30Days();
const TIME_OPTIONS = getTimeOptions();

interface PickerModalProps {
  visible: boolean;
  title: string;
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}

function PickerModal({ visible, title, options, selected, onSelect, onClose }: PickerModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <View style={[pmStyles.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={pmStyles.header}>
          <Text style={pmStyles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={pmStyles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { onSelect(item.value); onClose(); }}
              style={[pmStyles.option, item.value === selected && pmStyles.optionSelected]}
            >
              <Text style={[pmStyles.optionText, item.value === selected && pmStyles.optionTextSelected]}>
                {item.label}
              </Text>
              {item.value === selected && <CheckCircle size={16} color={C.accent} />}
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}

const pmStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 18, fontWeight: '700' as const, color: C.text },
  cancel: { fontSize: 16, color: C.accent, fontWeight: '600' as const },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  optionSelected: { backgroundColor: C.accentDim },
  optionText: { fontSize: 16, color: C.text },
  optionTextSelected: { color: C.accent, fontWeight: '700' as const },
});

export default function CreateShift() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const createShift = trpc.shifts.create.useMutation({
    onSuccess: async () => {
      // The real bootstrap data lives under the plain ['dock','bootstrap'] key
      // (see useDockBootstrap.ts). The tRPC utils key wouldn't match it, so we
      // invalidate both to force the employer shifts list to refetch.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dock', 'bootstrap'] }),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });

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
  const [selectedPPE, setSelectedPPE] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<DocumentPicker.DocumentPickerAsset[]>([]);

  // Pickers
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Recurrence
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurType, setRecurType] = useState<'Daily' | 'Weekly' | 'Custom'>('Daily');
  const [recurCount, setRecurCount] = useState('1');

  // Urgent flag
  const [isUrgent, setIsUrgent] = useState(false);

  // Creating state for recurrence
  const [creatingCount, setCreatingCount] = useState(0);
  const [totalToCreate, setTotalToCreate] = useState(0);

  const togglePPE = (opt: string) => {
    setSelectedPPE((prev) =>
      prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt],
    );
  };

  const getDateLabel = () => {
    if (!date) return 'Select date';
    return DATE_OPTIONS.find((d) => d.value === date)?.label ?? date;
  };

  const getTimeLabel = (t: string) => {
    if (!t) return 'Select time';
    return TIME_OPTIONS.find((o) => o.value === t)?.label ?? t;
  };

  const incrementDate = (base: string, days: number): string => {
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const handleSubmit = async () => {
    if (!title || !address || !city || !date || !startTime || !endTime || !hourlyRate) {
      Alert.alert('Missing Fields', 'Please fill all required fields');
      return;
    }

    const requirements = selectedPPE.join(', ');
    const notesValue = isUrgent ? `[URGENT] ${notes}` : notes;

    const count = isRecurring ? Math.max(1, Math.min(12, Number(recurCount) || 1)) : 1;
    const step = recurType === 'Daily' ? 1 : recurType === 'Weekly' ? 7 : 1;

    if (count > 1) setTotalToCreate(count);

    for (let i = 0; i < count; i++) {
      if (count > 1) setCreatingCount(i + 1);
      const shiftDate = i === 0 ? date : incrementDate(date, i * step);
      try {
        await createShift.mutateAsync(
          {
            title,
            category,
            locationAddress: address,
            locationCity: city,
            date: shiftDate,
            startTime,
            endTime,
            hourlyRate: Number(hourlyRate),
            minimumHours: Number(minHours),
            workersNeeded: Number(workersNeeded),
            requirements,
            notes: notesValue,
          },
          {
            onSuccess: async (result: unknown) => {
              if (i === 0 && user?.companyId) {
                const { id } = result as { id: string };
                for (const asset of attachments) {
                  const filename = asset.name ?? `shift-${Date.now()}`;
                  const path = buildShiftAttachmentPath(user.companyId, id, filename);
                  const blob =
                    Platform.OS === 'web' && asset.file
                      ? asset.file
                      : await (await fetch(asset.uri)).blob();
                  await uploadFileWithMetadata({
                    bucket: 'shift-attachments',
                    path,
                    file: blob,
                    contentType: asset.mimeType ?? 'application/octet-stream',
                    entityType: 'shift_attachment',
                    entityId: id,
                    companyId: user.companyId,
                  });
                  await supabase.from('shift_attachments').insert({
                    shift_id: id,
                    employer_company_id: user.companyId,
                    file_path: path,
                    caption: filename,
                    uploaded_by: user.id,
                  });
                }
              }
            },
          },
        );
      } catch (err) {
        Alert.alert('Unable to post shift', err instanceof Error ? err.message : 'Unknown error');
        setCreatingCount(0);
        setTotalToCreate(0);
        return;
      }
    }

    setCreatingCount(0);
    setTotalToCreate(0);
    Alert.alert('Shift Posted!', count > 1 ? `${count} shifts have been posted.` : 'Workers can now apply to your shift.');
    setTitle('');
    setAddress('');
    setCity('');
    setDate('');
    setStartTime('');
    setEndTime('');
    setHourlyRate('');
    setSelectedPPE([]);
    setNotes('');
    setAttachments([]);
    setIsRecurring(false);
    setIsUrgent(false);
  };

  const pickAttachments = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ['image/*', 'application/pdf'],
    });
    if (!picked.canceled) setAttachments(picked.assets ?? []);
  };

  const isCreating = totalToCreate > 0;
  const creatingLabel = isCreating
    ? `Creating ${creatingCount}/${totalToCreate} shifts…`
    : isRecurring && Number(recurCount) > 1
    ? `Post ${recurCount} Shifts`
    : 'Post Shift';

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Post a Shift</Text>
        <Text style={styles.sub}>Find workers for your operation</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Shift Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shift Details</Text>
          <View style={styles.formGap}>
            <Input
              label="Shift Title *"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Forklift Operator – Racking"
            />
          </View>
        </View>

        {/* Category */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Category</Text>
          <View style={styles.optionRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.optionChip, category === c && styles.optionActive]}
              >
                <Text style={[styles.optionText, category === c && styles.optionTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.formGap}>
            <Input label="Address *" value={address} onChangeText={setAddress} placeholder="6200 Tilbury Ave" />
            <Input label="City *" value={city} onChangeText={setCity} placeholder="Delta" />
          </View>
        </View>

        {/* Date & Time — Modal Pickers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Date & Time</Text>
          <View style={styles.formGap}>
            {/* Date Picker */}
            <View>
              <Text style={styles.inputLabel}>Date *</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.pickerBtn}>
                <Calendar size={16} color={date ? C.text : C.textMuted} />
                <Text style={[styles.pickerText, !date && styles.pickerPlaceholder]}>
                  {getDateLabel()}
                </Text>
                <ChevronDown size={16} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.row}>
              {/* Start Time */}
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Start Time *</Text>
                <TouchableOpacity onPress={() => setShowStartPicker(true)} style={styles.pickerBtn}>
                  <Clock size={16} color={startTime ? C.text : C.textMuted} />
                  <Text style={[styles.pickerText, !startTime && styles.pickerPlaceholder]}>
                    {getTimeLabel(startTime)}
                  </Text>
                  <ChevronDown size={14} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {/* End Time */}
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>End Time *</Text>
                <TouchableOpacity onPress={() => setShowEndPicker(true)} style={styles.pickerBtn}>
                  <Clock size={16} color={endTime ? C.text : C.textMuted} />
                  <Text style={[styles.pickerText, !endTime && styles.pickerPlaceholder]}>
                    {getTimeLabel(endTime)}
                  </Text>
                  <ChevronDown size={14} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Pay & Staffing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pay & Staffing</Text>
          <View style={styles.formGap}>
            <Input
              label="Hourly Rate ($/hr) *"
              value={hourlyRate}
              onChangeText={setHourlyRate}
              keyboardType="numeric"
              placeholder="22"
            />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Minimum Hours"
                  value={minHours}
                  onChangeText={setMinHours}
                  keyboardType="numeric"
                  placeholder="4"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="Workers Needed"
                  value={workersNeeded}
                  onChangeText={setWorkersNeeded}
                  keyboardType="numeric"
                  placeholder="1"
                />
              </View>
            </View>
          </View>
        </View>

        {/* PPE Requirements */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PPE Requirements</Text>
          <Text style={styles.sectionSub}>Select all that apply</Text>
          <View style={styles.optionRow}>
            {PPE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                onPress={() => togglePPE(opt)}
                style={[styles.ppeChip, selectedPPE.includes(opt) && styles.ppeChipActive]}
              >
                {selectedPPE.includes(opt) && <CheckCircle size={12} color={C.accent} />}
                <Text style={[styles.ppeText, selectedPPE.includes(opt) && styles.ppeTextActive]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Recurrence */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <Repeat size={16} color={isRecurring ? C.accent : C.textMuted} />
              <View>
                <Text style={[styles.toggleTitle, isRecurring && { color: C.text }]}>Repeat this shift</Text>
                <Text style={styles.toggleSub}>Post multiple shifts at once</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setIsRecurring((v) => !v)}
              style={[styles.toggle, isRecurring && styles.toggleOn]}
            >
              <View style={[styles.toggleThumb, isRecurring && styles.toggleThumbOn]} />
            </TouchableOpacity>
          </View>

          {isRecurring && (
            <View style={styles.recurOptions}>
              <View style={styles.optionRow}>
                {(['Daily', 'Weekly', 'Custom'] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setRecurType(t)}
                    style={[styles.optionChip, recurType === t && styles.optionActive]}
                  >
                    <Text style={[styles.optionText, recurType === t && styles.optionTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ maxWidth: 160 }}>
                <Input
                  label={`Number of ${recurType === 'Daily' ? 'days' : recurType === 'Weekly' ? 'weeks' : 'occurrences'} (1–12)`}
                  value={recurCount}
                  onChangeText={(v) => setRecurCount(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="3"
                />
              </View>
            </View>
          )}
        </View>

        {/* Urgent Flag */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <Zap size={16} color={isUrgent ? C.red : C.textMuted} />
              <View>
                <Text style={[styles.toggleTitle, isUrgent && { color: C.red }]}>Urgent — need workers ASAP</Text>
                <Text style={styles.toggleSub}>Adds a red URGENT badge on shift cards</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setIsUrgent((v) => !v)}
              style={[styles.toggle, isUrgent && styles.toggleOnRed]}
            >
              <View style={[styles.toggleThumb, isUrgent && styles.toggleThumbOn]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Notes & Attachments */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notes & Attachments</Text>
          <View style={styles.formGap}>
            <Input
              label="Additional Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              placeholder="Job details, parking info, special instructions…"
            />
            <Button
              label={
                attachments.length
                  ? `${attachments.length} file(s) attached`
                  : 'Attach job photos/instructions'
              }
              onPress={pickAttachments}
              variant="secondary"
              fullWidth
              icon={<Upload size={15} color={C.text} />}
            />
          </View>
        </View>

        {/* Submit */}
        <View style={styles.section}>
          <Button
            label={creatingLabel}
            onPress={handleSubmit}
            loading={isCreating || createShift.isPending}
            fullWidth
            size="lg"
            icon={<CheckCircle size={16} color={C.white} />}
          />
        </View>
      </ScrollView>

      {/* Date Picker Modal */}
      <PickerModal
        visible={showDatePicker}
        title="Select Date"
        options={DATE_OPTIONS}
        selected={date}
        onSelect={setDate}
        onClose={() => setShowDatePicker(false)}
      />
      {/* Start Time Modal */}
      <PickerModal
        visible={showStartPicker}
        title="Select Start Time"
        options={TIME_OPTIONS}
        selected={startTime}
        onSelect={setStartTime}
        onClose={() => setShowStartPicker(false)}
      />
      {/* End Time Modal */}
      <PickerModal
        visible={showEndPicker}
        title="Select End Time"
        options={TIME_OPTIONS}
        selected={endTime}
        onSelect={setEndTime}
        onClose={() => setShowEndPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  sectionSub: { fontSize: 12, color: C.textMuted, marginBottom: 10, marginTop: -8 },
  formGap: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  inputLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 6 },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerText: { flex: 1, fontSize: 14, color: C.text },
  pickerPlaceholder: { color: C.textMuted },
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  optionActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  optionText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  optionTextActive: { color: C.accent },
  // PPE chips
  ppeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  ppeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  ppeText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' as const },
  ppeTextActive: { color: C.accent, fontWeight: '600' as const },
  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleTitle: { fontSize: 14, fontWeight: '600' as const, color: C.textSecondary },
  toggleSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  toggle: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: C.accent },
  toggleOnRed: { backgroundColor: C.red },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.white },
  toggleThumbOn: { alignSelf: 'flex-end' },
  recurOptions: { gap: 12, marginTop: 12, paddingLeft: 4 },
});
