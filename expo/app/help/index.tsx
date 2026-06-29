import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ChevronLeft, Search, Sparkles, ChevronRight, BookOpen, MessageCircle, Bell, Star,
} from 'lucide-react-native';
import C from '@/constants/colors';
import {
  HELP_ROLES, HELP_WORLDS, SHARED_HELP, ROLE_TO_HELP_KEY, type RoleDoc,
} from '@/constants/help';
import { useAuthStore } from '@/store/auth';
import { useHelpLanguage } from '@/store/help-language';
import { getLang, tUI } from '@/constants/i18n';
import { useTranslator } from '@/hooks/useTranslator';
import LanguagePicker from '@/components/help/LanguagePicker';

const SHARED_ICON: Record<string, typeof MessageCircle> = {
  messages: MessageCircle,
  notifications: Bell,
  assistant: Sparkles,
  reviews: Star,
};

export default function HelpHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const lang = useHelpLanguage((s) => s.lang);
  const hydrate = useHelpLanguage((s) => s.hydrate);
  const [query, setQuery] = useState<string>('');

  useEffect(() => { void hydrate(); }, [hydrate]);

  const rtl = getLang(lang).rtl;
  const dirText = rtl ? ('right' as const) : ('left' as const);

  const myKey = user ? ROLE_TO_HELP_KEY[user.role] : undefined;
  const myRole = useMemo<RoleDoc | undefined>(
    () => HELP_ROLES.find((r) => r.key === myKey),
    [myKey],
  );

  // Translatable card text: role names/taglines, world titles/blurbs, shared cards.
  const dynamicTexts = useMemo<string[]>(() => {
    const out: string[] = [];
    for (const r of HELP_ROLES) { out.push(r.name, r.tagline); }
    for (const w of HELP_WORLDS) { out.push(w.title, w.blurb); }
    for (const s of SHARED_HELP) { out.push(s.title, s.summary); }
    return out;
  }, []);
  const { tx } = useTranslator(dynamicTexts, lang);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length === 0) return [];
    const out: { roleKey: string; roleName: string; screenId: string; title: string; summary: string }[] = [];
    for (const role of HELP_ROLES) {
      for (const s of role.screens) {
        if (
          s.title.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          role.name.toLowerCase().includes(q) ||
          s.actions.some((a) => a.toLowerCase().includes(q))
        ) {
          out.push({ roleKey: role.key, roleName: role.name, screenId: s.id, title: s.title, summary: s.summary });
        }
      }
    }
    return out.slice(0, 20);
  }, [q]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIcon}>
            <BookOpen size={18} color={C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{tUI(lang, 'helpCenter')}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{tUI(lang, 'helpCenterSub')}</Text>
          </View>
        </View>
        <LanguagePicker />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search */}
        <View style={styles.searchBar}>
          <Search size={18} color={C.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tUI(lang, 'searchPlaceholder')}
            placeholderTextColor={C.textMuted}
            style={[styles.searchInput, { textAlign: dirText }]}
            autoCorrect={false}
          />
        </View>

        {q.length > 0 ? (
          <View style={styles.searchResults}>
            <Text style={styles.sectionLabel}>{matches.length} {matches.length === 1 ? tUI(lang, 'result') : tUI(lang, 'results')}</Text>
            {matches.map((m) => (
              <TouchableOpacity
                key={`${m.roleKey}-${m.screenId}`}
                style={styles.resultRow}
                onPress={() => router.push(`/help/${m.roleKey}?screen=${m.screenId}` as never)}
              >
                <View style={styles.resultText}>
                  <Text style={[styles.resultTitle, { textAlign: dirText }]}>{tx(m.title)}</Text>
                  <Text style={[styles.resultSub, { textAlign: dirText }]} numberOfLines={1}>{tx(m.roleName)} · {tx(m.summary)}</Text>
                </View>
                <ChevronRight size={18} color={C.textMuted} />
              </TouchableOpacity>
            ))}
            {matches.length === 0 && (
              <Text style={styles.noResults}>{tUI(lang, 'noMatches')}</Text>
            )}
          </View>
        ) : (
          <>
            {/* AI help card */}
            <TouchableOpacity
              style={styles.aiCard}
              activeOpacity={0.9}
              onPress={() => router.push('/help/chat' as never)}
            >
              <View style={styles.aiIcon}>
                <Sparkles size={22} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.aiTitle, { textAlign: dirText }]}>{tUI(lang, 'askAi')}</Text>
                <Text style={[styles.aiSub, { textAlign: dirText }]}>{tUI(lang, 'askAiSub')}</Text>
              </View>
              <ChevronRight size={20} color={C.accent} />
            </TouchableOpacity>

            {/* Your role shortcut */}
            {myRole && (
              <>
                <Text style={styles.sectionLabel}>{tUI(lang, 'yourManual')}</Text>
                <RoleCard role={myRole} highlighted tx={tx} dirText={dirText} onPress={() => router.push(`/help/${myRole.key}` as never)} />
              </>
            )}

            {/* All manuals grouped by world */}
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>{tUI(lang, 'allManuals')}</Text>
            {HELP_WORLDS.map((w) => {
              const roles = HELP_ROLES.filter((r) => r.world === w.key);
              if (roles.length === 0) return null;
              return (
                <View key={w.key} style={styles.worldBlock}>
                  <View style={styles.worldHeader}>
                    <View style={[styles.worldDot, { backgroundColor: w.color }]} />
                    <Text style={styles.worldTitle}>{tx(w.title)}</Text>
                  </View>
                  <Text style={[styles.worldBlurb, { textAlign: dirText }]}>{tx(w.blurb)}</Text>
                  {roles.map((r) => (
                    <RoleCard key={r.key} role={r} tx={tx} dirText={dirText} onPress={() => router.push(`/help/${r.key}` as never)} />
                  ))}
                </View>
              );
            })}

            {/* Shared screens */}
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>{tUI(lang, 'everywhere')}</Text>
            <View style={styles.sharedGrid}>
              {SHARED_HELP.map((s) => {
                const Icon = SHARED_ICON[s.id] ?? BookOpen;
                return (
                  <View key={s.id} style={styles.sharedCard}>
                    <View style={styles.sharedIcon}>
                      <Icon size={18} color={C.accent} />
                    </View>
                    <Text style={[styles.sharedTitle, { textAlign: dirText }]}>{tx(s.title)}</Text>
                    <Text style={[styles.sharedSub, { textAlign: dirText }]} numberOfLines={3}>{tx(s.summary)}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function RoleCard({ role, onPress, highlighted, tx, dirText }: { role: RoleDoc; onPress: () => void; highlighted?: boolean; tx: (s: string) => string; dirText: 'left' | 'right' }) {
  const Icon = role.icon;
  return (
    <TouchableOpacity
      style={[styles.roleCard, highlighted && { borderColor: role.color }]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={[styles.roleIcon, { backgroundColor: role.colorDim }]}>
        <Icon size={20} color={role.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.roleName, { textAlign: dirText }]}>{tx(role.name)}</Text>
        <Text style={[styles.roleTagline, { textAlign: dirText }]} numberOfLines={1}>{tx(role.tagline)}</Text>
      </View>
      <View style={styles.roleMeta}>
        <Text style={styles.roleCount}>{role.screens.length}</Text>
        <ChevronRight size={18} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },

  scroll: { padding: 16, gap: 8 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, height: 48, marginBottom: 8,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },

  searchResults: { gap: 8 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  resultText: { flex: 1 },
  resultTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  resultSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  noResults: { fontSize: 13, color: C.textMuted, paddingVertical: 12, textAlign: 'center' as const },

  aiCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.accent,
    padding: 16, marginBottom: 8,
  },
  aiIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  aiSub: { fontSize: 12, color: C.textSecondary, marginTop: 2, lineHeight: 17 },

  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.2, marginTop: 12, marginBottom: 8 },

  worldBlock: { marginBottom: 4 },
  worldHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 2 },
  worldDot: { width: 8, height: 8, borderRadius: 3 },
  worldTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  worldBlurb: { fontSize: 12, color: C.textSecondary, marginBottom: 10 },

  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 8,
  },
  roleIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  roleName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  roleTagline: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  roleMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleCount: { fontSize: 12, color: C.textMuted, fontWeight: '700' as const },

  sharedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sharedCard: {
    width: '48.5%', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 6,
  },
  sharedIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  sharedTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  sharedSub: { fontSize: 12, color: C.textSecondary, lineHeight: 16 },
});
