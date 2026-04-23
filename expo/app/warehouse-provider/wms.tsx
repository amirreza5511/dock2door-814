import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Plus, PackageOpen, ClipboardCheck, Archive, CheckCircle } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Tab = 'locations' | 'stock' | 'receipts' | 'counts';

interface LocationRow { id: string; zone: string; aisle: string; rack: string; level: string; bin: string; label: string }
interface StockRow {
  id: string; variant_id: string; location_id: string; on_hand: number; reserved: number;
  product_variants?: { sku?: string; name?: string };
  warehouse_locations?: { label?: string; zone?: string; bin?: string };
}
interface ReceiptRow { id: string; reference?: string; status: string; created_at: string; supplier?: string }
interface CycleCountRow { id: string; status: string; variance?: number; created_at: string }

export default function WmsScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>('locations');

  const locations = trpc.wms.listLocations.useQuery();
  const stock = trpc.wms.listStockLevels.useQuery(undefined, { enabled: tab === 'stock' });
  const receipts = trpc.wms.listReceipts.useQuery(undefined, { enabled: tab === 'receipts' });
  const counts = trpc.wms.listCycleCounts.useQuery(undefined, { enabled: tab === 'counts' });

  const createLocation = trpc.wms.createLocation.useMutation({
    onSuccess: async () => { await utils.wms.listLocations.invalidate(); },
  });

  const [showLocForm, setShowLocForm] = useState<boolean>(false);
  const [lf, setLf] = useState({ zone: '', aisle: '', rack: '', level: '', bin: '', label: '' });

  const locList = useMemo<LocationRow[]>(() => (locations.data ?? []) as LocationRow[], [locations.data]);
  const stockList = useMemo<StockRow[]>(() => (stock.data ?? []) as StockRow[], [stock.data]);
  const receiptList = useMemo<ReceiptRow[]>(() => (receipts.data ?? []) as ReceiptRow[], [receipts.data]);
  const countList = useMemo<CycleCountRow[]>(() => (counts.data ?? []) as CycleCountRow[], [counts.data]);

  const submitLocation = async () => {
    if (!lf.zone.trim() && !lf.label.trim()) {
      Alert.alert('Missing info', 'Add at least a zone or label.');
      return;
    }
    try {
      await createLocation.mutateAsync(lf);
      setLf({ zone: '', aisle: '', rack: '', level: '', bin: '', label: '' });
      setShowLocForm(false);
    } catch (error) {
      Alert.alert('Unable to create location', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const activeQuery = tab === 'locations' ? locations : tab === 'stock' ? stock : tab === 'receipts' ? receipts : counts;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.title}>Warehouse Ops</Text>
          <Text style={styles.sub}>Locations · Stock · Receipts · Counts</Text>
        </View>
        {tab === 'locations' ? (
          <TouchableOpacity onPress={() => setShowLocForm(true)} style={styles.addBtn} testID="wms-add-location">
            <Plus size={18} color={C.white} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.segmentRow}>
        {(['locations', 'stock', 'receipts', 'counts'] as Tab[]).map((k) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.segment, tab === k && styles.segmentActive]}>
            <Text style={[styles.segmentText, tab === k && styles.segmentTextActive]}>{k[0].toUpperCase() + k.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        refreshControl={<RefreshControl refreshing={activeQuery.isFetching} onRefresh={() => void activeQuery.refetch()} tintColor={C.accent} />}
      >
        {activeQuery.isLoading ? <ScreenFeedback state="loading" title="Loading" /> : null}

        {tab === 'locations' && locList.length === 0 && !activeQuery.isLoading ? (
          <EmptyState icon={MapPin} title="No locations" description="Create your first bin location to start tracking stock." />
        ) : null}
        {tab === 'locations' && locList.map((l) => (
          <Card key={l.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={[styles.iconWrap, { backgroundColor: C.purpleDim }]}><MapPin size={15} color={C.purple} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{l.label || `${l.zone}-${l.aisle}-${l.rack}-${l.bin}`}</Text>
                <Text style={styles.cardMeta}>Zone {l.zone || '—'} · Aisle {l.aisle || '—'} · Rack {l.rack || '—'} · Bin {l.bin || '—'}</Text>
              </View>
            </View>
          </Card>
        ))}

        {tab === 'stock' && stockList.length === 0 && !activeQuery.isLoading ? (
          <EmptyState icon={Archive} title="No stock" description="Receive inventory to build stock levels." />
        ) : null}
        {tab === 'stock' && stockList.map((s) => (
          <Card key={s.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}><Archive size={15} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{s.product_variants?.sku ?? '—'} · {s.product_variants?.name ?? ''}</Text>
                <Text style={styles.cardMeta}>
                  {s.warehouse_locations?.label ?? `${s.warehouse_locations?.zone ?? ''} ${s.warehouse_locations?.bin ?? ''}`} · on-hand {s.on_hand} · reserved {s.reserved}
                </Text>
              </View>
              <Text style={styles.qty}>{Number(s.on_hand) - Number(s.reserved)}</Text>
            </View>
          </Card>
        ))}

        {tab === 'receipts' && receiptList.length === 0 && !activeQuery.isLoading ? (
          <EmptyState icon={PackageOpen} title="No receipts" description="Incoming ASNs and receipts will appear here." />
        ) : null}
        {tab === 'receipts' && receiptList.map((r) => (
          <Card key={r.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={[styles.iconWrap, { backgroundColor: C.greenDim }]}><PackageOpen size={15} color={C.green} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{r.reference ?? `Receipt ${r.id.slice(0, 8)}`}</Text>
                <Text style={styles.cardMeta}>{r.supplier ?? '—'} · {new Date(r.created_at).toLocaleDateString()}</Text>
              </View>
              <StatusBadge status={r.status} />
            </View>
          </Card>
        ))}

        {tab === 'counts' && countList.length === 0 && !activeQuery.isLoading ? (
          <EmptyState icon={ClipboardCheck} title="No cycle counts" description="Run periodic counts to verify inventory." />
        ) : null}
        {tab === 'counts' && countList.map((c) => (
          <Card key={c.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={[styles.iconWrap, { backgroundColor: C.yellowDim }]}><ClipboardCheck size={15} color={C.yellow} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Count {c.id.slice(0, 8)}</Text>
                <Text style={styles.cardMeta}>Variance {c.variance ?? 0} · {new Date(c.created_at).toLocaleDateString()}</Text>
              </View>
              <StatusBadge status={c.status} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={showLocForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowLocForm(false)}>
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalTitle}>New Location</Text>
            <Input label="Label" value={lf.label} onChangeText={(v) => setLf({ ...lf, label: v })} placeholder="A-12-3-B" autoCapitalize="characters" />
            <Input label="Zone" value={lf.zone} onChangeText={(v) => setLf({ ...lf, zone: v })} placeholder="A" autoCapitalize="characters" />
            <Input label="Aisle" value={lf.aisle} onChangeText={(v) => setLf({ ...lf, aisle: v })} placeholder="12" />
            <Input label="Rack" value={lf.rack} onChangeText={(v) => setLf({ ...lf, rack: v })} placeholder="3" />
            <Input label="Level" value={lf.level} onChangeText={(v) => setLf({ ...lf, level: v })} placeholder="2" />
            <Input label="Bin" value={lf.bin} onChangeText={(v) => setLf({ ...lf, bin: v })} placeholder="B" autoCapitalize="characters" />
            <Button label="Create location" onPress={() => void submitLocation()} loading={createLocation.isPending} fullWidth size="lg" icon={<CheckCircle size={16} color={C.white} />} />
            <Button label="Cancel" onPress={() => setShowLocForm(false)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  segmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  segment: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  segmentText: { fontSize: 12, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.accent },
  scroll: { padding: 16, gap: 10 },
  card: { padding: 14 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  qty: { fontSize: 18, fontWeight: '800' as const, color: C.green },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 12 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
});
