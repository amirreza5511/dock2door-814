import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import {
  TrendingUp, Users, Wallet, Copy, Share2, ClipboardList,
  ChevronRight, Sparkles, LogOut, CheckCheck,
} from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function SalesAgentHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);

  const agentQuery = trpc.sales.myAgent.useQuery();
  const dashQuery = trpc.sales.dashboard.useQuery();

  const agent = agentQuery.data as { agent_code?: string; plan?: { name?: string } } | null | undefined;
  const dash = dashQuery.data as
    | { pending: number; approved: number; paid: number; lifetime: number; accounts: number; leads: number; openLeads: number }
    | undefined;

  const code = agent?.agent_code ?? '——————';

  const copyCode = useCallback(async () => {
    if (!agent?.agent_code) return;
    await Clipboard.setStringAsync(agent.agent_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [agent?.agent_code]);

  const shareCode = useCallback(async () => {
    if (!agent?.agent_code) return;
    const msg = `Join Dock2Door and use my referral code ${agent.agent_code} at sign-up.`;
    if (Platform.OS === 'web') { await copyCode(); return; }
    try { await Share.share({ message: msg }); } catch {}
  }, [agent?.agent_code, copyCode]);

  if (agentQuery.isLoading) {
    return <View style={[styles.root, styles.center]}><ScreenFeedback state="loading" title="Loading your CRM" /></View>;
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#12253D', C.bg]} style={styles.heroBg} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.brandRow}>
            <View style={styles.brandBadge}><Sparkles size={16} color={C.accent} /></View>
            <View>
              <Text style={styles.hello}>Sales Agent</Text>
              <Text style={styles.name}>{user?.name ?? 'Welcome back'}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => void logout()} style={styles.logoutBtn}>
            <LogOut size={18} color={C.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.lifetimeLabel}>Lifetime commission</Text>
        <Text style={styles.lifetimeValue}>{money(dash?.lifetime ?? 0)}</Text>
        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: C.yellowDim }]}>
            <Text style={[styles.pillLabel, { color: C.yellow }]}>Pending {money(dash?.pending ?? 0)}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: C.blueDim }]}>
            <Text style={[styles.pillLabel, { color: C.blue }]}>Approved {money(dash?.approved ?? 0)}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: C.greenDim }]}>
            <Text style={[styles.pillLabel, { color: C.green }]}>Paid {money(dash?.paid ?? 0)}</Text>
          </View>
        </View>

        <Card elevated style={styles.codeCard}>
          <Text style={styles.codeLabel}>YOUR REFERRAL CODE</Text>
          <Text style={styles.codeValue}>{code}</Text>
          <Text style={styles.codeHint}>Share this code. When a warehouse, driver, employer or company signs up with it, you get credit and the commission is added to your ledger automatically.</Text>
          <View style={styles.codeActions}>
            <TouchableOpacity onPress={() => void copyCode()} style={[styles.codeBtn, styles.codeBtnPrimary]}>
              {copied ? <CheckCheck size={16} color={C.white} /> : <Copy size={16} color={C.white} />}
              <Text style={styles.codeBtnText}>{copied ? 'Copied' : 'Copy code'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void shareCode()} style={styles.codeBtn}>
              <Share2 size={16} color={C.accent} />
              <Text style={[styles.codeBtnText, { color: C.accent }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <View style={styles.statGrid}>
          <StatTile icon={<Users size={18} color={C.blue} />} value={String(dash?.accounts ?? 0)} label="Accounts onboarded" tint={C.blueDim} />
          <StatTile icon={<ClipboardList size={18} color={C.purple} />} value={String(dash?.openLeads ?? 0)} label="Open leads" tint={C.purpleDim} />
        </View>

        <NavRow
          icon={<ClipboardList size={20} color={C.accent} />}
          title="My leads pipeline"
          subtitle={`${dash?.leads ?? 0} leads · track prospects to won`}
          onPress={() => router.push('/sales-agent/leads' as never)}
        />
        <NavRow
          icon={<Wallet size={20} color={C.green} />}
          title="Commission ledger"
          subtitle="Every bounty, referral & recurring payout"
          onPress={() => router.push('/sales-agent/earnings' as never)}
        />
        <NavRow
          icon={<TrendingUp size={20} color={C.blue} />}
          title="My commission plan"
          subtitle={agent?.plan?.name ?? 'Default plan'}
          onPress={() => router.push('/sales-agent/earnings' as never)}
        />
      </ScrollView>
    </View>
  );
}

function StatTile({ icon, value, label, tint }: { icon: React.ReactNode; value: string; label: string; tint: string }) {
  return (
    <Card style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: tint }]}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function NavRow({ icon, title, subtitle, onPress }: { icon: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card style={styles.navRow}>
        <View style={styles.navIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.navTitle}>{title}</Text>
          <Text style={styles.navSub}>{subtitle}</Text>
        </View>
        <ChevronRight size={20} color={C.textMuted} />
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 340 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  hello: { fontSize: 12, color: C.accent, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  name: { fontSize: 18, color: C.text, fontWeight: '800' as const },
  logoutBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  lifetimeLabel: { fontSize: 13, color: C.textSecondary, marginTop: 8 },
  lifetimeValue: { fontSize: 44, fontWeight: '800' as const, color: C.text, letterSpacing: -1.5 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  pillLabel: { fontSize: 12, fontWeight: '700' as const },
  codeCard: { padding: 18, marginTop: 6, gap: 6 },
  codeLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const, letterSpacing: 1.2 },
  codeValue: { fontSize: 30, fontWeight: '800' as const, color: C.accent, letterSpacing: 4 },
  codeHint: { fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 2 },
  codeActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  codeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  codeBtnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  codeBtnText: { fontSize: 14, fontWeight: '700' as const, color: C.white },
  statGrid: { flexDirection: 'row', gap: 12 },
  statTile: { flex: 1, padding: 14, gap: 8 },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 12, color: C.textSecondary },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  navIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  navSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
