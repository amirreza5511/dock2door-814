import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Copy, Share2, CheckCheck, ClipboardList, Link2, Sparkles } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { SalesVertical } from '@/constants/types';

const VERTICALS: { id: SalesVertical; label: string; blurb: string }[] = [
  { id: 'warehouse', label: 'Warehouse', blurb: 'Storage & fulfillment provider' },
  { id: 'drayage', label: 'Drayage company', blurb: 'Container trucking & port moves' },
  { id: 'freight_forwarder', label: 'Freight forwarder', blurb: 'Importer / exporter' },
  { id: 'employer', label: 'Employer', blurb: 'Posts labour shifts' },
  { id: 'trucking', label: 'Trucking / carrier', blurb: 'Fleet or carrier company' },
  { id: 'shipper', label: 'Shipper', blurb: 'Posts deliveries & loads' },
  { id: 'customer', label: 'Customer', blurb: 'Books space & services' },
  { id: 'service', label: 'Service provider', blurb: 'Industrial services' },
  { id: 'worker', label: 'Worker', blurb: 'Picks up shifts' },
  { id: 'driver', label: 'Driver', blurb: 'Owner-operator' },
];

function buildInviteLink(code: string): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/signup?ref=${encodeURIComponent(code)}`;
  }
  return null;
}

export default function OnboardClient() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const agentQuery = trpc.sales.myAgent.useQuery();
  const agent = agentQuery.data as { agent_code?: string } | null | undefined;
  const code = agent?.agent_code ?? '';

  const [vertical, setVertical] = useState<SalesVertical>('warehouse');
  const [copied, setCopied] = useState<'code' | 'link' | 'msg' | null>(null);
  const [businessName, setBusinessName] = useState('');

  const upsertLead = trpc.sales.upsertLead.useMutation({
    onSuccess: async () => { await utils.sales.leads.invalidate(); await utils.sales.dashboard.invalidate(); },
  });

  const inviteLink = useMemo(() => (code ? buildInviteLink(code) : null), [code]);
  const message = useMemo(() => {
    if (!code) return '';
    const base = `Join Dock2Door and get set up in minutes. Use my referral code ${code} when you sign up`;
    return inviteLink ? `${base}, or tap this link: ${inviteLink}` : `${base}.`;
  }, [code, inviteLink]);

  const copy = useCallback(async (what: 'code' | 'link' | 'msg', value: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  }, []);

  const share = useCallback(async () => {
    if (!message) return;
    if (Platform.OS === 'web') { await copy('msg', message); return; }
    try { await Share.share({ message }); } catch {}
  }, [message, copy]);

  const saveAsLead = useCallback(async () => {
    try {
      await upsertLead.mutateAsync({ businessName: businessName.trim(), vertical, status: 'New', notes: 'Added from Onboard a client' });
      Alert.alert('Saved to your pipeline', 'This prospect is now a lead you can work and convert later.');
      setBusinessName('');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Error');
    }
  }, [upsertLead, businessName, vertical]);

  if (agentQuery.isLoading) {
    return <View style={[styles.root, styles.center]}><ScreenFeedback state="loading" title="Loading" /></View>;
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#12253D', C.bg]} style={styles.heroBg} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Onboard a client</Text>
        <SupportMenu />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.introRow}>
          <View style={styles.introBadge}><Sparkles size={16} color={C.accent} /></View>
          <Text style={styles.introText}>Pick the kind of business, then send them your invite. When they sign up, they’re credited to you automatically.</Text>
        </View>

        <Text style={styles.sectionLabel}>1 · What kind of business?</Text>
        <View style={styles.grid}>
          {VERTICALS.map((v) => {
            const active = vertical === v.id;
            return (
              <TouchableOpacity key={v.id} onPress={() => setVertical(v.id)} activeOpacity={0.85} style={[styles.typeCard, active && styles.typeCardActive]}>
                <Text style={[styles.typeLabel, active && { color: C.accent }]}>{v.label}</Text>
                <Text style={styles.typeBlurb}>{v.blurb}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>2 · Send your invite</Text>
        <Card elevated style={styles.inviteCard}>
          <Text style={styles.codeLabel}>YOUR REFERRAL CODE</Text>
          <View style={styles.codeRow}>
            <Text style={styles.codeValue}>{code || '——————'}</Text>
            <TouchableOpacity onPress={() => void copy('code', code)} style={styles.miniBtn}>
              {copied === 'code' ? <CheckCheck size={15} color={C.green} /> : <Copy size={15} color={C.accent} />}
            </TouchableOpacity>
          </View>

          {inviteLink ? (
            <TouchableOpacity onPress={() => void copy('link', inviteLink)} activeOpacity={0.8} style={styles.linkRow}>
              <Link2 size={15} color={C.blue} />
              <Text style={styles.linkText} numberOfLines={1}>{inviteLink}</Text>
              {copied === 'link' ? <CheckCheck size={15} color={C.green} /> : <Copy size={15} color={C.textMuted} />}
            </TouchableOpacity>
          ) : (
            <Text style={styles.linkHint}>Tip: share the code above — the business enters it during sign-up and you get the credit.</Text>
          )}

          <View style={styles.actionsRow}>
            <Button label="Share invite" onPress={() => void share()} icon={<Share2 size={16} color={C.white} />} style={{ flex: 1 }} />
            <Button label={copied === 'msg' ? 'Copied' : 'Copy message'} variant="secondary" onPress={() => void copy('msg', message)} icon={copied === 'msg' ? <CheckCheck size={16} color={C.accent} /> : <Copy size={16} color={C.accent} />} style={{ flex: 1 }} />
          </View>
        </Card>

        <Text style={styles.sectionLabel}>Not ready to invite yet?</Text>
        <Card style={styles.leadCard}>
          <View style={styles.leadHeadRow}>
            <ClipboardList size={18} color={C.purple} />
            <Text style={styles.leadHead}>Save as a lead to work first</Text>
          </View>
          <Input label="Business name (optional)" value={businessName} onChangeText={setBusinessName} placeholder="Acme Warehousing" />
          <Button label="Add to my pipeline" variant="secondary" onPress={() => void saveAsLead()} loading={upsertLead.isPending} fullWidth />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 200 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { paddingHorizontal: 16, gap: 12 },
  introRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 },
  introBadge: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  introText: { flex: 1, fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  sectionLabel: { fontSize: 12, fontWeight: '800' as const, color: C.accent, letterSpacing: 1, textTransform: 'uppercase' as const, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 10 },
  typeCard: { width: '48%', padding: 14, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  typeCardActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  typeLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  typeBlurb: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  inviteCard: { padding: 18, gap: 12 },
  codeLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const, letterSpacing: 1.2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codeValue: { fontSize: 28, fontWeight: '800' as const, color: C.accent, letterSpacing: 4 },
  miniBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  linkText: { flex: 1, fontSize: 12, color: C.blue, fontWeight: '600' as const },
  linkHint: { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  leadCard: { padding: 16, gap: 12 },
  leadHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadHead: { fontSize: 14, fontWeight: '700' as const, color: C.text },
});
