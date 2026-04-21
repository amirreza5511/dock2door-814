import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, Platform, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Award, CheckCircle, XCircle, FileText, Filter } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import EmptyState from '@/components/ui/EmptyState';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { getSignedUrl } from '@/lib/storage-files';

type CertStatus = 'Pending' | 'Approved' | 'Rejected' | 'Expired';

interface CertRow {
  id: string;
  worker_user_id: string;
  type: string;
  expiry_date: string | null;
  file_path: string | null;
  status: CertStatus;
  notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

interface WorkerLookup {
  id: string;
  name: string | null;
  email: string | null;
}

async function fetchCerts(): Promise<CertRow[]> {
  const { data, error } = await supabase
    .from('worker_certifications')
    .select('id,worker_user_id,type,expiry_date,file_path,status,notes,reviewed_at,reviewed_by,created_at')
    .order('created_at', { ascending: false })
    .returns<CertRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchWorkers(ids: string[]): Promise<Record<string, WorkerLookup>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email')
    .in('id', ids)
    .returns<WorkerLookup[]>();
  if (error) throw new Error(error.message);
  const map: Record<string, WorkerLookup> = {};
  (data ?? []).forEach((w) => { map[w.id] = w; });
  return map;
}

const FILTERS: (CertStatus | 'All')[] = ['All', 'Pending', 'Approved', 'Rejected', 'Expired'];

export default function AdminCertifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<CertStatus | 'All'>('Pending');
  const [selected, setSelected] = useState<CertRow | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [approveNote, setApproveNote] = useState<string>('');

  const certsQuery = useQuery({
    queryKey: ['admin-certs'],
    queryFn: fetchCerts,
    staleTime: 10_000,
  });

  const workerIds = useMemo(() => {
    const set = new Set<string>();
    (certsQuery.data ?? []).forEach((c) => set.add(c.worker_user_id));
    return Array.from(set);
  }, [certsQuery.data]);

  const workersQuery = useQuery({
    queryKey: ['admin-cert-workers', workerIds.sort().join(',')],
    queryFn: () => fetchWorkers(workerIds),
    enabled: workerIds.length > 0,
    staleTime: 60_000,
  });

  const workers = workersQuery.data ?? {};

  const filtered = useMemo(() => {
    const list = certsQuery.data ?? [];
    if (filter === 'All') return list;
    return list.filter((c) => c.status === filter);
  }, [certsQuery.data, filter]);

  const pendingCount = useMemo(() => (certsQuery.data ?? []).filter((c) => c.status === 'Pending').length, [certsQuery.data]);

