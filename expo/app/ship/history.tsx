import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, History, Trash2, Package, BadgeCheck } from 'lucide-react-native';
import C from '@/constants/colors';
import { useShipStore, type QuoteHistoryEntry } from '@/store/shipStore';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function ShipHistory() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hydrate = useShipStore((s) => s.hydrate);
  const history = useShipStore((s) => s.history);
  const clearHistory = useShipStore((s) => s.clearHistory);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quote history</Text>
        {history.length > 0 ? (
          <TouchableOpacity onPress={clearHistory} style={styles.iconBtn} hitSlop={8}>
            <Trash2 size={20} color={C.red} />
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {history.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><History size={30} color={C.textMuted} /></View>
            <Text style={styles.emptyTitle}>No quotes yet</Text>
            <Text style={styles.emptyDesc}>Every time you compare couriers, the best price shows up here so you can revisit it.</Text>
          </View>
        ) : (
          history.map((h) => <HistoryRow key={h.id} h={h} onPress={() => router.push('/ship/quote' as never)} />)
        )}
      </ScrollView>
    </View>
  );
}

function HistoryRow({ h, onPress }: { h: QuoteHistoryEntry; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.cardIcon}><Package size={18} color={C.accent} /></View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{h.bestCourier}</Text>
          {h.isLive ? (
            <View style={styles.liveTag}><BadgeCheck size={11} color={C.green} /><Text style={styles.liveText}>Live</Text></View>
          ) : <Text style={styles.estTag}>Est.</Text>}
        </View>
        <Text style={styles.cardSub} numberOfLines={1}>
          {h.length}×{h.width}×{h.height}cm · {h.weight}kg · {h.service}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {[h.fromPostal, h.toCity || h.toPostal].filter(Boolean).join('  →  ') || 'No route'} · {timeAgo(h.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={styles.cardPrice}>{h.currency} {h.bestPrice.toFixed(2)}</Text>
        <ChevronRight size={16} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  cardIcon: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  liveText: { fontSize: 10, color: C.green, fontWeight: '700' as const },
  estTag: { fontSize: 10, color: C.textMuted, fontWeight: '700' as const, backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  cardSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  cardPrice: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 10, paddingHorizontal: 20 },
});
