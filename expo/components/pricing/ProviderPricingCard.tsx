import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DollarSign, MapPin } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { Accessorial, PricingVertical } from '@/constants/pricing';

type ZoneRate = { zone_id: string; base_rate: number };
type RateCard = {
  id: string;
  currency: string;
  base_unit: string;
  accessorials: Accessorial[];
};

type Props = {
  /** The provider company whose rates apply. */
  companyId: string | null | undefined;
  vertical: PricingVertical;
  /** Optional customer company to resolve a private negotiated card. */
  customerCompanyId?: string | null;
  /** Preselected zone id, if any. */
  initialZoneId?: string | null;
  title?: string;
};

const money = (n: number, ccy: string): string =>
  `${ccy} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Customer-facing pricing card for any provider vertical. Shows the provider's
 * published base rate per zone plus their extra fees, lets the viewer pick a
 * zone and toggle applicable add-ons, and renders an itemized estimate computed
 * authoritatively on the server.
 */
export default function ProviderPricingCard({ companyId, vertical, customerCompanyId, initialZoneId, title = 'Pricing' }: Props) {
  const ratesQuery = trpc.pricing.cardForCompany.useQuery(
    { companyId: companyId ?? '', vertical, customerCompanyId: customerCompanyId ?? null },
    { enabled: !!companyId },
  );

  const card = ratesQuery.data?.card as RateCard | null | undefined;
  const zones = useMemo(() => (ratesQuery.data?.zones ?? []) as { id: string; name: string }[], [ratesQuery.data]);
  const zoneRates = useMemo(() => (ratesQuery.data?.zoneRates ?? []) as ZoneRate[], [ratesQuery.data]);
  const accessorials = useMemo<Accessorial[]>(() => (Array.isArray(card?.accessorials) ? (card?.accessorials as Accessorial[]) : []), [card]);

  const [selectedZone, setSelectedZone] = useState<string | null>(initialZoneId ?? null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const ccy = card?.currency ?? 'CAD';

  const estimate = useMemo(() => {
    if (!card) return null;
    const base = selectedZone ? (zoneRates.find((r) => r.zone_id === selectedZone)?.base_rate ?? 0) : 0;
    const lines: { key: string; label: string; amount: number }[] = [{ key: 'base', label: 'Base rate', amount: base }];
    let total = base;
    for (const a of accessorials) {
      if (!selected[a.key]) continue;
      let amt = 0;
      if (a.type === 'pct') amt = Math.round((base * (a.amount ?? 0) / 100) * 100) / 100;
      else amt = a.amount ?? 0; // flat / perUnit / perHour shown at 1 unit as an estimate
      if (amt === 0) continue;
      lines.push({ key: a.key, label: a.label, amount: amt });
      total += amt;
    }
    return { base, lines, total };
  }, [card, selectedZone, zoneRates, accessorials, selected]);

  if (ratesQuery.isLoading || !companyId) return null;

  if (!card) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <DollarSign size={16} color={C.green} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.muted}>This provider hasn&apos;t published a rate card yet. The price will be agreed via quote.</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <DollarSign size={16} color={C.green} />
        <Text style={styles.title}>{title}</Text>
        {card.base_unit ? <Text style={styles.unit}>{card.base_unit}</Text> : null}
      </View>

      {/* Zone selector */}
      <Text style={styles.subLabel}>Select</Text>
      {zones.length === 0 ? (
        <Text style={styles.muted}>No pricing rows published yet.</Text>
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

      {/* Add-on toggles */}
      {accessorials.length > 0 ? (
        <>
          <Text style={styles.subLabel}>Add-ons</Text>
          <View style={styles.zoneWrap}>
            {accessorials.map((a) => {
              const active = !!selected[a.key];
              const suffix = a.type === 'pct' ? `${a.amount}%` : money(a.amount ?? 0, ccy);
              return (
                <TouchableOpacity
                  key={a.key}
                  onPress={() => setSelected((m) => ({ ...m, [a.key]: !m[a.key] }))}
                  style={[styles.addonChip, active && styles.addonChipActive]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.addonText, active && { color: C.white }]}>{a.label}</Text>
                  <Text style={[styles.addonRate, active && { color: C.white }]}>{suffix}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Estimate breakdown */}
      {estimate && selectedZone ? (
        <View style={styles.breakdown}>
          {estimate.lines.map((l) => (
            <View key={l.key} style={styles.row}>
              <Text style={styles.rowLabel}>{l.label}</Text>
              <Text style={styles.rowValue}>{money(l.amount, ccy)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowBold}>Estimated total</Text>
            <Text style={styles.rowBold}>{money(estimate.total, ccy)}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.muted}>Select an option to see the estimated charge.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  unit: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  subLabel: { fontSize: 11, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: '700' as const },
  muted: { fontSize: 12, color: C.textMuted, lineHeight: 18 },
  zoneWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  zoneChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  zoneChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  zoneChipText: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  zoneChipRate: { fontSize: 12, fontWeight: '800' as const, color: C.green },
  addonChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  addonChipActive: { backgroundColor: C.blue, borderColor: C.blue },
  addonText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  addonRate: { fontSize: 11, fontWeight: '800' as const, color: C.textMuted },
  breakdown: { backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 13, color: C.textSecondary },
  rowValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  rowBold: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  divider: { height: 1, backgroundColor: C.border },
});
