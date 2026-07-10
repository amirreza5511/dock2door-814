import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, Linking, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, MapPin, Clock, DollarSign, X, Users, Star, Navigation, CheckCircle, AlertTriangle, Heart, Repeat } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftCategory, ShiftPost } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import { skillLabel } from '@/constants/skills';
import SupportMenu from '@/components/SupportMenu';

const BASE_CATEGORY_COLORS: Partial<Record<ShiftCategory, string>> = {
  General: C.yellow,
  Driver: C.blue,
  Forklift: C.accent,
  HighReach: C.purple,
};
/** Safe color lookup — new catalog skills fall back to the accent color. */
const catColor = (c: ShiftCategory | undefined): string => (c ? BASE_CATEGORY_COLORS[c] ?? C.accent : C.accent);

interface AppRow { id: string; shift_id: string; worker_user_id: string; status: string; }

interface CompanyReviewRow { target_company_id: string; rating: number; }

function fmtTime(t: string): string {
  try {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  } catch { return t; }
}

function formatShiftLine(date: string, startTime: string, endTime: string): string {
  try {
    const d = new Date(date + 'T00:00:00');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} · ${fmtTime(startTime)} – ${fmtTime(endTime)}`;
  } catch { return `${date} · ${startTime} – ${endTime}`; }
}

function StarRow({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} color={n <= Math.round(rating) ? C.yellow : C.border} fill={n <= Math.round(rating) ? C.yellow : 'transparent'} />
      ))}
    </View>
  );
}

export default function BrowseShifts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { shiftPosts, workerProfiles, companies, workerCertifications } = useDockData();
  const queryClient = useQueryClient();

  const utils = trpc.useUtils();
  const applyM = trpc.shifts.apply.useMutation({
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['browse-apps', user?.id] }),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });

  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<ShiftCategory | 'All'>('All');
  const [favOnly, setFavOnly] = useState<boolean>(false);
  const [ongoingOnly, setOngoingOnly] = useState<boolean>(false);
  const [selected, setSelected] = useState<ShiftPost | null>(null);
  const [applyModal, setApplyModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Direct query for applications
  const appsQ = useQuery({
    queryKey: ['browse-apps', user?.id],
    queryFn: async (): Promise<AppRow[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('shift_applications')
        .select('id,shift_id,worker_user_id,status')
        .eq('worker_user_id', user.id);
      return (data ?? []) as AppRow[];
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const myApps = appsQ.data ?? [];

  const [refreshing, setRefreshing] = useState<boolean>(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        appsQ.refetch(),
        utils.dock.bootstrap.invalidate(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // Company reviews for star ratings
  const reviewsQ = useQuery({
    queryKey: ['company-reviews'],
    queryFn: async (): Promise<CompanyReviewRow[]> => {
      const { data } = await supabase
        .from('reviews')
        .select('target_company_id,rating')
        .not('target_company_id', 'is', null);
      return (data ?? []) as CompanyReviewRow[];
    },
    staleTime: 120_000,
  });
  const allReviews = reviewsQ.data ?? [];

  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);

  // Favorite employers
  const favEmpQ = useQuery({
    queryKey: ['worker-fav-employers', user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('worker_favorite_employers')
        .select('employer_company_id')
        .eq('worker_user_id', user.id);
      return (data ?? []).map((r) => r.employer_company_id as string);
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
  const favEmpSet = useMemo(() => new Set(favEmpQ.data ?? []), [favEmpQ.data]);

  const toggleFavoriteEmployer = async (companyId: string) => {
    if (!user?.id) return;
    const isFav = favEmpSet.has(companyId);
    try {
      if (isFav) {
        await supabase
          .from('worker_favorite_employers')
          .delete()
          .eq('worker_user_id', user.id)
          .eq('employer_company_id', companyId);
      } else {
        await supabase.from('worker_favorite_employers').insert({
          worker_user_id: user.id,
          employer_company_id: companyId,
        });
      }
      await favEmpQ.refetch();
    } catch (e) {
      Alert.alert('Unable to update favorites', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const todayStr = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);
  // Only Posted shifts whose date is today or later are applyable.
  // Filled / Cancelled / past-date shifts are filtered out so workers never see a doomed Apply button.
  const available = useMemo(
    () => shiftPosts.filter((s) => s.status === 'Posted' && s.date >= todayStr),
    [shiftPosts, todayStr],
  );
  const filtered = useMemo(() => available.filter((s) => {
    const matchQ = s.title.toLowerCase().includes(query.toLowerCase()) || s.locationCity.toLowerCase().includes(query.toLowerCase());
    const matchCat = filterCat === 'All' || s.category === filterCat;
    const matchFav = !favOnly || favEmpSet.has(s.employerCompanyId);
    const matchOngoing = !ongoingOnly || s.isOngoing;
    return matchQ && matchCat && matchFav && matchOngoing;
  }), [available, query, filterCat, favOnly, ongoingOnly, favEmpSet]);

  const hasApplied = (shiftId: string) => myApps.some((a) => a.shift_id === shiftId && ['Applied', 'Accepted'].includes(a.status));

  const getEmployerName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? 'Employer';

  const getCompanyRating = (companyId: string): { avg: number; count: number } => {
    const revs = allReviews.filter((r) => r.target_company_id === companyId);
    if (revs.length === 0) return { avg: 0, count: 0 };
    return { avg: revs.reduce((s, r) => s + r.rating, 0) / revs.length, count: revs.length };
  };

  const getAppliedCount = (shiftId: string) => myApps.filter((a) => a.shift_id === shiftId).length;

  const hasCertForCategory = (category: ShiftCategory): boolean => {
    if (category !== 'Forklift' && category !== 'HighReach') return true;
    return workerCertifications.some(
      (c) => c.workerUserId === user?.id && c.type === category && c.adminApproved,
    );
  };

  const handleApply = () => {
    if (!selected || !user) return;
    if (hasApplied(selected.id)) {
      Alert.alert('Already Applied', 'You have already applied to this shift.');
      return;
    }
    setSubmitting(true);
    applyM.mutate(
      { shiftId: selected.id },
      {
        onSettled: () => setSubmitting(false),
        onSuccess: () => {
          setApplyModal(false);
          Alert.alert('Applied!', 'Your application has been sent.');
        },
        onError: (e: Error) => Alert.alert('Unable to apply', e.message),
      },
    );
  };

  // Build the filter list from the skills that actually appear in open shifts
  // so workers only see relevant chips (avoids a wall of 38 categories).
  const CATEGORIES: (ShiftCategory | 'All')[] = useMemo(() => {
    const present = Array.from(new Set(available.map((s) => s.category))).sort();
    return ['All', ...present];
  }, [available]);

  const isUrgent = (s: ShiftPost) => s.notes?.startsWith('[URGENT]');

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.flex1}>
            <Text style={styles.title}>Find Shifts</Text>
            <Text style={styles.sub}>{filtered.length} open shifts</Text>
          </View>
          <SupportMenu />
        </View>
        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search shifts…"
            placeholderTextColor={C.textMuted}
            style={styles.searchInput}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')}>
              <X size={16} color={C.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContent}
      >
        <TouchableOpacity
          onPress={() => setFavOnly((v) => !v)}
          style={[styles.chip, styles.favChip, favOnly && styles.favChipActive]}
        >
          <Heart size={12} color={favOnly ? C.red : C.textSecondary} fill={favOnly ? C.red : 'transparent'} />
          <Text style={[styles.chipText, favOnly && { color: C.red, fontWeight: '700' as const }]}>Favorites</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setOngoingOnly((v) => !v)}
          style={[styles.chip, styles.favChip, ongoingOnly && styles.ongoingChipActive]}
        >
          <Repeat size={12} color={ongoingOnly ? C.accent : C.textSecondary} />
          <Text style={[styles.chipText, ongoingOnly && { color: C.accent, fontWeight: '700' as const }]}>Ongoing</Text>
        </TouchableOpacity>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setFilterCat(c)}
            style={[styles.chip, filterCat === c && styles.chipActive]}
          >
            <Text style={[styles.chipText, filterCat === c && styles.chipTextActive]}>{c === 'All' ? 'All' : skillLabel(c)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} />
        }
      >
        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Search size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>No shifts found</Text>
          </View>
        )}
        {filtered.map((s) => {
          const applied = hasApplied(s.id);
          const color = catColor(s.category);
          const rating = getCompanyRating(s.employerCompanyId);
          const urgent = isUrgent(s);
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => { setSelected(s); setApplyModal(true); }}
              activeOpacity={0.85}
            >
              <Card style={[styles.card, applied && styles.cardApplied]}>
                {/* Top row: category + rating + applied count + urgent */}
                <View style={styles.cardTop}>
                  <View style={[styles.catChip, { backgroundColor: color + '20' }]}>
                    <Text style={[styles.catText, { color }]}>{skillLabel(s.category)}</Text>
                  </View>
                  {urgent && (
                    <View style={styles.urgentBadge}>
                      <Text style={styles.urgentText}>URGENT</Text>
                    </View>
                  )}
                  {s.isOngoing && (
                    <View style={styles.ongoingBadge}>
                      <Repeat size={10} color={C.accent} />
                      <Text style={styles.ongoingText}>ONGOING</Text>
                    </View>
                  )}
                  {rating.count > 0 && (
                    <View style={styles.ratingRow}>
                      <StarRow rating={rating.avg} />
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  {applied && (
                    <View style={styles.appliedBadge}>
                      <CheckCircle size={11} color={C.green} />
                      <Text style={styles.appliedText}>Applied</Text>
                    </View>
                  )}
                </View>

                {/* Title */}
                <Text style={styles.shiftTitle}>{s.title}</Text>

                {/* Employer name — tappable */}
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/company/[id]' as any, params: { id: s.employerCompanyId } })}
                  hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
                >
                  <Text style={styles.employer}>{getEmployerName(s.employerCompanyId)}</Text>
                </TouchableOpacity>

                {/* Location */}
                <View style={styles.metaRow}>
                  <MapPin size={12} color={C.textMuted} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {s.locationAddress}, {s.locationCity}
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      Linking.openURL(
                        `https://maps.google.com/?q=${encodeURIComponent(`${s.locationAddress}, ${s.locationCity}`)}`,
                      )
                    }
                    style={styles.mapsLink}
                  >
                    <Navigation size={11} color={C.blue} />
                  </TouchableOpacity>
                </View>

                {/* Date/time */}
                <View style={styles.metaRow}>
                  <Clock size={12} color={C.textMuted} />
                  <Text style={styles.metaText}>{formatShiftLine(s.date, s.startTime, s.endTime)}</Text>
                </View>

                {/* Bottom: rate + min hours + workers */}
                <View style={styles.cardBottom}>
                  <View style={styles.rateRow}>
                    <Text style={styles.rate}>${s.hourlyRate ?? s.flatRate}/hr</Text>
                    <View style={styles.minHoursBadge}>
                      <Text style={styles.minHoursText}>min {s.minimumHours}h</Text>
                    </View>
                  </View>
                  <View style={styles.workersRow}>
                    <Users size={12} color={C.textMuted} />
                    <Text style={styles.workersText}>{s.workersNeeded} needed</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Apply Modal */}
      <Modal visible={applyModal && !!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected && (() => {
            const rating = getCompanyRating(selected.employerCompanyId);
            const certOk = hasCertForCategory(selected.category);
            const workerRate = profile?.hourlyExpectation ?? 0;
            const shiftRate = selected.hourlyRate ?? selected.flatRate ?? 0;
            const reqParts = selected.requirements?.split(',').map((r) => r.trim()).filter(Boolean) ?? [];
            const employerShiftCount = shiftPosts.filter((s) => s.employerCompanyId === selected.employerCompanyId).length;
            const fillRate = employerShiftCount > 0
              ? Math.round((shiftPosts.filter((s) => s.employerCompanyId === selected.employerCompanyId && s.status === 'Completed').length / employerShiftCount) * 100)
              : 0;

            return (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalBody}>
                  <View style={styles.modalCatRow}>
                    <View style={[styles.catChip, { backgroundColor: catColor(selected.category) + '20' }]}>
                      <Text style={[styles.catText, { color: catColor(selected.category) }]}>
                        {skillLabel(selected.category)}
                      </Text>
                    </View>
                    {isUrgent(selected) && (
                      <View style={styles.urgentBadge}>
                        <Text style={styles.urgentText}>URGENT</Text>
                      </View>
                    )}
                    {selected.isOngoing && (
                      <View style={styles.ongoingBadge}>
                        <Repeat size={10} color={C.accent} />
                        <Text style={styles.ongoingText}>ONGOING</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.modalTitle}>{selected.title}</Text>
                  <View style={styles.modalEmployerRow}>
                    <TouchableOpacity
                      onPress={() => {
                        setApplyModal(false);
                        setTimeout(() => router.push({ pathname: '/company/[id]' as any, params: { id: selected.employerCompanyId } }), 300);
                      }}
                      style={{ flex: 1 }}
                    >
                      <Text style={styles.modalEmployer}>{getEmployerName(selected.employerCompanyId)} →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => void toggleFavoriteEmployer(selected.employerCompanyId)}
                      style={[styles.favEmpBtn, favEmpSet.has(selected.employerCompanyId) && styles.favEmpBtnActive]}
                      hitSlop={6}
                    >
                      <Heart size={14} color={favEmpSet.has(selected.employerCompanyId) ? C.red : C.textMuted} fill={favEmpSet.has(selected.employerCompanyId) ? C.red : 'transparent'} />
                      <Text style={[styles.favEmpText, favEmpSet.has(selected.employerCompanyId) && { color: C.red }]}>
                        {favEmpSet.has(selected.employerCompanyId) ? 'Saved' : 'Save'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Requirements */}
                  {reqParts.length > 0 && (
                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>Requirements</Text>
                      {reqParts.map((r, i) => (
                        <View key={i} style={styles.bulletRow}>
                          <Text style={styles.bullet}>•</Text>
                          <Text style={styles.bulletText}>{r}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Your Match */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Your Match</Text>
                    <View style={styles.matchRow}>
                      {certOk ? (
                        <CheckCircle size={15} color={C.green} />
                      ) : (
                        <AlertTriangle size={15} color={C.red} />
                      )}
                      <Text style={[styles.matchText, { color: certOk ? C.green : C.red }]}>
                        {certOk
                          ? `${selected.category} certification — verified ✓`
                          : `Missing ${selected.category} certification — required`}
                      </Text>
                    </View>
                    {workerRate > 0 && shiftRate > 0 && (
                      <View style={styles.matchRow}>
                        {shiftRate >= workerRate ? (
                          <CheckCircle size={15} color={C.green} />
                        ) : (
                          <AlertTriangle size={15} color={C.yellow} />
                        )}
                        <Text style={[styles.matchText, { color: shiftRate >= workerRate ? C.green : C.yellow }]}>
                          You expect ${workerRate}/hr — this shift pays ${shiftRate}/hr{shiftRate >= workerRate ? ' ✓' : ''}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Employer Reliability */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Employer Reliability</Text>
                    <View style={styles.reliabilityRow}>
                      <Text style={styles.reliabilityText}>
                        {employerShiftCount} shifts posted
                      </Text>
                      <Text style={styles.reliabilityDot}>·</Text>
                      <Text style={styles.reliabilityText}>{fillRate}% fill rate</Text>
                      {rating.count > 0 && (
                        <>
                          <Text style={styles.reliabilityDot}>·</Text>
                          <StarRow rating={rating.avg} />
                          <Text style={styles.reliabilityText}>{rating.avg.toFixed(1)}</Text>
                        </>
                      )}
                    </View>
                  </View>

                  {/* Notes */}
                  {!!selected.notes && !selected.notes.startsWith('[URGENT]') && (
                    <View style={styles.notesBox}>
                      <Text style={styles.notesLabel}>Notes from employer</Text>
                      <Text style={styles.notesText}>{selected.notes}</Text>
                    </View>
                  )}
                  {!!selected.notes && selected.notes.startsWith('[URGENT]') && selected.notes.length > 8 && (
                    <View style={styles.notesBox}>
                      <Text style={styles.notesLabel}>Notes from employer</Text>
                      <Text style={styles.notesText}>{selected.notes.replace('[URGENT] ', '')}</Text>
                    </View>
                  )}

                  {/* Apply */}
                  <View style={styles.actionBtns}>
                    {hasApplied(selected.id) ? (
                      <View style={styles.alreadyApplied}>
                        <CheckCircle size={16} color={C.green} />
                        <Text style={styles.alreadyAppliedText}>Already applied to this shift</Text>
                      </View>
                    ) : (
                      <Button
                        label={`Apply · $${selected.hourlyRate ?? selected.flatRate}/hr`}
                        onPress={handleApply}
                        loading={submitting}
                        fullWidth
                        size="lg"
                      />
                    )}
                    <Button label="Close" onPress={() => setApplyModal(false)} variant="ghost" fullWidth />
                  </View>
                </View>
              </ScrollView>
            );
          })()}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  headerTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  flex1: { flex: 1 },
  sub: { fontSize: 13, color: C.textSecondary, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  favChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  favChipActive: { backgroundColor: C.redDim, borderColor: C.red },
  ongoingChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  ongoingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  ongoingText: { fontSize: 10, color: C.accent, fontWeight: '800' as const, letterSpacing: 0.5 },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 12 },
  card: { gap: 6 },
  cardApplied: { borderColor: C.green + '50', backgroundColor: C.greenDim },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  catChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  catText: { fontSize: 12, fontWeight: '700' as const },
  urgentBadge: { backgroundColor: C.redDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  urgentText: { fontSize: 10, color: C.red, fontWeight: '800' as const, letterSpacing: 0.5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  appliedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  appliedText: { fontSize: 11, color: C.green, fontWeight: '700' as const },
  shiftTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  employer: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, color: C.textSecondary, flex: 1 },
  mapsLink: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blueDim, borderRadius: 6 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rate: { fontSize: 18, fontWeight: '800' as const, color: C.green },
  minHoursBadge: { backgroundColor: C.bgSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  minHoursText: { fontSize: 11, color: C.textMuted, fontWeight: '500' as const },
  workersRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  workersText: { fontSize: 12, color: C.textMuted },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '600' as const },
  // Modal
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 16 },
  modalCatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  modalEmployer: { fontSize: 15, color: C.accent, fontWeight: '600' as const },
  modalEmployerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  favEmpBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.card, borderRadius: 9, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 6 },
  favEmpBtnActive: { backgroundColor: C.redDim, borderColor: C.red + '60' },
  favEmpText: { fontSize: 12, color: C.textMuted, fontWeight: '700' as const },
  modalSection: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  modalSectionTitle: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, color: C.textSecondary, marginTop: 1 },
  bulletText: { fontSize: 14, color: C.textSecondary, flex: 1 },
  matchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  matchText: { fontSize: 13, fontWeight: '600' as const, flex: 1 },
  reliabilityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  reliabilityText: { fontSize: 13, color: C.textSecondary },
  reliabilityDot: { fontSize: 13, color: C.textMuted },
  notesBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  notesLabel: { fontSize: 11, color: C.textMuted, marginBottom: 4, fontWeight: '600' as const },
  notesText: { fontSize: 13, color: C.textSecondary },
  actionBtns: { gap: 10 },
  alreadyApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.greenDim,
    borderRadius: 12,
    padding: 14,
    justifyContent: 'center',
  },
  alreadyAppliedText: { fontSize: 14, color: C.green, fontWeight: '600' as const },
});
