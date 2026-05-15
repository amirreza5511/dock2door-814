import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, Star, MapPin, Building2, Users } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';

interface CompanyRow {
  id: string;
  name: string;
  city: string | null;
  status: string;
  created_at: string;
}

interface ShiftRow {
  id: string;
  status: string;
  title: string;
  date: string;
  hourly_rate: number | null;
  start_time: string;
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface StaffRow { id: string; }

async function fetchCompanyProfile(companyId: string) {
  const [companyRes, shiftsRes, reviewsRes, staffRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id,name,city,status,created_at')
      .eq('id', companyId)
      .single(),
    supabase
      .from('shift_posts')
      .select('id,status,title,date,hourly_rate,start_time')
      .eq('employer_company_id', companyId),
    supabase
      .from('reviews')
      .select('id,rating,comment,created_at')
      .eq('target_company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('company_users')
      .select('id')
      .eq('company_id', companyId),
  ]);

  return {
    company: (companyRes.data ?? null) as CompanyRow | null,
    shifts: (shiftsRes.data ?? []) as ShiftRow[],
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
    staff: (staffRes.data ?? []) as StaffRow[],
  };
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          color={n <= Math.round(rating) ? C.yellow : C.border}
          fill={n <= Math.round(rating) ? C.yellow : 'transparent'}
        />
      ))}
    </View>
  );
}

