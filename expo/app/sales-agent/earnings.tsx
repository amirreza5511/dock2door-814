import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Award, Repeat, UserPlus, Gift } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { CommissionKind, CommissionStatus } from '@/constants/types';

interface EntryRow {
  id: string; kind: CommissionKind; vertical: string; amount: number;
  status: CommissionStatus; description: string; created_at: string;
}

const KIND_META: Record<CommissionKind, { label: string; icon: React.ReactNode; tint: string }> = {
  bounty: { label: 'Signing bounty', icon: <Award size={16} color={C.accent} />, tint: C.accent },
  recurring: { label: 'Recurring', icon: <Repeat size={16} color={C.blue} />, tint: C.blue },
  referral: { label: 'Referral fee', icon: <UserPlus size={16} color={C.purple} />, tint: C.purple },
  bonus: { label: 'Milestone bonus', icon: <Gift size={16} color={C.green} />, tint: C.green },
};

const STATUS_TINT: Record<CommissionStatus, string> = {
  Pending: C.yellow, Approved: C.blue, Paid: C.green, Rejected: C.red,
};

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SalesAgentEarnings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const commissionsQuery = trpc.sales.commissions.useQuery();
  const [filter, setFilter] = useState<CommissionStatus | 'All'>('All');

  const entries = useMemo(() => (commissionsQuery.data as EntryRow[] | undefined) ?? [], [commissionsQuery.data]);
  const filtered = filter === 'All' ? entries : entries.filter((e) => e.status === filter);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Commission ledger</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
        {(['All', 'Pending', 'Approved', 'Paid', 'Rejected'] as const).map((s) => (
          <TouchableOpacity key={s} onPress={() => setFilter(s)} style={[styles.chip, filter === s && styles.chipActive]}>
            <Text style={[styles.chipText, filter === s && styles.chipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {commissionsQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading commissions" /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No commissions yet</Text>
          <Text style={styles.emptyMsg}>When an account you onboard signs up with your code, your bounty and recurring commissions appear here.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
          {filtered.map((e) => {
            const meta = KIND_META[e.kind] ?? KIND_META.bounty;
            return (
              <Card key={e.id} style={styles.entryCard}>
                <View style={[styles.entryIcon, { backgroundColor: meta.tint + '1F' }]}>{meta.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>{meta.label}{e.vertical ? ` · ${e.vertical}` : ''}</Text>
                  {e.description ? <Text style={styles.entryDesc} numberOfLines={2}>{e.description}</Text> : null}
                  <Text style={styles.entryDate}>{new Date(e.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={styles.entryRight}>
                  <Text style={styles.entryAmount}>{money(e.amount)}</Text>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_TINT[e.status] + '22' }]}>
                    <Text style={[styles.statusText, { color: STATUS_TINT[e.status] }]}>{e.status}</Text>
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  filterBar: { maxHeight: 56, flexGrow: 0 },
  filterContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.white },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  emptyMsg: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, marginTop: 8, lineHeight: 19 },
  list: { padding: 16, gap: 10 },
  entryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  entryIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, textTransform: 'capitalize' as const },
  entryDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  entryDate: { fontSize: 11, color: C.textMuted, marginTop: 3 },
  entryRight: { alignItems: 'flex-end', gap: 6 },
  entryAmount: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  statusDot: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: '700' as const },
});
