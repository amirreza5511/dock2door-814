import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Truck, Layers, Boxes, Home, Plus, Package,
  Globe, MapPin, ClipboardList,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import {
  freightRoleKind, FREIGHT_STATUS_META, FREIGHT_MODE_LABEL,
  type FreightMode, type FreightQuoteStatus,
} from '@/constants/globalFreight';
import {
  COVERAGE_AREAS, type CoverageArea, LOAD_TYPES, type LoadType, GROUND_FREIGHT_MODES,
} from '@/constants/groundFreight';
import { formatMoney } from '@/constants/world';
import { useAuthStore } from '@/store/auth';
import { useExploreStore } from '@/store/explore';
import { SAMPLE_FREIGHT_QUOTES } from '@/lib/exploreSamples';
import GroundLoadWizard from '@/components/GroundLoadWizard';
import FreightProviderBoard from '@/components/FreightProviderBoard';
import ScreenFeedback from '@/components/ui/ScreenFeedback';

type FreightRequest = {
  id: string; reference_code: string; title: string; freight_mode: FreightMode;
  origin_city: string; origin_country: string; dest_city: string; dest_country: string;
  weight: number; weight_unit: string; pieces: number; currency: string;
  status: FreightQuoteStatus; offer_count: number; awarded_amount: number;
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

export default function GroundFreightHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();

  const isExploring = useExploreStore((s) => s.isExploring);
  const exploreRole = useExploreStore((s) => s.exploreRole);
  const kind = useMemo(
    () => freightRoleKind((isExploring ? exploreRole : user?.role) ?? undefined),
    [user?.role, isExploring, exploreRole],
  );
  const isCustomer = kind === 'customer';
  const isProvider = kind === 'freight' || kind === 'ground';

  const [coverage, setCoverage] = useState<CoverageArea>('canada');
  const [loadType, setLoadType] = useState<LoadType>('ltl');
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [showBoard, setShowBoard] = useState<boolean>(false);

  const mineQuery = trpc.freight.mine.useQuery(undefined, { enabled: isCustomer && !isExploring });
  const allMine = (isExploring ? (SAMPLE_FREIGHT_QUOTES as unknown as FreightRequest[]) : ((mineQuery.data ?? []) as FreightRequest[]));
  const requests = useMemo(
    () => allMine.filter((r) => GROUND_FREIGHT_MODES.includes(r.freight_mode)),
    [allMine],
  );

  const handleSubmitted = useCallback(() => {
    setWizardOpen(false);
    void utils.freight.mine.invalidate();
  }, [utils]);

  const openWizard = useCallback(() => setWizardOpen(true), []);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={isCustomer && !isExploring ? (
          <RefreshControl refreshing={mineQuery.isRefetching} onRefresh={() => void mineQuery.refetch()} tintColor={C.textSecondary} />
        ) : undefined}
      >
        <LinearGradient colors={['#0E2A1C', C.bg, C.bg]} style={styles.heroBg} />

        <View style={[styles.nav, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Truck size={32} color={C.green} />
          </View>
          <Text style={styles.badge}>LTL & FTL QUOTES</Text>
          <Text style={styles.title}>Get a price for{'\n'}any truck load.</Text>
          <Text style={styles.desc}>
            Local, across Canada, or worldwide with final-mile to the door. Post your load
            once and carriers and companies send competing prices to win it.
          </Text>
        </View>

        {/* Coverage switch */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>COVERAGE</Text>
          <View style={styles.segRow}>
            {COVERAGE_AREAS.map((cov) => {
              const active = coverage === cov.value;
              return (
                <TouchableOpacity key={cov.value} activeOpacity={0.85} onPress={() => setCoverage(cov.value)}
                  style={[styles.seg, active && styles.segActive]} testID={`ground-coverage-${cov.value}`}>
                  <Text style={[styles.segText, active && styles.segTextActive]}>{cov.label}</Text>
                  <Text style={[styles.segSub, active && styles.segSubActive]}>{cov.sublabel}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Mode chips */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LOAD TYPE</Text>
          <View style={styles.modeRow}>
            {LOAD_TYPES.map((l) => {
              const active = loadType === l.value;
              const Icon = l.icon;
              return (
                <TouchableOpacity key={l.value} activeOpacity={0.85} onPress={() => setLoadType(l.value)}
                  style={[styles.modeChip, active && styles.modeChipActive]} testID={`ground-load-${l.value}`}>
                  <Icon size={16} color={active ? C.white : C.green} />
                  <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{l.short}</Text>
                </TouchableOpacity>
              );
            })}
            <View style={styles.modeChip}>
              <Home size={16} color={C.accent} />
              <Text style={styles.modeChipText}>+ Final-mile</Text>
            </View>
          </View>
        </View>

        {/* Primary CTAs */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.ctaPrimary} activeOpacity={0.85} onPress={openWizard} testID="ground-cta-quote">
            <LinearGradient colors={[C.green, '#1E7A4D']} style={styles.ctaGrad}>
              <Plus size={18} color={C.white} />
              <Text style={styles.ctaText}>Get quotes for my load</Text>
              <ChevronRight size={18} color={C.white} />
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ctaSecondary} activeOpacity={0.85}
            onPress={() => setShowBoard((v) => !v)} testID="ground-cta-board">
            <ClipboardList size={18} color={C.green} />
            <Text style={styles.ctaSecondaryText}>Browse open loads & quote</Text>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Provider board */}
        {showBoard && (
          <View style={styles.section}>
            {isProvider ? (
              <View style={styles.boardWrap}>
                <FreightProviderBoard kind={kind === 'ground' ? 'ground' : 'freight'}
                  modeFilter={GROUND_FREIGHT_MODES} title="Open truck loads" />
              </View>
            ) : (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Quoting is for providers</Text>
                <Text style={styles.noticeText}>
                  Carriers, trucking companies, forwarders and other business accounts can send quotes.
                  Sign in with a provider account to compete on open loads.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Customer's ground loads */}
        {isCustomer && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>MY LOADS</Text>
            {!isExploring && mineQuery.isLoading ? (
              <ScreenFeedback state="loading" title="Loading your loads" />
            ) : requests.length === 0 ? (
              <View style={styles.emptyCard}>
                <Package size={28} color={C.textMuted} />
                <Text style={styles.emptyTitle}>No loads yet</Text>
                <Text style={styles.emptyDesc}>Tap “Get quotes for my load” to post your first one.</Text>
              </View>
            ) : (
              requests.map((r) => (
                <TouchableOpacity key={r.id} style={styles.reqCard} activeOpacity={0.85}
                  onPress={() => router.push(`/global-freight/${r.id}` as never)}>
                  <View style={styles.reqTop}>
                    <Text style={styles.reqRef}>{r.reference_code}</Text>
                    <StatusPill status={r.status} />
                  </View>
                  <Text style={styles.reqTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={styles.reqMetaRow}>
                    <Text style={styles.reqMeta}>{FREIGHT_MODE_LABEL[r.freight_mode]}</Text>
                    <Text style={styles.reqMetaDot}>·</Text>
                    <Text style={styles.reqMeta}>{r.origin_city || r.origin_country} → {r.dest_city || r.dest_country}</Text>
                  </View>
                  <View style={styles.reqFooter}>
                    <Text style={styles.reqOffers}>
                      {r.status === 'Accepted' && r.awarded_amount > 0
                        ? `Booked · ${formatMoney(r.awarded_amount, r.currency)}`
                        : `${r.offer_count} quote${r.offer_count === 1 ? '' : 's'}`}
                    </Text>
                    <ChevronRight size={18} color={C.textMuted} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
          {[
            { icon: Layers, title: 'Describe it once', desc: 'Pickup, drop-off, load type and size — plus an instant ballpark price.' },
            { icon: Boxes, title: 'Providers compete', desc: 'Carriers and companies send prices and transit times to win your load.' },
            { icon: Globe, title: 'Pick & go', desc: 'Compare quotes side by side, chat, then accept the one you want.' },
          ].map((f) => (
            <View key={f.title} style={styles.featureCard}>
              <View style={styles.featureIcon}><f.icon size={20} color={C.green} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <GroundLoadWizard
        visible={wizardOpen}
        initialCoverage={coverage}
        initialLoadType={loadType}
        onClose={() => setWizardOpen(false)}
        onSubmitted={handleSubmitted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  nav: { paddingHorizontal: 16, paddingBottom: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  iconWrap: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenDim, marginBottom: 16 },
  badge: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8, marginBottom: 8, color: C.green },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 12, lineHeight: 38 },
  desc: { fontSize: 15, color: C.textSecondary, lineHeight: 23 },
  section: { paddingHorizontal: 24, marginTop: 22 },
  sectionLabel: { fontSize: 11, color: C.green, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 12 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, gap: 2 },
  segActive: { backgroundColor: C.greenDim, borderColor: C.green },
  segText: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  segTextActive: { color: C.green },
  segSub: { fontSize: 10, color: C.textMuted, lineHeight: 13 },
  segSubActive: { color: C.green },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modeChipActive: { backgroundColor: C.green, borderColor: C.green },
  modeChipText: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  modeChipTextActive: { color: C.white },
  ctaPrimary: { borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  ctaGrad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 17 },
  ctaText: { flex: 1, color: C.white, fontSize: 16, fontWeight: '800' as const },
  ctaSecondary: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 15, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  ctaSecondaryText: { flex: 1, color: C.text, fontSize: 15, fontWeight: '700' as const },
  boardWrap: { minHeight: 400 },
  notice: { padding: 16, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, gap: 6 },
  noticeTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  noticeText: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 28, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
  reqCard: { gap: 8, padding: 16, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginBottom: 10 },
  reqTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqRef: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, letterSpacing: 0.5 },
  reqTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  reqMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  reqMeta: { fontSize: 13, color: C.textSecondary },
  reqMetaDot: { fontSize: 13, color: C.textMuted },
  reqFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  reqOffers: { fontSize: 13, fontWeight: '600' as const, color: C.green },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' as const },
  featureCard: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 10 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenDim },
  featureTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  featureDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
});