export default function CompanyProfileScreen() {
  const insets = useSafeAreaInsets();
  const { companyId } = useLocalSearchParams<{ companyId: string }>();

  const profileQ = useQuery({
    queryKey: ['company-profile', companyId],
    queryFn: () => fetchCompanyProfile(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });

  const { company, shifts, reviews, staff } = profileQ.data ?? {
    company: null,
    shifts: [],
    reviews: [],
    staff: [],
  };

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  }, [reviews]);

  const totalPosted = shifts.length;
  const totalCompleted = shifts.filter((s) => s.status === 'Completed').length;
  const fillRate = totalPosted > 0 ? Math.round((totalCompleted / totalPosted) * 100) : 0;

  // Rating distribution
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  const recentShifts = [...shifts]
    .sort((a, b) => new Date(b.date + 'T00:00').getTime() - new Date(a.date + 'T00:00').getTime())
    .slice(0, 3);

  const memberSince = company ? new Date(company.created_at).getFullYear() : null;

  if (profileQ.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (!company) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>Company not found.</Text>
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
        <Text style={styles.headerTitle} numberOfLines={1}>Company Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Card */}
        <View style={styles.companyCard}>
          <View style={styles.companyIconWrap}>
            <Building2 size={28} color={C.accent} />
          </View>
          <Text style={styles.companyName}>{company.name}</Text>
          {company.city && (
            <View style={styles.cityRow}>
              <MapPin size={13} color={C.textMuted} />
              <Text style={styles.cityText}>{company.city}</Text>
            </View>
          )}
          <View style={styles.companyMeta}>
            <Text style={styles.memberSince}>Member since {memberSince}</Text>
            <StatusBadge status={company.status} />
          </View>
        </View>

        {/* Stats Row */}
        <Card style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{totalPosted}</Text>
              <Text style={styles.statLbl}>Shifts Posted</Text>
            </View>
            <View style={[styles.stat, styles.statMid]}>
              <Text style={[styles.statVal, { color: fillRate > 70 ? C.green : fillRate > 40 ? C.yellow : C.red }]}>
                {fillRate}%
              </Text>
              <Text style={styles.statLbl}>Fill Rate</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: avgRating > 0 ? C.yellow : C.textMuted }]}>
                {avgRating > 0 ? avgRating.toFixed(1) : '—'} ★
              </Text>
              <Text style={styles.statLbl}>Avg Rating</Text>
            </View>
          </View>
        </Card>

        {/* Trust Indicators */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trust & Verification</Text>
          <Card>
            <View style={styles.trustList}>
              {[
                { label: 'Identity verified', ok: company.status !== 'PendingApproval' },
                { label: `Payment on time`, ok: company.status === 'Active' || company.status === 'Approved' },
                { label: `Active since ${memberSince}`, ok: true },
                { label: `${staff.length} team member${staff.length !== 1 ? 's' : ''}`, ok: true },
              ].map(({ label, ok }) => (
                <View key={label} style={styles.trustRow}>
                  <CheckCircle size={15} color={ok ? C.green : C.textMuted} />
                  <Text style={[styles.trustText, !ok && { color: C.textMuted }]}>{label}</Text>
                </View>
              ))}
            </View>
          </Card>
        </View>

        {/* Reviews */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews ({reviews.length})</Text>
          {reviews.length > 0 && (
            <Card style={{ marginBottom: 10 }}>
              {/* Star distribution */}
              {dist.map(({ star, count }) => {
                const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                return (
                  <View key={star} style={styles.distRow}>
                    <Text style={styles.distStar}>{star}★</Text>
                    <View style={styles.distBar}>
                      <View style={[styles.distFill, { width: `${pct}%` as any }]} />
                    </View>
                    <Text style={styles.distCount}>{count}</Text>
                  </View>
                );
              })}
              <View style={styles.avgRow}>
                <Text style={styles.avgNum}>{avgRating.toFixed(1)}</Text>
                <StarRow rating={avgRating} />
                <Text style={styles.avgTotal}>({reviews.length})</Text>
              </View>
            </Card>
          )}
          {reviews.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No reviews yet.</Text>
            </Card>
          ) : (
            reviews.map((r) => (
              <Card key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewTop}>
                  <StarRow rating={r.rating} size={12} />
                  <Text style={styles.reviewDate}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </Text>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
              </Card>
            ))
          )}
        </View>

        {/* Recent Shifts */}
        {recentShifts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Shifts</Text>
            {recentShifts.map((s) => (
              <Card key={s.id} style={styles.shiftCard}>
                <View style={styles.shiftRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftTitle}>{s.title}</Text>
                    <Text style={styles.shiftMeta}>{s.date}</Text>
                  </View>
                  <View style={styles.shiftRight}>
                    {s.hourly_rate != null && (
                      <Text style={styles.shiftRate}>${s.hourly_rate}/hr</Text>
                    )}
                    <StatusBadge status={s.status} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
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
  // Company card
  companyCard: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: C.bgSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    gap: 8,
  },
  companyIconWrap: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.accent,
  },
  companyName: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cityText: { fontSize: 13, color: C.textSecondary },
  companyMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberSince: { fontSize: 12, color: C.textMuted },
  // Stats
  statsCard: { marginBottom: 16 },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  statVal: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLbl: { fontSize: 11, color: C.textSecondary, textAlign: 'center' as const },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  // Trust
  trustList: { gap: 10 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trustText: { fontSize: 14, color: C.text },
  // Reviews
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  distStar: { fontSize: 12, color: C.textMuted, width: 22, textAlign: 'right' as const },
  distBar: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  distFill: { height: 6, backgroundColor: C.yellow, borderRadius: 3 },
  distCount: { fontSize: 12, color: C.textMuted, width: 20, textAlign: 'center' as const },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  avgNum: { fontSize: 22, fontWeight: '800' as const, color: C.yellow },
  avgTotal: { fontSize: 13, color: C.textMuted },
  reviewCard: { marginBottom: 8 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reviewDate: { fontSize: 11, color: C.textMuted, marginLeft: 'auto' as any },
  reviewComment: { fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const },
  // Recent shifts
  shiftCard: { marginBottom: 8 },
  shiftRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  shiftTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  shiftMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  shiftRight: { alignItems: 'flex-end', gap: 4 },
  shiftRate: { fontSize: 13, color: C.green, fontWeight: '700' as const },
});
