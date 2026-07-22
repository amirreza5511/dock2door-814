import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Globe, Ship, Plane, Boxes, Container,
  MapPin, Package, Truck, ArrowRight, Home, Layers,
} from 'lucide-react-native';
import C from '@/constants/colors';

type Scope = 'worldwide' | 'local';

type QuickTile = {
  key: string;
  label: string;
  icon: typeof Ship;
  color: string;
  route: string;
  scope: 'both' | Scope;
};

const QUICK: QuickTile[] = [
  { key: 'ocean', label: 'Ocean\nFCL / LCL', icon: Ship, color: C.blue, route: '/customer/ocean', scope: 'worldwide' },
  { key: 'air', label: 'Air\ncargo', icon: Plane, color: C.purple, route: '/customer/air', scope: 'worldwide' },
  { key: 'ltl', label: 'LTL / FTL\ntrucking', icon: Truck, color: C.green, route: '/customer/post-load', scope: 'local' },
  { key: 'finalmile', label: 'Final-mile\ndelivery', icon: Home, color: C.accent, route: '/ship', scope: 'local' },
  { key: 'drayage', label: 'Container\ndrayage', icon: Container, color: C.blue, route: '/customer/drayage', scope: 'both' },
  { key: 'quote', label: 'Get\nquotes', icon: Globe, color: C.yellow, route: '/global-freight', scope: 'both' },
];

const FEATURES = [
  { icon: Boxes, title: 'One request, many quotes', desc: 'Describe your shipment once — air, ocean, truck, LTL, FTL, FCL or LCL — and get competing quotes.' },
  { icon: Layers, title: 'LTL to full container', desc: 'From a single pallet (LTL) to full truckloads and full containers — every size is covered.' },
  { icon: MapPin, title: 'Worldwide & local', desc: 'Ship internationally or move freight domestically, with final-mile delivery to the door.' },
] as const;

const MODES = [
  { icon: Plane, label: 'Air' },
  { icon: Ship, label: 'Ocean' },
  { icon: Truck, label: 'LTL / FTL' },
  { icon: Boxes, label: 'FCL / LCL' },
  { icon: Home, label: 'Final-mile' },
] as const;

export default function InternationalHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('worldwide');

  const tiles = useMemo<QuickTile[]>(
    () => QUICK.filter((t) => t.scope === 'both' || t.scope === scope),
    [scope],
  );

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={['#0B2A3D', C.bg, C.bg]} style={styles.heroBg} />

        <View style={[styles.nav, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Globe size={32} color={C.blue} />
          </View>
          <Text style={styles.badge}>FREIGHT · WORLDWIDE & LOCAL</Text>
          <Text style={styles.title}>Ship anything,{'\n'}anywhere.</Text>
          <Text style={styles.desc}>
            Ocean, air, LTL, FTL and full containers — post one request and receive competing
            quotes from forwarders and carriers, then track it all the way to the door.
          </Text>
        </View>

        {/* Scope switch */}
        <View style={styles.scopeRow}>
          <TouchableOpacity
            style={[styles.scopeBtn, scope === 'worldwide' && styles.scopeBtnActive]}
            onPress={() => setScope('worldwide')}
            testID="intl-scope-worldwide"
          >
            <Globe size={15} color={scope === 'worldwide' ? C.white : C.textSecondary} />
            <Text style={[styles.scopeText, scope === 'worldwide' && styles.scopeTextActive]}>Worldwide</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scopeBtn, scope === 'local' && styles.scopeBtnActive]}
            onPress={() => setScope('local')}
            testID="intl-scope-local"
          >
            <MapPin size={15} color={scope === 'local' ? C.white : C.textSecondary} />
            <Text style={[styles.scopeText, scope === 'local' && styles.scopeTextActive]}>Local / domestic</Text>
          </TouchableOpacity>
        </View>

        {/* Mode chips */}
        <View style={styles.modeRow}>
          {MODES.map((m) => (
            <View key={m.label} style={styles.modeChip}>
              <m.icon size={15} color={C.blue} />
              <Text style={styles.modeChipText}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick access grid */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
          <View style={styles.quickGrid}>
            {tiles.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={styles.quickTile}
                activeOpacity={0.85}
                onPress={() => router.push(t.route as never)}
                testID={`intl-quick-${t.key}`}
              >
                <View style={[styles.quickIcon, { backgroundColor: `${t.color}22` }]}>
                  <t.icon size={22} color={t.color} />
                </View>
                <Text style={styles.quickLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Primary CTA */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.ctaPrimary}
            activeOpacity={0.85}
            onPress={() => router.push('/global-freight' as never)}
            testID="intl-cta-quote"
          >
            <LinearGradient colors={[C.blue, '#1E5C99']} style={styles.ctaGrad}>
              <Boxes size={18} color={C.white} />
              <Text style={styles.ctaText}>Get a freight quote</Text>
              <ChevronRight size={18} color={C.white} />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureCard}>
              <View style={styles.featureIcon}>
                <f.icon size={20} color={C.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Hub banner */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.hubBanner}
            activeOpacity={0.85}
            onPress={() => router.push('/global-freight/hubs' as never)}
            testID="intl-hubs"
          >
            <View style={styles.hubBannerIcon}><Package size={20} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hubBannerTitle}>Canada hub network</Text>
              <Text style={styles.hubBannerDesc}>Ocean, air, truck & LCL/FCL route into a destination city hub for final-mile.</Text>
            </View>
            <ArrowRight size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  nav: { paddingHorizontal: 16, paddingBottom: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  iconWrap: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim, marginBottom: 16 },
  badge: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8, marginBottom: 8, color: C.blue },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 12, lineHeight: 38 },
  desc: { fontSize: 15, color: C.textSecondary, lineHeight: 23 },
  scopeRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, marginTop: 18 },
  scopeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  scopeBtnActive: { backgroundColor: C.blue, borderColor: C.blue },
  scopeText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  scopeTextActive: { color: C.white },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 24, marginTop: 14 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modeChipText: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  section: { paddingHorizontal: 24, marginTop: 22 },
  sectionLabel: { fontSize: 11, color: C.blue, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 12 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickTile: { width: '31.5%', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 6, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  quickIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 12, fontWeight: '700' as const, color: C.text, textAlign: 'center', lineHeight: 15 },
  ctaPrimary: { borderRadius: 14, overflow: 'hidden' },
  ctaGrad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 17 },
  ctaText: { flex: 1, color: C.white, fontSize: 16, fontWeight: '800' as const },
  featureCard: {
    flexDirection: 'row', gap: 14, alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10,
  },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim },
  featureTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  featureDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  hubBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55' },
  hubBannerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  hubBannerTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  hubBannerDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 16 },
});
