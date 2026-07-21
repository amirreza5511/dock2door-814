import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Navigation, PackageCheck, Truck, Store, Package, CircleDot } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { trackingUrl } from '@/constants/couriers';
import { trpc } from '@/lib/trpc';
import { useExploreStore } from '@/store/explore';

interface Parcel {
  id: string;
  tracking_number: string;
  status: string;
  to_name: string;
  to_city: string;
  from_city: string;
  created_at: string;
}

const STEPS = [
  { key: 'Created', label: 'Label created', icon: Package },
  { key: 'DroppedOff', label: 'Dropped off', icon: Store },
  { key: 'InTransit', label: 'In transit', icon: Truck },
  { key: 'Delivered', label: 'Delivered', icon: PackageCheck },
] as const;

const STATUS_ORDER: Record<string, number> = {
  Created: 0, DroppedOff: 1, InTransit: 2, Delivered: 3, Cancelled: -1,
};

export default function ShipTrack() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const isExploring = useExploreStore((s) => s.isExploring);

  const [code, setCode] = useState<string>(params.code ?? '');

  const mineQuery = trpc.parcel.mine.useQuery(undefined, { enabled: !isExploring, retry: false });
  const parcels = (mineQuery.data as Parcel[] | undefined) ?? [];

  const match = useMemo(() => {
    const q = code.trim().toLowerCase();
    if (!q) return null;
    return parcels.find((p) => p.tracking_number?.toLowerCase() === q) ?? null;
  }, [code, parcels]);

  const currentStep = match ? STATUS_ORDER[match.status] ?? 0 : -2;
  const cancelled = match?.status === 'Cancelled';

  const openCarrier = () => {
    const q = code.trim();
    if (!q) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Linking.openURL(trackingUrl(q)).catch(() => {});
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Track a parcel</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>TRACKING NUMBER</Text>
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="Enter or paste a tracking number"
          autoCapitalize="characters"
        />

        <View style={{ marginTop: 14 }}>
          <Button
            label="Open on carrier site"
            onPress={openCarrier}
            disabled={!code.trim()}
            fullWidth
            variant="secondary"
            icon={<Navigation size={16} color={C.accent} />}
          />
        </View>

        {code.trim() && match ? (
          <View style={styles.timelineCard}>
            <View style={styles.timelineHead}>
              <Text style={styles.timelineTitle} numberOfLines={1}>{match.to_name || 'Shipment'}</Text>
              <Text style={styles.timelineSub} numberOfLines={1}>
                {[match.from_city, match.to_city].filter(Boolean).join('  →  ')}
              </Text>
            </View>

            {cancelled ? (
              <View style={styles.cancelledRow}>
                <CircleDot size={18} color={C.red} />
                <Text style={styles.cancelledText}>This shipment was cancelled.</Text>
              </View>
            ) : (
              STEPS.map((s, i) => {
                const done = i <= currentStep;
                const active = i === currentStep;
                return (
                  <View key={s.key} style={styles.stepRow}>
                    <View style={styles.stepRail}>
                      <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                        <s.icon size={14} color={done ? C.white : C.textMuted} />
                      </View>
                      {i < STEPS.length - 1 ? <View style={[styles.stepLine, i < currentStep && styles.stepLineDone]} /> : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 18 }}>
                      <Text style={[styles.stepLabel, done && { color: C.text }]}>{s.label}</Text>
                      {active ? <Text style={styles.stepNow}>Current status</Text> : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : code.trim() && !isExploring && !mineQuery.isLoading ? (
          <View style={styles.notFound}>
            <Text style={styles.notFoundText}>
              We couldn’t find that tracking number in your shipments. It may belong to another account — tap “Open on carrier site” to check with the courier.
            </Text>
          </View>
        ) : null}

        {isExploring ? (
          <Text style={styles.hint}>Sign in to see a live status timeline for your own shipments.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 10 },
  timelineCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 18, marginTop: 24 },
  timelineHead: { marginBottom: 18 },
  timelineTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  timelineSub: { fontSize: 12, color: C.textMuted, marginTop: 3 },
  stepRow: { flexDirection: 'row', gap: 14 },
  stepRail: { alignItems: 'center' },
  stepDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  stepDotDone: { backgroundColor: C.accent, borderColor: C.accent },
  stepDotActive: { backgroundColor: C.accent, borderColor: C.accentLight },
  stepLine: { width: 2, flex: 1, backgroundColor: C.border, marginVertical: 2 },
  stepLineDone: { backgroundColor: C.accent },
  stepLabel: { fontSize: 14, fontWeight: '700' as const, color: C.textMuted, marginTop: 6 },
  stepNow: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  cancelledRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelledText: { fontSize: 14, color: C.red, fontWeight: '600' as const },
  notFound: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginTop: 24 },
  notFoundText: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  hint: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
