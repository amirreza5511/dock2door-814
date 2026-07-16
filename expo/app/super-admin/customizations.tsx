import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  RefreshControl, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, SlidersHorizontal, Check, X, Clock, Building2, EyeOff, ListPlus,
} from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface ReqRow {
  id: string;
  companyName: string;
  companyType: string;
  requesterName: string;
  title: string;
  details: string;
  payload: { hiddenModules?: string[]; customFields?: { label?: string }[] };
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  createdAt?: string;
}

const STATUS_META: Record<string, { color: string; label: string; Icon: typeof Check }> = {
  pending: { color: C.yellow, label: 'Pending', Icon: Clock },
  approved: { color: C.green, label: 'Approved', Icon: Check },
  rejected: { color: C.red, label: 'Rejected', Icon: X },
};

export default function AdminCustomizationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const requestsQuery = trpc.customization.allRequests.useQuery();
  const decide = trpc.customization.decide.useMutation();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => (requestsQuery.data ?? []) as ReqRow[], [requestsQuery.data]);
  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const shown = filter === 'pending' ? rows.filter((r) => r.status === 'pending') : rows;

  const act = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await decide.mutateAsync({ requestId: id, approve });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.customization.allRequests.invalidate();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <View style={styles.badge}><SlidersHorizontal size={14} color={C.purple} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Customization requests</Text>
            <Text style={styles.headerSub} numberOfLines={1}>Approve changes companies want in their workspace</Text>
          </View>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['pending', 'all'] as const).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'pending' ? `Pending (${pendingCount})` : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {requestsQuery.isLoading ? (
        <View style={styles.centered}><ScreenFeedback state="loading" title="Loading requests" /></View>
      ) : requestsQuery.isError ? (
        <View style={styles.centered}><ScreenFeedback state="error" title="Unable to load requests" onRetry={() => void requestsQuery.refetch()} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={requestsQuery.isFetching} onRefresh={() => void requestsQuery.refetch()} tintColor={C.accent} />}
        >
          {shown.length === 0 ? (
            <EmptyState icon={Check} title="Nothing to review" description="Customization requests from companies will appear here for approval." />
          ) : shown.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.pending;
            const hidden = r.payload?.hiddenModules ?? [];
            const fields = r.payload?.customFields ?? [];
            const busy = busyId === r.id;
            return (
              <Card key={r.id} style={styles.reqCard}>
                <View style={styles.reqTop}>
                  <View style={styles.companyРow}>
                    <Building2 size={13} color={C.textSecondary} />
                    <Text style={styles.companyName}>{r.companyName || 'Company'}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + '18', borderColor: meta.color + '55' }]}>
                    <meta.Icon size={11} color={meta.color} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.reqTitle}>{r.title}</Text>
                {r.details ? <Text style={styles.reqDetails}>{r.details}</Text> : null}

                {hidden.length > 0 ? (
                  <View style={styles.payloadRow}>
                    <EyeOff size={13} color={C.textMuted} />
                    <Text style={styles.payloadText}>Hide: {hidden.join(', ')}</Text>
                  </View>
                ) : null}
                {fields.length > 0 ? (
                  <View style={styles.payloadRow}>
                    <ListPlus size={13} color={C.textMuted} />
                    <Text style={styles.payloadText}>Add fields: {fields.map((f) => f.label).join(', ')}</Text>
                  </View>
                ) : null}
                {r.requesterName ? <Text style={styles.reqMeta}>Requested by {r.requesterName}</Text> : null}

                {r.status === 'pending' ? (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: C.green }]}
                      disabled={busy}
                      onPress={() => void act(r.id, true)}
                    >
                      {busy ? <ActivityIndicator size="small" color={C.white} /> : <Check size={15} color={C.white} />}
                      <Text style={styles.actionBtnText}>Approve & apply</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.rejectBtn]}
                      disabled={busy}
                      onPress={() => void act(r.id, false)}
                    >
                      <X size={15} color={C.red} />
                      <Text style={[styles.actionBtnText, { color: C.red }]}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                ) : r.adminNote ? (
                  <Text style={styles.reqMeta}>Note: {r.adminNote}</Text>
                ) : null}
              </Card>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  badge: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.purple + '22', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 12.5, fontWeight: '700' as const, color: C.textMuted },
  filterTextActive: { color: C.accent },
  scroll: { paddingHorizontal: 16, gap: 12 },
  reqCard: { gap: 8 },
  reqTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  companyРow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  companyName: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 10.5, fontWeight: '800' as const },
  reqTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  reqDetails: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  payloadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payloadText: { flex: 1, fontSize: 12, color: C.textMuted },
  reqMeta: { fontSize: 11.5, color: C.textMuted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, paddingVertical: 11 },
  rejectBtn: { flex: 0, paddingHorizontal: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.red + '55' },
  actionBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.white },
});
