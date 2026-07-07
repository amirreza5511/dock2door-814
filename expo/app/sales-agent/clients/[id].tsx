import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Building2, UserRound, Mail, MapPin, CheckCircle2, Circle, Award, Repeat, UserPlus, Gift } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { CommissionKind, CommissionStatus } from '@/constants/types';

type OnboardStatus = 'Signed up' | 'Setting up' | 'Active';

interface CommissionRow {
  id: string; kind: CommissionKind; amount: number; status: CommissionStatus; description: string; created_at: string;
}

interface ClientDetail {
  id: string; name: string; email: string; city: string; address: string; vertical: string;
  source: string; onboardStatus: OnboardStatus; companyStatus: string; hasCompany: boolean;
  createdAt: string; commissions: CommissionRow[];
}

const STATUS_TINT: Record<OnboardStatus, string> = { 'Signed up': C.blue, 'Setting up': C.yellow, Active: C.green };
const PEOPLE = new Set(['worker', 'driver', 'owner_operator']);
const VERTICAL_LABEL: Record<string, string> = {
  warehouse: 'Warehouse', drayage: 'Drayage company', freight_forwarder: 'Freight forwarder',
  employer: 'Employer', trucking: 'Trucking / carrier', shipper: 'Shipper', customer: 'Customer',
  service: 'Service provider', worker: 'Worker', driver: 'Driver', owner_operator: 'Owner-operator',
};
const KIND_ICON: Record<CommissionKind, React.ReactNode> = {
  bounty: <Award size={15} color={C.accent} />, recurring: <Repeat size={15} color={C.blue} />,
  referral: <UserPlus size={15} color={C.purple} />, bonus: <Gift size={15} color={C.green} />,
};
const COMM_STATUS_TINT: Record<CommissionStatus, string> = { Pending: C.yellow, Approved: C.blue, Paid: C.green, Rejected: C.red };

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function ClientDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const detailQuery = trpc.sales.clientDetail.useQuery({ id: id as string }, { enabled: Boolean(id) });
  const client = detailQuery.data as ClientDetail | null | undefined;

  const totalEarned = useMemo(
    () => (client?.commissions ?? []).reduce((a, c) => a + Number(c.amount || 0), 0),
    [client?.commissions],
  );

  const steps = useMemo(() => {
    if (!client) return [] as { label: string; done: boolean }[];
    const isPerson = PEOPLE.has(client.vertical);
    return [
      { label: 'Signed up with your invite', done: true },
      isPerson
        ? { label: 'Profile completed', done: client.onboardStatus === 'Active' }
        : { label: 'Company profile set up', done: client.hasCompany },
      isPerson
        ? { label: 'Active on the platform', done: client.onboardStatus === 'Active' }
        : { label: 'Approved & active', done: client.companyStatus === 'Approved' },
      { label: 'First revenue recorded', done: totalEarned > 0 && client.commissions.some((c) => c.kind === 'recurring') },
    ];
  }, [client, totalEarned]);

  if (detailQuery.isLoading) {
    return <View style={[styles.root, styles.center]}><ScreenFeedback state="loading" title="Loading client" /></View>;
  }
  if (!client) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.emptyTitle}>Client not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}><Text style={styles.backLinkText}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  const isPerson = PEOPLE.has(client.vertical);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#12253D', C.bg]} style={styles.heroBg} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Client</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.clientHead}>
          <View style={styles.clientIcon}>
            {isPerson ? <UserRound size={26} color={C.accent} /> : <Building2 size={26} color={C.accent} />}
          </View>
          <Text style={styles.clientName}>{client.name}</Text>
          <Text style={styles.clientVertical}>{VERTICAL_LABEL[client.vertical] ?? client.vertical}</Text>
          <View style={[styles.statusPill, { backgroundColor: STATUS_TINT[client.onboardStatus] + '22' }]}>
            <Text style={[styles.statusText, { color: STATUS_TINT[client.onboardStatus] }]}>{client.onboardStatus}</Text>
          </View>
        </View>

        <View style={styles.metricRow}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{money(totalEarned)}</Text>
            <Text style={styles.metricLabel}>Earned from client</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{doneCount}/{steps.length}</Text>
            <Text style={styles.metricLabel}>Onboarding steps</Text>
          </Card>
        </View>

        <Text style={styles.sectionLabel}>Onboarding progress</Text>
        <Card style={styles.stepsCard}>
          {steps.map((s, i) => (
            <View key={i} style={[styles.stepRow, i < steps.length - 1 && styles.stepDivider]}>
              {s.done ? <CheckCircle2 size={20} color={C.green} /> : <Circle size={20} color={C.textMuted} />}
              <Text style={[styles.stepText, s.done && styles.stepTextDone]}>{s.label}</Text>
            </View>
          ))}
        </Card>

        {(client.email || client.city || client.address) ? (
          <>
            <Text style={styles.sectionLabel}>Contact</Text>
            <Card style={styles.contactCard}>
              {client.email ? (
                <TouchableOpacity style={styles.contactRow} onPress={() => void Linking.openURL(`mailto:${client.email}`)} disabled={Platform.OS === 'web'}>
                  <Mail size={16} color={C.blue} />
                  <Text style={styles.contactText}>{client.email}</Text>
                </TouchableOpacity>
              ) : null}
              {(client.city || client.address) ? (
                <View style={styles.contactRow}>
                  <MapPin size={16} color={C.accent} />
                  <Text style={styles.contactText}>{[client.address, client.city].filter(Boolean).join(', ')}</Text>
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Commission history</Text>
        {client.commissions.length === 0 ? (
          <Card style={styles.emptyCommCard}>
            <Text style={styles.emptyCommText}>No commission recorded yet. You’ll earn your bounty once they finish onboarding, plus recurring commission as they generate revenue.</Text>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {client.commissions.map((c) => (
              <Card key={c.id} style={styles.commCard}>
                <View style={styles.commIcon}>{KIND_ICON[c.kind] ?? KIND_ICON.bounty}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.commDesc} numberOfLines={2}>{c.description || c.kind}</Text>
                  <Text style={styles.commDate}>{new Date(c.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={styles.commRight}>
                  <Text style={styles.commAmount}>{money(c.amount)}</Text>
                  <View style={[styles.commStatusPill, { backgroundColor: COMM_STATUS_TINT[c.status] + '22' }]}>
                    <Text style={[styles.commStatusText, { color: COMM_STATUS_TINT[c.status] }]}>{c.status}</Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  scroll: { paddingHorizontal: 16, gap: 12 },
  clientHead: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  clientIcon: { width: 68, height: 68, borderRadius: 20, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  clientName: { fontSize: 22, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  clientVertical: { fontSize: 13, color: C.textSecondary },
  statusPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, marginTop: 4 },
  statusText: { fontSize: 12, fontWeight: '700' as const },
  metricRow: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, padding: 14, gap: 4, alignItems: 'center' },
  metricValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  metricLabel: { fontSize: 11, color: C.textSecondary },
  sectionLabel: { fontSize: 12, fontWeight: '800' as const, color: C.accent, letterSpacing: 1, textTransform: 'uppercase' as const, marginTop: 8 },
  stepsCard: { padding: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12 },
  stepDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  stepText: { fontSize: 14, color: C.textSecondary, flex: 1 },
  stepTextDone: { color: C.text, fontWeight: '600' as const },
  contactCard: { padding: 6 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  contactText: { fontSize: 14, color: C.text },
  emptyCommCard: { padding: 16 },
  emptyCommText: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  commCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  commIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  commDesc: { fontSize: 13, fontWeight: '600' as const, color: C.text, textTransform: 'capitalize' as const },
  commDate: { fontSize: 11, color: C.textMuted, marginTop: 3 },
  commRight: { alignItems: 'flex-end', gap: 5 },
  commAmount: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  commStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  commStatusText: { fontSize: 10, fontWeight: '700' as const },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  backLink: { marginTop: 12 },
  backLinkText: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
});
