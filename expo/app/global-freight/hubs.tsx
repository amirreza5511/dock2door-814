import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ChevronLeft, MapPin, Ship, Plane, Truck, Boxes, Container,
  Star, ArrowRight, Warehouse, CircleDot, Info,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { sortedCanadaHubs, isHubLiveMember, liveHubCount, type LiveHubCity } from '@/constants/canadaHubs';
import type { FreightMode } from '@/constants/globalFreight';

interface ModeDef {
  key: FreightMode;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
}

const MODES: ModeDef[] = [
  { key: 'ocean', label: 'Ocean', icon: Ship, color: C.blue },
  { key: 'air', label: 'Air', icon: Plane, color: C.accent },
  { key: 'lcl', label: 'LCL', icon: Boxes, color: C.green },
  { key: 'fcl', label: 'FCL', icon: Container, color: C.purple },
  { key: 'truck', label: 'Truck', icon: Truck, color: C.yellow },
];

export default function CanadaHubsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const networkHubsQuery = trpc.freight.networkHubs.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const liveCities = useMemo<LiveHubCity[]>(() => (networkHubsQuery.data ?? []) as LiveHubCity[], [networkHubsQuery.data]);

  const hubs = useMemo(() => sortedCanadaHubs(liveCities), [liveCities]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [mode, setMode] = useState<FreightMode>('lcl');

  const selected = hubs.find((h) => h.id === selectedId) ?? hubs[0];
  const modeSupported = selected?.modes.includes(mode) ?? false;
  const memberCount = hubs.filter((h) => isHubLiveMember(h, liveCities)).length;

  const goQuote = () => router.push('/global-freight' as never);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Canada hub network</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Land it anywhere in Canada</Text>
          <Text style={styles.heroDesc}>
            Ocean, air, truck and LCL/FCL freight all route into a destination city hub for
            deconsolidation and final-mile delivery. {memberCount} partner hub{memberCount === 1 ? '' : 's'} live in our network.
          </Text>
        </View>

        {/* Mode selector */}
        <Text style={styles.sectionLabel}>MODE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeScroll}>
          {MODES.map((m) => {
            const on = mode === m.key;
            const Icon = m.icon;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.modeChip, on && { backgroundColor: m.color, borderColor: m.color }]}
                activeOpacity={0.85}
                onPress={() => setMode(m.key)}
              >
                <Icon size={16} color={on ? C.white : m.color} />
                <Text style={[styles.modeChipText, on && { color: C.white }]}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Hub list */}
        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>DESTINATION HUB</Text>
        <View style={styles.hubList}>
          {hubs.map((h) => {
            const on = selected?.id === h.id;
            const supports = h.modes.includes(mode);
            const member = isHubLiveMember(h, liveCities);
            const count = liveHubCount(h, liveCities);
            return (
              <TouchableOpacity
                key={h.id}
                style={[styles.hubCard, on && styles.hubCardOn, !supports && styles.hubCardDim]}
                activeOpacity={0.85}
                onPress={() => setSelectedId(h.id)}
              >
                <View style={[styles.hubPin, on && { backgroundColor: C.accent }]}>
                  <MapPin size={18} color={on ? C.white : C.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.hubTitleRow}>
                    <Text style={styles.hubCity}>{h.city}</Text>
                    <Text style={styles.hubProv}>{h.province}</Text>
                    {member ? (
                      <View style={styles.memberPill}>
                        <Star size={10} color={C.accent} fill={C.accent} />
                        <Text style={styles.memberText}>Partner{count > 0 ? ` · ${count}` : ''}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.hubBlurb} numberOfLines={2}>{h.blurb}</Text>
                  <View style={styles.hubModes}>
                    {MODES.filter((m) => h.modes.includes(m.key)).map((m) => (
                      <View key={m.key} style={styles.hubModeTag}>
                        <m.icon size={11} color={m.color} />
                        <Text style={styles.hubModeTagText}>{m.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Route preview */}
        {selected ? (
          <View style={styles.routeCard}>
            <Text style={styles.routeLabel}>ROUTE PREVIEW · {MODES.find((m) => m.key === mode)?.label.toUpperCase()}</Text>
            {!modeSupported ? (
              <View style={styles.warnRow}>
                <Info size={14} color={C.yellow} />
                <Text style={styles.warnText}>
                  {selected.city} doesn’t receive {MODES.find((m) => m.key === mode)?.label} directly — it’ll transship
                  from the nearest gateway, then truck in.
                </Text>
              </View>
            ) : null}
            <RouteStep icon={CircleDot} color={C.textSecondary} title="Origin" sub="Your supplier / port of loading" />
            <RouteConnector />
            <RouteStep
              icon={mode === 'ocean' || mode === 'lcl' || mode === 'fcl' ? Ship : mode === 'air' ? Plane : Truck}
              color={C.blue}
              title={`${MODES.find((m) => m.key === mode)?.label} to Canada`}
              sub={mode === 'air' ? `Arrives ${selected.airportCode ?? 'nearest airport'}` : mode === 'truck' ? 'Overland line-haul' : `Arrives ${selected.seaportCode ?? 'nearest seaport'}`}
            />
            <RouteConnector />
            <RouteStep
              icon={Warehouse}
              color={C.accent}
              title={`${selected.city} hub`}
              sub={isHubLiveMember(selected, liveCities) ? 'Partner hub · deconsolidation & customs handoff' : 'Coverage hub · deconsolidation'}
              highlight
            />
            <RouteConnector />
            <RouteStep icon={Truck} color={C.green} title="Final-mile delivery" sub={`Door delivery across ${selected.province}`} />
          </View>
        ) : null}

        <TouchableOpacity style={styles.cta} activeOpacity={0.9} onPress={goQuote} testID="hubs-get-quote">
          <Text style={styles.ctaText}>Get a freight quote to {selected?.city ?? 'Canada'}</Text>
          <ArrowRight size={18} color={C.white} />
        </TouchableOpacity>

        <View style={styles.footNote}>
          <Info size={13} color={C.textMuted} />
          <Text style={styles.footNoteText}>
            Partner hubs are prioritised and will show live capacity & pricing as they come online. Other cities
            remain available as coverage destinations.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function RouteStep({
  icon: Icon, color, title, sub, highlight,
}: { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; title: string; sub: string; highlight?: boolean }) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepIcon, { backgroundColor: color + '22' }, highlight && { backgroundColor: color + '33', borderWidth: 1, borderColor: color }]}>
        <Icon size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stepTitle, highlight && { color: C.accent }]}>{title}</Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

function RouteConnector() {
  return <View style={styles.connector} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  hero: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8, gap: 8 },
  heroTitle: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  heroDesc: { fontSize: 14, lineHeight: 21, color: C.textSecondary },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 10, paddingHorizontal: 20 },
  modeScroll: { paddingHorizontal: 20, gap: 10 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modeChipText: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  hubList: { paddingHorizontal: 20, gap: 10 },
  hubCard: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  hubCardOn: { borderColor: C.accent, backgroundColor: C.accentDim },
  hubCardDim: { opacity: 0.72 },
  hubPin: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  hubTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hubCity: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  hubProv: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
  memberPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accent + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  memberText: { fontSize: 10, fontWeight: '800' as const, color: C.accent },
  hubBlurb: { fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 3 },
  hubModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  hubModeTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.bgSecondary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  hubModeTagText: { fontSize: 10, fontWeight: '700' as const, color: C.textSecondary },
  routeCard: { margin: 20, marginBottom: 8, padding: 18, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  routeLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.2, marginBottom: 14 },
  warnRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: C.yellow + '18', borderRadius: 10, padding: 10, marginBottom: 14 },
  warnText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  stepSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  connector: { width: 2, height: 16, backgroundColor: C.border, marginLeft: 16, marginVertical: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, marginHorizontal: 20, marginTop: 14, paddingVertical: 16, borderRadius: 14 },
  ctaText: { fontSize: 16, fontWeight: '800' as const, color: C.white },
  footNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginHorizontal: 20, marginTop: 16 },
  footNoteText: { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 17 },
});
