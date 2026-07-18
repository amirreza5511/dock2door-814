import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LogOut, Container, Landmark, Store, Receipt, Zap, ShieldCheck, CreditCard, Ruler,
} from 'lucide-react-native';
import Card from '@/components/ui/Card';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

interface InvoiceRow {
  id: string;
  status: string;
  total_amount: number;
  requires_prepayment: boolean;
}

/** Guest hub — pay-as-you-go access to every Dock2Door service. */
export default function GuestHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const invoicesQuery = trpc.guest.invoices.useQuery(undefined, { refetchInterval: 30000 });
  const invoices = useMemo(() => (invoicesQuery.data as InvoiceRow[] | undefined) ?? [], [invoicesQuery.data]);
  const unpaid = invoices.filter((i) => i.status !== 'Paid' && i.status !== 'Void');
  const unpaidTotal = unpaid.reduce((s, i) => s + Number(i.total_amount ?? 0), 0);

  const services = [
    {
      icon: Container, color: C.blue, title: 'Container drayage',
      sub: 'Post import/export container orders — drayage companies quote & deliver',
      onPress: () => router.push('/guest/orders'),
    },
    {
      icon: Landmark, color: C.accent, title: 'Customs clearance',
      sub: 'Send shipment details & documents to a licensed customs broker',
      onPress: () => router.push('/clearance'),
    },
    {
      icon: Store, color: C.green, title: 'Rentals & services',
      sub: 'Rent forklifts & cranes, book mobile repair, insure cargo',
      onPress: () => router.push('/marketplace'),
    },
    {
      icon: Ruler, color: C.purple, title: 'Warehouse space',
      sub: 'Rent square footage — transparent per-sqft pricing, volume & term discounts',
      onPress: () => router.push('/spaces' as never),
    },
    {
      icon: Receipt, color: C.yellow, title: 'My billing',
      sub: unpaid.length > 0 ? `${unpaid.length} invoice${unpaid.length > 1 ? 's' : ''} to prepay — $${unpaidTotal.toFixed(2)}` : 'All invoices paid',
      onPress: () => router.push('/guest/billing'),
    },
  ];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{user?.name ?? 'Guest'}</Text>
          <Text style={styles.subtitle}>Guest access — every service, pay-as-you-go</Text>
        </View>
        <SupportMenu />
        <TouchableOpacity onPress={() => void logout()} style={styles.iconBtn}>
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
        {unpaid.length > 0 ? (
          <TouchableOpacity onPress={() => router.push('/guest/billing')}>
            <Card style={[styles.noticeCard, { borderColor: C.yellow }]}>
              <CreditCard size={16} color={C.yellow} />
              <Text style={styles.noticeText}>
                {unpaid.length} invoice{unpaid.length > 1 ? 's' : ''} waiting for prepayment (${unpaidTotal.toFixed(2)}). Services start once paid.
              </Text>
            </Card>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionTitle}>Services</Text>
        {services.map((s) => (
          <TouchableOpacity key={s.title} onPress={s.onPress}>
            <Card style={styles.serviceCard}>
              <View style={[styles.serviceIcon, { backgroundColor: s.color + '20' }]}>
                <s.icon size={20} color={s.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.serviceTitle}>{s.title}</Text>
                <Text style={styles.serviceSub}>{s.sub}</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>How guest access works</Text>
        <Card style={styles.howCard}>
          {[
            { icon: Zap, text: 'Order any service instantly — no business account or approval wait.' },
            { icon: CreditCard, text: 'Every invoice includes a guest surcharge and must be prepaid before work starts.' },
            { icon: ShieldCheck, text: 'Upgrade to a full business account anytime to get standard pricing and invoicing terms.' },
          ].map((h, i) => (
            <View key={i} style={styles.howRow}>
              <h.icon size={15} color={C.accent} />
              <Text style={styles.howText}>{h.text}</Text>
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
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, marginBottom: 6 },
  noticeText: { flex: 1, fontSize: 12, color: C.text, lineHeight: 17, fontWeight: '600' as const },
  sectionTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginTop: 18, marginBottom: 10 },
  serviceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10 },
  serviceIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  serviceTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  serviceSub: { fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 17 },
  howCard: { padding: 14, gap: 10 },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  howText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 18 },
});
