import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, MapPin, DollarSign, Award, Star, Camera } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { getSignedUrl } from '@/lib/storage-files';

interface WorkerProfileData {
  id: string;
  user_id: string;
  display_name: string;
  skills: string[];
  coverage_cities: string[];
  hourly_expectation: number;
  verified: boolean;
  status: string;
  bio: string | null;
  profile_photo_path: string | null;
  avatar_path: string | null;
  profiles: { name: string | null; email: string | null };
}

interface CertRow {
  id: string;
  type: string;
  expiry_date: string | null;
  status: string;
}

interface PhotoRow {
  id: string;
  file_path: string;
  caption: string | null;
  visibility: string;
  moderation_status: string;
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_user_id: string;
}

async function fetchPublicProfile(workerId: string) {
  const [profileRes, certsRes, photosRes, reviewsRes] = await Promise.all([
    supabase
      .from('worker_profiles')
      .select('id,user_id,display_name,skills,coverage_cities,hourly_expectation,verified,status,bio,profile_photo_path,avatar_path,profiles!inner(name,email)')
      .eq('user_id', workerId)
      .single(),
    supabase
      .from('worker_certifications')
      .select('id,type,expiry_date,status')
      .eq('worker_user_id', workerId)
      .eq('status', 'Approved'),
    supabase
      .from('work_photos')
      .select('id,file_path,caption,visibility,moderation_status')
      .eq('worker_user_id', workerId)
      .in('visibility', ['public', 'company'])
      .eq('moderation_status', 'approved'),
    supabase
      .from('reviews')
      .select('id,rating,comment,created_at,reviewer_user_id')
      .eq('reviewee_user_id', workerId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return {
    profile: profileRes.data as WorkerProfileData | null,
    certs: (certsRes.data ?? []) as CertRow[],
    photos: (photosRes.data ?? []) as PhotoRow[],
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
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

export default function WorkerPublicProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { workerId } = useLocalSearchParams<{ workerId: string }>();

  const profileQuery = useQuery({
    queryKey: ['worker-public-profile', workerId],
    queryFn: () => fetchPublicProfile(workerId),
    enabled: Boolean(workerId),
    staleTime: 30_000,
  });

  const { profile, certs, photos, reviews } = profileQuery.data ?? { profile: null, certs: [], photos: [], reviews: [] };

  const photoPhotoPath = profile?.profile_photo_path ?? profile?.avatar_path ?? '';
  const avatarQuery = useQuery({
    queryKey: ['worker-pub-avatar', workerId, photoPhotoPath],
    queryFn: () => photoPhotoPath ? getSignedUrl('worker-photos', photoPhotoPath, 120) : Promise.resolve(''),
    enabled: Boolean(photoPhotoPath),
    staleTime: 60_000,
  });

  const photoUrlsQuery = useQuery({
    queryKey: ['worker-pub-photos', workerId, photos.map((p) => p.id).join(',')],
    queryFn: () => loadPhotoUrls(photos),
    enabled: photos.length > 0,
    staleTime: 60_000,
  });
  const photoUrls = photoUrlsQuery.data ?? {};

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  if (profileQuery.isLoading) {
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
        <Text style={styles.headerTitle} numberOfLines={1}>Worker Profile</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]} showsVerticalScrollIndicator={false}>
        {/* Header card */}
        <View style={styles.heroCard}>
          <View style={styles.avatarWrap}>
            {avatarQuery.data ? (
              <Image source={{ uri: avatarQuery.data }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{(profile.display_name ?? 'W').charAt(0)}</Text>
            )}
          </View>
          <Text style={styles.displayName}>{profile.display_name}</Text>
          <View style={styles.badgeRow}>
            {profile.verified && (
              <View style={styles.verifiedBadge}>
                <CheckCircle size={13} color={C.green} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
            <StatusBadge status={profile.status} />
          </View>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <DollarSign size={15} color={C.green} />
              <Text style={styles.statValue}>${profile.hourly_expectation}/hr</Text>
            </View>
            <View style={[styles.stat, styles.statBorder]}>
              <MapPin size={15} color={C.blue} />
              <Text style={styles.statValue}>{(profile.coverage_cities ?? []).length} cities</Text>
            </View>
            <View style={styles.stat}>
              <Star size={15} color={C.yellow} />
              <Text style={styles.statValue}>{avgRating > 0 ? avgRating.toFixed(1) : '—'}</Text>
            </View>
          </View>
        </View>

        {/* Coverage cities */}
        {(profile.coverage_cities ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Coverage Cities</Text>
            <View style={styles.chipRow}>
              {profile.coverage_cities.map((city) => (
                <View key={city} style={styles.cityChip}>
                  <MapPin size={11} color={C.blue} />
                  <Text style={styles.cityText}>{city}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Skills */}
        {(profile.skills ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.chipRow}>
              {profile.skills.map((s) => (
                <View key={s} style={styles.skillChip}>
                  <Text style={styles.skillText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Bio */}
        {profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Card>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </Card>
          </View>
        ) : null}

        {/* Certifications */}
        {certs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            <View style={styles.chipRow}>
              {certs.map((c) => (
                <View key={c.id} style={styles.certChip}>
                  <Award size={12} color={C.green} />
                  <Text style={styles.certChipText}>{c.type}</Text>
                  {c.expiry_date ? <Text style={styles.certExpiry}>exp. {c.expiry_date}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Work Photos */}
        {photos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Work Photos</Text>
            <View style={styles.photoGrid}>
              {photos.map((p) => (
                <View key={p.id} style={styles.photoCell}>
                  {photoUrls[p.id] ? (
                    <Image source={{ uri: photoUrls[p.id] }} style={styles.photoImage} />
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

        {/* Reviews */}
        <View style={styles.section}>
          <View style={styles.sectionRowBetween}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            {reviews.length > 0 && (
              <View style={styles.avgRating}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={14} color={n <= Math.round(avgRating) ? C.yellow : C.border} fill={n <= Math.round(avgRating) ? C.yellow : 'transparent'} />
                ))}
                <Text style={styles.avgRatingText}>{avgRating.toFixed(1)} ({reviews.length})</Text>
              </View>
            )}
          </View>
          {reviews.length === 0 ? (
            <Card><Text style={styles.emptyText}>No reviews yet.</Text></Card>
          ) : (
            reviews.map((r) => (
              <Card key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={13} color={n <= r.rating ? C.yellow : C.border} fill={n <= r.rating ? C.yellow : 'transparent'} />
                  ))}
                  <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: C.text, flex: 1 },
  scroll: { padding: 16, gap: 0 },
  loadingText: { fontSize: 14, color: C.textSecondary },
  backFallback: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.card, borderRadius: 10 },
  backFallbackText: { color: C.accent, fontWeight: '600' as const },
  heroCard: { alignItems: 'center', paddingVertical: 24, backgroundColor: C.bgSecondary, borderRadius: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  avatarWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.accent, marginBottom: 12 },
  avatarImg: { width: '100%', height: '100%', borderRadius: 40 },
  avatarText: { fontSize: 30, fontWeight: '800' as const, color: C.accent },
  displayName: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  statsRow: { flexDirection: 'row', gap: 0, width: '100%', paddingHorizontal: 16 },
  stat: { flex: 1, alignItems: 'center', gap: 4, flexDirection: 'row', justifyContent: 'center' },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  sectionRowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.accentDim, borderRadius: 8 },
  skillText: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  cityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.blueDim, borderRadius: 8 },
  cityText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  certChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.greenDim, borderRadius: 8, borderWidth: 1, borderColor: C.green + '40' },
  certChipText: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  certExpiry: { fontSize: 10, color: C.textMuted },
  bioText: { fontSize: 14, color: C.textSecondary, lineHeight: 22 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoCell: { width: '31.8%', aspectRatio: 1, backgroundColor: C.card, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  photoImage: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avgRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avgRatingText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  reviewCard: { marginBottom: 8 },
  reviewStars: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 6 },
  reviewDate: { fontSize: 11, color: C.textMuted, marginLeft: 6 },
  reviewComment: { fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' },
});
