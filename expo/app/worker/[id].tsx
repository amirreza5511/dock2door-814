import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Award, Star, MapPin, DollarSign, CheckCircle, Camera, Zap,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { getSignedUrl } from '@/lib/storage-files';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';

interface WorkerPublic {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  tagline: string | null;
  skills: string[] | null;
  coverage_cities: string[] | null;
  hourly_expectation: number | null;
  verified: boolean;
  status: string;
  profile_photo_path: string | null;
  avatar_path: string | null;
}

interface CertRow { id: string; type: string; expiry_date: string | null; status: string; }
interface PhotoRow { id: string; file_path: string; caption: string | null; visibility: string; moderation_status: string; }
interface ReviewRow { id: string; rating: number; comment: string | null; created_at: string; reviewer_user_id: string; reviewer_company_id: string | null; reviewer_company: { name: string } | null; }
interface AssignmentCountRow { id: string; status: string; }
interface AvailabilityRow { date: string; available: boolean; }

async function fetchWorkerById(userId: string) {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [profileRes, certsRes, photosRes, reviewsRes, assignmentsRes] = await Promise.all([
    supabase
      .from('worker_profiles')
      .select('id,user_id,display_name,bio,tagline,skills,coverage_cities,hourly_expectation,verified,status,profile_photo_path,avatar_path')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('worker_certifications')
      .select('id,type,expiry_date,status')
      .eq('worker_user_id', userId)
      .eq('status', 'Approved'),
    supabase
      .from('work_photos')
      .select('id,file_path,caption,visibility,moderation_status')
      .eq('worker_user_id', userId)
      .in('visibility', ['public', 'company'])
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('reviews')
      .select('id,rating,comment,created_at,reviewer_user_id,reviewer_company_id,reviewer_company:reviewer_company_id(name)')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('shift_assignments')
      .select('id,status')
      .eq('worker_user_id', userId),
  ]);

  // Availability — gracefully handle if table doesn't exist
  let availability: AvailabilityRow[] = [];
  try {
    const availRes = await supabase
      .from('worker_availability')
      .select('date,available')
      .eq('worker_user_id', userId)
      .gte('date', today)
      .lte('date', nextWeek);
    availability = (availRes.data ?? []) as AvailabilityRow[];
  } catch {
    // table may not exist yet — ignore
  }

  return {
    profile: (profileRes.data ?? null) as WorkerPublic | null,
    certs: (certsRes.data ?? []) as CertRow[],
    photos: (photosRes.data ?? []) as PhotoRow[],
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
    assignments: (assignmentsRes.data ?? []) as AssignmentCountRow[],
    availability,
  };
}

async function loadPhotoUrls(photos: PhotoRow[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    photos.map(async (p) => {
      try {
        const url = await getSignedUrl('worker-photos', p.file_path, 120);
        return [p.id, url] as [string, string];
      } catch {
        return [p.id, ''] as [string, string];
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, v]) => v));
}

// Generate a 7-day row Mon–Sun starting from today
function getWeekDays(): { label: string; isoDate: string }[] {
  const result: { label: string; isoDate: string }[] = [];
  const labels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const today = new Date();
  // Start from Monday of this week
  const dayOfWeek = (today.getDay() + 6) % 7; // 0=Mon
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dayOfWeek + i);
    result.push({
      label: labels[i],
      isoDate: d.toISOString().split('T')[0],
    });
  }
  return result;
}

