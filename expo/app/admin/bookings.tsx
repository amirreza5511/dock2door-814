import React, { useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Building2, CalendarClock, CheckCircle2, CircleDot, Filter, Route, Search, Send, ShieldCheck, Warehouse, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { supabase } from '@/lib/supabaseClient';

type Filter = 'unrouted' | 'routed' | 'active' | 'all';

export default function AdminBookingRoutingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const bootstrap = useDockBootstrapData();
  const { warehouseBookings, warehouseListings, companies } = bootstrap.data;

  const [filter, setFilter] = useState<Filter>('unrouted');
  const [search, setSearch] = useState('');
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const [routeListingId, setRouteListingId] = useState('');
  const [routeNotes, setRouteNotes] = useState('');
  const [routing, setRouting] = useState(false);

  const providers = useMemo(() => companies.filter((c) => c.type === 'warehouse_provider'), [companies]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return warehouseBookings.filter((b) => {
      if (filter === 'unrouted' && b.status !== 'Requested') return false;
      if (filter === 'routed' && !['Accepted', 'CounterOffered', 'Confirmed', 'Scheduled'].includes(b.status)) return false;
      if (filter === 'active' && !['Accepted', 'Confirmed', 'Scheduled', 'InProgress'].includes(b.status)) return false;
      if (!s) return true;
      return JSON.stringify(b).toLowerCase().includes(s);
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [warehouseBookings, filter, search]);

  const totals = useMemo(() => ({
    unrouted: warehouseBookings.filter((b) => b.status === 'Requested').length,
    active: warehouseBookings.filter((b) => ['Accepted', 'Confirmed', 'Scheduled', 'InProgress'].includes(b.status)).length,
    completed: warehouseBookings.filter((b) => b.status === 'Completed').length,
  }), [warehouseBookings]);

  const openRoute = (bookingId: string, currentListingId: string) => {
    setRouteFor(bookingId);
    setRouteListingId(currentListingId);
    setRouteNotes('');
  };

  const suggestForCurrent = useMemo(() => {
    if (!routeFor) return [] as typeof warehouseListings;
    const booking = warehouseBookings.find((b) => b.id === routeFor);
    if (!booking) return warehouseListings;
    return warehouseListings
      .filter((l) => l.status === 'Available' && l.availablePalletCapacity >= booking.palletsRequested)
      .slice(0, 20);
  }, [routeFor, warehouseBookings, warehouseListings]);

  const assign = async () => {
    if (!routeFor || !routeListingId.trim()) { Alert.alert('Pick a warehouse'); return; }
    const booking = warehouseBookings.find((b) => b.id === routeFor);
    if (!booking) return;
    const listing = warehouseListings.find((l) => l.id === routeListingId);
    if (!listing) { Alert.alert('Invalid listing'); return; }
    setRouting(true);
    try {
      const { error } = await supabase
        .from('warehouse_bookings')
        .update({
          listing_id: routeListingId,
          warehouse_company_id: listing.companyId,
          customer_notes: [booking.customerNotes, routeNotes ? `Broker routing note: ${routeNotes}` : ''].filter(Boolean).join('\n'),
        })
        .eq('id', routeFor);
      if (error) throw error;
      await bootstrap.refetch();
      await utils.bookings.listMine.invalidate();
      Alert.alert('Booking routed', `Assigned to ${listing.name}. Provider will receive the request.`);
      setRouteFor(null);
    } catch (err) {
      Alert.alert('Routing failed', err instanceof Error ? err.message : 'Unknown error');
    } finally { setRouting(false); }
  };

  const forceStatus = async (bookingId: string, next: 'Cancelled' | 'Completed') => {
    Alert.prompt?.('Reason', `Admin reason for forcing booking to ${next}`, async (reason) => {
      if (!reason) return;
      try {
        const { error } = await supabase.rpc('admin_force_booking_status', { p_booking_id: bookingId, p_next_status: next, p_reason: reason });
        if (error) throw error;
        await bootstrap.refetch();
      } catch (err) { Alert.alert('Force failed', err instanceof Error ? err.message : 'Unknown error'); }
    }) ?? (async () => {
      try {
        const { error } = await supabase.rpc('admin_force_booking_status', { p_booking_id: bookingId, p_next_status: next, p_reason: 'Admin broker override' });
        if (error) throw error;
        await bootstrap.refetch();
      } catch (err) { Alert.alert('Force failed', err instanceof Error ? err.message : 'Unknown error'); }
    })();
  };

  if (bootstrap.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading bookings" /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Booking Routing</Text>
          <Text style={styles.subtitle}>Broker view · customer → Dock2Door → provider</Text>
        </View>
        <View style={styles.brokerBadge}><ShieldCheck size={12} color={C.accent} /><Text style={styles.brokerBadgeText}>Broker</Text></View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.stat, { borderLeftColor: C.yellow }]}><Text style={styles.statValue}>{totals.unrouted}</Text><Text style={styles.statLabel}>Unrouted</Text></View>
        <View style={[styles.stat, { borderLeftColor: C.accent }]}><Text style={styles.statValue}>{totals.active}</Text><Text style={styles.statLabel}>Active</Text></View>
        <View style={[styles.stat, { borderLeftColor: C.green }]}><Text style={styles.statValue}>{totals.completed}</Text><Text style={styles.statLabel}>Completed</Text></View>
      </View>

      <View style={styles.searchBar}>
        <Search size={14} color={C.textMuted} />
        <Input value={search} onChangeText={setSearch} placeholder="Search by customer, listing, notes…" containerStyle={styles.searchInput} />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><X size={14} color={C.textMuted} /></TouchableOpacity> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {(['unrouted', 'routed', 'active', 'all'] as Filter[]).map((k) => (
          <TouchableOpacity key={k} onPress={() => setFilter(k)} style={[styles.filterChip, filter === k && styles.filterChipActive]}>
            <Filter size={10} color={filter === k ? C.accent : C.textMuted} />
            <Text style={[styles.filterText, filter === k && styles.filterTextActive]}>{k === 'unrouted' ? 'To route' : k[0].toUpperCase() + k.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={bootstrap.isFetching} onRefresh={() => void bootstrap.refetch()} tintColor={C.accent} />}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}><Route size={34} color={C.textMuted} /><Text style={styles.emptyTitle}>Nothing to route</Text><Text style={styles.emptyText}>New customer bookings will appear here.</Text></View>
        ) : filtered.map((b) => {
          const listing = warehouseListings.find((l) => l.id === b.listingId);
          const customer = companies.find((c) => c.id === b.customerCompanyId);
          const provider = companies.find((c) => c.id === listing?.companyId);
          const unrouted = b.status === 'Requested';
          return (
            <View key={b.id} style={[styles.bookingCard, unrouted && styles.bookingCardNew]}>
              <View style={styles.bookingTop}>
                <View style={{ flex: 1 }}>
                  <View style={styles.bookingMetaRow}>
                    <Building2 size={12} color={C.textMuted} />
                    <Text style={styles.bookingCust}>{customer?.name || 'Customer'}</Text>
                    <CircleDot size={10} color={C.textMuted} />
                    <Text style={styles.bookingMeta}>{b.id.slice(0, 8)}</Text>
                  </View>
                  <Text style={styles.bookingTitle}>{b.palletsRequested} pallets · {b.startDate} → {b.endDate}</Text>
                  <View style={styles.bookingMetaRow}>
                    <CalendarClock size={11} color={C.textMuted} />
                    <Text style={styles.bookingMeta}>{new Date(b.createdAt).toLocaleString()}</Text>
                  </View>
                </View>
                <StatusBadge status={b.status} />
              </View>

              <View style={styles.routeBox}>
                <View style={styles.routeCol}>
                  <Text style={styles.routeLabel}>Customer pays</Text>
                  <Text style={styles.routeValue}>${b.proposedPrice.toLocaleString()}</Text>
                </View>
                <Route size={14} color={C.accent} />
                <View style={styles.routeCol}>
                  <Text style={styles.routeLabel}>Routed to</Text>
                  <Text style={styles.routeValue}>{listing?.name || (unrouted ? '— pending —' : 'Unknown')}</Text>
                  {provider ? <Text style={styles.routeProvider}>Provider: {provider.name}</Text> : null}
                </View>
              </View>

              {b.customerNotes ? (
                <Text style={styles.bookingNotes}>“{b.customerNotes}”</Text>
              ) : null}

              <View style={styles.actionRow}>
                <Button
                  label={unrouted ? 'Route to warehouse' : 'Re-route'}
                  onPress={() => openRoute(b.id, b.listingId)}
                  icon={<Send size={14} color={C.white} />}
                  size="sm"
                />
                {!unrouted && b.status !== 'Completed' && b.status !== 'Cancelled' ? (
                  <Button label="Force complete" variant="secondary" size="sm" onPress={() => void forceStatus(b.id, 'Completed')} />
                ) : null}
                {b.status !== 'Completed' && b.status !== 'Cancelled' ? (
                  <Button label="Cancel" variant="danger" size="sm" onPress={() => void forceStatus(b.id, 'Cancelled')} />
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={routeFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRouteFor(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Assign warehouse</Text>
            <TouchableOpacity onPress={() => setRouteFor(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.hint}>Customer never sees the provider identity. Only the assigned provider will receive the operational booking details.</Text>

            <Text style={styles.sectionLabel}>Suggested warehouses ({suggestForCurrent.length})</Text>
            {suggestForCurrent.length === 0 ? (
              <Text style={styles.hint}>No listings match the pallet requirement. Pick any active warehouse below.</Text>
            ) : suggestForCurrent.map((l) => {
              const provider = providers.find((p) => p.id === l.companyId);
              const active = routeListingId === l.id;
              return (
                <TouchableOpacity key={l.id} onPress={() => setRouteListingId(l.id)} style={[styles.listingRow, active && styles.listingRowActive]}>
                  <Warehouse size={16} color={active ? C.accent : C.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listingTitle}>{l.name}</Text>
                    <Text style={styles.listingMeta}>{provider?.name || 'Provider'} · {l.city} · {l.warehouseType}</Text>
                    <Text style={styles.listingMeta}>{l.availablePalletCapacity} pallets available · ${l.storageRatePerPallet}/{l.storageTerm.toLowerCase()}</Text>
                  </View>
                  {active ? <CheckCircle2 size={18} color={C.accent} /> : null}
                </TouchableOpacity>
              );
            })}

            <Input label="Listing ID override" value={routeListingId} onChangeText={setRouteListingId} placeholder="listing_…" />
            <Input label="Internal routing note (not shown to customer)" value={routeNotes} onChangeText={setRouteNotes} placeholder="Rate negotiated, temp window, etc." multiline numberOfLines={3} />
            <Button
              label="Route booking"
              onPress={() => void assign()}
              loading={routing}
              fullWidth
              size="lg"
              icon={<Send size={15} color={C.white} />}
            />
            <Button label="Cancel" onPress={() => setRouteFor(null)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  brokerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  brokerBadgeText: { fontSize: 11, color: C.accent, fontWeight: '700' as const },
  statsRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: C.bgSecondary },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, padding: 10 },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10 },
  searchInput: { flex: 1, marginBottom: 0 },
  filterRow: { gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  filterTextActive: { color: C.accent },
  body: { padding: 16, gap: 10 },
  bookingCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  bookingCardNew: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim },
  bookingTop: { flexDirection: 'row', gap: 10 },
  bookingMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  bookingCust: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  bookingMeta: { fontSize: 11, color: C.textMuted },
  bookingTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 4 },
  routeBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10 },
  routeCol: { flex: 1 },
  routeLabel: { fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  routeValue: { fontSize: 13, fontWeight: '700' as const, color: C.text, marginTop: 2 },
  routeProvider: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  bookingNotes: { fontSize: 12, color: C.textSecondary, fontStyle: 'italic' as const, borderLeftWidth: 2, borderLeftColor: C.border, paddingLeft: 8 },
  actionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyText: { fontSize: 12, color: C.textMuted },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
  hint: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  sectionLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 6 },
  listingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  listingRowActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  listingTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  listingMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
});