  const approveMutation = useMutation({
    mutationFn: async (args: { id: string; reason: string | null }) => {
      const { error } = await supabase.rpc('admin_approve_certification', {
        p_cert_id: args.id,
        p_reason: args.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-certs'] });
      setSelected(null);
      setApproveNote('');
      Alert.alert('Certification approved');
    },
    onError: (err: unknown) => Alert.alert('Approve failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (args: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('admin_reject_certification', {
        p_cert_id: args.id,
        p_reason: args.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-certs'] });
      setSelected(null);
      setRejectReason('');
      Alert.alert('Certification rejected');
    },
    onError: (err: unknown) => Alert.alert('Reject failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  const openFile = async (path: string | null) => {
    if (!path) { Alert.alert('No file attached'); return; }
    try {
      const url = await getSignedUrl('certifications', path, 60);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        const { Linking } = await import('react-native');
        await Linking.openURL(url);
      }
    } catch (err) {
      Alert.alert('Unable to open file', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const workerLabel = (uid: string) => {
    const w = workers[uid];
    return w ? (w.name || w.email || uid) : uid.slice(0, 8);
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Certifications</Text>
          <Text style={styles.sub}>{pendingCount} pending · {(certsQuery.data ?? []).length} total</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
        <View style={styles.filterLeading}>
          <Filter size={13} color={C.textMuted} />
        </View>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]} testID={`filter-${f}`}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {certsQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading certifications" />
        ) : certsQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load certifications" onRetry={() => void certsQuery.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Award} title={`No ${filter.toLowerCase()} certifications`} description="Worker-submitted certifications will appear here for review." />
        ) : filtered.map((c) => {
          const statusColor = c.status === 'Approved' ? C.green : c.status === 'Rejected' ? C.red : c.status === 'Expired' ? C.textMuted : C.yellow;
          const dim = c.status === 'Approved' ? C.greenDim : c.status === 'Rejected' ? C.redDim : C.yellowDim;
          return (
            <TouchableOpacity key={c.id} onPress={() => setSelected(c)} activeOpacity={0.85} testID={`cert-${c.id}`}>
              <Card style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.iconWrap, { backgroundColor: dim }]}>
                    <Award size={18} color={statusColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{c.type} · {workerLabel(c.worker_user_id)}</Text>
                    <Text style={styles.cardMeta}>Expires {c.expiry_date ?? '—'} · Submitted {new Date(c.created_at).toLocaleDateString()}</Text>
                  </View>
                  <StatusBadge status={c.status} />
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          {selected ? (
            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>{selected.type} Certificate</Text>
                <StatusBadge status={selected.status} size="md" />
              </View>
              <Text style={styles.modalSub}>Worker: {workerLabel(selected.worker_user_id)}</Text>
              <Text style={styles.modalSub}>Expiry: {selected.expiry_date ?? '—'}</Text>
              <Text style={styles.modalSub}>Submitted: {new Date(selected.created_at).toLocaleString()}</Text>
              {selected.reviewed_at ? (
                <Text style={styles.modalSub}>Reviewed: {new Date(selected.reviewed_at).toLocaleString()}</Text>
              ) : null}
              {selected.notes ? (
                <Text style={styles.reasonText}>Notes: {selected.notes}</Text>
              ) : null}

              <TouchableOpacity onPress={() => void openFile(selected.file_path)} style={styles.fileBtn} disabled={!selected.file_path} testID="open-cert-file">
                <FileText size={15} color={selected.file_path ? C.accent : C.textMuted} />
                <Text style={[styles.fileBtnText, !selected.file_path && { color: C.textMuted }]}>
                  {selected.file_path ? (selected.file_path.split('/').pop() ?? 'Open certificate') : 'No file attached'}
                </Text>
              </TouchableOpacity>

              {selected.status === 'Pending' ? (
                <View style={styles.actionSection}>
                  <Text style={styles.sectionLabel}>Approve with optional note</Text>
                  <TextInput
                    value={approveNote}
                    onChangeText={setApproveNote}
                    placeholder="Optional approval note"
                    placeholderTextColor={C.textMuted}
                    style={styles.textInput}
                    testID="approve-note"
                  />
                  <Button
                    label={approveMutation.isPending ? 'Approving…' : 'Approve Certification'}
                    onPress={() => approveMutation.mutate({ id: selected.id, reason: approveNote.trim() || null })}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                    fullWidth
                    icon={<CheckCircle size={15} color={C.white} />}
                  />

                  <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Reject (reason required)</Text>
                  <TextInput
                    value={rejectReason}
                    onChangeText={setRejectReason}
                    placeholder="Reason for rejection"
                    placeholderTextColor={C.textMuted}
                    multiline
                    numberOfLines={3}
                    style={[styles.textInput, styles.textArea]}
                    testID="reject-reason"
                  />
                  <Button
                    label={rejectMutation.isPending ? 'Rejecting…' : 'Reject Certification'}
                    onPress={() => {
                      const reason = rejectReason.trim();
                      if (!reason) { Alert.alert('Reason required', 'Please provide a rejection reason'); return; }
                      rejectMutation.mutate({ id: selected.id, reason });
                    }}
                    variant="danger"
                    fullWidth
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                    icon={<XCircle size={15} color={C.red} />}
                  />
                </View>
              ) : null}

              <Button label="Close" onPress={() => setSelected(null)} variant="ghost" fullWidth />
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  filterBar: { maxHeight: 52, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, alignItems: 'center' },
  filterLeading: { width: 22, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 14, gap: 10 },
  card: { padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 10 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 8 },
  modalSub: { fontSize: 13, color: C.textSecondary },
  reasonText: { fontSize: 13, color: C.text, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, marginTop: 6 },
  fileBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.accentDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, borderWidth: 1, borderColor: C.accent + '40' },
  fileBtnText: { fontSize: 13, color: C.accent, fontWeight: '700' as const, flex: 1 },
  actionSection: { gap: 10, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border },
  sectionLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  textInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
});
