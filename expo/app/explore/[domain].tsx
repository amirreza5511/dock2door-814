import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Compass, ChevronRight, UserPlus, Building2 } from 'lucide-react-native';
import C from '@/constants/colors';
import { DOMAIN_MAP } from '@/constants/domains';
import type { Domain } from '@/lib/access';
import { useExploreStore } from '@/store/explore';

const VALID: Domain[] = ['labour', 'logistics', 'freight', 'drayage', 'marketplace', 'globalfreight'];

export default function DomainIntro() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ domain: string }>();
  const startExplore = useExploreStore((s) => s.startExplore);

  const domainKey = (params.domain ?? '') as Domain;
  const domain = VALID.includes(domainKey) ? DOMAIN_MAP[domainKey] : null;

  if (!domain) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 40, alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFound}>World not found.</Text>
        <TouchableOpacity onPress={() => router.replace('/' as never)} style={styles.backHome}>
          <Text style={styles.backHomeText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const exploreAs = (role: typeof domain.roles[number]) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startExplore(role.role, domain.key);
    router.push(role.route as never);
  };

  const DomainIcon = domain.icon;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={[domain.bg, C.bg, C.bg]} style={styles.heroBg} />

        <View style={[styles.nav, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.iconWrap, { backgroundColor: domain.bg }]}>
            <DomainIcon size={32} color={domain.color} />
          </View>
          <Text style={[styles.badge, { color: domain.color }]}>{domain.badge} · {domain.tagline}</Text>
          <Text style={styles.title}>{domain.title}</Text>
          <Text style={styles.desc}>{domain.desc}</Text>
        </View>

        {/* Capabilities */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHAT YOU CAN DO</Text>
          {domain.features.map((f) => {
            const FIcon = f.icon;
            return (
              <View key={f.title} style={styles.featureCard}>
                <View style={[styles.featureIcon, { backgroundColor: domain.bg }]}>
                  <FIcon size={20} color={domain.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.desc}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Explore roles */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>EXPLORE AS</Text>
          <Text style={styles.exploreHint}>
            Jump into any role’s real dashboard with sample data — no account needed.
          </Text>
          {domain.roles.map((r) => {
            const RIcon = r.icon;
            return (
              <TouchableOpacity
                key={`${r.role}-${r.label}`}
                style={[styles.roleCard, { borderColor: domain.color }]}
                activeOpacity={0.85}
                onPress={() => exploreAs(r)}
                testID={`explore-role-${r.role}`}
              >
                <View style={[styles.roleIcon, { backgroundColor: domain.bg }]}>
                  <RIcon size={20} color={domain.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleLabel}>{r.label}</Text>
                  <Text style={styles.roleDesc}>{r.desc}</Text>
                </View>
                <View style={[styles.rolePlay, { backgroundColor: domain.color }]}>
                  <Compass size={16} color={C.white} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Directory + signup */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.directoryBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/directory' as never)}
          >
            <Building2 size={18} color={C.text} />
            <Text style={styles.directoryText}>Browse companies & jobs</Text>
            <ChevronRight size={18} color={C.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signupBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/auth/signup' as never)}
          >
            <UserPlus size={16} color={C.white} />
            <Text style={styles.signupText}>Create a free account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 380 },
  nav: { paddingHorizontal: 16, paddingBottom: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  iconWrap: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  badge: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' as const },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 12 },
  desc: { fontSize: 15, color: C.textSecondary, lineHeight: 23 },
  section: { paddingHorizontal: 24, marginTop: 20 },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.5, marginBottom: 12 },
  exploreHint: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: 14, marginTop: -4 },
  featureCard: {
    flexDirection: 'row', gap: 14, alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10,
  },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  featureDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  roleCard: {
    flexDirection: 'row', gap: 14, alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1,
    padding: 16, marginBottom: 10,
  },
  roleIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  roleLabel: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  roleDesc: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  rolePlay: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  directoryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 16, marginBottom: 12,
  },
  directoryText: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: C.text },
  signupBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15,
  },
  signupText: { fontSize: 15, fontWeight: '700' as const, color: C.white },
  notFound: { fontSize: 16, color: C.text, marginBottom: 16 },
  backHome: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  backHomeText: { color: C.text, fontWeight: '600' as const },
});