export default function WorkerPublicProfileById() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = String(id);

  const profileQ = useQuery({
    queryKey: ['worker-by-id', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchWorkerById(userId),
    staleTime: 30_000,
  });

  const { profile, certs, photos, reviews, assignments, availability } = profileQ.data ?? {
    profile: null, certs: [], photos: [], reviews: [], assignments: [], availability: [],
  };

  const avatarPath = profile?.profile_photo_path ?? profile?.avatar_path ?? '';
  const avatarQ = useQuery({
    queryKey: ['worker-id-avatar', userId, avatarPath],
    queryFn: () => avatarPath ? getSignedUrl('worker-photos', avatarPath, 120) : Promise.resolve(''),
    enabled: Boolean(avatarPath),
    staleTime: 60_000,
  });

  const photoUrlsQ = useQuery({
    queryKey: ['worker-id-photos', userId, photos.map((p) => p.id).join(',')],
    queryFn: () => loadPhotoUrls(photos),
    enabled: photos.length > 0,
    staleTime: 60_000,
  });
  const photoUrls = photoUrlsQ.data ?? {};

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  // Reliability
  const reliability = useMemo(() => {
    const completed = assignments.filter((a) => ['Completed', 'HoursConfirmed', 'Confirmed'].includes(a.status)).length;
    const noShows = assignments.filter((a) => a.status === 'NoShow').length;
    const total = completed + noShows;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total: completed, noShows, pct };
  }, [assignments]);

  // Availability dots
  const weekDays = getWeekDays();
  const availMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const a of availability) m[a.date] = a.available;
    return m;
  }, [availability]);

  const initial = profile?.display_name?.charAt(0) ?? '?';

  if (profileQ.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>Worker profile not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backFallback}>
          <Text style={styles.backFallbackText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{profile.display_name ?? 'Worker'}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── 1. Hero (smaller 60px avatar) ─── */}
        <View style={styles.heroCard}>
          <View style={styles.avatarWrap}>
            {avatarQ.data ? (
              <Image source={{ uri: avatarQ.data }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
          <Text style={styles.displayName}>{profile.display_name}</Text>
          {profile.tagline ? <Text style={styles.tagline}>{profile.tagline}</Text> : null}
          <View style={styles.badgeRow}>
            {profile.verified && (
              <View style={styles.verifiedBadge}>
                <CheckCircle size={12} color={C.green} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
            <StatusBadge status={profile.status} />
          </View>
        </View>

        {/* ─── 2. Decision Row ─── */}
        <Card style={styles.decisionCard}>
          <Text style={styles.decisionTitle}>EMPLOYER DECISION STATS</Text>
          <View style={styles.decisionRow}>
            <View style={styles.dStat}>
              <Text style={[styles.dStatVal, { color: reliability.pct > 80 ? C.green : reliability.pct > 50 ? C.yellow : C.red }]}>
                {reliability.total > 0 ? `${reliability.pct}%` : '—'}
              </Text>
              <Text style={styles.dStatLbl}>Completion</Text>
              {reliability.total > 0 && (
                <Text style={styles.dStatSub}>{reliability.total} shifts</Text>
              )}
            </View>
            <View style={[styles.dStat, styles.dStatMid]}>
              <Text style={[styles.dStatVal, { color: avgRating > 0 ? C.yellow : C.textMuted }]}>
                {avgRating > 0 ? avgRating.toFixed(1) : '—'}
              </Text>
              <Text style={styles.dStatLbl}>Rating</Text>
              {reviews.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 2, justifyContent: 'center' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={9} color={n <= Math.round(avgRating) ? C.yellow : C.border} fill={n <= Math.round(avgRating) ? C.yellow : 'transparent'} />
                  ))}
                </View>
              )}
            </View>
            <View style={styles.dStat}>
              <Zap size={16} color={C.blue} />
              <Text style={styles.dStatLbl}>Response</Text>
              <Text style={styles.dStatSub}>{'<2h typically'}</Text>
            </View>
          </View>
        </Card>

        {/* ─── 3. Availability This Week ─── */}
        {(availability.length > 0 || true) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Availability This Week</Text>
            <Card>
              <View style={styles.weekRow}>
                {weekDays.map(({ label, isoDate }) => {
                  const isSet = isoDate in availMap;
                  const isAvail = availMap[isoDate];
                  const isToday = isoDate === new Date().toISOString().split('T')[0];
                  return (
                    <View key={isoDate} style={[styles.dayCol, isToday && styles.dayColToday]}>
                      <Text style={[styles.dayLabel, isToday && { color: C.accent }]}>{label}</Text>
                      {isSet ? (
                        <View style={[styles.availDot, { backgroundColor: isAvail ? C.green : C.border }]} />
                      ) : (
                        <View style={styles.availDotEmpty} />
                      )}
                    </View>
                  );
                })}
              </View>
              <View style={styles.availLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: C.green }]} />
                  <Text style={styles.legendText}>Available</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: C.border }]} />
                  <Text style={styles.legendText}>Unavailable</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={styles.availDotEmpty} />
                  <Text style={styles.legendText}>Not set</Text>
                </View>
              </View>
            </Card>
          </View>
        )}

        {/* ─── 4. Certifications (moved UP) ─── */}
        {certs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            <View style={styles.chipRow}>
              {certs.map((c) => (
                <View key={c.id} style={styles.certChip}>
                  <Award size={12} color={C.green} />
                  <Text style={styles.certChipText}>{c.type}</Text>
                  {c.expiry_date ? (
                    <Text style={styles.certExpiry}>exp. {c.expiry_date}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── 5. Skills ─── */}
        {(profile.skills ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.chipRow}>
              {(profile.skills ?? []).map((s) => (
                <View key={s} style={styles.skillChip}>
                  <Text style={styles.skillText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── 6. Coverage Cities ─── */}
        {(profile.coverage_cities ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Coverage Cities</Text>
            <View style={styles.chipRow}>
              {(profile.coverage_cities ?? []).map((c) => (
                <View key={c} style={styles.cityChip}>
                  <MapPin size={11} color={C.blue} />
                  <Text style={styles.cityText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── 7. Bio (moved DOWN) ─── */}
        {profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Card>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </Card>
          </View>
        ) : null}

        {/* ─── 8. Work Gallery ─── */}
        {photos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Work Gallery</Text>
            <View style={styles.photoGrid}>
              {photos.map((p) => (
                <View key={p.id} style={styles.photoCell}>
                  {photoUrls[p.id] ? (
                    <Image source={{ uri: photoUrls[p.id] }} style={styles.photoImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <Camera size={20} color={C.textMuted} />
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── 9. Reviews ─── */}
        <View style={styles.section}>
          <View style={styles.sectionRowBetween}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            {reviews.length > 0 && (
              <View style={styles.avgRating}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    size={14}
                    color={n <= Math.round(avgRating) ? C.yellow : C.border}
                    fill={n <= Math.round(avgRating) ? C.yellow : 'transparent'}
                  />
                ))}
                <Text style={styles.avgRatingText}>{avgRating.toFixed(1)} ({reviews.length})</Text>
              </View>
            )}
          </View>
          {reviews.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No reviews yet.</Text>
            </Card>
          ) : (
            reviews.map((r) => (
              <Card key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      size={13}
                      color={n <= r.rating ? C.yellow : C.border}
                      fill={n <= r.rating ? C.yellow : 'transparent'}
                    />
                  ))}
                  <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
                {(r.reviewer_company?.name) ? (
                  <Text style={styles.reviewerName}>by {r.reviewer_company.name}</Text>
                ) : null}
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: C.text, flex: 1, textAlign: 'center' as const },
  loadingText: { fontSize: 14, color: C.textSecondary },
  backFallback: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.card, borderRadius: 10 },
  backFallbackText: { color: C.accent, fontWeight: '600' as const },
  scroll: { padding: 16 },
  // Hero (60px avatar)
  heroCard: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: C.bgSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 14,
    gap: 6,
  },
  avatarWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.accent,
    marginBottom: 6,
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 30 },
  avatarText: { fontSize: 24, fontWeight: '800' as const, color: C.accent },
  displayName: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  tagline: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  verifiedText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  // Decision Row
  decisionCard: { marginBottom: 14 },
  decisionTitle: { fontSize: 10, fontWeight: '700' as const, color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10 },
  decisionRow: { flexDirection: 'row' },
  dStat: { flex: 1, alignItems: 'center', gap: 4 },
  dStatMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  dStatVal: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  dStatLbl: { fontSize: 11, color: C.textSecondary },
  dStatSub: { fontSize: 10, color: C.textMuted },
  // Availability
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  sectionRowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  dayCol: { alignItems: 'center', gap: 6, flex: 1, paddingVertical: 4 },
  dayColToday: { backgroundColor: C.accent + '15', borderRadius: 8 },
  dayLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  availDot: { width: 10, height: 10, borderRadius: 5 },
  availDotEmpty: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: C.border },
  availLegend: { flexDirection: 'row', gap: 14, justifyContent: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: C.textMuted },
  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.accentDim, borderRadius: 8 },
  skillText: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  cityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.blueDim, borderRadius: 8,
  },
  cityText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  certChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.greenDim, borderRadius: 8,
    borderWidth: 1, borderColor: C.green + '40',
  },
  certChipText: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  certExpiry: { fontSize: 10, color: C.textMuted },
  bioText: { fontSize: 14, color: C.textSecondary, lineHeight: 22 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoCell: {
    width: '31.8%', aspectRatio: 1, backgroundColor: C.card,
    borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border,
  },
  photoImage: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avgRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avgRatingText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  reviewCard: { marginBottom: 8 },
  reviewStars: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 6 },
  reviewDate: { fontSize: 11, color: C.textMuted, marginLeft: 6 },
  reviewComment: { fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const, fontStyle: 'italic' as const },
  reviewerName: { fontSize: 11, color: C.textMuted, marginTop: 4, fontStyle: 'italic' as const },
  // Employer rate stats
  statsRow: { flexDirection: 'row', width: '100%', paddingHorizontal: 16 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: C.text },
});
