import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Anchor, ArrowLeft, Building2, ExternalLink, MapPin, Ship, Train, X } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import EmptyState from '@/components/ui/EmptyState';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const TYPE_ICON: Record<string, any> = {
  Port: Ship,
  Rail: Train,
  Depot: Building2,
  Warehouse: Building2,
  Yard: Anchor,
};
const TYPE_COLOR: Record<string, string> = {
  Port: C.blue,
  Rail: C.green,
  Depot: C.yellow,
  Warehouse: C.accent,
  Yard: C.purple,
};

export default function TerminalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const terminalsQuery = trpc.drayage.listTerminals.useQuery({ type: typeFilter, search });

  const terminals = useMemo(() => (terminalsQuery.data ?? []) as any[], [terminalsQuery.data]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Terminals</Text>
          <Text style={styles.headerSub}>BC Ports · CN · CP Rail · Depots</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <Input
          placeholder="Search terminals..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={styles.filterRow}>
        {['all', 'Port', 'Rail', 'Depot', 'Yard'].map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTypeFilter(t)}
            style={[styles.filterPill, typeFilter === t && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, typeFilter === t && styles.filterPillTextActive]}>
              {t === 'all' ? 'All' : t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={terminalsQuery.isFetching} onRefresh={() => void terminalsQuery.refetch()} tintColor={C.accent} />}
      >
        {terminalsQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading terminals" />
        ) : terminalsQuery.isError ? (
          <ScreenFeedback state="error" title="Unable to load terminals" onRetry={() => void terminalsQuery.refetch()} />
        ) : terminals.length === 0 ? (
          <EmptyState icon={Anchor} title="No terminals found" description="Try a different search or filter." />
        ) : terminals.map((t) => {
          const Icon = TYPE_ICON[t.terminal_type] ?? Building2;
          const color = TYPE_COLOR[t.terminal_type] ?? C.blue;
          return (
            <Card key={t.id} style={styles.terminalCard}>
              <View style={styles.terminalTop}>
                <View style={[styles.terminalIcon, { backgroundColor: color + '20' }]}>
                  <Icon size={20} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.terminalName}>{t.name}</Text>
                  <Text style={styles.terminalCode}>{t.code} · {t.operator}</Text>
                </View>
                <View style={[styles.typeBadge, { backgroundColor: color + '20' }]}>
                  <Text style={[styles.typeBadgeText, { color }]}>{t.terminal_type}</Text>
                </View>
              </View>
              <View style={styles.terminalMeta}>
                <View style={styles.metaItem}>
                  <MapPin size={12} color={C.textMuted} />
                  <Text style={styles.metaText}>{t.address || t.city || '—'}</Text>
                </View>
                {t.hours ? (
                  <View style={styles.metaItem}>
                    <Text style={styles.metaText}>{t.hours}</Text>
                  </View>
                ) : null}
              </View>
              {t.portal_url ? (
                <TouchableOpacity
                  style={styles.portalBtn}
                  onPress={() => void Linking.openURL(t.portal_url)}
                >
                  <Text style={styles.portalBtnText}>Port Portal</Text>
                  <ExternalLink size={14} color={C.accent} />
                </TouchableOpacity>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  searchRow: { paddingHorizontal: 20, paddingTop: 14 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12, flexWrap: 'wrap' as const },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterPillActive: { backgroundColor: C.accent, borderColor: C.accent },
  filterPillText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
  filterPillTextActive: { color: C.white },
  scroll: { paddingHorizontal: 20, gap: 10, paddingTop: 4 },
  terminalCard: { gap: 10 },
  terminalTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  terminalIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  terminalName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  terminalCode: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '800' as const, textTransform: 'uppercase' as const },
  terminalMeta: { gap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: C.textMuted },
  portalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accentDim, borderRadius: 10, paddingVertical: 10 },
  portalBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
});
