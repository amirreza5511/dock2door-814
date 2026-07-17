import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, Building2, CalendarSearch, Receipt, ArrowRight, Briefcase, Info } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { useAuthStore } from '@/store/auth';
import { trpc } from '@/lib/trpc';

interface AgencyWorkerRow { id: string; worker_user_id: string | null; status: string; }
interface AgencyClientRow { id: string; status: string; }
interface AssignmentRow {
  assignment_id: string; shift_title: string; shift_date: string; start_time: string;
  employer_name: string | null; worker_name: string; status: string;
}
interface PayableRow {
  payable_id: string; gross_pay: number; agency_fee: number; net_to_agency: number; status: string;
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AgencyDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const workersQuery = trpc.agency.workers.useQuery();
  const clientsQuery = trpc.agency.clients.useQuery();
  const assignmentsQuery = trpc.agency.assignments.useQuery();
  const payablesQuery = trpc.agency.payables.useQuery();

  const workers = useMemo(() => (workersQuery.data as AgencyWorkerRow[] | undefined) ?? [], [workersQuery.data]);
  const clients = useMemo(() => (clientsQuery.data as AgencyClientRow[] | undefined) ?? [], [clientsQuery.data]);
  const assignments = useMemo(() => (assignmentsQuery.data as AssignmentRow[] | undefined) ?? [], [assignmentsQuery.data]);
  const payables = useMemo(() => (payablesQuery.data as PayableRow[] | undefined) ?? [], [payablesQuery.data]);

  const activeWorkers = workers.filter((w) => w.status === 'Active').length;
  const activeClients = clients.filter((c) => c.status === 'Active').length;
  const activePlacements = assignments.filter((a) => a.status === 'Scheduled' || a.status === 'InProgress').length;
  const owed = payables.filter((p) => p.status === 'Pending' || p.status === 'Approved')
    .reduce((s, p) => s + Number(p.net_to_agency ?? 0), 0);

  const stats = [
    { label: 'Active workers', value: String(activeWorkers), icon: <Users size={16} color={C.purple} />, tint: C.purple },
    { label: 'Clients', value: String(activeClients), icon: <Building2 size={16} color={C.blue} />, tint: C.blue },
    { label: 'Placements', value: String(activePlacements), icon: <Briefcase size={16} color={C.accent} />, tint: C.accent },
    { label: 'Owed to you', value: money(owed), icon: <Receipt size={16} color={C.green} />, tint: C.green },
  ];

  const quickActions = [
    { label: 'Claim open shifts', desc: 'Book platform shifts for your workers', icon: <CalendarSearch size={18} color={C.accent} />, route: '/agency/shifts' },
    { label: 'Manage roster', desc: 'Add & manage your own workers', icon: <Users size={18} color={C.purple} />, route: '/agency/workers' },
    { label: 'Your clients', desc: 'Keep your customer book in one place', icon: <Building2 size={18} color={C.blue} />, route: '/agency/clients' },
    { label: 'Billing & payouts', desc: 'What you earn and what you owe us', icon: <Receipt size={18} color={C.green} />, route: '/agency/billing' },
  ];

  const recent = assignments.slice(0, 5);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Employment Agency</Text>
            <Text style={styles.title}>{user?.name ?? 'Welcome'}</Text>
          </View>
          <SupportMenu />
        </View>

        <View style={styles.statsGrid}>
          {stats.map((s) => (
            <Card key={s.label} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: s.tint + '1F' }]}>{s.icon}</View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Card>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        {quickActions.map((a) => (
          <TouchableOpacity key={a.label} onPress={() => router.push(a.route as never)} activeOpacity={0.8}>
            <Card style={styles.actionCard}>
              <View style={styles.actionIcon}>{a.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>{a.label}</Text>
                <Text style={styles.actionDesc}>{a.desc}</Text>
              </View>
              <ArrowRight size={16} color={C.textMuted} />
            </Card>
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Recent placements</Text>
        {recent.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No placements yet</Text>
            <Text style={styles.emptyMsg}>Claim an open shift for one of your workers and it will show up here.</Text>
          </Card>
        ) : (
          recent.map((a) => (
            <Card key={a.assignment_id} style={styles.placementCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.placementTitle}>{a.shift_title}</Text>
                <Text style={styles.placementSub}>{a.worker_name} · {a.employer_name ?? 'Employer'} · {a.shift_date}</Text>
              </View>
              <View style={styles.statusPill}><Text style={styles.statusPillText}>{a.status}</Text></View>
            </Card>
          ))
        )}

        <Card style={styles.infoCard}>
          <View style={styles.infoHead}>
            <Info size={15} color={C.accent} />
            <Text style={styles.infoTitle}>How it works</Text>
          </View>
          <Text style={styles.infoText}>
            Add your own workers and clients, then use Dock2Door for booking, coordination, pricing and invoicing.
            When you claim an open shift for one of your workers (or they apply themselves), the shift pay is routed
            to your agency — you pay your workers. A small agency premium is deducted from each placement as the
            platform fee.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  hello: { fontSize: 12, color: C.accent, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5, marginTop: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { flexBasis: '47%', flexGrow: 1, padding: 14, gap: 6 },
  statIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.4 },
  statLabel: { fontSize: 11, color: C.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginBottom: 10, marginTop: 6 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8 },
  actionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  actionDesc: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  emptyCard: { padding: 18, alignItems: 'center', gap: 6, marginBottom: 12 },
  emptyTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  placementCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 8 },
  placementTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  placementSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.accentDim },
  statusPillText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  infoCard: { padding: 16, marginTop: 14, gap: 8 },
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoTitle: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  infoText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
});
