import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Search, Building2, Star, MapPin, BadgeCheck, Briefcase, ArrowRight } from 'lucide-react-native';
import C from '@/constants/colors';
import { DOMAIN_LABELS, type Domain } from '@/lib/access';
import {
  SAMPLE_DIRECTORY_COMPANIES, SAMPLE_DIRECTORY_JOBS,
  type DirectoryCompany, type DirectoryJob,
} from '@/lib/exploreSamples';
import { useExploreStore } from '@/store/explore';
import { useAuthStore } from '@/store/auth';

const DOMAIN_COLOR: Record<Domain, string> = {
  labour: C.purple,
  logistics: C.accent,
  freight: C.green,
  drayage: C.blue,
  marketplace: C.yellow,
  globalfreight: C.blue,
};

type Tab = 'companies' | 'jobs';
type Filter = Domain | 'all';

const FILTERS: Filter[] = ['all', 'labour', 'logistics', 'freight', 'drayage', 'marketplace', 'globalfreight'];

/** Public company & jobs directory — browsable by everyone, even without an account. */
export default function DirectoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const requestAction = useExploreStore((s) => s.requestAction);
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<Tab>('companies');
  const [search, setSearch] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');

  const companies = useMemo<DirectoryCompany[]>(() => {
    const q = search.trim().toLowerCase();
    return SAMPLE_DIRECTORY_COMPANIES.filter((c) => {
      if (filter !== 'all' && c.domain !== filter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.roleLabel.toLowerCase().includes(q);
    });
  }, [search, filter]);

  const jobs = useMemo<DirectoryJob[]>(() => {
    const q = search.trim().toLowerCase();
    return SAMPLE_DIRECTORY_JOBS.filter((j) => {
      if (filter !== 'all' && j.domain !== filter) return false;
      if (!q) return true;
      return j.title.toLowerCase().includes(q) || j.city.toLowerCase().includes(q) || j.company.toLowerCase().includes(q);
    });
  }, [search, filter]);

  const gate = (label: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (user) {
      router.push('/' as never);
      return;
    }
    requestAction(label);
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Directory</Text>
          <Text style={styles.subtitle}>Companies & open work across Dock2Door</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, city or type…"
          placeholderTextColor={C.textMuted}
        />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'companies' && styles.tabActive]}
          onPress={() => setTab('companies')}
        >
          <Building2 size={15} color={tab === 'companies' ? C.accent : C.textSecondary} />
          <Text style={[styles.tabText, tab === 'companies' && styles.tabTextActive]}>Companies</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'jobs' && styles.tabActive]}
          onPress={() => setTab('jobs')}
        >
          <Briefcase size={15} color={tab === 'jobs' ? C.accent : C.textSecondary} />
          <Text style={[styles.tabText, tab === 'jobs' && styles.tabTextActive]}>Jobs & loads</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f === 'all' ? 'All' : DOMAIN_LABELS[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'companies'
          ? companies.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.cardIcon, { backgroundColor: DOMAIN_COLOR[c.domain] + '20' }]}>
                    <Building2 size={20} color={DOMAIN_COLOR[c.domain]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.cardName} numberOfLines={1}>{c.name}</Text>
                      {c.verified ? <BadgeCheck size={15} color={C.blue} /> : null}
                    </View>
                    <View style={styles.metaRow}>
                      <View style={[styles.roleTag, { backgroundColor: DOMAIN_COLOR[c.domain] + '18' }]}>
                        <Text style={[styles.roleTagText, { color: DOMAIN_COLOR[c.domain] }]}>{c.roleLabel}</Text>
                      </View>
                      <MapPin size={11} color={C.textMuted} />
                      <Text style={styles.metaText}>{c.city}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.blurb}>{c.blurb}</Text>
                <View style={styles.cardFooter}>
                  <View style={styles.ratingRow}>
                    <Star size={13} color={C.yellow} fill={C.yellow} />
                    <Text style={styles.ratingText}>{c.rating.toFixed(1)}</Text>
                    <Text style={styles.reviewText}>({c.reviews})</Text>
                  </View>
                  <TouchableOpacity style={styles.contactBtn} onPress={() => gate(`Contact ${c.name}`)}>
                    <Text style={styles.contactBtnText}>Contact</Text>
                    <ArrowRight size={14} color={C.white} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          : jobs.map((j) => (
              <TouchableOpacity key={j.id} style={styles.card} activeOpacity={0.85} onPress={() => gate(`Apply to ${j.title}`)}>
                <View style={styles.jobTop}>
                  <View style={[styles.jobTag, { backgroundColor: DOMAIN_COLOR[j.domain] + '18' }]}>
                    <Text style={[styles.jobTagText, { color: DOMAIN_COLOR[j.domain] }]}>{j.tag}</Text>
                  </View>
                  <Text style={styles.jobPay}>{j.pay}</Text>
                </View>
                <Text style={styles.jobTitle}>{j.title}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{j.company}</Text>
                  <MapPin size={11} color={C.textMuted} />
                  <Text style={styles.metaText}>{j.city}</Text>
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.jobWhen}>{j.when}</Text>
                  <View style={styles.applyRow}>
                    <Text style={styles.applyText}>View & apply</Text>
                    <ArrowRight size={14} color={C.accent} />
                  </View>
                </View>
              </TouchableOpacity>
            ))}

        {(tab === 'companies' ? companies.length : jobs.length) === 0 ? (
          <View style={styles.empty}>
            <Search size={36} color={C.textMuted} />
            <Text style={styles.emptyText}>No matches. Try a different search or filter.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 14, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14, height: 44 },
  tabs: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  tabActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  tabText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  tabTextActive: { color: C.accent },
  filterScroll: { maxHeight: 52 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  chipActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  chipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  chipTextActive: { color: C.accent },
  list: { paddingHorizontal: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { flexShrink: 1, fontSize: 16, fontWeight: '800' as const, color: C.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  roleTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  roleTagText: { fontSize: 11, fontWeight: '700' as const },
  metaText: { fontSize: 12, color: C.textMuted },
  blurb: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  reviewText: { fontSize: 12, color: C.textMuted },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  contactBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.white },
  jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  jobTagText: { fontSize: 11, fontWeight: '800' as const },
  jobPay: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  jobTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  jobWhen: { fontSize: 12, color: C.textMuted },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  applyText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const, maxWidth: 260 },
});
