import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, ChevronLeft, Circle, Coins, DollarSign, Fuel, TrendingUp, UserRound, X } from 'lucide-react-native';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';

type LoadRow = {
  id: string; vehicle_type: string; status: string;
  accepted_driver_user_id?: string | null; driver_name?: string | null;
  pickup_address?: string | null; dropoff_address?: string | null;
  provider_net?: number | null; total_price?: number | null;
  driver_pay_type?: string | null; driver_pay_value?: number | null; fuel_cost?: number | null;
  driver_settled?: boolean | null; delivered_at?: string | null;
};

type FleetDriver = { id: string; name?: string | null; data?: { name?: string; userId?: string } | null };

function driverPay(l: LoadRow): number {
  const net = Number(l.provider_net ?? 0);
  if (l.driver_pay_type === 'Percent') return Math.round(net * Number(l.driver_pay_value ?? 0)) / 100;
  if (l.driver_pay_type === 'Flat') return Number(l.driver_pay_value ?? 0);
  return 0;
}
function tripProfit(l: LoadRow): number {
  return Number(l.provider_net ?? 0) - driverPay(l) - Number(l.fuel_cost ?? 0);
}

export default function SettlementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.loads.settlement.useQuery(undefined, { refetchInterval: 30000 });
  const driversQuery = trpc.operations.listFleet.useQuery({ entity: 'drivers' });
  const setSettlement = trpc.loads.setSettlement.useMutation();
  const markSettled = trpc.loads.markSettled.useMutation();

  const [editing, setEditing] = useState<LoadRow | null>(null);
  const [payType, setPayType] = useState<'Percent' | 'Flat'>('Percent');
  const [payValue, setPayValue] = useState<string>('');
  const [fuel, setFuel] = useState<string>('');
  const [onlyUnsettled, setOnlyUnsettled] = useState<boolean>(false);

  const loads = useMemo<LoadRow[]>(() => (query.data ?? []) as LoadRow[], [query.data]);
  const drivers = useMemo<FleetDriver[]>(() => (driversQuery.data ?? []) as FleetDriver[], [driversQuery.data]);

  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) { const uid = d.data?.userId; if (uid) m.set(uid, d.name || d.data?.name || 'Driver'); }
    return m;
  }, [drivers]);

  const driverLabel = useCallback((l: LoadRow): string => {
    if (l.driver_name?.trim()) return l.driver_name.trim();
    if (l.accepted_driver_user_id && nameByUid.has(l.accepted_driver_user_id)) return nameByUid.get(l.accepted_driver_user_id) as string;
    return 'Unassigned';
  }, [nameByUid]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; loads: LoadRow[] }>();
    for (const l of loads) {
      const key = l.accepted_driver_user_id ?? l.driver_name ?? 'unknown';
      const name = driverLabel(l);
      if (!map.has(key)) map.set(key, { name, loads: [] });
      map.get(key)!.loads.push(l);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [loads, driverLabel]);

  const totals = useMemo(() => {
    let revenue = 0, pay = 0, fuelCost = 0, profit = 0, unpaid = 0;
    for (const l of loads) {
      revenue += Number(l.provider_net ?? 0);
      pay += driverPay(l);
      fuelCost += Number(l.fuel_cost ?? 0);
      profit += tripProfit(l);
      if (!l.driver_settled) unpaid += driverPay(l);
    }
    return { revenue, pay, fuelCost, profit, unpaid };
  }, [loads]);

  const openEdit = (l: LoadRow) => {
    setEditing(l);
    setPayType((l.driver_pay_type as 'Percent' | 'Flat') || 'Percent');
    setPayValue(l.driver_pay_value != null ? String(l.driver_pay_value) : '');
    setFuel(l.fuel_cost != null ? String(l.fuel_cost) : '');
  };

  const savePlan = () => {
    if (!editing) return;
    const val = payValue.trim() === '' ? null : Number(payValue);
    if (val != null && (!Number.isFinite(val) || val < 0)) { Alert.alert('Enter a valid amount'); return; }
    const fuelVal = fuel.trim() === '' ? null : Number(fuel);
    setSettlement.mutate(
      { id: editing.id, payType: val == null ? null : payType, payValue: val, fuelCost: fuelVal },
      {
        onSuccess: async () => { setEditing(null); await utils.loads.settlement.invalidate(); },
        onError: (e) => Alert.alert('Unable to save', e instanceof Error ? e.message : 'Error'),
      },
    );
  };

  const toggleSettled = (l: LoadRow) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    markSettled.mutate({ id: l.id, settled: !l.driver_settled }, {
      onSuccess: async () => { await utils.loads.settlement.invalidate(); },
      onError: (e) => Alert.alert('Unable to update', e instanceof Error ? e.message : 'Error'),
    });
  };

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading settlement" /></View>;
  if (query.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load settlement" onRetry={() => void query.refetch()} /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch { router.replace('/' as never); } }} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Driver settlement</Text>
          <Text style={styles.subtitle}>{loads.length} delivered · ${totals.unpaid.toFixed(0)} to pay</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryGrid}>
          <View style={styles.sumCard}><DollarSign size={15} color={C.green} /><Text style={styles.sumValue}>${totals.revenue.toFixed(0)}</Text><Text style={styles.sumLabel}>Revenue</Text></View>
          <View style={styles.sumCard}><Coins size={15} color={C.accent} /><Text style={styles.sumValue}>${totals.pay.toFixed(0)}</Text><Text style={styles.sumLabel}>Driver pay</Text></View>
          <View style={styles.sumCard}><Fuel size={15} color={C.yellow} /><Text style={styles.sumValue}>${totals.fuelCost.toFixed(0)}</Text><Text style={styles.sumLabel}>Fuel</Text></View>
          <View style={styles.sumCard}><TrendingUp size={15} color={C.green} /><Text style={[styles.sumValue, { color: totals.profit >= 0 ? C.green : C.red }]}>${totals.profit.toFixed(0)}</Text><Text style={styles.sumLabel}>Profit</Text></View>
        </View>

        <TouchableOpacity style={styles.filterToggle} onPress={() => setOnlyUnsettled((v) => !v)}>
          <View style={[styles.checkbox, onlyUnsettled && styles.checkboxOn]}>{onlyUnsettled ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
          <Text style={styles.filterToggleText}>Only unpaid loads</Text>
        </TouchableOpacity>

        {loads.length === 0 ? (
          <EmptyState icon={Coins} title="No delivered loads yet" description="Once your drivers complete deliveries, settle their pay and see per-trip profit here." />
        ) : groups.map((g) => {
          const gLoads = onlyUnsettled ? g.loads.filter((l) => !l.driver_settled) : g.loads;
          if (gLoads.length === 0) return null;
          const gPay = gLoads.reduce((s, l) => s + driverPay(l), 0);
          const gUnpaid = gLoads.filter((l) => !l.driver_settled).reduce((s, l) => s + driverPay(l), 0);
          return (
            <View key={g.name} style={styles.group}>
              <View style={styles.groupHead}>
                <View style={styles.groupAvatar}><UserRound size={16} color={C.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupName}>{g.name}</Text>
                  <Text style={styles.groupMeta}>{gLoads.length} load{gLoads.length > 1 ? 's' : ''} · ${gPay.toFixed(0)} pay</Text>
                </View>
                {gUnpaid > 0 ? <View style={styles.unpaidTag}><Text style={styles.unpaidTagText}>${gUnpaid.toFixed(0)} due</Text></View> : <CheckCircle2 size={18} color={C.green} />}
              </View>
              {gLoads.map((l) => {
                const pay = driverPay(l);
                const profit = tripProfit(l);
                const hasPlan = !!l.driver_pay_type;
                return (
                  <View key={l.id} style={styles.loadRow}>
                    <View style={styles.loadTop}>
                      <View style={styles.vehBadge}><Text style={styles.vehBadgeText}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type}</Text></View>
                      <Text style={styles.loadRoute} numberOfLines={1}>{(l.pickup_address || 'Pickup')} → {(l.dropoff_address || 'Drop-off')}</Text>
                    </View>
                    <View style={styles.figuresRow}>
                      <View style={styles.figure}><Text style={styles.figLabel}>Revenue</Text><Text style={styles.figVal}>${Number(l.provider_net ?? 0).toFixed(0)}</Text></View>
                      <View style={styles.figure}><Text style={styles.figLabel}>Driver</Text><Text style={[styles.figVal, { color: C.accent }]}>${pay.toFixed(0)}</Text></View>
                      <View style={styles.figure}><Text style={styles.figLabel}>Fuel</Text><Text style={styles.figVal}>${Number(l.fuel_cost ?? 0).toFixed(0)}</Text></View>
                      <View style={styles.figure}><Text style={styles.figLabel}>Profit</Text><Text style={[styles.figVal, { color: profit >= 0 ? C.green : C.red }]}>${profit.toFixed(0)}</Text></View>
                    </View>
                    <View style={styles.loadActions}>
                      <TouchableOpacity style={styles.planBtn} onPress={() => openEdit(l)}>
                        <Coins size={13} color={C.accent} />
                        <Text style={styles.planBtnText}>{hasPlan ? `${l.driver_pay_type === 'Percent' ? l.driver_pay_value + '%' : '$' + l.driver_pay_value}` : 'Set pay'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.settleBtn, l.driver_settled && styles.settleBtnOn]} disabled={markSettled.isPending} onPress={() => toggleSettled(l)}>
                        {l.driver_settled ? <CheckCircle2 size={14} color={C.white} /> : <Circle size={14} color={C.textSecondary} />}
                        <Text style={[styles.settleBtnText, l.driver_settled && { color: C.white }]}>{l.driver_settled ? 'Paid' : 'Mark paid'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Driver pay plan</Text>
              <TouchableOpacity onPress={() => setEditing(null)} style={styles.modalClose}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <View style={styles.segment}>
              {(['Percent', 'Flat'] as const).map((t) => (
                <TouchableOpacity key={t} style={[styles.segBtn, payType === t && styles.segBtnOn]} onPress={() => setPayType(t)}>
                  <Text style={[styles.segText, payType === t && styles.segTextOn]}>{t === 'Percent' ? '% of net' : 'Flat rate'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.inputLabel}>{payType === 'Percent' ? 'Percent of carrier net (%)' : 'Flat trip amount ($)'}</Text>
            <TextInput value={payValue} onChangeText={setPayValue} keyboardType="numeric" placeholder={payType === 'Percent' ? 'e.g. 70' : 'e.g. 850'} placeholderTextColor={C.textMuted} style={styles.input} />
            <Text style={styles.inputLabel}>Fuel cost for this trip ($)</Text>
            <TextInput value={fuel} onChangeText={setFuel} keyboardType="numeric" placeholder="e.g. 220" placeholderTextColor={C.textMuted} style={styles.input} />
            {editing ? (
              <View style={styles.previewRow}>
                <Text style={styles.previewText}>Driver gets ${driverPay({ ...editing, driver_pay_type: payValue.trim() === '' ? null : payType, driver_pay_value: payValue.trim() === '' ? null : Number(payValue) }).toFixed(0)} · Profit ${tripProfit({ ...editing, driver_pay_type: payValue.trim() === '' ? null : payType, driver_pay_value: payValue.trim() === '' ? null : Number(payValue), fuel_cost: fuel.trim() === '' ? 0 : Number(fuel) }).toFixed(0)}</Text>
              </View>
            ) : null}
            <TouchableOpacity style={[styles.saveBtn, setSettlement.isPending && { opacity: 0.6 }]} disabled={setSettlement.isPending} onPress={savePlan}>
              <Text style={styles.saveBtnText}>{setSettlement.isPending ? 'Saving…' : 'Save pay plan'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 14 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sumCard: { width: '47%', flexGrow: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, gap: 4 },
  sumValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sumLabel: { fontSize: 12, color: C.textSecondary },
  filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: C.accent, borderColor: C.accent },
  checkboxTick: { color: C.white, fontSize: 12, fontWeight: '900' as const },
  filterToggleText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  group: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 12 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupAvatar: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  groupName: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  groupMeta: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  unpaidTag: { backgroundColor: C.yellow + '1E', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  unpaidTagText: { fontSize: 11.5, fontWeight: '800' as const, color: C.yellow },
  loadRow: { backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12, gap: 10 },
  loadTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vehBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  vehBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  loadRoute: { flex: 1, fontSize: 12.5, color: C.textSecondary },
  figuresRow: { flexDirection: 'row', gap: 8 },
  figure: { flex: 1 },
  figLabel: { fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  figVal: { fontSize: 14, fontWeight: '800' as const, color: C.text, marginTop: 2 },
  loadActions: { flexDirection: 'row', gap: 8 },
  planBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 9, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55' },
  planBtnText: { fontSize: 12.5, fontWeight: '800' as const, color: C.accent },
  settleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  settleBtnOn: { backgroundColor: C.green, borderColor: C.green },
  settleBtnText: { fontSize: 12.5, fontWeight: '800' as const, color: C.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, borderTopWidth: 1, borderColor: C.border, gap: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalClose: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segBtnOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  segText: { fontSize: 13.5, fontWeight: '800' as const, color: C.textSecondary },
  segTextOn: { color: C.accent },
  inputLabel: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, height: 48, color: C.text, fontSize: 15 },
  previewRow: { backgroundColor: C.greenDim, borderRadius: 10, padding: 12 },
  previewText: { fontSize: 13, fontWeight: '700' as const, color: C.green },
  saveBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, marginTop: 2 },
  saveBtnText: { fontSize: 15, fontWeight: '800' as const, color: C.white },
});
