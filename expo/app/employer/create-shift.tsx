import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity,
  Platform, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, Upload, Calendar, Clock, ChevronDown, Repeat, Zap, DollarSign } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { trpc } from '@/lib/trpc';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import { buildShiftAttachmentPath, uploadFileWithMetadata } from '@/lib/storage-files';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import SkillPicker from '@/components/SkillPicker';
import C from '@/constants/colors';
import type { ShiftCategory } from '@/constants/types';
import { ALL_SKILL_IDS } from '@/constants/skills';

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
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const params = useLocalSearchParams<{
    title?: string; category?: string; address?: string; city?: string;
    hourlyRate?: string; minHours?: string; workersNeeded?: string;
    requirements?: string; notes?: string;
  }>();
  const asStr = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

  // Platform commission (labour) for cost preview
  const commissionQ = useQuery({
    queryKey: ['platform-settings', 'labour-commission'],
    queryFn: async (): Promise<number> => {
      const { data } = await supabase
        .from('platform_settings')
        .select('labour_commission_percentage')
        .limit(1)
        .maybeSingle();
      const pct = (data as { labour_commission_percentage?: number } | null)?.labour_commission_percentage;
      return typeof pct === 'number' ? pct : 15;
    },
    staleTime: 5 * 60_000,
  });
  const commissionPct: number = commissionQ.data ?? 15;

  // Company readiness — uses server-side helpers (single source of truth) and falls back
  // to local checks if the RPCs aren't deployed yet.
  const companyQ = useQuery({
    queryKey: ['company-readiness', user?.companyId],
    queryFn: async () => {
      if (!user?.companyId) return null;
      const [companyRes, profileRes, billingRes, canPostRes] = await Promise.all([
        supabase
          .from('companies')
          .select('status, billing_mode, billing_email, billing_setup_completed_at, profile_completed_at, industry, public_bio, legal_business_name, admin_contact_email')
          .eq('id', user.companyId)
          .maybeSingle(),
        supabase.rpc('company_profile_is_complete', { p_company_id: user.companyId }),
        supabase.rpc('company_billing_is_complete', { p_company_id: user.companyId }),
        supabase.rpc('company_can_post_paid_shifts', { p_company_id: user.companyId }),
      ]);
      return {
        row: (companyRes.data ?? null) as {
          status: string | null;
          billing_mode: string | null;
          billing_email: string | null;
          billing_setup_completed_at: string | null;
          profile_completed_at: string | null;
          industry: string | null;
          public_bio: string | null;
          legal_business_name: string | null;
          admin_contact_email: string | null;
        } | null,
        profileComplete: profileRes.error ? null : Boolean(profileRes.data),
        billingComplete: billingRes.error ? null : Boolean(billingRes.data),
        canPostPaid: canPostRes.error ? null : Boolean(canPostRes.data),
      };
    },
    enabled: Boolean(user?.companyId),
    staleTime: 60_000,
  });
  const row = companyQ.data?.row ?? null;
  // Prefer server-side helpers; only fall back to local logic if the RPCs failed.
  const profileReady = companyQ.data?.profileComplete ?? Boolean(
    row?.profile_completed_at ||
    (row?.industry && (row?.public_bio?.length ?? 0) >= 20 && row?.legal_business_name && row?.admin_contact_email)
  );
  const billingReady = companyQ.data?.billingComplete ?? Boolean(row?.billing_setup_completed_at);
  const companyStatus = row?.status ?? '';
  const postingBlocked = companyStatus === 'Suspended';
  const canPostPaid = companyQ.data?.canPostPaid ?? (profileReady && billingReady && !postingBlocked);
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

  const initRequirements = asStr(params.requirements);
  const initCategory = asStr(params.category) as ShiftCategory;
  const [title, setTitle] = useState(asStr(params.title));
  const [skills, setSkills] = useState<ShiftCategory[]>(
    ALL_SKILL_IDS.includes(initCategory) ? [initCategory] : [],
  );
  const [isOngoing, setIsOngoing] = useState(false);
  const [address, setAddress] = useState(asStr(params.address));
  const [city, setCity] = useState(asStr(params.city));
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [hourlyRate, setHourlyRate] = useState(asStr(params.hourlyRate));
  const [minHours, setMinHours] = useState(asStr(params.minHours) || '4');
  const [workersNeeded, setWorkersNeeded] = useState(asStr(params.workersNeeded) || '1');
  const [selectedPPE, setSelectedPPE] = useState<string[]>(
    initRequirements ? initRequirements.split(',').map((r) => r.trim()).filter(Boolean) : [],
  );
  const [notes, setNotes] = useState(asStr(params.notes));
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

  const toggleSkill = (s: ShiftCategory) => {
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

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
    if (skills.length === 0) {
      Alert.alert('Select a skill', 'Pick at least one skill this job requires.');
      return;
    }
    if (postingBlocked) {
      Alert.alert(
        'Company suspended',
        'Your company cannot post shifts right now. Contact support to resolve account status.',
      );
      return;
    }
    // Block paid shift posting until company profile + billing setup are complete.
    // Single source of truth: company_can_post_paid_shifts() server-side helper.
    if (Number(hourlyRate) > 0 && !canPostPaid) {
      if (!profileReady) {
        Alert.alert(
          'Company profile incomplete',
          'Complete your company profile (industry, bio, legal name, admin contact) so workers and Super Admin can see who is posting the shift.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Complete profile', onPress: () => router.push('/employer/company-profile' as any) },
          ],
        );
        return;
      }
      if (!billingReady) {
        Alert.alert(
          'Billing setup required',
          'Add a billing contact and email before posting paid shifts. Invoices for confirmed hours will be issued to this contact.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Set up billing', onPress: () => router.push('/employer/billing' as any) },
          ],
        );
        return;
      }
      // Helper says not allowed but profile + billing look complete — status must be the blocker.
      Alert.alert(
        'Cannot post paid shifts',
        `Your company cannot post paid shifts right now (status: ${companyStatus || 'unknown'}). Contact support.`,
      );
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
            category: skills[0],
            skills,
            isOngoing,
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

        {/* Required skills */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Required Skills</Text>
          <Text style={styles.sectionSub}>Pick every skill this job needs — workers are matched on these</Text>
          <SkillPicker selected={skills} onToggle={toggleSkill} />
        </View>

        {/* Ongoing job toggle */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <Repeat size={16} color={isOngoing ? C.accent : C.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, isOngoing && { color: C.text }]}>Ongoing job opening</Text>
                <Text style={styles.toggleSub}>A recurring/continuous role, not a single dated shift. The date below is the start date.</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setIsOngoing((v) => !v)}
              style={[styles.toggle, isOngoing && styles.toggleOn]}
            >
              <View style={[styles.toggleThumb, isOngoing && styles.toggleThumbOn]} />
            </TouchableOpacity>
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

        {/* Cost preview */}
        {hourlyRate && startTime && endTime ? (() => {
          const sh = Number(startTime.split(':')[0]) + Number(startTime.split(':')[1]) / 60;
          const eh = Number(endTime.split(':')[0]) + Number(endTime.split(':')[1]) / 60;
          const hours = Math.max(0, eh - sh);
          const workers = Math.max(1, Number(workersNeeded) || 1);
          const rate = Number(hourlyRate) || 0;
          const labour = hours * rate * workers;
          const fee = labour * (commissionPct / 100);
          const total = labour + fee;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Estimated Cost</Text>
              <View style={{ backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.textMuted, fontSize: 13 }}>Worker pay ({hours.toFixed(1)}h × {workers} worker{workers > 1 ? 's' : ''})</Text>
                  <Text style={{ color: C.text, fontWeight: '600' as const }}>${labour.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.textMuted, fontSize: 13 }}>Platform fee ({commissionPct}%)</Text>
                  <Text style={{ color: C.text, fontWeight: '600' as const }}>${fee.toFixed(2)}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: C.border }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontWeight: '700' as const }}>Estimated total charge</Text>
                  <Text style={{ color: C.accent, fontWeight: '700' as const, fontSize: 16 }}>${total.toFixed(2)}</Text>
                </View>
                <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>Final charge is based on employer-confirmed hours after the shift.</Text>
              </View>
              {!profileReady ? (
                <TouchableOpacity
                  onPress={() => router.push('/employer/company-profile' as any)}
                  activeOpacity={0.8}
                  style={{ marginTop: 10, backgroundColor: C.yellowDim, borderWidth: 1, borderColor: C.yellow + '60', borderRadius: 10, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }}
                >
                  <DollarSign size={14} color={C.yellow} />
                  <Text style={{ color: C.yellow, fontSize: 12, flex: 1, fontWeight: '600' as const }}>
                    Company profile incomplete. Tap to add industry, bio, legal name + admin contact — required before posting paid shifts.
                  </Text>
                </TouchableOpacity>
              ) : !billingReady ? (
                <TouchableOpacity
                  onPress={() => router.push('/employer/billing' as any)}
                  activeOpacity={0.8}
                  style={{ marginTop: 10, backgroundColor: C.yellowDim, borderWidth: 1, borderColor: C.yellow + '60', borderRadius: 10, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }}
                >
                  <DollarSign size={14} color={C.yellow} />
                  <Text style={{ color: C.yellow, fontSize: 12, flex: 1, fontWeight: '600' as const }}>
                    Billing not set up. Tap to add a billing contact — required before posting paid shifts.
                  </Text>
                </TouchableOpacity>
              ) : null}
              {postingBlocked ? (
                <View style={{ marginTop: 10, backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '60', borderRadius: 10, padding: 10 }}>
                  <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' as const }}>
                    Company is {companyStatus}. You cannot post shifts — contact support.
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })() : null}

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
