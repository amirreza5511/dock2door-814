import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Globe, Ship, Plane, Boxes, Container,
  MapPin, Package, Truck, ArrowRight,
} from 'lucide-react-native';
import C from '@/constants/colors';

const FEATURES = [
  { icon: Boxes, title: 'One request, many quotes', desc: 'Describe your shipment once — air, ocean, truck, FCL or LCL — and receive competing quotes.' },
  { icon: Ship, title: 'Ocean FCL & LCL', desc: 'Post full containers or shared (LCL) cargo. Forwarders bid, you pick price and transit time.' },
  { icon: MapPin, title: 'Canada hub network', desc: 'Route ocean, air and truck into a destination city hub for smooth final-mile delivery.' },
] as const;

const ACTIONS = [
  { key: 'ocean', title: 'Ocean booking (FCL / LCL)', desc: '20ft · 40ft · 40ft HC · shared LCL', icon: Ship, color: C.blue, route: '/customer/ocean' },
  { key: 'air', title: 'Air cargo', desc: 'Photos + instant AI estimate, forwarders bid', icon: Plane, color: C.purple, route: '/customer/air' },
  { key: 'quote', title: 'Get competing quotes', desc: 'Air, ocean, truck, FCL or LCL — one request', icon: Globe, color: C.green, route: '/global-freight' },
  { key: 'hubs', title: 'Canada hub network', desc: 'Route freight into a destination city hub', icon: MapPin, color: C.accent, route: '/global-freight/hubs' },
  { key: 'drayage', title: 'Container drayage', desc: 'Port pickup / delivery of your container', icon: Container, color: C.blue, route: '/customer/drayage' },
] as const;

const MODES = [
  { icon: Plane, label: 'Air' },
  { icon: Ship, label: 'Ocean' },
  { icon: Truck, label: 'Truck' },
  { icon: Boxes, label: 'FCL / LCL' },
] as const;

export default function InternationalHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

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
          <Text style={styles.badge}>INTERNATIONAL FREIGHT · SHIP ANYWHERE</Text>
          <Text style={styles.title}>Ocean, air &{'\n'}freight quotes.</Text>
          <Text style={styles.desc}>
            Post one request — full container, shared LCL or air cargo — and receive competing
            quotes from forwarders and carriers worldwide, then track your booking.
          </Text>
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

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHAT DO YOU WANT TO SHIP?</Text>
          {ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={styles.actionCard}
              activeOpacity={0.85}
              onPress={() => router.push(a.route as never)}
              testID={`intl-action-${a.key}`}
            >
              <View style={[styles.actionIcon, { backgroundColor: `${a.color}22` }]}>
                <a.icon size={20} color={a.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>{a.title}</Text>
                <Text style={styles.actionDesc}>{a.desc}</Text>
              </View>
              <ChevronRight size={18} color={C.textMuted} />
            </TouchableOpacity>
          ))}
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
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 24, marginTop: 18 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  modeChipText: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  section: { paddingHorizontal: 24, marginTop: 22 },
  sectionLabel: { fontSize: 11, color: C.blue, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 12 },
  ctaPrimary: { borderRadius: 14, overflow: 'hidden' },
  ctaGrad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 17 },
  ctaText: { flex: 1, color: C.white, fontSize: 16, fontWeight: '800' as const },
  actionCard: {
    flexDirection: 'row', gap: 14, alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10,
  },
  actionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  actionDesc: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
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
