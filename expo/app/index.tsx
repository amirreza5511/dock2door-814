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
  MapPin, TrendingUp, Clock, Star, Boxes, Truck, PackageOpen, Anchor,
  Store, Forklift, Hammer, Construction, UsersRound, ChevronRight, Compass, Building2,
  Package, RotateCcw, Printer, Globe, Ship, Plane, Layers, Home,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { DOMAINS } from '@/constants/domains';

const { width } = Dimensions.get('window');

const STATS = [
  { label: 'Pallet Spaces', value: '1,150+' },
  { label: 'Active Workers', value: '200+' },
  { label: 'Service Partners', value: '18' },
  { label: 'Avg. Fill Time', value: '< 2h' },
];

const WORLDS = DOMAINS;

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
          <Text style={styles.sectionLabel}>SIX WORLDS, ONE PLATFORM</Text>
          <Text style={styles.sectionTitle}>Explore any world{'\n'}— no account needed.</Text>

          {WORLDS.map((w) => (
            <TouchableOpacity
              key={w.key}
              style={[styles.worldCard, { borderColor: w.color }]}
              activeOpacity={0.85}
              onPress={() => router.push(`/explore/${w.key}` as never)}
              testID={`domain-card-${w.key}`}
            >
              <View style={styles.worldHeaderRow}>
                <View style={[styles.worldIconWrap, { backgroundColor: w.bg }]}>
                  <w.icon size={24} color={w.color} />
                </View>
                <View style={styles.worldHeaderText}>
                  <Text style={[styles.worldBadge, { color: w.color }]}>{w.badge}</Text>
                  <Text style={styles.worldTitle}>{w.title}</Text>
                </View>
                <ChevronRight size={20} color={C.textMuted} />
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
              <View style={[styles.exploreRow, { backgroundColor: w.bg }]}>
                <Compass size={15} color={w.color} />
                <Text style={[styles.exploreRowText, { color: w.color }]}>Explore {w.title} — no account needed</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Ship & Return */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SHIP & RETURN</Text>
          <Text style={styles.sectionTitle}>A post office{'\n'}in your pocket.</Text>
          <TouchableOpacity
            style={styles.shipCard}
            activeOpacity={0.85}
            onPress={() => router.push('/ship' as never)}
            testID="home-ship"
          >
            <LinearGradient colors={['#12253D', '#0D1E35']} style={styles.shipGrad}>
              <View style={styles.shipHeaderRow}>
                <View style={styles.shipIconWrap}>
                  <Package size={24} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shipTitle}>Send a parcel or start a return</Text>
                  <Text style={styles.shipDesc}>Compare every courier, print a label, drop off or book a pickup.</Text>
                </View>
                <ChevronRight size={20} color={C.textMuted} />
              </View>
              <View style={styles.shipBullets}>
                {[
                  { icon: Printer, label: 'Get a price & label' },
                  { icon: RotateCcw, label: 'Amazon / Temu returns' },
                  { icon: Truck, label: 'Drop-off or pickup' },
                ].map((b) => (
                  <View key={b.label} style={styles.shipBullet}>
                    <b.icon size={14} color={C.accent} />
                    <Text style={styles.shipBulletText}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* International Freight */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INTERNATIONAL FREIGHT</Text>
          <Text style={styles.sectionTitle}>Ocean, air &{'\n'}freight quotes.</Text>
          <TouchableOpacity
            style={styles.shipCard}
            activeOpacity={0.85}
            onPress={() => router.push('/international' as never)}
            testID="home-international"
          >
            <LinearGradient colors={['#0B2A3D', '#0A1F2E']} style={styles.shipGrad}>
              <View style={styles.shipHeaderRow}>
                <View style={[styles.shipIconWrap, { backgroundColor: C.blueDim }]}>
                  <Globe size={24} color={C.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shipTitle}>Ship a container or air cargo worldwide</Text>
                  <Text style={styles.shipDesc}>Post one request — FCL, LCL or air — and get competing quotes from forwarders.</Text>
                </View>
                <ChevronRight size={20} color={C.textMuted} />
              </View>
              <View style={styles.shipBullets}>
                {[
                  { icon: Ship, label: 'Ocean FCL / LCL' },
                  { icon: Plane, label: 'Air cargo' },
                  { icon: MapPin, label: 'Canada hubs' },
                ].map((b) => (
                  <View key={b.label} style={styles.shipBullet}>
                    <b.icon size={14} color={C.blue} />
                    <Text style={styles.shipBulletText}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* LTL & FTL Quotes */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LTL & FTL QUOTES</Text>
          <Text style={styles.sectionTitle}>Truck loads,{'\n'}competing prices.</Text>
          <TouchableOpacity
            style={styles.shipCard}
            activeOpacity={0.85}
            onPress={() => router.push('/ground-freight' as never)}
            testID="home-ground-freight"
          >
            <LinearGradient colors={['#0E2A1C', '#0A1F16']} style={styles.shipGrad}>
              <View style={styles.shipHeaderRow}>
                <View style={[styles.shipIconWrap, { backgroundColor: C.greenDim }]}>
                  <Truck size={24} color={C.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shipTitle}>Get a price for any truck load</Text>
                  <Text style={styles.shipDesc}>Local, across Canada or worldwide — post once and let carriers compete on price.</Text>
                </View>
                <ChevronRight size={20} color={C.textMuted} />
              </View>
              <View style={styles.shipBullets}>
                {[
                  { icon: Layers, label: 'LTL part loads' },
                  { icon: Truck, label: 'FTL full trucks' },
                  { icon: Home, label: 'Final-mile' },
                ].map((b) => (
                  <View key={b.label} style={styles.shipBullet}>
                    <b.icon size={14} color={C.green} />
                    <Text style={styles.shipBulletText}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          </TouchableOpacity>
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
              { role: 'Employment Agency', desc: 'Your workers, our booking system', icon: UsersRound, color: C.purple },
              { role: 'Shipper', desc: 'Post deliveries, any size', icon: PackageOpen, color: C.green },
              { role: 'Owner-Operator', desc: 'Own one truck, deliver loads', icon: Truck, color: C.green },
              { role: 'Fleet / Carrier', desc: 'Run a fleet & dispatch drivers', icon: Truck, color: C.green },
              { role: 'Freight Forwarder', desc: 'Post import/export containers', icon: Anchor, color: C.blue },
              { role: 'Drayage Company', desc: 'Claim orders, dispatch & track', icon: Anchor, color: C.blue },
              { role: 'Customs Broker', desc: 'Clear shipments through customs', icon: ShieldCheck, color: C.blue },
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

        {/* Directory */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.directoryCard}
            activeOpacity={0.85}
            onPress={() => router.push('/directory' as never)}
            testID="home-directory"
          >
            <View style={styles.directoryIcon}><Building2 size={22} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.directoryTitle}>Browse the directory</Text>
              <Text style={styles.directoryDesc}>Companies & open work — no account needed</Text>
            </View>
            <ArrowRight size={18} color={C.textMuted} />
          </TouchableOpacity>
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
  exploreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 14, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  exploreRowText: { fontSize: 13, fontWeight: '700' as const },
  rolesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roleCard: {
    width: (width - 48 - 10) / 2,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 6,
  },
  roleTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  roleDesc: { fontSize: 12, color: C.textSecondary },
  shipCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: C.borderLight },
  shipGrad: { padding: 18 },
  shipHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shipIconWrap: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  shipTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  shipDesc: { fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 17 },
  shipBullets: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 16 },
  shipBullet: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shipBulletText: { fontSize: 12, fontWeight: '600' as const, color: C.text },
  directoryCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  directoryIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  directoryTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  directoryDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
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
