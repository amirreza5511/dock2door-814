import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inbox, FileCheck2, Receipt, LogOut, Landmark, MessagesSquare, FileUp, BadgeDollarSign } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

interface RequestRow {
  id: string;
  title: string;
  status: string;
  customer_name: string;
  created_at: string;
}

interface BillingRow {
  id: string;
  net_to_broker: number;
}

const ACTIVE_STATUSES = ['Quoted', 'InProgress', 'DocsRequired'];

export default function BrokerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const openQuery = trpc.broker.requests.useQuery({ scope: 'open' }, { refetchInterval: 30000 });
  const mineQuery = trpc.broker.requests.useQuery({ scope: 'mine' });
  const billingQuery = trpc.broker.billing.useQuery();

  const open = useMemo(() => (openQuery.data as RequestRow[] | undefined) ?? [], [openQuery.data]);
  const mine = useMemo(() => (mineQuery.data as RequestRow[] | undefined) ?? [], [mineQuery.data]);
  const billing = useMemo(() => (billingQuery.data as BillingRow[] | undefined) ?? [], [billingQuery.data]);

  const active = mine.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const cleared = mine.filter((r) => r.status === 'Cleared');
  const earned = billing.reduce((s, b) => s + Number(b.net_to_broker ?? 0), 0);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{user?.name ?? 'Customs Broker'}</Text>
          <Text style={styles.subtitle}>Customs brokerage — clear shipments on Dock2Door</Text>
        </View>
        <SupportMenu />
        <TouchableOpacity onPress={() => void logout()} style={styles.iconBtn}>
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.statsGrid}>
          {[
            { label: 'Open requests', value: open.length, icon: Inbox, color: C.yellow },
            { label: 'In progress', value: active.length, icon: FileCheck2, color: C.blue },
            { label: 'Cleared', value: cleared.length, icon: Landmark, color: C.green },
            { label: 'Net earned', value: `$${earned.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: BadgeDollarSign, color: C.accent },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: s.color + '20' }]}><s.icon size={17} color={s.color} /></View>
              <Text style={styles.statValue}>{String(s.value)}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/customs-broker/requests')}>
            <Inbox size={20} color={C.accent} />
            <Text style={styles.actionLabel}>Open pool</Text>
            <Text style={styles.actionSub}>{open.length} waiting for a broker</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/customs-broker/billing')}>
            <Receipt size={20} color={C.green} />
            <Text style={styles.actionLabel}>Billing</Text>
            <Text style={styles.actionSub}>Fees & payouts</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Active clearances</Text>
        {active.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>No active clearances. Claim a request from the open pool to get started.</Text>
          </Card>
        ) : (
          active.slice(0, 6).map((r) => (
            <TouchableOpacity key={r.id} onPress={() => router.push({ pathname: '/customs-broker/[requestId]', params: { requestId: r.id } })}>
              <Card style={styles.reqCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reqTitle}>{r.title}</Text>
                  <Text style={styles.reqSub}>{r.customer_name}</Text>
                </View>
                <View style={styles.statusPill}><Text style={styles.statusPillText}>{r.status}</Text></View>
              </Card>
            </TouchableOpacity>
          ))
        )}

        <Card style={styles.howCard}>
          <Text style={styles.howTitle}>How it works</Text>
          {[
            { icon: Inbox, text: 'Importers & exporters submit clearance requests with shipment details.' },
            { icon: BadgeDollarSign, text: 'You claim a request and quote your brokerage fee.' },
            { icon: FileUp, text: 'Request documents — the customer uploads them right here.' },
            { icon: MessagesSquare, text: 'Chat with the customer on-platform, then mark the shipment cleared.' },
            { icon: Receipt, text: 'An invoice is issued automatically; Dock2Door keeps a small commission.' },
          ].map((s, i) => (
            <View key={i} style={styles.howRow}>
              <s.icon size={15} color={C.accent} />
              <Text style={styles.howText}>{s.text}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 6 },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: C.textMuted },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 5 },
  actionLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  actionSub: { fontSize: 11, color: C.textMuted },
  emptyCard: { padding: 16, marginBottom: 20 },
  emptyText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  reqCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 8 },
  reqTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  reqSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.accentDim },
  statusPillText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  howCard: { padding: 16, gap: 10, marginTop: 12 },
  howTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 2 },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  howText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 18 },
});
