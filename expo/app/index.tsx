import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Warehouse, Wrench, Users, ShieldCheck, ArrowRight,
  MapPin, TrendingUp, Clock, Star, HardHat, Boxes, Truck, PackageOpen, Anchor,
  Store, Forklift, Hammer, Construction,
} from 'lucide-react-native';
import C from '@/constants/colors';

const { width } = Dimensions.get('window');

type WorldDef = {
  key: 'labour' | 'logistics' | 'freight' | 'drayage' | 'marketplace';
  badge: string;
  color: string;
  bg: string;
  icon: typeof HardHat;
  title: string;
  desc: string;
  bullets: { icon: typeof Users; label: string; sub: string }[];
};

const WORLDS: WorldDef[] = [
  {
    key: 'labour',
    badge: 'Domain 1',
    color: C.purple,
    bg: C.purpleDim,
    icon: HardHat,
    title: 'Labour',
    desc: 'Connect the people who need work with the businesses who need crews.',
    bullets: [
      { icon: Clock, label: 'Employers', sub: 'Post & fill shifts fast' },
      { icon: Users, label: 'Workers', sub: 'Find shifts that fit you' },
    ],
  },
  {
    key: 'logistics',
    badge: 'Domain 2',
    color: C.accent,
    bg: C.accentDim,
    icon: Boxes,
    title: 'Logistics & Warehousing',
    desc: 'Warehouse space, industrial services, trucking and fulfillment in one place.',
    bullets: [
      { icon: Warehouse, label: 'Warehouse Space', sub: 'Dry · Chill · Frozen' },
      { icon: Wrench, label: 'Industrial Services', sub: 'On-demand crews' },
      { icon: Truck, label: 'Trucking & Fulfillment', sub: 'Move and ship goods' },
    ],
  },
  {
    key: 'freight',
    badge: 'Domain 3',
    color: C.green,
    bg: C.greenDim,
    icon: PackageOpen,
    title: 'Freight & Delivery',
    desc: 'Uber for trucks — post any delivery, from a single box to a full load. Owner-operators and fleet carriers grab and dispatch them.',
    bullets: [
      { icon: PackageOpen, label: 'Shippers', sub: 'Post loads — parcel to full truck' },
      { icon: Truck, label: 'Owner-Operators', sub: 'Bring your truck, accept loads' },
      { icon: Truck, label: 'Fleet / Carrier Companies', sub: 'Accept loads & dispatch drivers' },
    ],
  },
  {
    key: 'drayage',
    badge: 'Domain 4',
    color: C.blue,
    bg: C.blueDim,
    icon: Anchor,
    title: 'Container Drayage',
    desc: 'Post import/export container orders. Drayage companies claim them, dispatch drivers, enter port reservations, and track containers live on a map.',
    bullets: [
      { icon: Anchor, label: 'Freight Forwarders', sub: 'Post import/export container orders' },
      { icon: Truck, label: 'Drayage Companies', sub: 'Claim orders, dispatch & track live' },
      { icon: Users, label: 'Drivers', sub: 'Receive work orders & advance moves' },
    ],
  },
  {
    key: 'marketplace',
    badge: 'Domain 5',
    color: C.yellow,
    bg: C.yellowDim,
    icon: Store,
    title: 'Rentals & Services',
    desc: 'A shared marketplace for every business: rent equipment you operate, hire an operated crane service, book mobile repair techs, hire services, and insure your cargo. Request a quote, get an official price, and place the order.',
    bullets: [
      { icon: Forklift, label: 'Equipment Rental', sub: 'Forklifts, lifts & gear you operate' },
      { icon: Construction, label: 'Crane Service', sub: 'Crane + operator comes & does the lift' },
      { icon: Hammer, label: 'Mobile Repair & Services', sub: 'On-site techs & labour crews' },
      { icon: ShieldCheck, label: 'Cargo Insurance', sub: 'Insure freight & shipments' },
    ],
  },
];

const STATS = [
  { label: 'Pallet Spaces', value: '1,150+' },
  { label: 'Active Workers', value: '200+' },
  { label: 'Service Partners', value: '18' },
  { label: 'Avg. Fill Time', value: '< 2h' },
];

