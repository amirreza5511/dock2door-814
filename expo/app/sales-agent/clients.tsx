import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, Plus, Building2, UserRound } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type OnboardStatus = 'Signed up' | 'Setting up' | 'Active';

interface ClientRow {
  id: string; name: string; email: string; city: string; vertical: string;
  source: string; onboardStatus: OnboardStatus; earned: number; createdAt: string;
}

const STATUS_TINT: Record<OnboardStatus, string> = {
  'Signed up': C.blue, 'Setting up': C.yellow, Active: C.green,
};

const VERTICAL_LABEL: Record<string, string> = {
  warehouse: 'Warehouse', drayage: 'Drayage company', freight_forwarder: 'Freight forwarder',
  employer: 'Employer', trucking: 'Trucking / carrier', shipper: 'Shipper', customer: 'Customer',
  service: 'Service provider', worker: 'Worker', driver: 'Driver', owner_operator: 'Owner-operator',
};

const PEOPLE = new Set(['worker', 'driver', 'owner_operator']);

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function SalesAgentClients() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const clientsQuery = trpc.sales.clients.useQuery();
  const [filter, setFilter] = useState<OnboardStatus | 'All'>('All');

  const clients = useMemo(() => (clientsQuery.data as ClientRow[] | undefined) ?? [], [clientsQuery.data]);
  const filtered = filter === 'All' ? clients : clients.filter((c) => c.onboardStatus === filter);
  const totalEarned = useMemo(() => clients.reduce((a, c) => a + Number(c.earned || 0), 0), [clients]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>My clients</Text>
        <TouchableOpacity onPress={() => router.push('/sales-agent/onboard' as never)} style={[styles.iconBtn, styles.addBtn]}><Plus size={20} color={C.white} /></TouchableOpacity>
      </View>

      {clientsQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading clients" /></View>
      ) : clients.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No clients yet</Text>
          <Text style={styles.emptyMsg}>When a business signs up with your invite, they land here — with their onboarding status and the commission they earn you.</Text>
          <Button label="Onboard your first client" onPress={() => router.push('/sales-agent/onboard' as never)} icon={<Plus size={16} color={C.white} />} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{clients.length}</Text>
              <Text style={styles.summaryLabel}>Clients onboarded</Text>
            </Card>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{money(totalEarned)}</Text>
              <Text style={styles.summaryLabel}>Earned from clients</Text>
            </Card>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
            {(['All', 'Signed up', 'Setting up', 'Active'] as const).map((s) => (
              <TouchableOpacity key={s} onPress={() => setFilter(s)} style={[styles.chip, filter === s && styles.chipActive]}>
                <Text style={[styles.chipText, filter === s && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
            {filtered.map((c) => {
              const isPerson = PEOPLE.has(c.vertical);
              return (
                <TouchableOpacity key={c.id} activeOpacity={0.85} onPress={() => router.push(`/sales-agent/clients/${c.id}` as never)}>
                  <Card style={styles.clientCard}>
                    <View style={styles.clientIcon}>
                      {isPerson ? <UserRound size={20} color={C.accent} /> : <Building2 size={20} color={C.accent} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clientName} numberOfLines={1}>{c.name}</Text>
                      <Text style={styles.clientMeta}>{VERTICAL_LABEL[c.vertical] ?? c.vertical}{c.city ? ` · ${c.city}` : ''}</Text>
                    </View>
                    <View style={styles.clientRight}>
                      <Text style={styles.clientEarned}>{money(c.earned)}</Text>
                      <View style={[styles.statusPill, { backgroundColor: STATUS_TINT[c.onboardStatus] + '22' }]}>
                        <Text style={[styles.statusText, { color: STATUS_TINT[c.onboardStatus] }]}>{c.onboardStatus}</Text>
                      </View>
                    </View>
                    <ChevronRight size={18} color={C.textMuted} />
                  </Card>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  addBtn: { backgroundColor: C.accent, borderColor: C.accent },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  emptyMsg: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, marginTop: 8, lineHeight: 19 },
  summaryRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  summaryCard: { flex: 1, padding: 14, gap: 4 },
  summaryValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  summaryLabel: { fontSize: 12, color: C.textSecondary },
  filterBar: { maxHeight: 60, flexGrow: 0 },
  filterContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.white },
  list: { paddingHorizontal: 16, gap: 10 },
  clientCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  clientIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  clientName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  clientMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  clientRight: { alignItems: 'flex-end', gap: 5 },
  clientEarned: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  statusPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: '700' as const },
});
