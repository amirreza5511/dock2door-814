import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Building2, CheckCircle, DollarSign, Globe, Trash2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { VEHICLE_OPTIONS, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

interface RateCardRow {
  id: string;
  company_id: string | null;
  vehicle_type: string;
  base_price: number;
  per_km: number;
  per_pallet: number;
  same_day_multiplier: number;
}

interface CommissionOverrideRow {
  company_id: string;
  commission_percentage: number;
  booking_fee: number;
}

interface CompanyRow { id: string; name: string; type: string }

type RateDraft = { base: string; perKm: string; perPallet: string; sameDay: string };

const DEFAULTS: Record<VehicleType, RateDraft> = {
  Bicycle: { base: '6', perKm: '1.2', perPallet: '8', sameDay: '1.4' },
  Motorcycle: { base: '8', perKm: '1.5', perPallet: '8', sameDay: '1.4' },
  Car: { base: '12', perKm: '1.8', perPallet: '8', sameDay: '1.4' },
  Pickup: { base: '25', perKm: '2.2', perPallet: '8', sameDay: '1.4' },
  MovingTruck: { base: '60', perKm: '3.0', perPallet: '8', sameDay: '1.4' },
  FiveTon: { base: '90', perKm: '3.5', perPallet: '8', sameDay: '1.4' },
  FlatDeck: { base: '120', perKm: '4.0', perPallet: '8', sameDay: '1.4' },
  Semi: { base: '200', perKm: '4.5', perPallet: '8', sameDay: '1.4' },
};

export default function AdminFreightPricing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [scope, setScope] = useState<'global' | string>('global'); // 'global' or companyId
  const settingsQuery = trpc.admin.getPlatformSettings.useQuery();
  const rateCardsQuery = trpc.admin.listRateCards.useQuery();
  const overridesQuery = trpc.admin.listCommissionOverrides.useQuery();
  const companiesQuery = trpc.admin.listCompaniesForPricing.useQuery();

  const upsertRate = trpc.admin.upsertRateCard.useMutation({ onSuccess: async () => { await utils.admin.listRateCards.invalidate(); } });
  const deleteRate = trpc.admin.deleteRateCard.useMutation({ onSuccess: async () => { await utils.admin.listRateCards.invalidate(); } });
  const upsertOverride = trpc.admin.upsertCommissionOverride.useMutation({ onSuccess: async () => { await utils.admin.listCommissionOverrides.invalidate(); } });
  const deleteOverride = trpc.admin.deleteCommissionOverride.useMutation({ onSuccess: async () => { await utils.admin.listCommissionOverrides.invalidate(); } });
  const updateSettings = trpc.admin.updatePlatformSettings.useMutation({ onSuccess: async () => { await utils.admin.getPlatformSettings.invalidate(); } });

  const companies = (companiesQuery.data as CompanyRow[] | undefined) ?? [];
  const rateCards = (rateCardsQuery.data as RateCardRow[] | undefined) ?? [];
  const overrides = (overridesQuery.data as CommissionOverrideRow[] | undefined) ?? [];

  // Commission state (global + per-company).
  const [globalCommission, setGlobalCommission] = useState<string>('12');
  const [globalBookingFee, setGlobalBookingFee] = useState<string>('5');
  const [companyCommission, setCompanyCommission] = useState<string>('');
  const [companyBookingFee, setCompanyBookingFee] = useState<string>('');

  // Per-vehicle rate drafts for the active scope.
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});

  useEffect(() => {
    const root = settingsQuery.data as Record<string, unknown> | undefined;
    if (root) {
      if (typeof root.trucking_commission_percentage === 'number') setGlobalCommission(String(root.trucking_commission_percentage));
      if (typeof root.trucking_booking_fee === 'number') setGlobalBookingFee(String(root.trucking_booking_fee));
    }
  }, [settingsQuery.data]);

  // Build drafts whenever scope or data changes.
  useEffect(() => {
    const next: Record<string, RateDraft> = {};
    for (const v of VEHICLE_OPTIONS) {
      const row = rateCards.find((r) => r.vehicle_type === v.type && (scope === 'global' ? r.company_id === null : r.company_id === scope));
      const globalRow = rateCards.find((r) => r.vehicle_type === v.type && r.company_id === null);
      const fallback = globalRow
        ? { base: String(globalRow.base_price), perKm: String(globalRow.per_km), perPallet: String(globalRow.per_pallet), sameDay: String(globalRow.same_day_multiplier) }
        : DEFAULTS[v.type];
      next[v.type] = row
        ? { base: String(row.base_price), perKm: String(row.per_km), perPallet: String(row.per_pallet), sameDay: String(row.same_day_multiplier) }
        : fallback;
    }
    setDrafts(next);

    if (scope !== 'global') {
      const ov = overrides.find((o) => o.company_id === scope);
      setCompanyCommission(ov ? String(ov.commission_percentage) : '');
      setCompanyBookingFee(ov ? String(ov.booking_fee) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, rateCardsQuery.data, overridesQuery.data]);

  const setDraft = (type: string, key: keyof RateDraft, value: string) => {
    setDrafts((p) => ({ ...p, [type]: { ...p[type], [key]: value } }));
  };

  const saveRate = async (type: VehicleType) => {
    const d = drafts[type];
    if (!d) return;
    try {
      await upsertRate.mutateAsync({
        companyId: scope === 'global' ? null : scope,
        vehicleType: type,
        basePrice: Number(d.base) || 0,
        perKm: Number(d.perKm) || 0,
        perPallet: Number(d.perPallet) || 0,
        sameDayMultiplier: Number(d.sameDay) || 1,
      });
    } catch (err) {
      Alert.alert('Unable to save', err instanceof Error ? err.message : 'Error');
    }
  };

  const saveGlobalCommission = async () => {
    try {
      await updateSettings.mutateAsync({
        data: {
          truckingCommissionPercentage: Number(globalCommission) || 0,
          truckingBookingFee: Number(globalBookingFee) || 0,
        },
      });
      Alert.alert('Saved', 'Global commission updated.');
    } catch (err) {
      Alert.alert('Unable to save', err instanceof Error ? err.message : 'Error');
    }
  };

  const saveCompanyOverride = async () => {
    if (scope === 'global') return;
    try {
      await upsertOverride.mutateAsync({
        companyId: scope,
        commissionPercentage: Number(companyCommission) || 0,
        bookingFee: Number(companyBookingFee) || 0,
      });
      Alert.alert('Saved', 'Company commission override updated.');
    } catch (err) {
      Alert.alert('Unable to save', err instanceof Error ? err.message : 'Error');
    }
  };

  const removeCompanyOverride = async () => {
    if (scope === 'global') return;
    try {
      await deleteOverride.mutateAsync({ companyId: scope });
      setCompanyCommission('');
      setCompanyBookingFee('');
    } catch (err) {
      Alert.alert('Unable to remove', err instanceof Error ? err.message : 'Error');
    }
  };

  const removeCompanyRate = async (type: VehicleType) => {
    const row = rateCards.find((r) => r.vehicle_type === type && r.company_id === scope);
    if (!row) { Alert.alert('No override', 'This vehicle already uses the global rate.'); return; }
    try {
      await deleteRate.mutateAsync({ id: row.id });
    } catch (err) {
      Alert.alert('Unable to remove', err instanceof Error ? err.message : 'Error');
    }
  };

  // Sample breakdown for a 25 km, 2-pallet, next-day Pickup at the active scope.
  const sample = useMemo(() => {
    const d = drafts.Pickup ?? DEFAULTS.Pickup;
    const distance = 25;
    const pallets = 2;
    const freight = (Number(d.base) + Number(d.perKm) * distance + Number(d.perPallet) * pallets) * 1;
    const pct = scope === 'global' ? Number(globalCommission) : (companyCommission !== '' ? Number(companyCommission) : Number(globalCommission));
    const fee = scope === 'global' ? Number(globalBookingFee) : (companyBookingFee !== '' ? Number(companyBookingFee) : Number(globalBookingFee));
    const commission = (freight * (pct || 0)) / 100;
    return {
      freight: freight.toFixed(2),
      fee: (fee || 0).toFixed(2),
      commission: commission.toFixed(2),
      platform: (commission + (fee || 0)).toFixed(2),
      carrierNet: (freight - commission).toFixed(2),
      shipperPays: (freight + (fee || 0)).toFixed(2),
    };
  }, [drafts, scope, globalCommission, globalBookingFee, companyCommission, companyBookingFee]);

  if (settingsQuery.isLoading || rateCardsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading pricing" /></View>;
  }
  if (settingsQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load pricing" onRetry={() => void settingsQuery.refetch()} /></View>;
  }

  const activeCompany = companies.find((c) => c.id === scope);
  const overrideCompanyIds = new Set(overrides.map((o) => o.company_id));

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View>
          <Text style={styles.title}>Freight Pricing</Text>
          <Text style={styles.sub}>Rate cards & commission per vehicle and company</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Scope selector */}
        <Text style={styles.sectionTitle}>Pricing for</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>
          <TouchableOpacity onPress={() => setScope('global')} style={[styles.scopeChip, scope === 'global' && styles.scopeChipActive]}>
            <Globe size={14} color={scope === 'global' ? C.white : C.accent} />
            <Text style={[styles.scopeChipText, scope === 'global' && { color: C.white }]}>Global default</Text>
          </TouchableOpacity>
          {companies.map((co) => (
            <TouchableOpacity key={co.id} onPress={() => setScope(co.id)} style={[styles.scopeChip, scope === co.id && styles.scopeChipActive]}>
              <Building2 size={14} color={scope === co.id ? C.white : (overrideCompanyIds.has(co.id) ? C.green : C.textSecondary)} />
              <Text style={[styles.scopeChipText, scope === co.id && { color: C.white }, overrideCompanyIds.has(co.id) && scope !== co.id && { color: C.green }]} numberOfLines={1}>{co.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {scope !== 'global' ? (
          <Text style={styles.scopeNote}>
            Editing overrides for <Text style={{ color: C.text, fontWeight: '700' }}>{activeCompany?.name ?? 'company'}</Text>. Vehicles without a saved override use the global rate.
          </Text>
        ) : null}

        {/* Commission */}
        <Text style={styles.sectionTitle}>Commission & booking fee</Text>
        <Card style={styles.formCard}>
          {scope === 'global' ? (
            <>
              <View style={styles.inlineRow}>
                <View style={{ flex: 1 }}><Input label="Commission (%)" value={globalCommission} onChangeText={setGlobalCommission} keyboardType="numeric" /></View>
                <View style={{ flex: 1 }}><Input label="Booking fee ($)" value={globalBookingFee} onChangeText={setGlobalBookingFee} keyboardType="numeric" /></View>
              </View>
              <Button label="Save commission" onPress={() => void saveGlobalCommission()} loading={updateSettings.isPending} fullWidth icon={<CheckCircle size={16} color={C.white} />} />
            </>
          ) : (
            <>
              <Text style={styles.helperNote}>Leave blank to use the global commission for this company.</Text>
              <View style={styles.inlineRow}>
                <View style={{ flex: 1 }}><Input label="Commission (%)" value={companyCommission} onChangeText={setCompanyCommission} keyboardType="numeric" placeholder={globalCommission} /></View>
                <View style={{ flex: 1 }}><Input label="Booking fee ($)" value={companyBookingFee} onChangeText={setCompanyBookingFee} keyboardType="numeric" placeholder={globalBookingFee} /></View>
              </View>
              <Button label="Save company commission" onPress={() => void saveCompanyOverride()} loading={upsertOverride.isPending} fullWidth icon={<CheckCircle size={16} color={C.white} />} />
              {overrideCompanyIds.has(scope) ? (
                <TouchableOpacity onPress={() => void removeCompanyOverride()} style={styles.removeRow}>
                  <Trash2 size={13} color={C.red} /><Text style={styles.removeText}>Remove override (use global)</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </Card>

        {/* Sample breakdown */}
        <Card style={styles.sampleCard}>
          <View style={styles.sampleHead}><DollarSign size={15} color={C.accent} /><Text style={styles.sampleTitle}>Sample: Pickup · 25 km · 2 pallets</Text></View>
          <Row label="Freight price" value={`$${sample.freight}`} />
          <Row label="Booking fee" value={`$${sample.fee}`} />
          <Row label="Commission" value={`- $${sample.commission}`} />
          <View style={styles.sampleDivider} />
          <Row label="Carrier nets" value={`$${sample.carrierNet}`} strong color={C.green} />
          <Row label="Platform earns" value={`$${sample.platform}`} strong color={C.accent} />
          <Row label="Shipper pays" value={`$${sample.shipperPays}`} strong />
        </Card>

        {/* Rate cards per vehicle */}
        <Text style={styles.sectionTitle}>Rate card</Text>
        {VEHICLE_OPTIONS.map((v) => {
          const d = drafts[v.type] ?? DEFAULTS[v.type];
          const hasCompanyRow = scope !== 'global' && rateCards.some((r) => r.vehicle_type === v.type && r.company_id === scope);
          return (
            <Card key={v.type} style={styles.vehCard}>
              <View style={styles.vehHead}>
                <Text style={styles.vehTitle}>{v.emoji}  {v.label}</Text>
                {scope !== 'global' ? (
                  <Text style={[styles.vehTag, hasCompanyRow ? { color: C.green } : { color: C.textMuted }]}>{hasCompanyRow ? 'Custom' : 'Global'}</Text>
                ) : null}
              </View>
              <View style={styles.inlineRow}>
                <View style={{ flex: 1 }}><Input label="Base ($)" value={d.base} onChangeText={(t) => setDraft(v.type, 'base', t)} keyboardType="numeric" /></View>
                <View style={{ flex: 1 }}><Input label="Per km ($)" value={d.perKm} onChangeText={(t) => setDraft(v.type, 'perKm', t)} keyboardType="numeric" /></View>
              </View>
              <View style={styles.inlineRow}>
                <View style={{ flex: 1 }}><Input label="Per pallet ($)" value={d.perPallet} onChangeText={(t) => setDraft(v.type, 'perPallet', t)} keyboardType="numeric" /></View>
                <View style={{ flex: 1 }}><Input label="Same-day ×" value={d.sameDay} onChangeText={(t) => setDraft(v.type, 'sameDay', t)} keyboardType="numeric" /></View>
              </View>
              <View style={styles.vehActions}>
                <View style={{ flex: 1 }}>
                  <Button label={scope === 'global' ? 'Save rate' : 'Save override'} onPress={() => void saveRate(v.type)} loading={upsertRate.isPending} fullWidth size="sm" />
                </View>
                {scope !== 'global' && hasCompanyRow ? (
                  <TouchableOpacity onPress={() => void removeCompanyRate(v.type)} style={styles.vehDelete}><Trash2 size={16} color={C.red} /></TouchableOpacity>
                ) : null}
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && { fontWeight: '700' as const, color: C.text }]}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontWeight: '800' as const }, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  sub: { fontSize: 11, color: C.textSecondary, marginTop: 2, textAlign: 'center' as const },
  scroll: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 8 },
  scopeRow: { gap: 8, paddingVertical: 4 },
  scopeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, maxWidth: 200 },
  scopeChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  scopeChipText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary, flexShrink: 1 },
  scopeNote: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  formCard: { padding: 14, gap: 12 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  helperNote: { fontSize: 11, color: C.textMuted, lineHeight: 15 },
  removeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  removeText: { fontSize: 12, color: C.red, fontWeight: '700' as const },
  sampleCard: { padding: 14, gap: 8, backgroundColor: C.cardElevated },
  sampleHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sampleTitle: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  sampleDivider: { height: 1, backgroundColor: C.border, marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 13, color: C.textSecondary },
  rowValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  vehCard: { padding: 14, gap: 10 },
  vehHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vehTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  vehTag: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  vehActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vehDelete: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '40' },
});