export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fadeAnim, slideAnim, pulseAnim]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={['#0D1E35', C.bg, C.bg]}
          style={styles.heroBg}
        />

        {/* Nav */}
        <View style={[styles.nav, { paddingTop: insets.top + 16 }]}>
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>Dock2Door</Text>
          </View>
          <View style={styles.navBtns}>
            <TouchableOpacity onPress={() => router.push('/auth/login' as any)} style={styles.loginBtn}>
              <Text style={styles.loginBtnText}>Log In</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero */}
        <Animated.View style={[styles.hero, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.heroPill}>
            <MapPin size={12} color={C.accent} />
            <Text style={styles.heroPillText}>Global Logistics Platform</Text>
          </View>

          <Text style={styles.heroTitle}>
            {'The B2B Logistics\nMarketplace for\n'}
            <Text style={{ color: C.accent }}>Modern Industry</Text>
          </Text>

          <Text style={styles.heroSub}>
            Book warehouse space, hire industrial crews, and post labour shifts — all in one platform built for modern logistics operations.
          </Text>

          <View style={styles.heroCtas}>
            <TouchableOpacity
              onPress={() => router.push('/auth/signup' as any)}
              style={styles.ctaPrimary}
              activeOpacity={0.85}
            >
              <LinearGradient colors={[C.accentLight, C.accent]} style={styles.ctaGrad}>
                <Text style={styles.ctaPrimaryText}>Get Started Free</Text>
                <ArrowRight size={16} color={C.white} />
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/auth/login' as any)}
              style={styles.ctaSecondary}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaSecondaryText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {STATS.map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Two worlds */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TWO WORLDS, ONE PLATFORM</Text>
          <Text style={styles.sectionTitle}>Pick the world{'\n'}you work in.</Text>

          {WORLDS.map((w) => (
            <View key={w.key} style={[styles.worldCard, { borderColor: w.color }]}>
              <View style={styles.worldHeaderRow}>
                <View style={[styles.worldIconWrap, { backgroundColor: w.bg }]}>
                  <w.icon size={24} color={w.color} />
                </View>
                <View style={styles.worldHeaderText}>
                  <Text style={[styles.worldBadge, { color: w.color }]}>{w.badge}</Text>
                  <Text style={styles.worldTitle}>{w.title}</Text>
                </View>
              </View>
              <Text style={styles.worldDesc}>{w.desc}</Text>
              <View style={styles.worldBullets}>
                {w.bullets.map((b) => (
                  <View key={b.label} style={styles.worldBullet}>
                    <View style={[styles.worldBulletIcon, { backgroundColor: w.bg }]}>
                      <b.icon size={15} color={w.color} />
                    </View>
                    <View style={styles.featureText}>
                      <Text style={styles.worldBulletLabel}>{b.label}</Text>
                      <Text style={styles.worldBulletSub}>{b.sub}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* Roles */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BUILT FOR</Text>
          <Text style={styles.sectionTitle}>Every role in the{'\n'}supply chain.</Text>

          <View style={styles.rolesGrid}>
            {[
              { role: 'Customer', desc: 'Book warehouse & services', icon: ShieldCheck, color: C.blue },
              { role: 'Warehouse Provider', desc: 'List your storage space', icon: Warehouse, color: C.accent },
              { role: 'Service Provider', desc: 'Offer industrial services', icon: Wrench, color: C.green },
              { role: 'Employer', desc: 'Post and fill shifts fast', icon: Clock, color: C.yellow },
              { role: 'Worker', desc: 'Find shifts that fit you', icon: Users, color: C.purple },
              { role: 'Shipper', desc: 'Post deliveries, any size', icon: PackageOpen, color: C.green },
              { role: 'Owner-Operator', desc: 'Own one truck, deliver loads', icon: Truck, color: C.green },
              { role: 'Fleet / Carrier', desc: 'Run a fleet & dispatch drivers', icon: Truck, color: C.green },
              { role: 'Freight Forwarder', desc: 'Post import/export containers', icon: Anchor, color: C.blue },
              { role: 'Drayage Company', desc: 'Claim orders, dispatch & track', icon: Anchor, color: C.blue },
              { role: 'Container Driver', desc: 'Receive work orders, move containers', icon: Truck, color: C.blue },
              { role: 'Crane / Equipment Co.', desc: 'Rent out cranes & heavy gear', icon: Construction, color: C.yellow },
              { role: 'Mobile Repair', desc: 'Dispatch techs & crews on-site', icon: Hammer, color: C.purple },
              { role: 'Cargo Insurer', desc: 'Insure freight & shipments', icon: ShieldCheck, color: C.yellow },
              { role: 'Marketplace Buyer', desc: 'Rent, repair & insure cargo', icon: Store, color: C.blue },
              { role: 'Admin', desc: 'Full platform control', icon: Star, color: C.red },
            ].map((r) => (
              <View key={r.role} style={styles.roleCard}>
                <r.icon size={20} color={r.color} />
                <Text style={styles.roleTitle}>{r.role}</Text>
                <Text style={styles.roleDesc}>{r.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* CTA bottom */}
        <View style={styles.bottomCta}>
          <LinearGradient colors={['#0D1E35', '#162438']} style={styles.bottomCtaGrad}>
            <View style={styles.trendRow}>
              <TrendingUp size={16} color={C.accent} />
              <Text style={styles.trendText}>Trusted by logistics businesses worldwide</Text>
            </View>
            <Text style={styles.bottomCtaTitle}>Ready to streamline{'\n'}your logistics?</Text>
            <TouchableOpacity
              onPress={() => router.push('/auth/signup' as any)}
              style={styles.ctaPrimary}
              activeOpacity={0.85}
            >
              <LinearGradient colors={[C.accentLight, C.accent]} style={styles.ctaGrad}>
                <Text style={styles.ctaPrimaryText}>Create Your Account</Text>
                <ArrowRight size={16} color={C.white} />
              </LinearGradient>
            </TouchableOpacity>
          </LinearGradient>
        </View>

        {/* Demo accounts */}
        <View style={styles.demoBox}>
          <Text style={styles.demoTitle}>Demo Accounts</Text>
          <Text style={styles.demoNote}>Use these to explore each role:</Text>
          {[
            ['Admin', 'admin@dock2door.ca', 'admin123'],
            ['Customer', 'customer@freshmart.ca', 'password'],
            ['Warehouse', 'provider@vandc.ca', 'password'],
            ['Service', 'service@deltadev.ca', 'password'],
            ['Employer', 'employer@deltalog.ca', 'password'],
            ['Worker', 'worker.marcus@gmail.com', 'password'],
          ].map(([role, email, pwd]) => (
            <View key={role} style={styles.demoRow}>
              <Text style={styles.demoRole}>{role}</Text>
              <Text style={styles.demoEmail}>{email}</Text>
              <Text style={styles.demoPwd}>{pwd}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  heroBg: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 500,
  },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingBottom: 8,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoDot: { width: 10, height: 10, borderRadius: 3, backgroundColor: C.accent },
  logoText: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  navBtns: { flexDirection: 'row', gap: 8 },
  loginBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card,
  },
  loginBtnText: { color: C.text, fontSize: 14, fontWeight: '600' as const },
  hero: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 },
  heroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: C.accentDim, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 20,
  },
  heroPillText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  heroTitle: { fontSize: 38, fontWeight: '800' as const, color: C.text, lineHeight: 46, letterSpacing: -1, marginBottom: 16 },
  heroSub: { fontSize: 16, color: C.textSecondary, lineHeight: 24, marginBottom: 28 },
  heroCtas: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  ctaPrimary: { borderRadius: 12, overflow: 'hidden' },
  ctaGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 14 },
  ctaPrimaryText: { color: C.white, fontSize: 15, fontWeight: '700' as const },
  ctaSecondary: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  ctaSecondaryText: { color: C.text, fontSize: 15, fontWeight: '600' as const },
  statsRow: {
    flexDirection: 'row', marginHorizontal: 24, marginBottom: 40,
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  statItem: {
    flex: 1, paddingVertical: 16, alignItems: 'center',
    borderRightWidth: 1, borderRightColor: C.border,
  },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.accent, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textAlign: 'center', letterSpacing: 0.3 },
  section: { paddingHorizontal: 24, marginBottom: 40 },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 8 },
  sectionTitle: { fontSize: 26, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5, lineHeight: 32, marginBottom: 20 },
  featureCard: {
    flexDirection: 'row', gap: 16,
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10,
  },
  featureIconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1 },
  featureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  featureTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  featureSubtitle: {
    fontSize: 11, color: C.textMuted,
    backgroundColor: C.border, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  featureDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  worldCard: {
    backgroundColor: C.card, borderRadius: 16,
    borderWidth: 1, padding: 18, marginBottom: 14,
  },
  worldHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  worldIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  worldHeaderText: { flex: 1 },
  worldBadge: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, marginBottom: 2, textTransform: 'uppercase' as const },
  worldTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  worldDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 20, marginBottom: 14 },
  worldBullets: { gap: 8 },
  worldBullet: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  worldBulletIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  worldBulletLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  worldBulletSub: { fontSize: 12, color: C.textSecondary },
  rolesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roleCard: {
    width: (width - 48 - 10) / 2,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 6,
  },
  roleTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  roleDesc: { fontSize: 12, color: C.textSecondary },
  bottomCta: { marginHorizontal: 24, marginBottom: 24, borderRadius: 20, overflow: 'hidden' },
  bottomCtaGrad: { padding: 28, borderRadius: 20, borderWidth: 1, borderColor: C.border },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  trendText: { fontSize: 13, color: C.textSecondary },
  bottomCtaTitle: { fontSize: 26, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5, lineHeight: 32, marginBottom: 20 },
  demoBox: {
    marginHorizontal: 24, marginBottom: 20,
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.borderLight,
    padding: 16,
  },
  demoTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  demoNote: { fontSize: 12, color: C.textMuted, marginBottom: 12 },
  demoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border },
  demoRole: { width: 72, fontSize: 11, fontWeight: '700' as const, color: C.accent },
  demoEmail: { flex: 1, fontSize: 11, color: C.textSecondary },
  demoPwd: { fontSize: 11, color: C.textMuted },
});
