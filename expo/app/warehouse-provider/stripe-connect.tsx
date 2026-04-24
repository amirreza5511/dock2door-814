import React, { useMemo, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, ExternalLink, ShieldCheck, Wallet } from 'lucide-react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';

interface CompanyRow {
  id: string;
  name: string;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean | null;
}

export default function StripeConnectScreen() {
  const insets = useSafeAreaInsets();
  const { activeCompany } = useActiveCompany();
  const companyId = activeCompany?.companyId ?? null;
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const companyQuery = useQuery<CompanyRow | null>({
    queryKey: ['stripe-connect', 'company', companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, stripe_connect_account_id, stripe_connect_onboarded')
        .eq('id', companyId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as CompanyRow | null;
    },
  });

  const onboardMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('No active company');
      const returnUrl = Platform.OS === 'web' ? window.location.origin + '/warehouse-provider/stripe-connect' : 'dock2door://stripe-connect-return';
      const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
        body: { company_id: companyId, return_url: returnUrl, refresh_url: returnUrl },
      });
      if (error) throw new Error(error.message);
      return data as { url: string | null; account_id: string; onboarded: boolean };
    },
    onSuccess: async (res) => {
      await companyQuery.refetch();
      if (res.onboarded) {
        Alert.alert('Payouts ready', 'Your Stripe Connect account is fully onboarded.');
        return;
      }
      if (res.url) {
        setLastUrl(res.url);
        if (Platform.OS === 'web') window.open(res.url, '_blank');
        else await Linking.openURL(res.url);
      }
    },
    onError: (err: Error) => Alert.alert('Unable to start onboarding', err.message),
  });

  const dashboardMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('No active company');
      const { data, error } = await supabase.functions.invoke('stripe-connect-dashboard', {
        body: { company_id: companyId },
      });
      if (error) throw new Error(error.message);
      return data as { url: string; account_id: string };
    },
    onSuccess: async (res) => {
      if (!res.url) return;
      if (Platform.OS === 'web') window.open(res.url, '_blank');
      else await Linking.openURL(res.url);
    },
    onError: async (err: Error) => {
      if (err.message.toLowerCase().includes('onboarding_incomplete')) {
        await companyQuery.refetch();
      }
      Alert.alert('Unable to open Stripe dashboard', err.message);
    },
  });

  const state = useMemo<'none' | 'pending' | 'ready'>(() => {
    const c = companyQuery.data;
    if (!c?.stripe_connect_account_id) return 'none';
    return c.stripe_connect_onboarded ? 'ready' : 'pending';
  }, [companyQuery.data]);

  if (!companyId) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="empty" title="Select an active company" /></View>;
  }
  if (companyQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading payout setup" /></View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 80 }]}>
        <Text style={styles.title}>Payout setup</Text>
        <Text style={styles.subtitle}>Dock2Door pays you via Stripe Connect after commission is deducted. Complete onboarding to receive transfers.</Text>

        <Card elevated style={styles.statusCard}>
          <View style={styles.statusHead}>
            <View style={[styles.iconWrap, { backgroundColor: state === 'ready' ? C.greenDim : state === 'pending' ? C.yellowDim : C.bgSecondary }]}>
              {state === 'ready' ? <CheckCircle2 size={22} color={C.green} /> : <Wallet size={22} color={state === 'pending' ? C.yellow : C.textMuted} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>
                {state === 'ready' ? 'Payouts enabled' : state === 'pending' ? 'Onboarding in progress' : 'Not connected'}
              </Text>
              <Text style={styles.statusMeta}>
                {state === 'ready' ? 'You will receive transfers automatically after each paid booking.'
                  : state === 'pending' ? 'Your Stripe account is created but onboarding needs to be finished.'
                  : 'Connect a Stripe account to start receiving payouts.'}
              </Text>
            </View>
          </View>

          {companyQuery.data?.stripe_connect_account_id ? (
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Stripe account</Text>
              <Text style={styles.kvVal} numberOfLines={1}>{companyQuery.data.stripe_connect_account_id}</Text>
            </View>
          ) : null}

          <View style={{ height: 12 }} />
          {state === 'ready' ? (
            <>
              <Button
                label="Open Stripe dashboard"
                icon={<ExternalLink size={16} color={C.white} />}
                onPress={() => dashboardMutation.mutate()}
                loading={dashboardMutation.isPending}
                fullWidth
                testID="stripe-dashboard"
              />
              <Button
                label="Refresh status"
                variant="secondary"
                icon={<ShieldCheck size={14} color={C.text} />}
                onPress={() => onboardMutation.mutate()}
                loading={onboardMutation.isPending}
              />
            </>
          ) : (
            <Button
              label={state === 'none' ? 'Start Stripe onboarding' : 'Continue onboarding'}
              icon={<ShieldCheck size={16} color={C.white} />}
              onPress={() => onboardMutation.mutate()}
              loading={onboardMutation.isPending}
              fullWidth
              testID="stripe-onboard"
            />
          )}

          {lastUrl && state !== 'ready' ? (
            <Button
              label="Re-open onboarding link"
              icon={<ExternalLink size={14} color={C.text} />}
              variant="secondary"
              onPress={() => Platform.OS === 'web' ? window.open(lastUrl, '_blank') : void Linking.openURL(lastUrl)}
            />
          ) : null}
        </Card>

        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>How it works</Text>
          <InfoRow n={1} text="Dock2Door collects payment from the customer on your behalf." />
          <InfoRow n={2} text="Platform commission is deducted per the active commission rule." />
          <InfoRow n={3} text="The remaining amount is queued as a payout and transferred to your connected Stripe account." />
          <InfoRow n={4} text="Stripe deposits funds to your bank on your configured schedule." />
        </Card>
      </ScrollView>
    </View>
  );
}

function InfoRow({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoNum}><Text style={styles.infoNumText}>{n}</Text></View>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: -4 },
  statusCard: { gap: 10, marginTop: 10 },
  statusHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  statusMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  kvKey: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  kvVal: { fontSize: 12, color: C.text, flex: 1, textAlign: 'right' as const },
  infoCard: { gap: 10 },
  infoTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  infoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  infoNumText: { fontSize: 11, fontWeight: '800' as const, color: C.accent },
  infoText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },
});
