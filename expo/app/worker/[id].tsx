import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, Star, Shield, MapPin } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import Card from '@/components/ui/Card';

interface WorkerPublic {
  user_id: string;
  display_name: string;
  bio: string | null;
  tagline: string | null;
  skills: string[] | null;
  coverage_cities: string[] | null;
  hourly_expectation: number | null;
  verified: boolean;
}

interface PhotoRow { id: string; file_path: string; caption: string | null; visibility: string; }
interface BadgeRow { code: string }
interface ReviewSummary { avg_rating: number | null; review_count: number | null; }

export default function WorkerPublicProfile() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = String(id);

  const profileQ = useQuery({
    queryKey: ['worker-public', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<WorkerPublic | null> => {
      const { data, error } = await supabase
        .from('worker_profiles')
        .select('user_id,display_name,bio,tagline,skills,coverage_cities,hourly_expectation,verified')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as WorkerPublic | null;
    },
  });

  const photosQ = useQuery({
    queryKey: ['worker-photos', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<PhotoRow[]> => {
      const { data, error } = await supabase
        .from('work_photos')
        .select('id,file_path,caption,visibility')
        .eq('worker_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(24);
      if (error) return [];
      return (data ?? []) as PhotoRow[];
    },
  });

  const badgesQ = useQuery({
    queryKey: ['worker-badges', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<BadgeRow[]> => {
      const { data, error } = await supabase
        .from('worker_badges')
        .select('code')
        .eq('worker_user_id', userId);
      if (error) return [];
      return (data ?? []) as BadgeRow[];
    },
  });

  const summaryQ = useQuery({
    queryKey: ['worker-summary', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ReviewSummary | null> => {
      const { data, error } = await supabase
        .from('review_summaries')
        .select('avg_rating,review_count')
        .eq('target_kind', 'worker')
        .eq('target_id', userId)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as ReviewSummary | null;
    },
  });

  const profile = profileQ.data;
  const initial = profile?.display_name?.charAt(0) ?? '?';
  const badges = badgesQ.data ?? [];
  const photos = photosQ.data ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{profile?.display_name ?? 'Worker'}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}>
        <View style={styles.heroRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.heroStats}>
            <Stat label="Shifts" value={String(summaryQ.data?.review_count ?? 0)} />
            <Stat label="Rating" value={summaryQ.data?.avg_rating ? summaryQ.data.avg_rating.toFixed(1) : '—'} />
            <Stat label="Badges" value={String(badges.length)} />
          </View>
        </View>

        <Text style={styles.name}>{profile?.display_name ?? '—'}</Text>
        {profile?.tagline ? <Text style={styles.tagline}>{profile.tagline}</Text> : null}
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        <View style={styles.badgeRow}>
          {profile?.verified && (
            <View style={[styles.badge, { backgroundColor: C.greenDim }]}>
              <Shield size={11} color={C.green} />
              <Text style={[styles.badgeText, { color: C.green }]}>Verified</Text>
            </View>
          )}
          {badges.map((b) => (
            <View key={b.code} style={[styles.badge, { backgroundColor: b.code === 'no_show_risk' ? C.redDim : C.accentDim }]}>
              <Award size={11} color={b.code === 'no_show_risk' ? C.red : C.accent} />
              <Text style={[styles.badgeText, { color: b.code === 'no_show_risk' ? C.red : C.accent }]}>{b.code.replace(/_/g, ' ')}</Text>
            </View>
          ))}
        </View>

        {(profile?.skills?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.chipsRow}>
              {(profile?.skills ?? []).map((s) => (
                <View key={s} style={styles.skillChip}><Text style={styles.skillText}>{s}</Text></View>
              ))}
            </View>
          </View>
        )}

        {(profile?.coverage_cities?.length ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Coverage</Text>
            <View style={styles.chipsRow}>
              {(profile?.coverage_cities ?? []).map((c) => (
                <View key={c} style={styles.cityChip}>
                  <MapPin size={11} color={C.blue} />
                  <Text style={styles.cityText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work Gallery</Text>
          {photos.length === 0 ? (
            <Card><Text style={styles.emptyText}>No photos yet.</Text></Card>
          ) : (
            <View style={styles.grid}>
              {photos.map((p) => (
                <View key={p.id} style={styles.gridCell}>
                  {Platform.OS === 'web' ? (
                    <View style={styles.photoPlaceholder}><Star size={18} color={C.textMuted} /></View>
                  ) : (
                    <Image source={{ uri: p.file_path }} style={styles.photo} resizeMode="cover" />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  scroll: { padding: 20, gap: 12 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.accent },
  avatarText: { fontSize: 38, fontWeight: '800' as const, color: C.accent },
  heroStats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginTop: 12 },
  tagline: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  bio: { fontSize: 14, color: C.textSecondary, lineHeight: 22 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  section: { gap: 8, marginTop: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skillChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.accentDim },
  skillText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  cityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.blueDim },
  cityText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  emptyText: { color: C.textMuted, fontSize: 13, textAlign: 'center', fontStyle: 'italic' as const },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gridCell: { width: '32.5%', aspectRatio: 1, backgroundColor: C.card, borderRadius: 6, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
});
