import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  Search, MapPin, X, Wrench, Hammer, Forklift, DollarSign,
  ArrowLeft, Plus, Store, Building2,
} from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import {
  SERVICE_TYPES, serviceTypeLabel, subcategoryLabel,
  type ServiceType,
} from '@/constants/serviceMarketplace';

type MarketListing = {
  id: string;
  companyId: string;
  companyName: string;
  companyCity: string;
  serviceType: ServiceType;
  subcategory: string;
  title: string;
  description: string;
  coverageArea: string[];
  hourlyRate: number;
  perJobRate: number | null;
  dailyRate: number | null;
  weeklyRate: number | null;
  minimumHours: number;
  negotiable: boolean;
  certifications: string;
};

const TYPE_ICON: Record<ServiceType, typeof Wrench> = {
  service: Wrench,
  equipment_rental: Forklift,
  mobile_repair: Hammer,
};

const TYPE_COLOR: Record<ServiceType, string> = {
  service: C.accent,
  equipment_rental: C.blue,
  mobile_repair: C.purple,
};

function priceLabel(l: MarketListing): string {
  if (l.serviceType === 'equipment_rental') {
    if (l.dailyRate) return `$${l.dailyRate}/day`;
    if (l.weeklyRate) return `$${l.weeklyRate}/wk`;
    if (l.hourlyRate) return `$${l.hourlyRate}/hr`;
    return l.negotiable ? 'Negotiable' : '—';
  }
  if (l.hourlyRate) return `$${l.hourlyRate}/hr`;
  if (l.perJobRate) return `$${l.perJobRate}/job`;
  return l.negotiable ? 'Negotiable' : '—';
}

