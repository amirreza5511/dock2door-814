import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Settings, CheckCircle, Plus, Trash2 } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface CommissionRuleRow {
  id: string;
  module: string;
  percentage: string;
  minimum_amount: string;
  currency: string;
  active: boolean;
}

interface TaxRuleRow {
  id: string;
  jurisdiction: string;
  rate: string;
  applies_to: string;
  active: boolean;
}

interface FeatureFlagRow {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
}

interface CommissionDraft {
  module: string;
  percentage: string;
  minimumAmount: string;
}

interface TaxDraft {
  jurisdiction: string;
  rate: string;
  appliesTo: string;
}

interface FlagDraft {
  key: string;
  description: string;
  enabled: boolean;
}

export default function AdminPlatformSettings() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.admin.getPlatformSettings.useQuery();
  const commissionsQuery = trpc.admin.listCommissionRules.useQuery();
  const taxesQuery = trpc.admin.listTaxRules.useQuery();
  const flagsQuery = trpc.admin.listFeatureFlags.useQuery();

  const updateSettings = trpc.admin.updatePlatformSettings.useMutation({
    onSuccess: async () => { await utils.admin.getPlatformSettings.invalidate(); },
  });
  const upsertCommission = trpc.admin.upsertCommissionRule.useMutation({
    onSuccess: async () => { await utils.admin.listCommissionRules.invalidate(); },
  });
  const upsertTax = trpc.admin.upsertTaxRule.useMutation({
    onSuccess: async () => { await utils.admin.listTaxRules.invalidate(); },
  });
  const upsertFlag = trpc.admin.upsertFeatureFlag.useMutation({
    onSuccess: async () => { await utils.admin.listFeatureFlags.invalidate(); },
  });

  const [handlingFee, setHandlingFee] = useState<string>('12');
  const [taxMode, setTaxMode] = useState<string>('GST+PST');
  const [commissionDraft, setCommissionDraft] = useState<CommissionDraft>({ module: 'warehouse', percentage: '8', minimumAmount: '0' });
  const [taxDraft, setTaxDraft] = useState<TaxDraft>({ jurisdiction: 'BC', rate: '12', appliesTo: 'all' });
  const [flagDraft, setFlagDraft] = useState<FlagDraft>({ key: '', description: '', enabled: false });

  useEffect(() => {
    const data = settingsQuery.data?.data as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data.handlingFeePerPalletDefault === 'number') setHandlingFee(String(data.handlingFeePerPalletDefault));
      if (typeof data.taxMode === 'string') setTaxMode(data.taxMode);
    }
  }, [settingsQuery.data]);

  const saveSettings = async () => {
    try {
      await updateSettings.mutateAsync({
        data: {
          handlingFeePerPalletDefault: Number(handlingFee) || 0,
          taxMode,
        },
      });
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unable to save');
    }
  };

  const addCommission = async () => {
    if (!commissionDraft.module.trim()) return;
    try {
      await upsertCommission.mutateAsync({
        module: commissionDraft.module.trim(),
        percentage: Number(commissionDraft.percentage) || 0,
        minimumAmount: Number(commissionDraft.minimumAmount) || 0,
        currency: 'cad',
        active: true,
      });
      setCommissionDraft({ module: '', percentage: '8', minimumAmount: '0' });
    } catch (error) {
      Alert.alert('Unable to save commission rule', error instanceof Error ? error.message : 'Error');
    }
  };

  const toggleCommission = async (rule: CommissionRuleRow) => {
    try {
      await upsertCommission.mutateAsync({
        id: rule.id,
        module: rule.module,
        percentage: Number(rule.percentage),
        minimumAmount: Number(rule.minimum_amount),
        currency: rule.currency,
        active: !rule.active,
      });
    } catch (error) {
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Error');
    }
  };

  const addTax = async () => {
    if (!taxDraft.jurisdiction.trim()) return;
    try {
      await upsertTax.mutateAsync({
        jurisdiction: taxDraft.jurisdiction.trim(),
        rate: Number(taxDraft.rate) || 0,
        appliesTo: taxDraft.appliesTo.trim() || 'all',
        active: true,
      });
      setTaxDraft({ jurisdiction: '', rate: '12', appliesTo: 'all' });
    } catch (error) {
      Alert.alert('Unable to save tax rule', error instanceof Error ? error.message : 'Error');
    }
  };

  const addFlag = async () => {
    if (!flagDraft.key.trim()) return;
    try {
      await upsertFlag.mutateAsync({
        key: flagDraft.key.trim(),
        description: flagDraft.description.trim() || null,
        enabled: flagDraft.enabled,
        rollout: {},
      });
      setFlagDraft({ key: '', description: '', enabled: false });
    } catch (error) {
      Alert.alert('Unable to save flag', error instanceof Error ? error.message : 'Error');
    }
  };

  const toggleFlag = async (flag: FeatureFlagRow) => {
    try {
      await upsertFlag.mutateAsync({
        key: flag.key,
        description: flag.description,
        enabled: !flag.enabled,
        rollout: {},
      });
    } catch (error) {
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Error');
    }
  };

  if (settingsQuery.isLoading || commissionsQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading platform settings" />
      </View>
    );
  }

  if (settingsQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="error" title="Unable to load settings" onRetry={() => void settingsQuery.refetch()} />
      </View>
    );
  }

  const commissions = (commissionsQuery.data as CommissionRuleRow[] | undefined) ?? [];
  const taxes = (taxesQuery.data as TaxRuleRow[] | undefined) ?? [];
  const flags = (flagsQuery.data as FeatureFlagRow[] | undefined) ?? [];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.iconWrap}>
          <Settings size={20} color={C.accent} />
        </View>
        <View>
          <Text style={styles.title}>Platform Settings</Text>
          <Text style={styles.sub}>Commission, tax, feature flags & defaults</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Section title="Defaults">
          <Card elevated style={styles.formCard}>
            <Input label="Default Handling Fee per Pallet ($)" value={handlingFee} onChangeText={setHandlingFee} keyboardType="numeric" placeholder="12" />
            <Input label="Tax Mode" value={taxMode} onChangeText={setTaxMode} placeholder="GST+PST" />
            <Button label="Save Defaults" onPress={() => void saveSettings()} loading={updateSettings.isPending} fullWidth icon={<CheckCircle size={16} color={C.white} />} />
          </Card>
        </Section>

        <Section title="Commission Rules">
          {commissions.length === 0 ? (
            <Text style={styles.emptyText}>No commission rules yet — warehouse/service/labour default to 8/20/15%.</Text>
          ) : commissions.map((rule) => (
            <Card key={rule.id} style={styles.ruleCard}>
              <View style={styles.ruleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ruleTitle}>{rule.module}</Text>
                  <Text style={styles.ruleMeta}>{Number(rule.percentage).toFixed(2)}% · min ${Number(rule.minimum_amount).toFixed(0)} {rule.currency.toUpperCase()}</Text>
                </View>
                <Switch value={rule.active} onValueChange={() => void toggleCommission(rule)} />
              </View>
            </Card>
          ))}
          <Card style={styles.formCard}>
            <View style={styles.inlineRow}>
              <View style={{ flex: 1 }}><Input label="Module" value={commissionDraft.module} onChangeText={(v) => setCommissionDraft((p) => ({ ...p, module: v }))} placeholder="warehouse / service / labour / fulfillment" /></View>
            </View>
            <View style={styles.inlineRow}>
              <View style={{ flex: 1 }}><Input label="Percentage" value={commissionDraft.percentage} onChangeText={(v) => setCommissionDraft((p) => ({ ...p, percentage: v }))} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><Input label="Minimum ($)" value={commissionDraft.minimumAmount} onChangeText={(v) => setCommissionDraft((p) => ({ ...p, minimumAmount: v }))} keyboardType="numeric" /></View>
            </View>
            <Button label="Add Commission Rule" onPress={() => void addCommission()} loading={upsertCommission.isPending} fullWidth icon={<Plus size={16} color={C.white} />} />
          </Card>
        </Section>

        <Section title="Tax Rules">
          {taxes.length === 0 ? <Text style={styles.emptyText}>No tax rules configured.</Text> : taxes.map((tax) => (
            <Card key={tax.id} style={styles.ruleCard}>
              <Text style={styles.ruleTitle}>{tax.jurisdiction} · {tax.applies_to}</Text>
              <Text style={styles.ruleMeta}>{Number(tax.rate).toFixed(2)}% {tax.active ? '· active' : '· disabled'}</Text>
            </Card>
          ))}
          <Card style={styles.formCard}>
            <View style={styles.inlineRow}>
              <View style={{ flex: 1 }}><Input label="Jurisdiction" value={taxDraft.jurisdiction} onChangeText={(v) => setTaxDraft((p) => ({ ...p, jurisdiction: v }))} placeholder="BC" /></View>
              <View style={{ flex: 1 }}><Input label="Rate (%)" value={taxDraft.rate} onChangeText={(v) => setTaxDraft((p) => ({ ...p, rate: v }))} keyboardType="numeric" /></View>
            </View>
            <Input label="Applies to" value={taxDraft.appliesTo} onChangeText={(v) => setTaxDraft((p) => ({ ...p, appliesTo: v }))} placeholder="all / warehouse / service" />
            <Button label="Add Tax Rule" onPress={() => void addTax()} loading={upsertTax.isPending} fullWidth icon={<Plus size={16} color={C.white} />} />
          </Card>
        </Section>

        <Section title="Feature Flags">
          {flags.length === 0 ? <Text style={styles.emptyText}>No feature flags yet.</Text> : flags.map((flag) => (
            <Card key={flag.id} style={styles.ruleCard}>
              <View style={styles.ruleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ruleTitle}>{flag.key}</Text>
                  {flag.description ? <Text style={styles.ruleMeta}>{flag.description}</Text> : null}
                </View>
                <Switch value={flag.enabled} onValueChange={() => void toggleFlag(flag)} />
              </View>
            </Card>
          ))}
          <Card style={styles.formCard}>
            <Input label="Flag key" value={flagDraft.key} onChangeText={(v) => setFlagDraft((p) => ({ ...p, key: v }))} placeholder="new_onboarding" autoCapitalize="none" />
            <Input label="Description" value={flagDraft.description} onChangeText={(v) => setFlagDraft((p) => ({ ...p, description: v }))} placeholder="Optional description" multiline numberOfLines={2} />
            <TouchableOpacity onPress={() => setFlagDraft((p) => ({ ...p, enabled: !p.enabled }))} style={styles.toggleRow}>
              <Text style={styles.toggleText}>Enabled</Text>
              <Switch value={flagDraft.enabled} onValueChange={(v) => setFlagDraft((p) => ({ ...p, enabled: v }))} />
            </TouchableOpacity>
            <Button label="Add Feature Flag" onPress={() => void addFlag()} loading={upsertFlag.isPending} fullWidth icon={<Plus size={16} color={C.white} />} />
          </Card>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 8 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  formCard: { padding: 14, gap: 12 },
  ruleCard: { padding: 12, marginBottom: 8 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ruleTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, textTransform: 'capitalize' as const },
  ruleMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  toggleText: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  emptyText: { fontSize: 13, color: C.textMuted, marginBottom: 12 },
});
