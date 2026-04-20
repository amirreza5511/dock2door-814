import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, MapPin, X, Wrench, Clock, DollarSign } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import C from '@/constants/colors';
import type { ServiceCategory } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';

const CATEGORY_COLORS: Record<ServiceCategory, string> = {
  Labour: C.yellow,
  Forklift: C.accent,
  PalletRework: C.blue,
  Devanning: C.green,
  LocalTruck: C.purple,
  IndustrialCleaning: C.textSecondary,
};

const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  Labour: 'Labour',
  Forklift: 'Forklift',
  PalletRework: 'Pallet Rework',
  Devanning: 'Devanning',
  LocalTruck: 'Local Truck',
  IndustrialCleaning: 'Cleaning',
};

const ALL_CATEGORIES: ServiceCategory[] = ['Labour', 'Forklift', 'PalletRework', 'Devanning', 'LocalTruck', 'IndustrialCleaning'];

export default function Services() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const createServiceJobMutation = trpc.dock.createRecord.useMutation({
    onSuccess: async () => {
      await utils.dock.bootstrap.invalidate();
    },
  });
  const { serviceListings, companies } = bootstrapQuery.data;

  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<ServiceCategory | 'All'>('All');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [bookModal, setBookModal] = useState(false);

  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const active = useMemo(() => serviceListings.filter((l) => l.status === 'Active'), [serviceListings]);

  const filtered = useMemo(() => active.filter((l) => {
    const co = companies.find((c) => c.id === l.companyId);
    const matchQ = (co?.name ?? '').toLowerCase().includes(query.toLowerCase()) || l.category.toLowerCase().includes(query.toLowerCase());
    const matchCat = filterCat === 'All' || l.category === filterCat;
    return matchQ && matchCat;
  }), [active, query, filterCat, companies]);

  const service = useMemo(() => serviceListings.find((l) => l.id === selectedService), [serviceListings, selectedService]);
  const serviceCompany = useMemo(() => companies.find((c) => c.id === service?.companyId), [companies, service]);

  const estimatedTotal = useMemo(() => {
    if (!service || !duration) return null;
    const h = Number(duration);
    return h * service.hourlyRate;
  }, [service, duration]);

  const handleBook = async () => {
    if (!service || !user?.companyId) {
      return;
    }
    if (!address || !city || !dateTime || !duration) {
      Alert.alert('Missing Info', 'Please fill all required fields');
      return;
    }

    const durationHours = Number(duration);
    if (!Number.isFinite(durationHours) || durationHours < service.minimumHours) {
      Alert.alert('Invalid Duration', `Minimum booking duration is ${service.minimumHours} hours.`);
      return;
    }

    setSubmitting(true);
    try {
      await createServiceJobMutation.mutateAsync({
        table: 'service_jobs',
        payload: {
          serviceId: service.id,
          customerCompanyId: user.companyId,
          locationAddress: address,
          locationCity: city,
          dateTimeStart: dateTime,
          durationHours,
          notes,
          totalPrice: estimatedTotal ?? 0,
          status: 'Requested',
          paymentStatus: 'Pending',
          checkInTs: null,
          checkOutTs: null,
          customerConfirmed: false,
          createdAt: new Date().toISOString(),
        },
      });
      setBookModal(false);
      setAddress('');
      setCity('');
      setDateTime('');
      setDuration('');
      setNotes('');
      Alert.alert('Job Requested!', 'The service provider will review your request.');
    } catch (error) {
      Alert.alert('Request failed', error instanceof Error ? error.message : 'Unable to request service.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>Industrial Services</Text>
        <Text style={styles.headerSub}>{filtered.length} providers available</Text>
        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search services…" placeholderTextColor={C.textMuted} style={styles.searchInput} />
          {query ? <TouchableOpacity onPress={() => setQuery('')}><X size={16} color={C.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {(['All', ...ALL_CATEGORIES] as (ServiceCategory | 'All')[]).map((cat) => (
          <TouchableOpacity key={cat} onPress={() => setFilterCat(cat)} style={[styles.chip, filterCat === cat && styles.chipActive]}>
            <Text style={[styles.chipText, filterCat === cat && styles.chipTextActive]}>
              {cat === 'All' ? 'All' : CATEGORY_LABELS[cat as ServiceCategory]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.map((l) => {
          const co = companies.find((c) => c.id === l.companyId);
          const color = CATEGORY_COLORS[l.category];
          return (
            <TouchableOpacity key={l.id} onPress={() => { setSelectedService(l.id); setBookModal(true); }} style={styles.card} activeOpacity={0.85}>
              <View style={styles.cardHeader}>
                <View style={[styles.catBadge, { backgroundColor: color + '20' }]}>
                  <Wrench size={14} color={color} />
                  <Text style={[styles.catBadgeText, { color }]}>{CATEGORY_LABELS[l.category]}</Text>
                </View>
                <StatusBadge status={l.status} />
              </View>
              <Text style={styles.cardName}>{co?.name ?? 'Unknown Provider'}</Text>
              <View style={styles.coverageRow}>
                <MapPin size={13} color={C.textMuted} />
                <Text style={styles.coverageText}>{l.coverageArea.join(' · ')}</Text>
              </View>
              <View style={styles.cardStats}>
                <View style={styles.cardStat}>
                  <DollarSign size={13} color={C.textMuted} />
                  <Text style={styles.cardStatValue}>${l.hourlyRate}/hr</Text>
                </View>
                {l.perJobRate && (
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatLabel}>From</Text>
                    <Text style={styles.cardStatValue}>${l.perJobRate}/job</Text>
                  </View>
                )}
                <View style={styles.cardStat}>
                  <Clock size={13} color={C.textMuted} />
                  <Text style={styles.cardStatValue}>Min {l.minimumHours}h</Text>
                </View>
              </View>
              {l.certifications && (
                <Text style={styles.certText}>{l.certifications}</Text>
              )}
            </TouchableOpacity>
          );
        })}
        {filtered.length === 0 && (
          <View style={styles.emptyState}>
            <Wrench size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>No services found</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={bookModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {service && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <View style={[styles.catBadge, { backgroundColor: CATEGORY_COLORS[service.category] + '20' }]}>
                    <Text style={[styles.catBadgeText, { color: CATEGORY_COLORS[service.category] }]}>{CATEGORY_LABELS[service.category]}</Text>
                  </View>
                  <StatusBadge status={service.status} />
                </View>
                <Text style={styles.modalTitle}>{serviceCompany?.name}</Text>
                <View style={styles.locationRow}>
                  <MapPin size={14} color={C.textMuted} />
                  <Text style={styles.locationText}>Covers: {service.coverageArea.join(', ')}</Text>
                </View>
                <View style={styles.detailGrid}>
                  {[
                    ['Hourly Rate', `$${service.hourlyRate}/hr`],
                    ['Per Job', service.perJobRate ? `$${service.perJobRate}` : 'N/A'],
                    ['Minimum Hours', `${service.minimumHours}h`],
                    ['Certifications', service.certifications || 'N/A'],
                  ].map(([label, val]) => (
                    <View key={label} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{label}</Text>
                      <Text style={styles.detailValue}>{val}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.bookingFormTitle}>Request Service</Text>
                <View style={styles.formGap}>
                  <Input label="Job Location Address" value={address} onChangeText={setAddress} placeholder="8800 Bridgeport Rd" />
                  <Input label="City" value={city} onChangeText={setCity} placeholder="Richmond" />
                  <Input label="Start Date/Time (ISO)" value={dateTime} onChangeText={setDateTime} placeholder="2025-04-01T08:00:00" />
                  <Input label="Duration (hours)" value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder={`Min ${service.minimumHours}`} />
                  <Input label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} placeholder="Special instructions…" />
                  {estimatedTotal && (
                    <View style={styles.priceEstimate}>
                      <Text style={styles.priceEstimateLabel}>Estimated Total</Text>
                      <Text style={styles.priceEstimateValue}>${estimatedTotal}</Text>
                    </View>
                  )}
                  <Button label="Request Service" onPress={handleBook} loading={submitting} fullWidth size="lg" />
                  <Button label="Cancel" onPress={() => setBookModal(false)} variant="ghost" fullWidth />
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
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  headerSub: { fontSize: 13, color: C.textSecondary, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  catBadgeText: { fontSize: 12, fontWeight: '700' as const },
  cardName: { fontSize: 18, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  coverageRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  coverageText: { fontSize: 12, color: C.textSecondary, flex: 1 },
  cardStats: { flexDirection: 'row', gap: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  cardStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStatValue: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardStatLabel: { fontSize: 12, color: C.textMuted },
  certText: { fontSize: 11, color: C.textMuted, marginTop: 8 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '600' as const },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalBody: { padding: 20 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 6 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  locationText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: 8 },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  bookingFormTitle: { fontSize: 18, fontWeight: '700' as const, color: C.text, marginTop: 16, marginBottom: 12 },
  formGap: { gap: 12 },
  priceEstimate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenDim, borderRadius: 10, padding: 14 },
  priceEstimateLabel: { fontSize: 13, color: C.green },
  priceEstimateValue: { fontSize: 20, fontWeight: '800' as const, color: C.green },
});
