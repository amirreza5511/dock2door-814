import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Anchor, CalendarDays, Building2, DollarSign } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface RequestRow {
  id: string;
  title: string;
  mode: string;
  container_no: string;
  bl_number: string;
  port_of_entry: string;
  eta: string | null;
  commercial_value: number;
  currency: string;
  status: string;
  quote_amount: number;
  customer_name: string;
  created_at: string;
}

const STATUS_TINT: Record<string, string> = {
  Submitted: C.yellow, Quoted: C.blue, InProgress: C.accent,
  DocsRequired: C.yellow, Cleared: C.green, Rejected: C.red, Cancelled: C.textMuted,
};

export default function BrokerRequests() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<'open' | 'mine'>('open');

  const openQuery = trpc.broker.requests.useQuery({ scope: 'open' }, { refetchInterval: 30000 });
  const mineQuery = trpc.broker.requests.useQuery({ scope: 'mine' });
  const claimMutation = trpc.broker.claim.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.broker.requests.invalidate()]);
    },
  });

  const open = useMemo(() => (openQuery.data as RequestRow[] | undefined) ?? [], [openQuery.data]);
  const mine = useMemo(() => (mineQuery.data as RequestRow[] | undefined) ?? [], [mineQuery.data]);

  const rows = tab === 'open' ? open : mine;
  const isLoading = tab === 'open' ? openQuery.isLoading : mineQuery.isLoading;

  const claim = (r: RequestRow) => {
    Alert.alert('Claim this request?', `You will handle customs clearance for "${r.title}" (${r.customer_name}).`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Claim',
        onPress: async () => {
          try {
            await claimMutation.mutateAsync({ requestId: r.id });
            router.push({ pathname: '/customs-broker/[requestId]', params: { requestId: r.id } });
          } catch (e) {
            Alert.alert('Unable to claim', e instanceof Error ? e.message : 'Try again');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Clearance requests</Text>
        <SupportMenu />
      </View>

      <View style={styles.tabRow}>
        {([
          { key: 'open', label: `Open pool (${open.length})` },
          { key: 'mine', label: `My requests (${mine.length})` },
        ] as const).map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading requests" /></View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{tab === 'open' ? 'No open requests right now' : 'No requests yet'}</Text>
          <Text style={styles.emptyMsg}>
            {tab === 'open'
              ? 'When importers and exporters submit clearance requests, they show up here for you to claim.'
              : 'Requests you claim appear here so you can manage documents, quotes and clearance.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
          {rows.map((r) => {
            const tint = STATUS_TINT[r.status] ?? C.textMuted;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={() => tab === 'mine'
                  ? router.push({ pathname: '/customs-broker/[requestId]', params: { requestId: r.id } })
                  : undefined}
                activeOpacity={tab === 'mine' ? 0.7 : 1}
              >
                <Card style={styles.reqCard}>
                  <View style={styles.reqTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reqTitle}>{r.title}</Text>
                      <View style={styles.metaRow}>
                        <Building2 size={12} color={C.textMuted} />
                        <Text style={styles.metaText}>{r.customer_name}</Text>
                      </View>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: tint + '22' }]}>
                      <Text style={[styles.statusPillText, { color: tint }]}>{r.status}</Text>
                    </View>
                  </View>
                  <View style={styles.metaWrap}>
                    <View style={styles.metaRow}>
                      <Anchor size={12} color={C.textMuted} />
                      <Text style={styles.metaText}>
                        {r.mode}{r.container_no ? ` · ${r.container_no}` : ''}{r.bl_number ? ` · BL ${r.bl_number}` : ''}
                      </Text>
                    </View>
                    {r.port_of_entry || r.eta ? (
                      <View style={styles.metaRow}>
                        <CalendarDays size={12} color={C.textMuted} />
                        <Text style={styles.metaText}>{r.port_of_entry}{r.eta ? ` · ETA ${r.eta}` : ''}</Text>
                      </View>
                    ) : null}
                    {r.commercial_value > 0 ? (
                      <View style={styles.metaRow}>
                        <DollarSign size={12} color={C.green} />
                        <Text style={[styles.metaText, { color: C.green }]}>
                          Value ${Number(r.commercial_value).toLocaleString()} {r.currency}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {tab === 'open' ? (
                    <Button label="Claim & handle clearance" onPress={() => claim(r)} loading={claimMutation.isPending} fullWidth size="sm" />
                  ) : null}
                </Card>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  tabTextActive: { color: C.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  list: { paddingHorizontal: 16 },
  reqCard: { padding: 14, marginBottom: 10, gap: 10 },
  reqTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reqTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  metaWrap: { gap: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { fontSize: 12, color: C.textSecondary },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
});
