import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Globe, LogOut, Ship, Plane, Truck, Boxes, Plus, Package, ChevronRight } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import {
  freightRoleKind, FREIGHT_STATUS_META, FREIGHT_MODE_LABEL,
  type FreightMode, type FreightQuoteStatus,
} from '@/constants/globalFreight';
import { formatMoney } from '@/constants/world';
import FreightQuoteWizard from '@/components/FreightQuoteWizard';
import FreightProviderBoard from '@/components/FreightProviderBoard';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import { useExploreStore } from '@/store/explore';
import { SAMPLE_FREIGHT_QUOTES } from '@/lib/exploreSamples';

type FreightRequest = {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_country: string; origin_city: string; origin_port: string;
  dest_country: string; dest_city: string; dest_port: string;
  weight: number; weight_unit: string; volume: number; pieces: number;
  commodity: string; declared_value: number; currency: string;
  delivery_method: string; needs_container_pickup: boolean;
  status: FreightQuoteStatus; rejected_reason: string;
  awarded_amount: number; awarded_name: string;
  ground_awarded_amount: number; ground_awarded_name: string;
  offer_count: number; ground_offer_count: number; doc_count: number;
  created_at: string;
};

const TONE_COLOR: Record<'warning' | 'info' | 'success' | 'danger' | 'neutral', string> = {
  warning: C.yellow, info: C.blue, success: C.green, danger: C.red, neutral: C.textMuted,
};

