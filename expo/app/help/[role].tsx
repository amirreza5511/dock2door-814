import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check, Sparkles } from 'lucide-react-native';
import C from '@/constants/colors';
import { getRoleDoc, type ScreenDoc, type MockKind } from '@/constants/help';
import ScreenMock from '@/components/help/ScreenMock';

export default function RoleManual() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ role: string; screen?: string }>();
  const role = getRoleDoc(params.role ?? '');
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  const focusScreen = typeof params.screen === 'string' ? params.screen : undefined;

  useEffect(() => {
    if (!focusScreen) return;
    const t = setTimeout(() => {
      const y = offsets.current[focusScreen];
      if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
    }, 350);
    return () => clearTimeout(t);
  }, [focusScreen]);

  const accent = role?.color ?? C.accent;

  const header = useMemo(() => {
    if (!role) return null;
    const Icon = role.icon;
    return (
      <View style={[styles.hero, { backgroundColor: role.colorDim, borderColor: accent }]}>
        <View style={[styles.heroIcon, { backgroundColor: C.bgSecondary }]}>
          <Icon size={26} color={accent} />
        </View>
        <Text style={styles.heroTitle}>{role.name}</Text>
        <Text style={styles.heroTagline}>{role.tagline}</Text>
        <Text style={styles.heroOverview}>{role.overview}</Text>
      </View>
    );
  }, [role, accent]);

  if (!role) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + 80, alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFound}>Manual not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.notFoundBtn}>
          <Text style={styles.notFoundBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{role.name} Manual</Text>
        <TouchableOpacity onPress={() => router.push('/help/chat' as never)} style={styles.aiBtn}>
          <Sparkles size={16} color={accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {header}

        <Text style={styles.sectionLabel}>{role.screens.length} SCREENS · STEP BY STEP</Text>

        {role.screens.map((s, i) => (
          <View
            key={s.id}
            onLayout={(e) => { offsets.current[s.id] = e.nativeEvent.layout.y; }}
            style={[styles.screenCard, focusScreen === s.id && { borderColor: accent }]}
          >
            <View style={styles.screenHead}>
              <View style={[styles.stepNum, { backgroundColor: role.colorDim }]}>
                <Text style={[styles.stepNumText, { color: accent }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.screenTitle}>{s.title}</Text>
                <Text style={styles.screenSummary}>{s.summary}</Text>
              </View>
            </View>

            <ScreenMock doc={s} accent={accent} />

            <View style={styles.actions}>
              {s.actions.map((a) => (
                <View key={a} style={styles.actionRow}>
                  <View style={[styles.actionDot, { backgroundColor: role.colorDim }]}>
                    <Check size={11} color={accent} />
                  </View>
                  <Text style={styles.actionText}>{a}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity style={[styles.askCard, { borderColor: accent }]} onPress={() => router.push('/help/chat' as never)}>
          <Sparkles size={18} color={accent} />
          <Text style={styles.askText}>Still stuck? Ask the AI assistant</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

export type { MockKind, ScreenDoc };

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800' as const, color: C.text },
  aiBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },

  scroll: { padding: 16, gap: 8 },

  hero: { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 8 },
  heroIcon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.4 },
  heroTagline: { fontSize: 13, color: C.textSecondary, marginTop: 2, marginBottom: 10 },
  heroOverview: { fontSize: 14, color: C.text, lineHeight: 21, opacity: 0.92 },

  sectionLabel: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, letterSpacing: 1.2, marginTop: 14, marginBottom: 6 },

  screenCard: {
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10, gap: 12,
  },
  screenHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 13, fontWeight: '800' as const },
  screenTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  screenSummary: { fontSize: 13, color: C.textSecondary, marginTop: 2, lineHeight: 18 },

  actions: { gap: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionDot: { width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1, fontSize: 13, color: C.text, lineHeight: 18 },

  askCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 6,
  },
  askText: { fontSize: 14, fontWeight: '700' as const, color: C.text },

  notFound: { fontSize: 16, color: C.textSecondary, marginBottom: 16 },
  notFoundBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  notFoundBtnText: { color: C.text, fontWeight: '700' as const },
});
