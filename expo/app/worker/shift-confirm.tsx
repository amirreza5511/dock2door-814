import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, XCircle, MapPin, Clock, DollarSign, Building2 } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';

interface AssignmentDetail {
  id: string;
  shift_id: string;
  confirmed_rate: number;
  status: string;
  worker_confirmed: boolean | null;
  shift_posts: {
    title: string;
    date: string;
    start_time: string;
    end_time: string;
    location_address: string;
    location_city: string;
    employer_company_id: string;
  };
}

function fmtTime(t: string): string {
  try {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  } catch { return t; }
}

function formatDate(d: string): string {
  try {
    const dt = new Date(d + 'T00:00:00');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
  } catch { return d; }
}

export default function ShiftConfirmScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();

  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');

  const assignmentQ = useQuery({
    queryKey: ['shift-confirm', assignmentId],
    queryFn: async (): Promise<AssignmentDetail | null> => {
      if (!assignmentId) return null;
      const { data, error } = await supabase
        .from('shift_assignments')
        .select('id,shift_id,confirmed_rate,status,worker_confirmed,shift_posts(title,date,start_time,end_time,location_address,location_city,employer_company_id)')
        .eq('id', assignmentId)
        .single();
      if (error) throw new Error(error.message);

      // Fetch company name
      const sp = (data as any)?.shift_posts;
      if (sp?.employer_company_id) {
        const { data: co } = await supabase
          .from('companies')
          .select('name')
          .eq('id', sp.employer_company_id)
          .single();
        if (co) setCompanyName(co.name);
      }

      return data as AssignmentDetail | null;
    },
    enabled: Boolean(assignmentId),
    staleTime: 30_000,
  });

  const assignment = assignmentQ.data;
  const shift = (assignment as any)?.shift_posts ?? null;

  const handleConfirm = async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('shift_assignments')
        .update({
          worker_confirmed: true,
          worker_confirmed_at: new Date().toISOString(),
        })
        .eq('id', assignment.id);
      if (error) throw new Error(error.message);
      Alert.alert('Confirmed!', "See you there. We'll send a reminder before your shift.", [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to confirm');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!assignment) return;
    if (!cancelReason.trim()) {
      Alert.alert('Required', 'Please provide a reason for cancellation.');
      return;
    }
    setCancelling(true);
    try {
      const { error } = await supabase
        .from('shift_assignments')
        .update({
          worker_confirmed: false,
          cancellation_reason: cancelReason.trim(),
        })
        .eq('id', assignment.id);
      if (error) throw new Error(error.message);
      Alert.alert('Shift cancelled', 'The employer has been notified.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setCancelling(false);
    }
  };

  if (assignmentQ.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!assignment || !shift) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorText}>Shift not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backFallback}>
          <Text style={styles.backFallbackText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Already confirmed / cancelled
  if (assignment.worker_confirmed === true) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <CheckCircle size={56} color={C.green} />
        <Text style={[styles.heroTitle, { marginTop: 16 }]}>Already confirmed!</Text>
        <Text style={styles.heroSub}>You've confirmed attendance for this shift.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backFallback}>
          <Text style={styles.backFallbackText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Attendance</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Shift Info Card */}
        <View style={styles.shiftCard}>
          <Text style={styles.shiftTitle}>{shift.title}</Text>

          {companyName ? (
            <View style={styles.detailRow}>
              <Building2 size={16} color={C.accent} />
              <Text style={styles.detailText}>{companyName}</Text>
            </View>
          ) : null}

          <View style={styles.detailRow}>
            <Clock size={16} color={C.blue} />
            <Text style={styles.detailText}>
              {formatDate(shift.date)} · {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <MapPin size={16} color={C.textMuted} />
            <Text style={styles.detailText}>{shift.location_address}, {shift.location_city}</Text>
          </View>

          <View style={styles.detailRow}>
            <DollarSign size={16} color={C.green} />
            <Text style={styles.detailText}>${assignment.confirmed_rate}/hr</Text>
          </View>
        </View>

        <Text style={styles.promptText}>Are you able to attend this shift?</Text>

        {/* Confirm Button */}
        {!showCancelForm && (
          <TouchableOpacity
            onPress={handleConfirm}
            style={styles.confirmBtn}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator size="small" color={C.white} />
            ) : (
              <>
                <CheckCircle size={22} color={C.white} />
                <Text style={styles.confirmBtnText}>Yes, I'll be there ✓</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Cancel Flow */}
        {!showCancelForm ? (
          <TouchableOpacity
            onPress={() => setShowCancelForm(true)}
            style={styles.cancelBtn}
            activeOpacity={0.85}
          >
            <XCircle size={22} color={C.white} />
            <Text style={styles.cancelBtnText}>I can't make it</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.cancelForm}>
            <Text style={styles.cancelFormTitle}>Why can't you make it?</Text>
            <Text style={styles.cancelFormSub}>
              This will notify the employer so they can find a replacement.
            </Text>
            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="e.g. Family emergency, illness, transportation issue…"
              placeholderTextColor={C.textMuted}
              style={styles.cancelReasonInput}
              multiline
              numberOfLines={3}
              autoFocus
            />
            <TouchableOpacity
              onPress={handleCancel}
              style={styles.cancelSubmitBtn}
              disabled={cancelling}
              activeOpacity={0.85}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Text style={styles.cancelSubmitText}>Submit Cancellation</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowCancelForm(false); setCancelReason(''); }}
              style={styles.goBackLink}
            >
              <Text style={styles.goBackLinkText}>← Go back</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.footer}>
          Please confirm at least 12 hours before your shift. Late cancellations affect your reliability score.
        </Text>
      </ScrollView>
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
  backBtn: { marginBottom: 8 },
  backBtnText: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  scroll: { padding: 20, gap: 16 },
  shiftCard: {
    backgroundColor: C.bgSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    gap: 12,
  },
  shiftTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailText: { fontSize: 14, color: C.textSecondary, flex: 1, lineHeight: 20 },
  promptText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: C.text,
    textAlign: 'center' as const,
    marginVertical: 8,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: C.green,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  confirmBtnText: { fontSize: 18, fontWeight: '800' as const, color: C.white },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: C.red,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  cancelBtnText: { fontSize: 18, fontWeight: '800' as const, color: C.white },
  cancelForm: {
    backgroundColor: C.bgSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.redDim,
    padding: 20,
    gap: 12,
  },
  cancelFormTitle: { fontSize: 16, fontWeight: '700' as const, color: C.red },
  cancelFormSub: { fontSize: 13, color: C.textSecondary },
  cancelReasonInput: {
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    color: C.text,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: 'top' as const,
  },
  cancelSubmitBtn: {
    backgroundColor: C.red,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center' as const,
  },
  cancelSubmitText: { fontSize: 15, fontWeight: '700' as const, color: C.white },
  goBackLink: { alignItems: 'center' as const, paddingVertical: 4 },
  goBackLinkText: { fontSize: 13, color: C.textMuted },
  footer: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center' as const,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  errorText: { fontSize: 15, color: C.textSecondary },
  backFallback: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.card, borderRadius: 10 },
  backFallbackText: { color: C.accent, fontWeight: '600' as const },
  heroTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  heroSub: { fontSize: 14, color: C.textSecondary, textAlign: 'center' as const, marginTop: 8 },
});
