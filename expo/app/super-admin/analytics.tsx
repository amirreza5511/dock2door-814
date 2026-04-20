import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarChart3 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function SuperAdminAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const analyticsQuery = trpc.analytics.overview.useQuery();

  if (analyticsQuery.isLoading) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading analytics" /></View>;
  }

  if (analyticsQuery.isError) {
    return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load analytics" onRetry={() => void analyticsQuery.refetch()} /></View>;
  }

  const data = analyticsQuery.data;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}> 
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>Live utilization, revenue, and performance snapshots.</Text>
        {[
          ['Booking volume', data?.bookingVolume ?? 0],
          ['Revenue', `$${data?.revenue ?? 0}`],
          ['Utilization', `${data?.utilizationRate ?? 0}%`],
          ['Performance', data?.companyPerformance ?? 0],
          ['GMV', `$${data?.grossBookingValue ?? 0}`],
        ].map(([label, value]) => (
          <Card key={String(label)} style={styles.card}>
            <View style={styles.iconWrap}><BarChart3 size={16} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{label}</Text>
              <Text style={styles.cardValue}>{value}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 8 },
  card: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  cardTitle: { fontSize: 13, color: C.textSecondary },
  cardValue: { fontSize: 18, color: C.text, fontWeight: '800' as const, marginTop: 2 },
});
