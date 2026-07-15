import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Warehouse, Edit, EyeOff, Eye, CheckCircle, Network, Lock } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { trpc } from '@/lib/trpc';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ListingStatus, WarehouseListing } from '@/constants/types';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { parseListingRates, encodeListingRates, DEFAULT_RATES, type ListingRates } from '@/lib/listingRates';

export default function WPListings() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { activeCompany } = useActiveCompany();
  const activeCompanyId = activeCompany?.companyId ?? user?.companyId ?? null;
  const bootstrapQuery = useDockBootstrapData();
  const { warehouseListings, warehouseBookings } = bootstrapQuery.data;
  const utils = trpc.useUtils();
  const invalidate = async () => {
    await Promise.all([
      utils.dock.bootstrap.invalidate(),
      utils.warehouses.listMine.invalidate(),
    ]);
  };
  const updateMutation = trpc.warehouses.updateListing.useMutation({ onSuccess: invalidate });
  const setStatusMutation = trpc.warehouses.setListingStatus.useMutation({ onSuccess: invalidate });
  const setHubMutation = trpc.warehouse.setHub.useMutation({ onSuccess: invalidate });

  const toggleHub = async (l: WarehouseListing) => {
    try {
      await setHubMutation.mutateAsync({ listingId: l.id, enabled: !(l.isNetworkHub ?? true) });
    } catch (error) {
      Alert.alert('Unable to update hub setting', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState(false);
  const [editData, setEditData] = useState<Partial<WarehouseListing>>({});
  const [editRates, setEditRates] = useState<ListingRates>({ ...DEFAULT_RATES });
  const [editDisplayNotes, setEditDisplayNotes] = useState<string>('');

  const setRate = (key: keyof ListingRates, v: string) => {
    const n = Number(v);
    setEditRates((r) => ({ ...r, [key]: Number.isFinite(n) && n >= 0 ? n : 0 }));
  };

  const myListings = useMemo(() => warehouseListings.filter((l) => l.companyId === activeCompanyId), [warehouseListings, activeCompanyId]);

  const bookingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    warehouseBookings.forEach((b) => {
      if (myListings.find((l) => l.id === b.listingId)) {
        counts[b.listingId] = (counts[b.listingId] ?? 0) + 1;
      }
    });
    return counts;
  }, [warehouseBookings, myListings]);

  const openEdit = (l: WarehouseListing) => {
    setEditingId(l.id);
    const { rates, displayNotes } = parseListingRates(l.notes);
    setEditRates(rates);
    setEditDisplayNotes(displayNotes);
    setEditData({
      name: l.name,
      address: l.address,
      city: l.city,
      storageRatePerPallet: l.storageRatePerPallet,
      inboundHandlingFeePerPallet: l.inboundHandlingFeePerPallet,
      outboundHandlingFeePerPallet: l.outboundHandlingFeePerPallet,
      availablePalletCapacity: l.availablePalletCapacity,
      minPallets: l.minPallets,
      maxPallets: l.maxPallets,
      receivingHours: l.receivingHours,
    });
    setEditModal(true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        name: editData.name,
        address: editData.address,
        city: editData.city,
        storageRatePerPallet: editData.storageRatePerPallet !== undefined ? Number(editData.storageRatePerPallet) : undefined,
        inboundHandlingFeePerPallet: editData.inboundHandlingFeePerPallet !== undefined ? Number(editData.inboundHandlingFeePerPallet) : undefined,
        outboundHandlingFeePerPallet: editData.outboundHandlingFeePerPallet !== undefined ? Number(editData.outboundHandlingFeePerPallet) : undefined,
        availablePalletCapacity: editData.availablePalletCapacity !== undefined ? Number(editData.availablePalletCapacity) : undefined,
        minPallets: editData.minPallets !== undefined ? Number(editData.minPallets) : undefined,
        maxPallets: editData.maxPallets !== undefined ? Number(editData.maxPallets) : undefined,
        receivingHours: editData.receivingHours,
        notes: encodeListingRates(editDisplayNotes, editRates),
      });
      setEditModal(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Unable to save changes', message);
    }
  };

  const toggleStatus = async (l: WarehouseListing) => {
    let next: ListingStatus;
    if (l.status === 'Available') next = 'Hidden';
    else if (l.status === 'Hidden') next = 'Available';
    else if (l.status === 'Draft') next = 'PendingApproval';
    else return;
    try {
      await setStatusMutation.mutateAsync({ id: l.id, status: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Unable to update status', message);
    }
  };

  const getToggleLabel = (status: ListingStatus) => {
    if (status === 'Available') return 'Hide Listing';
    if (status === 'Hidden') return 'Unhide';
    if (status === 'Draft') return 'Submit for Approval';
    return '';
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Listings</Text>
        <Text style={styles.sub}>{myListings.length} total</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {myListings.length === 0 && (
          <View style={styles.emptyState}>
            <Warehouse size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>No listings yet. Create your first listing.</Text>
          </View>
        )}
        {myListings.map((l) => (
          <Card key={l.id} elevated style={styles.card}>
            <View style={styles.cardTop}>
              <View style={[styles.typeIcon, { backgroundColor: C.blueDim }]}>
                <Warehouse size={18} color={C.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{l.name}</Text>
                <Text style={styles.cardDetail}>{l.warehouseType} · {l.city} · {l.availablePalletCapacity} pallets</Text>
              </View>
              <StatusBadge status={l.status} />
            </View>
            <View style={styles.cardStats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>${l.storageRatePerPallet}</Text>
                <Text style={styles.statLabel}>/{l.storageTerm.toLowerCase()}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>${l.inboundHandlingFeePerPallet}</Text>
                <Text style={styles.statLabel}>in/out</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{bookingCounts[l.id] ?? 0}</Text>
                <Text style={styles.statLabel}>bookings</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => void toggleHub(l)} activeOpacity={0.8} style={[styles.hubRow, (l.isNetworkHub ?? true) ? styles.hubRowOn : styles.hubRowOff]}>
              <View style={[styles.hubIcon, { backgroundColor: (l.isNetworkHub ?? true) ? C.accentDim : C.bgSecondary }]}>
                {(l.isNetworkHub ?? true) ? <Network size={16} color={C.accent} /> : <Lock size={16} color={C.textMuted} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hubTitle}>{(l.isNetworkHub ?? true) ? 'Network hub — on' : 'Internal only'}</Text>
                <Text style={styles.hubDesc}>
                  {(l.isNetworkHub ?? true)
                    ? 'Discoverable for next-day freight routed through the delivery network.'
                    : 'Used only for your own loads — not offered to the network. Tap to enable.'}
                </Text>
              </View>
              <View style={[styles.hubSwitch, (l.isNetworkHub ?? true) && styles.hubSwitchOn]}>
                <View style={[styles.hubKnob, (l.isNetworkHub ?? true) && styles.hubKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.cardActions}>
              <Button label="Edit" onPress={() => openEdit(l)} variant="secondary" size="sm" icon={<Edit size={13} color={C.textSecondary} />} />
              {['Available', 'Hidden', 'Draft'].includes(l.status) && (
                <Button
                  label={getToggleLabel(l.status as ListingStatus)}
                  onPress={() => toggleStatus(l)}
                  variant="ghost"
                  size="sm"
                  icon={l.status === 'Available' ? <EyeOff size={13} color={C.textMuted} /> : <Eye size={13} color={C.textMuted} />}
                />
              )}
              {l.status === 'Draft' && (
                <View style={styles.draftNote}>
                  <Text style={styles.draftNoteText}>Submit for admin approval to go live</Text>
                </View>
              )}
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={editModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Edit Listing</Text>
            <View style={styles.formGap}>
              <Input label="Listing Name" value={editData.name ?? ''} onChangeText={(v) => setEditData((d) => ({ ...d, name: v }))} />
              <Input label="Address" value={editData.address ?? ''} onChangeText={(v) => setEditData((d) => ({ ...d, address: v }))} />
              <Input label="City" value={editData.city ?? ''} onChangeText={(v) => setEditData((d) => ({ ...d, city: v }))} />

              <Text style={styles.groupLabel}>Storage & handling</Text>
              <Input label="Storage Rate ($/pallet)" value={String(editData.storageRatePerPallet ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, storageRatePerPallet: Number(v) }))} keyboardType="numeric" />
              <View style={styles.twoCol}>
                <Input label="Inbound ($/pallet)" value={String(editData.inboundHandlingFeePerPallet ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, inboundHandlingFeePerPallet: Number(v) }))} keyboardType="numeric" containerStyle={styles.flex1} />
                <Input label="Outbound ($/pallet)" value={String(editData.outboundHandlingFeePerPallet ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, outboundHandlingFeePerPallet: Number(v) }))} keyboardType="numeric" containerStyle={styles.flex1} />
              </View>
              <View style={styles.twoCol}>
                <Input label="Min Pallets" value={String(editData.minPallets ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, minPallets: Number(v) }))} keyboardType="numeric" containerStyle={styles.flex1} />
                <Input label="Max Pallets" value={String(editData.maxPallets ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, maxPallets: Number(v) }))} keyboardType="numeric" containerStyle={styles.flex1} />
              </View>
              <Input label="Available Pallet Capacity" value={String(editData.availablePalletCapacity ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, availablePalletCapacity: Number(v) }))} keyboardType="numeric" />

              <Text style={styles.groupLabel}>Offloading & add-on rates</Text>
              <View style={styles.twoCol}>
                <Input label="20' Container ($)" value={String(editRates.c20)} onChangeText={(v) => setRate('c20', v)} keyboardType="numeric" containerStyle={styles.flex1} />
                <Input label="40' Container ($)" value={String(editRates.c40)} onChangeText={(v) => setRate('c40', v)} keyboardType="numeric" containerStyle={styles.flex1} />
              </View>
              <View style={styles.twoCol}>
                <Input label="5-Ton Truck ($)" value={String(editRates.t5)} onChangeText={(v) => setRate('t5', v)} keyboardType="numeric" containerStyle={styles.flex1} />
                <Input label="Gate Fee ($)" value={String(editRates.gate)} onChangeText={(v) => setRate('gate', v)} keyboardType="numeric" containerStyle={styles.flex1} />
              </View>
              <View style={styles.twoCol}>
                <Input label="Labour ($/hour)" value={String(editRates.labour)} onChangeText={(v) => setRate('labour', v)} keyboardType="numeric" containerStyle={styles.flex1} />
                <Input label="Special Unload/Load ($)" value={String(editRates.special)} onChangeText={(v) => setRate('special', v)} keyboardType="numeric" containerStyle={styles.flex1} />
              </View>

              <Text style={styles.groupLabel}>Facility</Text>
              <Input label="Receiving Hours" value={editData.receivingHours ?? ''} onChangeText={(v) => setEditData((d) => ({ ...d, receivingHours: v }))} />
              <Input label="Notes (shown to customers)" value={editDisplayNotes} onChangeText={setEditDisplayNotes} multiline numberOfLines={3} />
              <Button label="Save Changes" onPress={saveEdit} loading={updateMutation.isPending} fullWidth size="lg" icon={<CheckCircle size={16} color={C.white} />} />
              <Button label="Cancel" onPress={() => setEditModal(false)} variant="ghost" fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  list: { padding: 16, gap: 12 },
  card: { gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  cardDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardStats: { flexDirection: 'row', gap: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  stat: { gap: 2 },
  statValue: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textMuted },
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 10 },
  hubRowOn: { backgroundColor: C.accentDim, borderColor: C.accent + '55' },
  hubRowOff: { backgroundColor: C.card, borderColor: C.border },
  hubIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hubTitle: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  hubDesc: { fontSize: 11, color: C.textSecondary, marginTop: 2, lineHeight: 15 },
  hubSwitch: { width: 42, height: 24, borderRadius: 12, backgroundColor: C.border, padding: 3, justifyContent: 'center' },
  hubSwitchOn: { backgroundColor: C.accent },
  hubKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.white },
  hubKnobOn: { alignSelf: 'flex-end' },
  cardActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  draftNote: { flex: 1 },
  draftNoteText: { fontSize: 11, color: C.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 20 },
  formGap: { gap: 14 },
  groupLabel: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 8 },
  twoCol: { flexDirection: 'row', gap: 12 },
  flex1: { flex: 1 },
});
