import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, ChevronRight, Package, RotateCcw, PackageSearch,
  Settings2, Truck, Store, Printer, MapPin,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { COURIERS } from '@/constants/couriers';

const FEATURES = [
  { icon: Package, title: 'Send a parcel', desc: 'Enter size & weight, compare every courier, print a label with a scannable barcode.' },
  { icon: RotateCcw, title: 'Start a return', desc: 'Amazon, Temu or any store — get a prepaid return label or a QR code for the counter.' },
  { icon: MapPin, title: 'Drop off or pickup', desc: 'Drop at a post office / courier point, or book a pickup from your door.' },
] as const;

const ACTIONS = [
  { key: 'send', title: 'Send a parcel', desc: 'Price it, print a label, ship it', icon: Package, color: C.accent, route: '/ship/quote' },
  { key: 'return', title: 'Start a return', desc: 'Amazon · Temu · any store', icon: RotateCcw, color: C.blue, route: '/ship/return' },
  { key: 'mine', title: 'My shipments & returns', desc: 'Track, re-print labels, update status', icon: PackageSearch, color: C.green, route: '/ship/mine' },
  { key: 'couriers', title: 'Manage couriers', desc: 'Connect carrier accounts & keys', icon: Settings2, color: C.purple, route: '/ship/couriers' },
] as const;

export default function ShipHub() {
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
        <LinearGradient colors={['#0D1E35', C.bg, C.bg]} style={styles.heroBg} />

        <View style={[styles.nav, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Package size={32} color={C.accent} />
          </View>
          <Text style={styles.badge}>SHIP & RETURN · POST OFFICE IN YOUR POCKET</Text>
          <Text style={styles.title}>Send anything.{'\n'}Return anything.</Text>
          <Text style={styles.desc}>
            Compare every courier, print a label with a scannable barcode, and drop it off or
            book a pickup — all in one place.
          </Text>
        </View>

        {/* Primary CTA */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.ctaPrimary}
            activeOpacity={0.85}
            onPress={() => router.push('/ship/quote' as never)}
            testID="ship-cta-send"
          >
            <LinearGradient colors={[C.accentLight, C.accent]} style={styles.ctaGrad}>
              <Printer size={18} color={C.white} />
              <Text style={styles.ctaText}>Get a price & print a label</Text>
              <ChevronRight size={18} color={C.white} />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHAT DO YOU WANT TO DO?</Text>
          {ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={styles.actionCard}
              activeOpacity={0.85}
              onPress={() => router.push(a.route as never)}
              testID={`ship-action-${a.key}`}
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
                <f.icon size={20} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Couriers */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>COURIERS YOU CAN COMPARE</Text>
          <View style={styles.courierRow}>
            {COURIERS.map((c) => (
              <View key={c.code} style={[styles.courierChip, { borderColor: `${c.color}66` }]}>
                <View style={[styles.courierDot, { backgroundColor: c.color }]} />
                <Text style={styles.courierName}>{c.name}</Text>
              </View>
            ))}
          </View>
          <View style={styles.hintRow}>
            <Truck size={14} color={C.textMuted} />
            <Text style={styles.hint}>
              Live prices switch on for each courier once its account is connected. Others show clearly-marked estimates.
            </Text>
          </View>
          <View style={styles.hintRow}>
            <Store size={14} color={C.textMuted} />
            <Text style={styles.hint}>Drop off at a post office / courier point, or book a pickup from our network.</Text>
          </View>
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
  iconWrap: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim, marginBottom: 16 },
  badge: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8, marginBottom: 8, color: C.accent },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 12, lineHeight: 38 },
  desc: { fontSize: 15, color: C.textSecondary, lineHeight: 23 },
  section: { paddingHorizontal: 24, marginTop: 22 },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 12 },
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
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDim },
  featureTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  featureDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  courierRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  courierChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.card, borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  courierDot: { width: 8, height: 8, borderRadius: 4 },
  courierName: { fontSize: 12, fontWeight: '600' as const, color: C.text },
  hintRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-start' },
  hint: { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 17 },
});
