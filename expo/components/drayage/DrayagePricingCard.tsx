import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { DollarSign, MapPin, Check, Fuel, Clock, Package } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Props = {
  orderId: string;
  order: any;
  /** Whether the current viewer may lock the price onto the order. */
  canApply?: boolean;
};

type ZoneRate = { zone_id: string; base_rate: number };
type RateCard = {
  currency: string;
  fuel_surcharge_pct: number;
  prepull_fee: number;
  drop_pick_fee: number;
  chassis_per_day: number;
  waiting_free_min: number;
  waiting_per_hour: number;
  hourly_rate: number;
  hazmat_fee: number;
  overweight_fee: number;
};

const money = (n: number, ccy: string): string => `${ccy} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Shows the drayage company's published pricing for an order: the base rate for
 * each zone, plus fuel/prepull/waiting accessorials, and (for authorized users)
 * a button to lock the charge onto the order.
 */
export default function DrayagePricingCard({ orderId, order, canApply = false }: Props) {
  const utils = trpc.useUtils();
  const ratesQuery = trpc.drayage.rateCardForOrder.useQuery({ orderId });
  const applyMutation = trpc.drayage.applyRate.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.getOrderDetails.invalidate({ id: orderId });
    },
  });

  const card = ratesQuery.data?.card as RateCard | null | undefined;
  const zones = useMemo(() => (ratesQuery.data?.zones ?? []) as { id: string; name: string }[], [ratesQuery.data]);
  const zoneRates = useMemo(() => (ratesQuery.data?.zoneRates ?? []) as ZoneRate[], [ratesQuery.data]);

  const [selectedZone, setSelectedZone] = useState<string | null>(order?.zone_id ?? null);

  const ccy = card?.currency ?? order?.currency ?? 'CAD';

  const estimate = useMemo(() => {
    if (!card || !selectedZone) return null;
    const base = zoneRates.find((r) => r.zone_id === selectedZone)?.base_rate ?? 0;
    const fuel = Math.round((base * (card.fuel_surcharge_pct ?? 0) / 100) * 100) / 100;
    const accessorials =
      (order?.is_prepull ? card.prepull_fee ?? 0 : 0) +
      (order?.handling_mode === 'DropPick' ? card.drop_pick_fee ?? 0 : 0) +
      (order?.is_hazmat ? card.hazmat_fee ?? 0 : 0) +
      (order?.is_overweight ? card.overweight_fee ?? 0 : 0) +
      (card.chassis_per_day ?? 0);
    return { base, fuel, accessorials, total: base + fuel + accessorials };
  }, [card, selectedZone, zoneRates, order]);

  const applied = (order?.total_price ?? 0) > 0 && order?.zone_id;

  const onApply = () => {
    if (!selectedZone) { Alert.alert('Pick a zone', 'Select a delivery zone to price this order.'); return; }
    void applyMutation.mutateAsync({ orderId, zoneId: selectedZone }).catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  };

  if (ratesQuery.isLoading) return null;

  // No published rates for this company yet.
  if (!card) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <DollarSign size={16} color={C.green} />
          <Text style={styles.title}>Pricing</Text>
        </View>
        <Text style={styles.muted}>This drayage company hasn't published a rate card yet. The price will be agreed via quote.</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <DollarSign size={16} color={C.green} />
        <Text style={styles.title}>Pricing</Text>
        {applied ? <View style={styles.appliedBadge}><Check size={11} color={C.green} /><Text style={styles.appliedText}>Charged</Text></View> : null}
      </View>

      {/* Applied total (if any) */}
      {applied ? (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total charge</Text>
          <Text style={styles.totalValue}>{money(order.total_price, ccy)}</Text>
        </View>
      ) : null}

      {/* Zone selector */}
      <Text style={styles.subLabel}>Delivery zone</Text>
      {zones.length === 0 ? (
        <Text style={styles.muted}>No zones published yet.</Text>
      ) : (
        <View style={styles.zoneWrap}>
          {zones.map((z) => {
            const rate = zoneRates.find((r) => r.zone_id === z.id)?.base_rate ?? 0;
            const active = selectedZone === z.id;
            return (
              <TouchableOpacity
                key={z.id}
                onPress={() => setSelectedZone(z.id)}
                style={[styles.zoneChip, active && styles.zoneChipActive]}
                activeOpacity={0.8}
              >
                <MapPin size={13} color={active ? C.white : C.blue} />
                <Text style={[styles.zoneChipText, active && { color: C.white }]}>{z.name}</Text>
                <Text style={[styles.zoneChipRate, active && { color: C.white }]}>{rate ? money(rate, ccy) : '—'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Estimate breakdown */}
      {estimate ? (
        <View style={styles.breakdown}>
          <Row label="Base linehaul" value={money(estimate.base, ccy)} />
          {estimate.fuel > 0 ? <Row icon={<Fuel size={12} color={C.orange} />} label={`Fuel (${card.fuel_surcharge_pct}%)`} value={money(estimate.fuel, ccy)} /> : null}
          {order?.is_prepull && card.prepull_fee > 0 ? <Row icon={<Clock size={12} color={C.purple} />} label="Prepull" value={money(card.prepull_fee, ccy)} /> : null}
          {order?.handling_mode === 'DropPick' && card.drop_pick_fee > 0 ? <Row label="Drop & pick" value={money(card.drop_pick_fee, ccy)} /> : null}
          {order?.is_hazmat && card.hazmat_fee > 0 ? <Row icon={<Package size={12} color={C.yellow} />} label="Hazmat" value={money(card.hazmat_fee, ccy)} /> : null}
          {order?.is_overweight && card.overweight_fee > 0 ? <Row label="Overweight" value={money(card.overweight_fee, ccy)} /> : null}
          {card.chassis_per_day > 0 ? <Row label="Chassis / day" value={money(card.chassis_per_day, ccy)} /> : null}
          <View style={styles.divider} />
          <Row label="Estimated total" value={money(estimate.total, ccy)} bold />
        </View>
      ) : (
        <Text style={styles.muted}>Select a zone to see the estimated charge.</Text>
      )}

      {/* Accessorial reference */}
      {(card.waiting_per_hour > 0 || card.hourly_rate > 0) ? (
        <Text style={styles.footnote}>
          {card.waiting_per_hour > 0 ? `Waiting: ${card.waiting_free_min} min free, then ${money(card.waiting_per_hour, ccy)}/hr. ` : ''}
          {card.hourly_rate > 0 ? `Hourly work: ${money(card.hourly_rate, ccy)}/hr.` : ''}
        </Text>
      ) : null}

      {canApply && estimate ? (
        <Button
          label={applied ? 'Update charge' : 'Apply this charge'}
          onPress={onApply}
          loading={applyMutation.isPending}
          fullWidth
          size="md"
          icon={<Check size={15} color={C.white} />}
        />
      ) : null}
    </Card>
  );
}

function Row({ label, value, bold, icon }: { label: string; value: string; bold?: boolean; icon?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        {icon}
        <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      </View>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  appliedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.greenDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  appliedText: { fontSize: 10, fontWeight: '800' as const, color: C.green },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenDim, borderRadius: 12, padding: 14 },
  totalLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  totalValue: { fontSize: 20, fontWeight: '800' as const, color: C.green, letterSpacing: -0.5 },
  subLabel: { fontSize: 11, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: '700' as const },
  muted: { fontSize: 12, color: C.textMuted, lineHeight: 18 },
  zoneWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  zoneChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  zoneChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  zoneChipText: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  zoneChipRate: { fontSize: 12, fontWeight: '800' as const, color: C.green },
  breakdown: { backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: { fontSize: 13, color: C.textSecondary },
  rowValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  rowBold: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  divider: { height: 1, backgroundColor: C.border },
  footnote: { fontSize: 11, color: C.textMuted, lineHeight: 16, fontStyle: 'italic' as const },
});