export default function MarketplaceBrowse() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const params = useLocalSearchParams<{ type?: string }>();

  const browseQuery = trpc.marketplace.browse.useQuery(undefined);
  const utils = trpc.useUtils();
  const createJob = trpc.serviceJobs.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.marketplace.browse.invalidate(),
        utils.dock.bootstrap.invalidate(),
      ]);
    },
  });

  const listings: MarketListing[] = useMemo(() => (browseQuery.data ?? []) as MarketListing[], [browseQuery.data]);

  const initialType = (SERVICE_TYPES.some((t) => t.id === params.type) ? params.type : 'All') as ServiceType | 'All';
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ServiceType | 'All'>(initialType);
  const [selected, setSelected] = useState<MarketListing | null>(null);

  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => listings.filter((l) => {
    const matchType = typeFilter === 'All' || l.serviceType === typeFilter;
    const q = query.trim().toLowerCase();
    const matchQ = !q ||
      l.companyName.toLowerCase().includes(q) ||
      l.title.toLowerCase().includes(q) ||
      subcategoryLabel(l.subcategory).toLowerCase().includes(q) ||
      l.coverageArea.some((c) => c.toLowerCase().includes(q));
    return matchType && matchQ;
  }), [listings, typeFilter, query]);

  const isOwn = selected?.companyId === user?.companyId;

  const estimatedTotal = useMemo(() => {
    if (!selected || !duration) return null;
    const h = Number(duration);
    if (!Number.isFinite(h)) return null;
    const rate = selected.hourlyRate || 0;
    return rate > 0 ? h * rate : null;
  }, [selected, duration]);

  const resetForm = () => {
    setAddress(''); setCity(''); setDateTime(''); setDuration(''); setNotes('');
  };

  const handleRequest = async () => {
    if (!selected || !user?.companyId) {
      Alert.alert('Sign in required', 'You need a company account to request from the marketplace.');
      return;
    }
    if (!address || !city || !dateTime || !duration) {
      Alert.alert('Missing info', 'Please fill address, city, date/time and duration.');
      return;
    }
    const durationHours = Number(duration);
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      Alert.alert('Invalid duration', 'Enter a valid number of hours.');
      return;
    }
    setSubmitting(true);
    try {
      await createJob.mutateAsync({
        serviceId: selected.id,
        customerCompanyId: user.companyId,
        locationAddress: address,
        locationCity: city,
        dateTimeStart: dateTime,
        durationHours,
        notes,
        totalPrice: estimatedTotal ?? 0,
      });
      setSelected(null);
      resetForm();
      Alert.alert('Request sent', 'The provider will review your request and respond.');
    } catch (error) {
      Alert.alert('Request failed', error instanceof Error ? error.message : 'Unable to send request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <ArrowLeft size={20} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Browse listings</Text>
            <Text style={styles.headerSub}>{filtered.length} listings available</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/marketplace/create' as never)} style={styles.newBtn}>
            <Plus size={16} color={C.white} />
            <Text style={styles.newBtnText}>List</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search equipment, repair, services…" placeholderTextColor={C.textMuted} style={styles.searchInput} />
          {query ? <TouchableOpacity onPress={() => setQuery('')}><X size={16} color={C.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {(['All', ...SERVICE_TYPES.map((t) => t.id)] as (ServiceType | 'All')[]).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTypeFilter(t)} style={[styles.chip, typeFilter === t && styles.chipActive]}>
            <Text style={[styles.chipText, typeFilter === t && styles.chipTextActive]}>
              {t === 'All' ? 'All' : serviceTypeLabel(t)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {browseQuery.isLoading ? (
        <View style={styles.centerFill}><ScreenFeedback state="loading" title="Loading marketplace" /></View>
      ) : browseQuery.isError ? (
        <View style={styles.centerFill}><ScreenFeedback state="error" title="Unable to load marketplace" onRetry={() => void browseQuery.refetch()} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {filtered.map((l) => {
            const Icon = TYPE_ICON[l.serviceType];
            const color = TYPE_COLOR[l.serviceType];
            return (
              <TouchableOpacity key={l.id} onPress={() => { setSelected(l); resetForm(); }} style={styles.card} activeOpacity={0.85}>
                <View style={styles.cardHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: color + '20' }]}>
                    <Icon size={13} color={color} />
                    <Text style={[styles.typeBadgeText, { color }]}>{serviceTypeLabel(l.serviceType)}</Text>
                  </View>
                  {l.subcategory ? <Text style={styles.subcatText}>{subcategoryLabel(l.subcategory)}</Text> : null}
                </View>
                <Text style={styles.cardTitle}>{l.title || subcategoryLabel(l.subcategory) || serviceTypeLabel(l.serviceType)}</Text>
                <View style={styles.coverageRow}>
                  <Building2 size={12} color={C.textMuted} />
                  <Text style={styles.coverageText}>{l.companyName}</Text>
                </View>
                {l.coverageArea.length > 0 && (
                  <View style={styles.coverageRow}>
                    <MapPin size={12} color={C.textMuted} />
                    <Text style={styles.coverageText}>{l.coverageArea.join(' · ')}</Text>
                  </View>
                )}
                {l.description ? <Text style={styles.cardDesc} numberOfLines={2}>{l.description}</Text> : null}
                <View style={styles.cardFooter}>
                  <View style={styles.priceRow}>
                    <DollarSign size={14} color={C.green} />
                    <Text style={styles.priceText}>{priceLabel(l)}</Text>
                  </View>
                  {l.negotiable && <Text style={styles.negotiableTag}>Negotiable</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
          {filtered.length === 0 && (
            <View style={styles.emptyState}>
              <Store size={40} color={C.textMuted} />
              <Text style={styles.emptyText}>No listings yet</Text>
              <Text style={styles.emptySub}>Be the first — tap “List” to publish equipment, repair or a service.</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={selected !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        <View style={[styles.modal, { backgroundColor: C.bg }]}>
          <View style={styles.modalHandle} />
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              <View style={styles.modalBody}>
                <View style={[styles.typeBadge, { backgroundColor: TYPE_COLOR[selected.serviceType] + '20', alignSelf: 'flex-start' }]}>
                  <Text style={[styles.typeBadgeText, { color: TYPE_COLOR[selected.serviceType] }]}>{serviceTypeLabel(selected.serviceType)}</Text>
                </View>
                <Text style={styles.modalTitle}>{selected.title || subcategoryLabel(selected.subcategory)}</Text>
                <View style={styles.coverageRow}>
                  <Building2 size={13} color={C.textMuted} />
                  <Text style={styles.locationText}>{selected.companyName}{selected.companyCity ? ` · ${selected.companyCity}` : ''}</Text>
                </View>
                {selected.coverageArea.length > 0 && (
                  <View style={styles.coverageRow}>
                    <MapPin size={13} color={C.textMuted} />
                    <Text style={styles.locationText}>Covers: {selected.coverageArea.join(', ')}</Text>
                  </View>
                )}
                {selected.description ? <Text style={styles.modalDesc}>{selected.description}</Text> : null}

                <View style={styles.detailGrid}>
                  {[
                    ['Hourly', selected.hourlyRate ? `$${selected.hourlyRate}` : '—'],
                    ['Per Job', selected.perJobRate ? `$${selected.perJobRate}` : '—'],
                    ['Daily', selected.dailyRate ? `$${selected.dailyRate}` : '—'],
                    ['Weekly', selected.weeklyRate ? `$${selected.weeklyRate}` : '—'],
                    ['Min Hours', `${selected.minimumHours}h`],
                    ['Pricing', selected.negotiable ? 'Negotiable' : 'Fixed'],
                  ].map(([label, val]) => (
                    <View key={label} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{label}</Text>
                      <Text style={styles.detailValue}>{val}</Text>
                    </View>
                  ))}
                </View>
                {selected.certifications ? (
                  <Text style={styles.certText}>Certifications: {selected.certifications}</Text>
                ) : null}

                {isOwn ? (
                  <View style={styles.ownNote}>
                    <Text style={styles.ownNoteText}>This is your own listing. Other companies can request it from here.</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.formTitle}>Request this {serviceTypeLabel(selected.serviceType).toLowerCase()}</Text>
                    <View style={styles.formGap}>
                      <Input label="Location Address" value={address} onChangeText={setAddress} placeholder="8800 Bridgeport Rd" />
                      <Input label="City" value={city} onChangeText={setCity} placeholder="Richmond" />
                      <Input label="Start Date/Time" value={dateTime} onChangeText={setDateTime} placeholder="2026-08-01T08:00:00" />
                      <Input label={selected.serviceType === 'equipment_rental' ? 'Duration (hours needed)' : 'Duration (hours)'} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="8" />
                      <Input label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} placeholder="Details, access, equipment specs…" />
                      {estimatedTotal != null && (
                        <View style={styles.priceEstimate}>
                          <Text style={styles.priceEstimateLabel}>Estimated Total</Text>
                          <Text style={styles.priceEstimateValue}>${estimatedTotal}</Text>
                        </View>
                      )}
                      <Button label="Send Request" onPress={handleRequest} loading={submitting} fullWidth size="lg" />
                    </View>
                  </>
                )}
                <Button label="Close" onPress={() => setSelected(null)} variant="ghost" fullWidth />
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
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, paddingHorizontal: 12, height: 36, borderRadius: 10 },
  newBtnText: { color: C.white, fontWeight: '700' as const, fontSize: 13 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  centerFill: { flex: 1, justifyContent: 'center', padding: 20 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' as const },
  subcatText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  cardTitle: { fontSize: 17, fontWeight: '700' as const, color: C.text, marginBottom: 6 },
  coverageRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  coverageText: { fontSize: 12, color: C.textSecondary, flex: 1 },
  cardDesc: { fontSize: 13, color: C.textSecondary, marginTop: 4, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceText: { fontSize: 16, fontWeight: '800' as const, color: C.green },
  negotiableTag: { fontSize: 11, color: C.yellow, fontWeight: '700' as const, backgroundColor: C.yellowDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '700' as const },
  emptySub: { fontSize: 13, color: C.textMuted, textAlign: 'center', paddingHorizontal: 40 },
  modal: { flex: 1 },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalBody: { padding: 20, gap: 4 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginTop: 10, marginBottom: 6 },
  locationText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  modalDesc: { fontSize: 14, color: C.textSecondary, lineHeight: 20, marginTop: 8 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginTop: 14 },
  detailItem: { width: '33.33%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 14, color: C.text, fontWeight: '700' as const },
  certText: { fontSize: 12, color: C.textMuted, marginTop: 12 },
  ownNote: { backgroundColor: C.blueDim, borderRadius: 12, padding: 14, marginTop: 16, marginBottom: 8 },
  ownNoteText: { fontSize: 13, color: C.blue },
  formTitle: { fontSize: 18, fontWeight: '700' as const, color: C.text, marginTop: 20, marginBottom: 12 },
  formGap: { gap: 12 },
  priceEstimate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenDim, borderRadius: 10, padding: 14 },
  priceEstimateLabel: { fontSize: 13, color: C.green },
  priceEstimateValue: { fontSize: 20, fontWeight: '800' as const, color: C.green },
});