function StatusPill({ status }: { status: FreightQuoteStatus }) {
  const meta = FREIGHT_STATUS_META[status];
  const color = TONE_COLOR[meta.tone];
  return (
    <View style={[styles.pill, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{meta.label}</Text>
    </View>
  );
}

export default function GlobalFreightHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const utils = trpc.useUtils();

  const isExploring = useExploreStore((s) => s.isExploring);
  const exploreRole = useExploreStore((s) => s.exploreRole);
  const kind = useMemo(() => freightRoleKind((isExploring ? exploreRole : user?.role) ?? undefined), [user?.role, isExploring, exploreRole]);
  const isCustomer = kind === 'customer';
  const isProvider = kind === 'freight' || kind === 'ground';

  const [wizardOpen, setWizardOpen] = useState<boolean>(false);

  const mineQuery = trpc.freight.mine.useQuery(undefined, { enabled: isCustomer && !isExploring });
  const requests = (isExploring ? (SAMPLE_FREIGHT_QUOTES as unknown as FreightRequest[]) : ((mineQuery.data ?? []) as FreightRequest[]));

  const handleSubmitted = useCallback(() => {
    setWizardOpen(false);
    void utils.freight.mine.invalidate();
  }, [utils]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <View style={styles.brandIcon}><Globe size={20} color={C.blue} /></View>
            <View>
              <Text style={styles.title}>Global Freight</Text>
              <Text style={styles.subtitle}>International shipping & freight exchange</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => logout()} style={styles.logoutBtn}>
            <LogOut size={18} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={isCustomer ? <RefreshControl refreshing={mineQuery.isRefetching} onRefresh={() => void mineQuery.refetch()} tintColor={C.textSecondary} /> : undefined}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            {isCustomer ? 'Ship anything, anywhere' : kind === 'ground' ? 'Quote container pickup legs' : 'Win worldwide freight'}
          </Text>
          <Text style={styles.heroDesc}>
            {isCustomer
              ? 'Post one request and receive competing quotes from forwarders, carriers and truckers.'
              : kind === 'ground'
                ? 'Quote the container pickup / drayage leg on approved freight requests.'
                : 'Browse approved requests and send competing quotes across every mode.'}
          </Text>
        </View>

        <View style={styles.modeRow}>
          <View style={styles.modeChip}><Plane size={16} color={C.blue} /><Text style={styles.modeChipText}>Air</Text></View>
          <View style={styles.modeChip}><Ship size={16} color={C.blue} /><Text style={styles.modeChipText}>Ocean</Text></View>
          <View style={styles.modeChip}><Truck size={16} color={C.blue} /><Text style={styles.modeChipText}>Truck</Text></View>
          <View style={styles.modeChip}><Boxes size={16} color={C.blue} /><Text style={styles.modeChipText}>FCL / LCL</Text></View>
        </View>

        {isCustomer ? (
          <>
            <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={() => setWizardOpen(true)} testID="get-freight-quote">
              <Plus size={20} color={C.white} />
              <Text style={styles.ctaText}>Get a freight quote</Text>
            </TouchableOpacity>

            <Text style={styles.listHeading}>My requests</Text>
            {!isExploring && mineQuery.isLoading ? (
              <ScreenFeedback state="loading" title="Loading your requests" />
            ) : requests.length === 0 ? (
              <View style={styles.emptyCard}>
                <Package size={28} color={C.textMuted} />
                <Text style={styles.emptyTitle}>No requests yet</Text>
                <Text style={styles.emptyDesc}>Tap “Get a freight quote” to post your first request.</Text>
              </View>
            ) : (
              requests.map((r) => (
                <TouchableOpacity key={r.id} style={styles.reqCard} activeOpacity={0.85}
                  onPress={() => router.push(`/global-freight/${r.id}` as any)}>
                  <View style={styles.reqTop}>
                    <Text style={styles.reqRef}>{r.reference_code}</Text>
                    <StatusPill status={r.status} />
                  </View>
                  <Text style={styles.reqTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={styles.reqMetaRow}>
                    <Text style={styles.reqMeta}>{FREIGHT_MODE_LABEL[r.freight_mode]}</Text>
                    <Text style={styles.reqMetaDot}>·</Text>
                    <Text style={styles.reqMeta}>{r.weight} {r.weight_unit}</Text>
                    <Text style={styles.reqMetaDot}>·</Text>
                    <Text style={styles.reqMeta}>{r.pieces} pcs</Text>
                  </View>
                  <View style={styles.reqFooter}>
                    <Text style={styles.reqOffers}>
                      {r.status === 'Accepted' && r.awarded_amount > 0
                        ? `Booked · ${formatMoney(r.awarded_amount, r.currency)}`
                        : `${r.offer_count} quote${r.offer_count === 1 ? '' : 's'}`}
                      {r.needs_container_pickup ? ` · ${r.ground_offer_count} ground` : ''}
                    </Text>
                    <ChevronRight size={18} color={C.textMuted} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : isProvider ? (
          <View style={styles.boardWrap}>
            <FreightProviderBoard kind={kind === 'ground' ? 'ground' : 'freight'} />
          </View>
        ) : (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Sign in as an importer/exporter, forwarder, carrier or trucker to use Global Freight.
            </Text>
          </View>
        )}
      </ScrollView>

      <FreightQuoteWizard visible={wizardOpen} onClose={() => setWizardOpen(false)} onSubmitted={handleSubmitted} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  scroll: { padding: 20, gap: 18 },
  hero: { gap: 8 },
  heroTitle: { fontSize: 26, fontWeight: '800' as const, color: C.text },
  heroDesc: { fontSize: 15, lineHeight: 22, color: C.textSecondary },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modeChipText: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.blue, paddingVertical: 16, borderRadius: 14 },
  ctaText: { fontSize: 16, fontWeight: '800' as const, color: C.white },
  listHeading: { fontSize: 16, fontWeight: '800' as const, color: C.text, marginTop: 4 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 28, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
  reqCard: { gap: 8, padding: 16, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  reqTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqRef: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, letterSpacing: 0.5 },
  reqTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  reqMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reqMeta: { fontSize: 13, color: C.textSecondary },
  reqMetaDot: { fontSize: 13, color: C.textMuted },
  reqFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  reqOffers: { fontSize: 13, fontWeight: '600' as const, color: C.blue },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' as const },
  boardWrap: { minHeight: 400 },
  notice: { padding: 16, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  noticeText: { fontSize: 14, color: C.textSecondary, lineHeight: 20 },
});
