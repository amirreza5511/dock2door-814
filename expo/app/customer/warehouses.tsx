import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Search, MapPin, X, Warehouse, ThermometerSnowflake, Thermometer, Package, Star } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { WarehouseType } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';

const TYPE_ICONS: Record<WarehouseType, React.ComponentType<any>> = {
  Dry: Package,
  Chill: Thermometer,
  Frozen: ThermometerSnowflake,
};

const TYPE_COLORS: Record<WarehouseType, string> = {
  Dry: C.yellow,
  Chill: C.blue,
  Frozen: '#6EE7F7',
};

export default function Warehouses() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const { warehouseListings, companies, warehouseBookings } = bootstrapQuery.data;
  const utils = trpc.useUtils();
  const createBookingMutation = trpc.bookings.create.useMutation({
    onSuccess: async () => {
      await utils.dock.bootstrap.invalidate();
      await utils.bookings.listMine.invalidate();
    },
  });

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<WarehouseType | 'All'>('All');
  const [filterCity, setFilterCity] = useState('All');
  const [selectedListing, setSelectedListing] = useState<string | null>(null);
  const [bookingModal, setBookingModal] = useState(false);

  const [pallets, setPallets] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [handling, setHandling] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const available = useMemo(() =>
    warehouseListings.filter((l) => l.status === 'Available'),
    [warehouseListings]
  );

  const cities = useMemo(() => ['All', ...Array.from(new Set(available.map((l) => l.city)))], [available]);

  const filtered = useMemo(() => available.filter((l) => {
    const matchQ = l.name.toLowerCase().includes(query.toLowerCase()) || l.city.toLowerCase().includes(query.toLowerCase());
    const matchType = filterType === 'All' || l.warehouseType === filterType;
    const matchCity = filterCity === 'All' || l.city === filterCity;
    return matchQ && matchType && matchCity;
  }), [available, query, filterType, filterCity]);

  const listing = useMemo(() => warehouseListings.find((l) => l.id === selectedListing), [warehouseListings, selectedListing]);
  const listingCompany = useMemo(() => companies.find((c) => c.id === listing?.companyId), [companies, listing]);

  const estimatedPrice = useMemo(() => {
    if (!listing || !pallets || !startDate || !endDate) return null;
    const days = Math.max(1, (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    const p = Number(pallets);
    let total = p * listing.storageRatePerPallet;
    if (listing.storageTerm === 'Daily') total = p * listing.storageRatePerPallet * days;
    else if (listing.storageTerm === 'Weekly') total = p * listing.storageRatePerPallet * Math.ceil(days / 7);
    if (handling) total += p * (listing.inboundHandlingFeePerPallet + listing.outboundHandlingFeePerPallet);
    return total;
  }, [listing, pallets, startDate, endDate, handling]);

  const handleBook = async () => {
    if (!listing || !user?.companyId) return;
    if (!pallets || !startDate || !endDate) {
      Alert.alert('Missing Info', 'Please fill in pallets, start and end dates');
      return;
    }
    const p = Number(pallets);
    if (p < listing.minPallets || p > listing.maxPallets) {
      Alert.alert('Invalid Pallets', `Must be between ${listing.minPallets} and ${listing.maxPallets}`);
      return;
    }
    setSubmitting(true);
    try {
      await createBookingMutation.mutateAsync({
        listingId: listing.id,
        palletsRequested: p,
        startDate,
        endDate,
        handlingRequired: handling,
        customerNotes: notes,
        proposedPrice: estimatedPrice ?? 0,
      });
      await bootstrapQuery.refetch();
      setBookingModal(false);
      setPallets('');
      setStartDate('');
      setEndDate('');
      setNotes('');
      setHandling(false);
      Alert.alert('Booking Sent!', 'Your request has been sent to the warehouse provider.');
    } catch (error) {
      Alert.alert('Booking failed', error instanceof Error ? error.message : 'Unable to send booking request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="loading" title="Loading warehouses" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <ScreenFeedback state="error" title="Unable to load warehouses" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>Warehouse Space</Text>
        <Text style={styles.headerSub}>{filtered.length} listings available</Text>
        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or city…"
            placeholderTextColor={C.textMuted}
            style={styles.searchInput}
          />
          {query ? <TouchableOpacity onPress={() => setQuery('')}><X size={16} color={C.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {['All', 'Dry', 'Chill', 'Frozen'].map((t) => (
          <TouchableOpacity key={t} onPress={() => setFilterType(t as any)} style={[styles.chip, filterType === t && styles.chipActive]}>
            <Text style={[styles.chipText, filterType === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.divider} />
        {cities.map((c) => (
          <TouchableOpacity key={c} onPress={() => setFilterCity(c)} style={[styles.chip, filterCity === c && styles.chipActiveCity]}>
            <Text style={[styles.chipText, filterCity === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.map((l) => {
          const TypeIcon = TYPE_ICONS[l.warehouseType];
          const typeColor = TYPE_COLORS[l.warehouseType];
          const co = companies.find((c) => c.id === l.companyId);
          const myBookingsForThis = warehouseBookings.filter((b) => b.listingId === l.id && b.customerCompanyId === user?.companyId);
          return (
            <TouchableOpacity
              key={l.id}
              onPress={() => { setSelectedListing(l.id); setBookingModal(true); }}
              style={styles.card}
              activeOpacity={0.85}
              testID={`listing-${l.id}`}
            >
              {l.photos[0] && (
                <Image source={{ uri: l.photos[0] }} style={styles.cardImage} contentFit="cover" />
              )}
              <View style={styles.cardBody}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.typeChip, { backgroundColor: typeColor + '20' }]}>
                    <TypeIcon size={12} color={typeColor} />
                    <Text style={[styles.typeChipText, { color: typeColor }]}>{l.warehouseType}</Text>
                  </View>
                  <StatusBadge status={l.status} />
                </View>
                <Text style={styles.cardName}>{l.name}</Text>
                <View style={styles.locationRow}>
                  <MapPin size={13} color={C.textMuted} />
                  <Text style={styles.locationText}>{l.address}, {l.city}</Text>
                </View>
                {co && <Text style={styles.companyName}>{co.name}</Text>}
                <View style={styles.cardStats}>
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatValue}>{l.availablePalletCapacity}</Text>
                    <Text style={styles.cardStatLabel}>Pallets</Text>
                  </View>
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatValue}>${l.storageRatePerPallet}</Text>
                    <Text style={styles.cardStatLabel}>/{l.storageTerm.toLowerCase()}</Text>
                  </View>
                  <View style={styles.cardStat}>
                    <Text style={styles.cardStatValue}>${l.inboundHandlingFeePerPallet}</Text>
                    <Text style={styles.cardStatLabel}>in/out</Text>
                  </View>
                </View>
                {myBookingsForThis.length > 0 && (
                  <View style={styles.existingBooking}>
                    <Star size={12} color={C.accent} />
                    <Text style={styles.existingBookingText}>You have {myBookingsForThis.length} booking(s) here</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        {filtered.length === 0 && (
          <View style={styles.emptyState}>
            <Warehouse size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>No warehouses found</Text>
            <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
          </View>
        )}
      </ScrollView>

      {/* Booking Modal */}
      <Modal visible={bookingModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {listing && (
            <ScrollView showsVerticalScrollIndicator={false}>
              {listing.photos[0] && (
                <Image source={{ uri: listing.photos[0] }} style={styles.modalImage} contentFit="cover" />
              )}
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>{listing.name}</Text>
                  <StatusBadge status={listing.status} />
                </View>
                <View style={styles.locationRow}>
                  <MapPin size={14} color={C.textMuted} />
                  <Text style={styles.locationText}>{listing.address}, {listing.city}</Text>
                </View>
                {listingCompany && <Text style={[styles.companyName, { marginTop: 4 }]}>{listingCompany.name}</Text>}

                <View style={styles.detailGrid}>
                  {[
                    ['Type', listing.warehouseType],
                    ['Capacity', `${listing.availablePalletCapacity} pallets`],
                    ['Min/Max', `${listing.minPallets}–${listing.maxPallets} pallets`],
                    ['Storage Rate', `$${listing.storageRatePerPallet}/${listing.storageTerm.toLowerCase()}`],
                    ['Inbound Fee', `$${listing.inboundHandlingFeePerPallet}/pallet`],
                    ['Outbound Fee', `$${listing.outboundHandlingFeePerPallet}/pallet`],
                    ['Hours', listing.receivingHours],
                    ['Access', listing.accessRestrictions || 'None'],
                  ].map(([label, val]) => (
                    <View key={label} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{label}</Text>
                      <Text style={styles.detailValue}>{val}</Text>
                    </View>
                  ))}
                </View>

                {listing.notes ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesText}>{listing.notes}</Text>
                  </View>
                ) : null}

                <Text style={styles.bookingFormTitle}>Request Storage</Text>
                <View style={styles.formGap}>
                  <Input label="Number of Pallets" value={pallets} onChangeText={setPallets} keyboardType="numeric" placeholder={`${listing.minPallets}–${listing.maxPallets}`} />
                  <Input label="Start Date (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} placeholder="2025-04-01" />
                  <Input label="End Date (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} placeholder="2025-04-30" />
                  <TouchableOpacity onPress={() => setHandling(!handling)} style={[styles.checkbox, handling && styles.checkboxActive]}>
                    <View style={[styles.checkboxDot, handling && styles.checkboxDotActive]} />
                    <Text style={styles.checkboxLabel}>Include handling (in/out)</Text>
                  </TouchableOpacity>
                  <Input label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Any special requirements…" multiline numberOfLines={3} />

                  {estimatedPrice && (
                    <View style={styles.priceEstimate}>
                      <Text style={styles.priceEstimateLabel}>Estimated Price</Text>
                      <Text style={styles.priceEstimateValue}>${estimatedPrice.toLocaleString()}</Text>
                    </View>
                  )}

                  <Button label="Send Booking Request" onPress={handleBook} loading={submitting} fullWidth size="lg" />
                  <Button label="Cancel" onPress={() => setBookingModal(false)} variant="ghost" fullWidth />
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
  centered: { justifyContent: 'center', padding: 20 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  headerSub: { fontSize: 13, color: C.textSecondary, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.blueDim, borderColor: C.blue },
  chipActiveCity: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.text, fontWeight: '700' as const },
  divider: { width: 1, height: 20, backgroundColor: C.border, marginHorizontal: 4 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  cardImage: { width: '100%', height: 160 },
  cardBody: { padding: 14 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  typeChipText: { fontSize: 11, fontWeight: '700' as const },
  cardName: { fontSize: 17, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  locationText: { fontSize: 12, color: C.textSecondary, flex: 1 },
  companyName: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginBottom: 10 },
  cardStats: { flexDirection: 'row', gap: 16, marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  cardStat: { gap: 2 },
  cardStatValue: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  cardStatLabel: { fontSize: 11, color: C.textMuted },
  existingBooking: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.accentDim, borderRadius: 6, padding: 6 },
  existingBookingText: { fontSize: 12, color: C.accent },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 16, color: C.textSecondary, fontWeight: '600' as const },
  emptySubtext: { fontSize: 13, color: C.textMuted },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalImage: { width: '100%', height: 200 },
  modalBody: { padding: 20 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 10 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0, marginTop: 16, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  notesBox: { marginTop: 12, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  notesText: { fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  bookingFormTitle: { fontSize: 18, fontWeight: '700' as const, color: C.text, marginTop: 20, marginBottom: 12 },
  formGap: { gap: 12 },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  checkboxActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  checkboxDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border },
  checkboxDotActive: { backgroundColor: C.accent, borderColor: C.accent },
  checkboxLabel: { fontSize: 14, color: C.text },
  priceEstimate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenDim, borderRadius: 10, padding: 14 },
  priceEstimateLabel: { fontSize: 13, color: C.green },
  priceEstimateValue: { fontSize: 20, fontWeight: '800' as const, color: C.green },
});
