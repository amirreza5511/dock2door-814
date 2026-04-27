import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, ShieldCheck, LogIn, LogOut, MapPin, FileSignature, AlertTriangle, History } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { can, ROLE_LABEL, type CompanyRole } from '@/lib/permissions';

interface YardEvent { id: string; appointment_id: string; kind: string; notes?: string | null; created_at: string }
interface YardMove { id: string; from_location?: string | null; to_location?: string | null; status?: string; created_at: string }

export default function DockGateStation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;
  const allowed = can(role, 'dock.manage') || can(role, 'dock.view');

  const events = trpc.yard.listEvents.useQuery();
  const moves = trpc.yard.listMoves.useQuery();
  const recordEvent = trpc.yard.recordEvent.useMutation({
    onSuccess: async () => { await utils.yard.listEvents.invalidate(); },
  });

  const [appointmentId, setAppointmentId] = useState('');
  const [notes, setNotes] = useState('');

  const eventList = useMemo<YardEvent[]>(() => (events.data ?? []) as YardEvent[], [events.data]);
  const moveList = useMemo<YardMove[]>(() => (moves.data ?? []) as YardMove[], [moves.data]);

  if (!allowed) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 30 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.headerSimple, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
          <Text style={styles.title}>Dock / Gate Station</Text>
        </View>
        <View style={{ padding: 24 }}>
          <EmptyState icon={AlertTriangle} title="Not allowed" description={`Your role (${role ? ROLE_LABEL[role] : 'none'}) lacks dock.manage.`} />
        </View>
      </View>
    );
  }

  const fire = async (kind: string) => {
    if (!appointmentId.trim()) { Alert.alert('Appointment required', 'Enter the dock appointment id first.'); return; }
    try {
      await recordEvent.mutateAsync({ appointmentId: appointmentId.trim(), kind, notes: notes.trim() || undefined });
      Alert.alert('Event logged', `${kind} recorded by ${user?.name ?? user?.email}.`);
      setNotes('');
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dock / Gate Station</Text>
          <Text style={styles.subtitle}>Operator: {user?.name ?? user?.email} · {role ? ROLE_LABEL[role] : ''}</Text>
        </View>
        <View style={[styles.iconBubble, { backgroundColor: C.red + '20' }]}>
          <ShieldCheck size={20} color={C.red} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={events.isFetching || moves.isFetching} onRefresh={() => { void events.refetch(); void moves.refetch(); }} tintColor={C.accent} />}
      >
        <Text style={styles.sectionTitle}>Live event recorder</Text>
        <View style={styles.card}>
          <Input label="Appointment ID" value={appointmentId} onChangeText={setAppointmentId} placeholder="appt_…" />
          <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="Seal #, exception, etc." multiline numberOfLines={2} />
          <View style={styles.btnGrid}>
            <Button label="Check-in" size="sm" variant="secondary" onPress={() => void fire('check_in')} icon={<LogIn size={13} color={C.text} />} />
            <Button label="At gate" size="sm" variant="secondary" onPress={() => void fire('at_gate')} icon={<MapPin size={13} color={C.text} />} />
            <Button label="At door" size="sm" variant="secondary" onPress={() => void fire('at_door')} />
            <Button label="Loading" size="sm" variant="secondary" onPress={() => void fire('loading')} />
            <Button label="Unloading" size="sm" variant="secondary" onPress={() => void fire('unloading')} />
            <Button label="Seal check" size="sm" variant="secondary" onPress={() => void fire('seal_check')} icon={<FileSignature size={13} color={C.text} />} />
            <Button label="Hold" size="sm" variant="secondary" onPress={() => void fire('hold')} />
            <Button label="Released" size="sm" variant="secondary" onPress={() => void fire('released')} />
            <Button label="No show" size="sm" variant="secondary" onPress={() => void fire('no_show')} />
            <Button label="Check-out" size="sm" onPress={() => void fire('check_out')} icon={<LogOut size={13} color={C.white} />} />
          </View>
        </View>

        <Text style={styles.sectionTitle}><History size={11} color={C.textSecondary} /> Recent events</Text>
        {eventList.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No events" />
        ) : eventList.slice(0, 25).map((e) => (
          <View key={e.id} style={styles.row}>
            <ShieldCheck size={14} color={C.red} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{e.kind}</Text>
              <Text style={styles.rowMeta}>{e.notes || '—'} · {new Date(e.created_at).toLocaleString()}</Text>
            </View>
            <StatusBadge status={e.kind} size="sm" />
          </View>
        ))}

        <Text style={styles.sectionTitle}>Yard moves</Text>
        {moveList.length === 0 ? (
          <EmptyState icon={MapPin} title="No yard moves" />
        ) : moveList.slice(0, 20).map((m) => (
          <View key={m.id} style={styles.row}>
            <MapPin size={14} color={C.purple} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{(m.from_location ?? '—')} → {(m.to_location ?? '—')}</Text>
              <Text style={styles.rowMeta}>{new Date(m.created_at).toLocaleString()}</Text>
            </View>
            <StatusBadge status={m.status ?? 'open'} size="sm" />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerSimple: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBubble: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  body: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  btnGrid: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
});
