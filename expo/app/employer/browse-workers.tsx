import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Search, CheckCircle, MapPin, DollarSign, Users, ChevronRight } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';

type SkillFilter = 'All' | 'General' | 'Driver' | 'Forklift' | 'HighReach';

const SKILL_FILTERS: SkillFilter[] = ['All', 'General', 'Driver', 'Forklift', 'HighReach'];

interface WorkerRow {
  id: string;
  user_id: string;
  display_name: string;
  skills: string[];
  coverage_cities: string[];
  hourly_expectation: number;
  verified: boolean;
  status: string;
  bio: string | null;
}

async function fetchWorkers(): Promise<WorkerRow[]> {
  const { data, error } = await supabase
    .from('worker_profiles')
    .select('id,display_name,skills,coverage_cities,hourly_expectation,verified,status,bio,user_id')
    .eq('status', 'Active')
    .order('verified', { ascending: false })
    .order('created_at', { ascending: false })
    .returns<WorkerRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default function BrowseWorkers() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<SkillFilter>('All');

  const workersQuery = useQuery({
    queryKey: ['employer-browse-workers'],
    queryFn: fetchWorkers,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const list = workersQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((w) => {
      if (skillFilter !== 'All' && !w.skills.includes(skillFilter)) return false;
      if (q) {
        const nameMatch = w.display_name.toLowerCase().includes(q);
        const cityMatch = (w.coverage_cities ?? []).some((c) => c.toLowerCase().includes(q));
        if (!nameMatch && !cityMatch) return false;
      }
      return true;
    });
  }, [workersQuery.data, search, skillFilter]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerIcon}>
            <Users size={20} color={C.accent} />
          </View>
          <View>
            <Text style={styles.title}>Find Workers</Text>
            <Text style={styles.sub}>{filtered.length} active workers</Text>
          </View>
        </View>

        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or city…"
            placeholderTextColor={C.textMuted}
            returnKeyType="search"
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {SKILL_FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setSkillFilter(f)} style={[styles.chip, skillFilter === f && styles.chipActive]}>
            <Text style={[styles.chipText, skillFilter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {workersQuery.isLoading ? (
        <ScreenFeedback state="loading" title="Loading workers" />
      ) : workersQuery.isError ? (
        <ScreenFeedback state="error" title="Unable to load workers" onRetry={() => void workersQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Users size={40} color={C.textMuted} />
              <Text style={styles.emptyTitle}>No workers found</Text>
              <Text style={styles.emptyText}>Try adjusting your search or skill filter.</Text>
            </View>
          ) : filtered.map((w) => (
            <Card key={w.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.avatarWrap}>
                  <Text style={styles.avatarText}>{(w.display_name ?? 'W').charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{w.display_name}</Text>
                    {w.verified && (
                      <View style={styles.verifiedBadge}>
                        <CheckCircle size={11} color={C.green} />
                        <Text style={styles.verifiedText}>Verified</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.infoRow}>
                    <DollarSign size={12} color={C.green} />
                    <Text style={styles.infoText}>${w.hourly_expectation}/hr</Text>
                    {(w.coverage_cities ?? []).length > 0 && (
                      <>
                        <MapPin size={12} color={C.blue} />
                        <Text style={styles.infoText} numberOfLines={1}>
                          {(w.coverage_cities ?? []).slice(0, 2).join(', ')}
                          {(w.coverage_cities ?? []).length > 2 ? ` +${(w.coverage_cities ?? []).length - 2}` : ''}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              </View>

              {(w.skills ?? []).length > 0 && (
                <View style={styles.skillsRow}>
                  {w.skills.map((s) => (
                    <View key={s} style={styles.skillChip}>
                      <Text style={styles.skillText}>{s}</Text>
                    </View>
                  ))}
                </View>
              )}

              {w.bio ? (
                <Text style={styles.bio} numberOfLines={2}>{w.bio}</Text>
              ) : null}

              <TouchableOpacity
                onPress={() => router.push({ pathname: '/worker/public-profile', params: { workerId: w.user_id } })}
                style={styles.viewBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.viewBtnText}>View Profile</Text>
                <ChevronRight size={15} color={C.accent} />
              </TouchableOpacity>
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.text },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 14, gap: 12 },
  card: { gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatarWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.accent },
  avatarText: { fontSize: 18, fontWeight: '800' as const, color: C.accent },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.greenDim, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  verifiedText: { fontSize: 10, color: C.green, fontWeight: '700' as const },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  infoText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  skillsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  skillChip: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.accentDim, borderRadius: 6 },
  skillText: { fontSize: 11, color: C.accent, fontWeight: '600' as const },
  bio: { fontSize: 13, color: C.textMuted, lineHeight: 18 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accentDim, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: C.accent + '50' },
  viewBtnText: { fontSize: 14, color: C.accent, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
});
