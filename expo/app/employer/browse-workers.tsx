import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Share, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import { Search, CheckCircle, MapPin, DollarSign, Users, ChevronRight, Star, UserPlus, Send, X, Heart, Calendar, Clock } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface OpenShiftRow {
  id: string;
  title: string;
  category: string;
  location_city: string;
  date: string;
  start_time: string;
  end_time: string;
  hourly_rate: number | null;
  flat_rate: number | null;
  status: string;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
}

const INVITE_MESSAGE =
  'Join me on Dock2Door to pick up paid shifts and manage your work. Download the app to get started.';

interface RatingSummary { target_id: string; count: number; avg_rating: number; }

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

async function fetchRatingSummaries(): Promise<Record<string, RatingSummary>> {
  const { data } = await supabase
    .from('review_summaries')
    .select('target_id, count, avg_rating')
    .eq('target_kind', 'worker');
  const map: Record<string, RatingSummary> = {};
  for (const row of (data ?? [])) {
    map[row.target_id as string] = {
      target_id: row.target_id as string,
      count: Number(row.count ?? 0),
      avg_rating: Number(row.avg_rating ?? 0),
    };
  }
  return map;
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
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<SkillFilter>('All');
  const [favOnly, setFavOnly] = useState<boolean>(false);
  const [inviteWorker, setInviteWorker] = useState<WorkerRow | null>(null);
  const [invitingShiftId, setInvitingShiftId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);
  const [contactsLoading, setContactsLoading] = useState<boolean>(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactsDenied, setContactsDenied] = useState<boolean>(false);

  const openInvite = useCallback(async () => {
    setInviteOpen(true);
    setContactsDenied(false);
    if (contacts.length > 0) return;
    setContactsLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setContactsDenied(true);
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const rows: ContactRow[] = (data ?? [])
        .filter((c) => Boolean(c.name))
        .map((c) => ({
          id: c.id ?? c.name ?? Math.random().toString(36),
          name: c.name ?? 'Unknown',
          phone: c.phoneNumbers?.[0]?.number ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(rows);
    } catch {
      setContactsDenied(true);
    } finally {
      setContactsLoading(false);
    }
  }, [contacts.length]);

  const sendInvite = useCallback(async (contact: ContactRow) => {
    try {
      const firstName = contact.name.split(' ')[0] ?? 'there';
      await Share.share({
        message: `Hi ${firstName}! ${INVITE_MESSAGE}`,
      });
    } catch (e) {
      Alert.alert('Unable to send invite', e instanceof Error ? e.message : 'Please try again.');
    }
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q));
  }, [contacts, contactSearch]);

  const workersQuery = useQuery({
    queryKey: ['employer-browse-workers'],
    queryFn: fetchWorkers,
    staleTime: 30_000,
  });

  const ratingsQuery = useQuery({
    queryKey: ['browse-worker-ratings'],
    queryFn: fetchRatingSummaries,
    staleTime: 60_000,
  });
  const ratingMap = ratingsQuery.data ?? {};

  const favQ = useQuery({
    queryKey: ['employer-fav-workers', user?.companyId],
    queryFn: async (): Promise<string[]> => {
      if (!user?.companyId) return [];
      const { data } = await supabase
        .from('employer_favorite_workers')
        .select('worker_user_id')
        .eq('employer_company_id', user.companyId);
      return (data ?? []).map((r) => r.worker_user_id as string);
    },
    enabled: Boolean(user?.companyId),
    staleTime: 30_000,
  });
  const favSet = useMemo(() => new Set(favQ.data ?? []), [favQ.data]);

  const openShiftsQ = useQuery({
    queryKey: ['employer-open-shifts', user?.companyId],
    queryFn: async (): Promise<OpenShiftRow[]> => {
      if (!user?.companyId) return [];
      const { data } = await supabase
        .from('shift_posts')
        .select('id,title,category,location_city,date,start_time,end_time,hourly_rate,flat_rate,status')
        .eq('employer_company_id', user.companyId)
        .in('status', ['Posted', 'Filled'])
        .order('date', { ascending: true });
      return (data ?? []) as OpenShiftRow[];
    },
    enabled: Boolean(user?.companyId),
    staleTime: 30_000,
  });
  const openShifts = openShiftsQ.data ?? [];

  const toggleFavorite = useCallback(async (workerUserId: string) => {
    if (!user?.companyId) return;
    const isFav = favSet.has(workerUserId);
    try {
      if (isFav) {
        await supabase
          .from('employer_favorite_workers')
          .delete()
          .eq('employer_company_id', user.companyId)
          .eq('worker_user_id', workerUserId);
      } else {
        await supabase.from('employer_favorite_workers').insert({
          employer_company_id: user.companyId,
          worker_user_id: workerUserId,
          created_by: user.id,
        });
      }
      await favQ.refetch();
    } catch (e) {
      Alert.alert('Unable to update favorites', e instanceof Error ? e.message : 'Please try again.');
    }
  }, [favSet, user?.companyId, user?.id, favQ]);

  const sendShiftInvite = useCallback(async (shift: OpenShiftRow) => {
    if (!inviteWorker) return;
    setInvitingShiftId(shift.id);
    try {
      const { error } = await supabase.rpc('employer_invite_worker', {
        p_shift_id: shift.id,
        p_worker_user_id: inviteWorker.user_id,
        p_message: '',
      });
      if (error) throw new Error(error.message);
      const name = inviteWorker.display_name;
      setInviteWorker(null);
      Alert.alert('Invitation sent', `${name} was invited to "${shift.title}". They'll get a notification to accept or decline.`);
    } catch (e) {
      Alert.alert('Unable to invite', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setInvitingShiftId(null);
    }
  }, [inviteWorker]);

  const filtered = useMemo(() => {
    const list = workersQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((w) => {
      if (favOnly && !favSet.has(w.user_id)) return false;
      if (skillFilter !== 'All' && !w.skills.includes(skillFilter)) return false;
      if (q) {
        const nameMatch = w.display_name.toLowerCase().includes(q);
        const cityMatch = (w.coverage_cities ?? []).some((c) => c.toLowerCase().includes(q));
        if (!nameMatch && !cityMatch) return false;
      }
      return true;
    });
  }, [workersQuery.data, search, skillFilter, favOnly, favSet]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerIcon}>
            <Users size={20} color={C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Find Workers</Text>
            <Text style={styles.sub}>{filtered.length} active workers</Text>
          </View>
          <TouchableOpacity onPress={() => void openInvite()} style={styles.inviteBtn} activeOpacity={0.85}>
            <UserPlus size={15} color={C.accent} />
            <Text style={styles.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
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
        <TouchableOpacity onPress={() => setFavOnly((v) => !v)} style={[styles.chip, favOnly && styles.chipFav]}>
          <Heart size={12} color={favOnly ? C.red : C.textSecondary} fill={favOnly ? C.red : 'transparent'} />
          <Text style={[styles.chipText, favOnly && { color: C.red, fontWeight: '700' as const }]}>Favorites</Text>
        </TouchableOpacity>
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
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity onPress={() => void toggleFavorite(w.user_id)} hitSlop={8} style={styles.heartBtn}>
                      <Heart size={18} color={favSet.has(w.user_id) ? C.red : C.textMuted} fill={favSet.has(w.user_id) ? C.red : 'transparent'} />
                    </TouchableOpacity>
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
                  {ratingMap[w.user_id] && (
                    <View style={styles.ratingRow}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          size={10}
                          color={n <= Math.round(ratingMap[w.user_id].avg_rating) ? C.yellow : C.border}
                          fill={n <= Math.round(ratingMap[w.user_id].avg_rating) ? C.yellow : 'transparent'}
                        />
                      ))}
                      <Text style={styles.ratingText}>
                        {ratingMap[w.user_id].avg_rating.toFixed(1)} ({ratingMap[w.user_id].count})
                      </Text>
                    </View>
                  )}
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

              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={() => setInviteWorker(w)}
                  style={styles.inviteShiftBtn}
                  activeOpacity={0.85}
                >
                  <Send size={14} color={C.white} />
                  <Text style={styles.inviteShiftText}>Invite to shift</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/worker/[id]' as any, params: { id: w.user_id } })}
                  style={styles.viewBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.viewBtnText}>Profile</Text>
                  <ChevronRight size={15} color={C.accent} />
                </TouchableOpacity>
              </View>
            </Card>
          ))}
        </ScrollView>
      )}

      {/* Invite worker to a shift */}
      <Modal visible={!!inviteWorker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteWorker(null)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Invite to a shift</Text>
              <Text style={styles.modalSub}>Pick a shift for {inviteWorker?.display_name}. They'll get a notification to accept.</Text>
            </View>
            <TouchableOpacity onPress={() => setInviteWorker(null)} style={styles.closeBtn}>
              <X size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          {openShifts.length === 0 ? (
            <View style={styles.empty}>
              <Calendar size={40} color={C.textMuted} />
              <Text style={styles.emptyTitle}>No open shifts</Text>
              <Text style={styles.emptyText}>Post a shift first, then invite workers to it.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
              {openShifts.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => void sendShiftInvite(s)}
                  disabled={invitingShiftId !== null}
                  style={styles.shiftPick}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftPickTitle}>{s.title}</Text>
                    <View style={styles.shiftPickMeta}>
                      <Calendar size={11} color={C.textMuted} />
                      <Text style={styles.shiftPickMetaText}>{s.date}</Text>
                      <Clock size={11} color={C.textMuted} />
                      <Text style={styles.shiftPickMetaText}>{s.start_time}–{s.end_time}</Text>
                      <DollarSign size={11} color={C.green} />
                      <Text style={styles.shiftPickMetaText}>${s.hourly_rate ?? s.flat_rate}/hr</Text>
                    </View>
                  </View>
                  {invitingShiftId === s.id ? (
                    <ActivityIndicator color={C.accent} />
                  ) : (
                    <Send size={16} color={C.accent} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Invite from Contacts */}
      <Modal visible={inviteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteOpen(false)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Invite from Contacts</Text>
              <Text style={styles.modalSub}>Invite workers and teammates to Dock2Door.</Text>
            </View>
            <TouchableOpacity onPress={() => setInviteOpen(false)} style={styles.closeBtn}>
              <X size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          {!contactsLoading && !contactsDenied && contacts.length > 0 && (
            <View style={[styles.searchBar, { marginHorizontal: 16, marginBottom: 8 }]}>
              <Search size={16} color={C.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={contactSearch}
                onChangeText={setContactSearch}
                placeholder="Search contacts…"
                placeholderTextColor={C.textMuted}
              />
            </View>
          )}

          {contactsLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={C.accent} />
              <Text style={styles.emptyText}>Loading contacts…</Text>
            </View>
          ) : contactsDenied ? (
            <View style={styles.empty}>
              <Users size={40} color={C.textMuted} />
              <Text style={styles.emptyTitle}>Contacts unavailable</Text>
              <Text style={styles.emptyText}>
                {Platform.OS === 'web'
                  ? 'Contacts access isn’t available on web. Open the app on your phone to invite from contacts.'
                  : 'Enable Contacts access for Dock2Door in Settings to invite people you know.'}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
              {filteredContacts.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No contacts found.</Text>
                </View>
              ) : filteredContacts.map((c) => (
                <View key={c.id} style={styles.contactRow}>
                  <View style={styles.contactAvatar}>
                    <Text style={styles.contactAvatarText}>{c.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    {c.phone ? <Text style={styles.contactPhone}>{c.phone}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => void sendInvite(c)} style={styles.sendBtn} activeOpacity={0.85}>
                    <Send size={13} color={C.white} />
                    <Text style={styles.sendBtnText}>Invite</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
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
  ratingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, marginTop: 3 },
  ratingText: { fontSize: 11, color: C.yellow, fontWeight: '600' as const, marginLeft: 3 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accentDim, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: C.accent + '50' },
  viewBtnText: { fontSize: 14, color: C.accent, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accentDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.accent + '50' },
  inviteBtnText: { fontSize: 13, color: C.accent, fontWeight: '700' as const },
  chipFav: { backgroundColor: C.redDim, borderColor: C.red, flexDirection: 'row', alignItems: 'center', gap: 5 },
  heartBtn: { padding: 2 },
  cardActions: { flexDirection: 'row', gap: 8 },
  inviteShiftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 10, paddingVertical: 10 },
  inviteShiftText: { fontSize: 14, color: C.white, fontWeight: '700' as const },
  shiftPick: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  shiftPickTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  shiftPickMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' },
  shiftPickMetaText: { fontSize: 11, color: C.textSecondary, marginRight: 4 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  modalSub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  contactAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  contactAvatarText: { fontSize: 16, fontWeight: '800' as const, color: C.accent },
  contactName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  contactPhone: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  sendBtnText: { fontSize: 12, color: C.white, fontWeight: '700' as const },
});
