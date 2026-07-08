import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Activity, BarChart3, Building2, DollarSign, Eye, MousePointerClick, Percent, TrendingUp } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const money = (n: number): string => `$${Math.round(n).toLocaleString()}`;
const num = (n: number): string => Math.round(n).toLocaleString();

export default function SuperAdminAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const analyticsQuery = trpc.analytics.overview.useQuery();

  if (analyticsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading report" /></View>;
  }

  if (analyticsQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load report" onRetry={() => void analyticsQuery.refetch()} /></View>;
  }

  const data = analyticsQuery.data;
  const commission = data?.commission ?? { trucking: 0, warehouse: 0, service: 0, labour: 0, advertising: 0, other: 0, total: 0 };
  const ads = data?.ads ?? { active: 0, total: 0, impressions: 0, clicks: 0, revenue: 0 };
  const ctr = ads.impressions > 0 ? ((ads.clicks / ads.impressions) * 100).toFixed(2) : '0.00';

  const hero = [
    { label: 'Platform revenue', value: money(data?.revenue ?? 0), icon: DollarSign, hint: 'Commission earned' },
    { label: 'GMV', value: money(data?.grossBookingValue ?? 0), icon: TrendingUp, hint: 'Gross value processed' },
    { label: 'Jobs run', value: num(data?.bookingVolume ?? 0), icon: BarChart3, hint: 'All job types' },
    { label: 'Utilization', value: `${data?.utilizationRate ?? 0}%`, icon: Percent, hint: 'Completed / total' },
  ];

  const commissionRows: { label: string; value: number; color: string }[] = [
    { label: 'Trucking', value: commission.trucking, color: '#38bdf8' },
    { label: 'Warehouse', value: commission.warehouse, color: '#34d399' },
    { label: 'Services', value: commission.service, color: '#fbbf24' },
    { label: 'Labour', value: commission.labour, color: '#a78bfa' },
    { label: 'Advertising', value: commission.advertising, color: '#f472b6' },
    { label: 'Other', value: commission.other, color: '#94a3b8' },
  ];
  const commissionMax = Math.max(1, ...commissionRows.map((r) => r.value));

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={analyticsQuery.isFetching} onRefresh={() => void analyticsQuery.refetch()} tintColor={C.accent} />}
      >
        <Text style={styles.title}>Overall report</Text>
        <Text style={styles.subtitle}>Live revenue, delivery, and performance across the whole platform.</Text>

        <View style={styles.heroGrid}>
          {hero.map((h) => {
            const Icon = h.icon;
            return (
              <Card key={h.label} style={styles.heroCard}>
                <View style={styles.iconWrap}><Icon size={16} color={C.accent} /></View>
                <Text style={styles.heroValue}>{h.value}</Text>
                <Text style={styles.heroLabel}>{h.label}</Text>
                <Text style={styles.heroHint}>{h.hint}</Text>
              </Card>
            );
          })}
        </View>

        <Text style={styles.section}>Revenue by area</Text>
        <Card style={styles.blockCard}>
          {commissionRows.map((r) => (
            <View key={r.label} style={styles.barRow}>
              <View style={styles.barHead}>
                <Text style={styles.barLabel}>{r.label}</Text>
                <Text style={styles.barValue}>{money(r.value)}</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max(2, (r.value / commissionMax) * 100)}%`, backgroundColor: r.color }]} />
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total commission</Text>
            <Text style={styles.totalValue}>{money(commission.total)}</Text>
          </View>
        </Card>

        <Text style={styles.section}>Advertising</Text>
        <View style={styles.statGrid}>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><DollarSign size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{money(ads.revenue)}</Text>
            <Text style={styles.statLabel}>Ad revenue</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><Activity size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{ads.active}/{ads.total}</Text>
            <Text style={styles.statLabel}>Active ads</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><Eye size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{num(ads.impressions)}</Text>
            <Text style={styles.statLabel}>Impressions</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><MousePointerClick size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{num(ads.clicks)}</Text>
            <Text style={styles.statLabel}>Clicks · {ctr}% CTR</Text>
          </Card>
        </View>

        <Text style={styles.section}>Operations</Text>
        <View style={styles.statGrid}>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><Building2 size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{num(data?.activeCompanies ?? 0)}</Text>
            <Text style={styles.statLabel}>Active companies</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><BarChart3 size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{num(data?.completedJobs ?? 0)}</Text>
            <Text style={styles.statLabel}>Completed jobs</Text>
          </Card>
          <Card style={styles.statCard}>
            <View style={styles.iconWrap}><Activity size={16} color={C.accent} /></View>
            <Text style={styles.statValue}>{num(data?.openDisputes ?? 0)}</Text>
            <Text style={styles.statLabel}>Open disputes</Text>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 8 },
  title: { fontSize: 26, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 8 },
  section: { fontSize: 15, fontWeight: '800' as const, color: C.text, marginTop: 18, marginBottom: 8 },
  heroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  heroCard: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  iconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim, marginBottom: 6 },
  heroValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  heroLabel: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  heroHint: { fontSize: 11, color: C.textSecondary },
  blockCard: { gap: 14 },
  barRow: { gap: 6 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  barValue: { fontSize: 13, color: C.textSecondary, fontWeight: '700' as const },
  barTrack: { height: 8, borderRadius: 6, backgroundColor: C.accentDim, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 12 },
  totalLabel: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  totalValue: { fontSize: 18, color: C.accent, fontWeight: '800' as const },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flexBasis: '47%', flexGrow: 1, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 12, color: C.textSecondary },
});
