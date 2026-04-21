import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, MapPin, Clock, DollarSign, X, Users } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftCategory, ShiftPost } from '@/constants/types';
import { trpc } from '@/lib/trpc';

const CATEGORY_COLORS: Record<ShiftCategory, string> = {
  General: C.yellow, Driver: C.blue, Forklift: C.accent, HighReach: C.purple,
};

export default function BrowseShifts() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { shiftPosts, shiftApplications, workerProfiles, companies } = useDockData();
  const utils = trpc.useUtils();
  const applyM = trpc.shifts.apply.useMutation({
    onSuccess: async () => { await utils.dock.bootstrap.invalidate(); },
  });

  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<ShiftCategory | 'All'>('All');
  const [selected, setSelected] = useState<ShiftPost | null>(null);
  const [applyModal, setApplyModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);

  const available = useMemo(() => shiftPosts.filter((s) => s.status === 'Posted'), [shiftPosts]);

  const filtered = useMemo(() => available.filter((s) => {
    const matchQ = s.title.toLowerCase().includes(query.toLowerCase()) || s.locationCity.toLowerCase().includes(query.toLowerCase());
    const matchCat = filterCat === 'All' || s.category === filterCat;
    return matchQ && matchCat;
  }), [available, query, filterCat]);

  const myApps = useMemo(() => shiftApplications.filter((a) => a.workerUserId === user?.id), [shiftApplications, user]);

  const hasApplied = (shiftId: string) => myApps.some((a) => a.shiftId === shiftId && ['Applied', 'Accepted'].includes(a.status));

  const getEmployerName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? companyId;

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
          Alert.alert('Applied!', 'Your application has been sent. The employer will review it.');
        },
        onError: (e: Error) => Alert.alert('Unable to apply', e.message),
      },
    );
  };

  const CATEGORIES: (ShiftCategory | 'All')[] = ['All', 'General', 'Driver', 'Forklift', 'HighReach'];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Find Shifts</Text>
        <Text style={styles.sub}>{filtered.length} open shifts</Text>
        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search shifts…" placeholderTextColor={C.textMuted} style={styles.searchInput} />
          {query ? <TouchableOpacity onPress={() => setQuery('')}><X size={16} color={C.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity key={c} onPress={() => setFilterCat(c)} style={[styles.chip, filterCat === c && styles.chipActive]}>
            <Text style={[styles.chipText, filterCat === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Search size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>No shifts found</Text>
          </View>
        )}
        {filtered.map((s) => {
          const applied = hasApplied(s.id);
          const color = CATEGORY_COLORS[s.category];
          return (
            <TouchableOpacity key={s.id} onPress={() => { setSelected(s); setApplyModal(true); }} activeOpacity={0.85}>
              <Card style={[styles.card, applied && styles.cardApplied]}>
                <View style={styles.cardTop}>
                  <View style={[styles.catChip, { backgroundColor: color + '20' }]}>
                    <Text style={[styles.catText, { color }]}>{s.category}</Text>
                  </View>
                  {applied && <View style={styles.appliedBadge}><Text style={styles.appliedText}>Applied</Text></View>}
                  <StatusBadge status={s.status} />
                </View>
                <Text style={styles.shiftTitle}>{s.title}</Text>
                <Text style={styles.employer}>{getEmployerName(s.employerCompanyId)}</Text>
                <View style={styles.metaRow}>
                  <MapPin size={12} color={C.textMuted} />
                  <Text style={styles.metaText}>{s.locationCity}</Text>
                  <Clock size={12} color={C.textMuted} />
                  <Text style={styles.metaText}>{s.date} · {s.startTime}–{s.endTime}</Text>
                </View>
                <View style={styles.cardBottom}>
                  <View style={styles.rateRow}>
                    <DollarSign size={14} color={C.green} />
                    <Text style={styles.rate}>${s.hourlyRate}/hr</Text>
                    <Text style={styles.minHours}>Min {s.minimumHours}h</Text>
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

      <Modal visible={applyModal && !!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalCatRow}>
                  <View style={[styles.catChip, { backgroundColor: CATEGORY_COLORS[selected.category] + '20' }]}>
                    <Text style={[styles.catText, { color: CATEGORY_COLORS[selected.category] }]}>{selected.category}</Text>
                  </View>
                  <StatusBadge status={selected.status} />
                </View>
                <Text style={styles.modalTitle}>{selected.title}</Text>
                <Text style={styles.modalEmployer}>{getEmployerName(selected.employerCompanyId)}</Text>

                <View style={styles.detailGrid}>
                  {[
                    ['Location', `${selected.locationAddress}, ${selected.locationCity}`],
                    ['Date', selected.date],
                    ['Time', `${selected.startTime} – ${selected.endTime}`],
                    ['Pay', `$${selected.hourlyRate}/hr`],
                    ['Min Hours', `${selected.minimumHours}h`],
                    ['Workers Needed', `${selected.workersNeeded}`],
                    ['Requirements', selected.requirements || 'None'],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {selected.notes ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>Additional Notes</Text>
                    <Text style={styles.notesText}>{selected.notes}</Text>
                  </View>
                ) : null}

                {profile && (
                  <View style={styles.profileMatch}>
                    <Text style={styles.profileMatchTitle}>Your Skills</Text>
                    <View style={styles.skillsRow}>
                      {profile.skills.map((sk) => (
                        <View key={sk} style={[styles.skillChip, selected.category === sk && styles.skillChipMatch]}>
                          <Text style={[styles.skillText, selected.category === sk && styles.skillTextMatch]}>{sk}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.profileMatchSub}>Your rate: ${profile.hourlyExpectation}/hr · Offering: ${selected.hourlyRate}/hr</Text>
                  </View>
                )}

                <View style={styles.actionBtns}>
                  {hasApplied(selected.id) ? (
                    <View style={styles.alreadyApplied}>
                      <Text style={styles.alreadyAppliedText}>✓ You have already applied to this shift</Text>
                    </View>
                  ) : (
                    <Button label={`Apply for This Shift · $${selected.hourlyRate}/hr`} onPress={handleApply} loading={submitting} fullWidth size="lg" />
                  )}
                  <Button label="Close" onPress={() => setApplyModal(false)} variant="ghost" fullWidth />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  sub: { fontSize: 13, color: C.textSecondary, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 12 },
  card: {},
  cardApplied: { borderColor: C.green + '50', backgroundColor: C.greenDim },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  catText: { fontSize: 12, fontWeight: '700' as const },
  appliedBadge: { backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  appliedText: { fontSize: 11, color: C.green, fontWeight: '700' as const },
  shiftTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 2 },
  employer: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  metaText: { fontSize: 12, color: C.textSecondary },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rate: { fontSize: 16, fontWeight: '800' as const, color: C.green },
  minHours: { fontSize: 12, color: C.textMuted, marginLeft: 8 },
  workersRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  workersText: { fontSize: 12, color: C.textMuted },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '600' as const },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalCatRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  modalEmployer: { fontSize: 15, color: C.accent, fontWeight: '600' as const },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
  notesBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  notesLabel: { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  notesText: { fontSize: 13, color: C.textSecondary },
  profileMatch: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, gap: 8 },
  profileMatchTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  skillsRow: { flexDirection: 'row', gap: 6 },
  skillChip: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.bgSecondary, borderRadius: 6 },
  skillChipMatch: { backgroundColor: C.greenDim },
  skillText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  skillTextMatch: { color: C.green },
  profileMatchSub: { fontSize: 12, color: C.textMuted },
  actionBtns: { gap: 10 },
  alreadyApplied: { backgroundColor: C.greenDim, borderRadius: 12, padding: 14, alignItems: 'center' },
  alreadyAppliedText: { fontSize: 14, color: C.green, fontWeight: '600' as const },
});
