import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Archive, CheckCircle2, ClipboardCheck, MapPin, Minus, Move, PackageOpen, Plus, Scan, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Tab = 'board' | 'receive' | 'transfer' | 'count' | 'locations';

interface LocationRow { id: string; zone: string; aisle: string; rack: string; level: string; bin: string; label: string }
interface StockRow {
  id: string; variant_id: string; location_id: string; on_hand: number; reserved: number;
  product_variants?: { sku?: string; name?: string } | null;
  warehouse_locations?: { label?: string; zone?: string; bin?: string } | null;
}
interface ReceiptRow { id: string; reference?: string | null; status: string; supplier?: string | null; created_at: string }
interface CycleCountRow { id: string; status: string; variance?: number | null; created_at: string; location_id?: string; variant_id?: string; counted_qty?: number; system_qty?: number }

export default function WmsOperationsScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>('board');

  const locations = trpc.wms.listLocations.useQuery();
  const stock = trpc.wms.listStockLevels.useQuery();
  const receipts = trpc.wms.listReceipts.useQuery();
  const counts = trpc.wms.listCycleCounts.useQuery();

  const createLocation = trpc.wms.createLocation.useMutation({ onSuccess: async () => { await utils.wms.listLocations.invalidate(); } });
  const receive = trpc.wms.receive.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wms.listStockLevels.invalidate(), utils.wms.listReceipts.invalidate()]);
    },
  });
  const adjust = trpc.wms.adjust.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wms.listStockLevels.invalidate(), utils.wms.listCycleCounts.invalidate()]);
    },
  });

  const [locForm, setLocForm] = useState({ zone: '', aisle: '', rack: '', level: '', bin: '', label: '' });
  const [showLoc, setShowLoc] = useState(false);

  const [recvForm, setRecvForm] = useState({ step: 1, receiptId: '', variantId: '', locationId: '', quantity: '', lot: '', reference: '' });
  const [xferForm, setXferForm] = useState({ step: 1, variantId: '', fromLocation: '', toLocation: '', quantity: '' });
  const [countForm, setCountForm] = useState({ step: 1, variantId: '', locationId: '', countedQty: '', systemQty: '', reason: '' });
  const [stockSearch, setStockSearch] = useState('');

  const locList = useMemo<LocationRow[]>(() => (locations.data ?? []) as LocationRow[], [locations.data]);
  const stockList = useMemo<StockRow[]>(() => (stock.data ?? []) as StockRow[], [stock.data]);
  const filteredStock = useMemo(() => {
    const s = stockSearch.trim().toLowerCase();
    if (!s) return stockList;
    return stockList.filter((r) => JSON.stringify(r).toLowerCase().includes(s));
  }, [stockList, stockSearch]);

  const manualAdjust = (variantId: string, locationId: string, delta: number) => {
    Alert.alert(
      delta > 0 ? 'Adjust +1?' : 'Adjust −1?',
      'This writes a stock movement to the ledger. Use cycle count for multi-unit variances.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: delta < 0 ? 'destructive' : 'default',
          onPress: () => {
            if (Platform.OS !== 'web') { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
            void adjust.mutateAsync({ variantId, locationId, delta, reason: 'manual_adjust' }).catch((err) => {
              Alert.alert('Adjust failed', err instanceof Error ? err.message : 'Unknown');
            });
          },
        },
      ],
    );
  };
  const receiptList = useMemo<ReceiptRow[]>(() => (receipts.data ?? []) as ReceiptRow[], [receipts.data]);
  const countList = useMemo<CycleCountRow[]>(() => (counts.data ?? []) as CycleCountRow[], [counts.data]);

  const totals = useMemo(() => {
    const onHand = stockList.reduce((s, r) => s + Number(r.on_hand ?? 0), 0);
    const reserved = stockList.reduce((s, r) => s + Number(r.reserved ?? 0), 0);
    const open = receiptList.filter((r) => r.status !== 'Completed').length;
    const variance = countList.filter((c) => Math.abs(Number(c.variance ?? 0)) > 0).length;
    return { onHand, reserved, open, variance };
  }, [stockList, receiptList, countList]);

  const submitLocation = async () => {
    if (!locForm.zone.trim() && !locForm.label.trim()) { Alert.alert('Zone or label required'); return; }
    try {
      await createLocation.mutateAsync(locForm);
      setLocForm({ zone: '', aisle: '', rack: '', level: '', bin: '', label: '' });
      setShowLoc(false);
    } catch (err) { Alert.alert('Unable to create', err instanceof Error ? err.message : 'Unknown'); }
  };

  const submitReceive = async () => {
    if (!recvForm.variantId.trim() || !recvForm.locationId.trim() || !recvForm.quantity.trim()) {
      Alert.alert('Missing info', 'Variant, location, and quantity are required.');
      return;
    }
    try {
      await receive.mutateAsync({
        receiptId: recvForm.receiptId.trim() || undefined,
        variantId: recvForm.variantId.trim(),
        locationId: recvForm.locationId.trim(),
        quantity: Number(recvForm.quantity) || 0,
        lotCode: recvForm.lot.trim() || undefined,
        reference: recvForm.reference.trim() || undefined,
      });
      Alert.alert('Received', 'Stock ledger updated.');
      setRecvForm({ step: 1, receiptId: '', variantId: '', locationId: '', quantity: '', lot: '', reference: '' });
    } catch (err) { Alert.alert('Receive failed', err instanceof Error ? err.message : 'Unknown'); }
  };

  const submitTransfer = async () => {
    const qty = Number(xferForm.quantity) || 0;
    if (!xferForm.variantId.trim() || !xferForm.fromLocation.trim() || !xferForm.toLocation.trim() || qty <= 0) {
      Alert.alert('Missing info', 'Variant, from, to and quantity are required.');
      return;
    }
    try {
      await adjust.mutateAsync({ variantId: xferForm.variantId.trim(), locationId: xferForm.fromLocation.trim(), delta: -qty, reason: `transfer_out:${xferForm.toLocation.trim()}` });
      await adjust.mutateAsync({ variantId: xferForm.variantId.trim(), locationId: xferForm.toLocation.trim(), delta: qty, reason: `transfer_in:${xferForm.fromLocation.trim()}` });
      Alert.alert('Transferred', `Moved ${qty} units.`);
      setXferForm({ step: 1, variantId: '', fromLocation: '', toLocation: '', quantity: '' });
    } catch (err) { Alert.alert('Transfer failed', err instanceof Error ? err.message : 'Unknown'); }
  };

  const submitCount = async () => {
    const counted = Number(countForm.countedQty);
    const system = Number(countForm.systemQty);
    if (!countForm.variantId.trim() || !countForm.locationId.trim() || Number.isNaN(counted)) {
      Alert.alert('Missing info'); return;
    }
    const delta = counted - system;
    try {
      if (delta !== 0) {
        await adjust.mutateAsync({
          variantId: countForm.variantId.trim(),
          locationId: countForm.locationId.trim(),
          delta,
          reason: `cycle_count:${countForm.reason.trim() || 'variance'}`,
        });
      }
      Alert.alert('Count logged', delta === 0 ? 'Inventory matches.' : `Adjusted by ${delta > 0 ? '+' : ''}${delta}.`);
      setCountForm({ step: 1, variantId: '', locationId: '', countedQty: '', systemQty: '', reason: '' });
    } catch (err) { Alert.alert('Unable to log count', err instanceof Error ? err.message : 'Unknown'); }
  };

  const renderReceiveWizard = () => (
    <View style={styles.wizard}>
      <View style={styles.stepRow}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.step, recvForm.step >= n && styles.stepActive]}>
            <Text style={[styles.stepNum, recvForm.step >= n && { color: C.white }]}>{n}</Text>
          </View>
        ))}
      </View>
      {recvForm.step === 1 ? (
        <>
          <Text style={styles.wizardTitle}>Step 1 · Choose receipt (optional)</Text>
          <Text style={styles.wizardSub}>Scan or pick an ASN to auto-fill.</Text>
          <Input label="Receipt ID (optional)" value={recvForm.receiptId} onChangeText={(v) => setRecvForm({ ...recvForm, receiptId: v })} placeholder="PO-1024" />
          <Input label="Reference / Supplier" value={recvForm.reference} onChangeText={(v) => setRecvForm({ ...recvForm, reference: v })} placeholder="ASN or supplier code" />
          {receiptList.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hlist}>
              {receiptList.slice(0, 10).map((r) => (
                <TouchableOpacity key={r.id} onPress={() => setRecvForm({ ...recvForm, receiptId: r.id, reference: r.reference ?? '' })} style={styles.quickPick}>
                  <Text style={styles.quickPickTitle}>{r.reference || r.id.slice(0, 8)}</Text>
                  <Text style={styles.quickPickMeta}>{r.supplier ?? '—'}</Text>
                  <StatusBadge status={r.status} size="sm" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <Button label="Next" onPress={() => setRecvForm({ ...recvForm, step: 2 })} fullWidth />
        </>
      ) : recvForm.step === 2 ? (
        <>
          <Text style={styles.wizardTitle}>Step 2 · Scan SKU & lot</Text>
          <Input label="Variant / SKU ID" value={recvForm.variantId} onChangeText={(v) => setRecvForm({ ...recvForm, variantId: v })} placeholder="variant_…" />
          <Input label="Lot / batch code" value={recvForm.lot} onChangeText={(v) => setRecvForm({ ...recvForm, lot: v })} placeholder="LOT-2026-04" autoCapitalize="characters" />
          <Input label="Quantity" value={recvForm.quantity} onChangeText={(v) => setRecvForm({ ...recvForm, quantity: v })} keyboardType="numeric" placeholder="48" />
          <View style={styles.navRow}>
            <Button label="Back" onPress={() => setRecvForm({ ...recvForm, step: 1 })} variant="secondary" />
            <Button label="Next" onPress={() => setRecvForm({ ...recvForm, step: 3 })} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.wizardTitle}>Step 3 · Putaway location</Text>
          <Input label="Location ID" value={recvForm.locationId} onChangeText={(v) => setRecvForm({ ...recvForm, locationId: v })} placeholder="location_…" />
          {locList.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hlist}>
              {locList.slice(0, 12).map((l) => (
                <TouchableOpacity key={l.id} onPress={() => setRecvForm({ ...recvForm, locationId: l.id })} style={[styles.quickPick, recvForm.locationId === l.id && styles.quickPickActive]}>
                  <MapPin size={13} color={recvForm.locationId === l.id ? C.accent : C.textMuted} />
                  <Text style={styles.quickPickTitle}>{l.label || `${l.zone}-${l.aisle}-${l.bin}`}</Text>
                  <Text style={styles.quickPickMeta}>Zone {l.zone || '—'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.navRow}>
            <Button label="Back" onPress={() => setRecvForm({ ...recvForm, step: 2 })} variant="secondary" />
            <Button label="Receive & putaway" onPress={() => void submitReceive()} loading={receive.isPending} icon={<CheckCircle2 size={15} color={C.white} />} />
          </View>
        </>
      )}
    </View>
  );

  const renderTransferWizard = () => (
    <View style={styles.wizard}>
      <View style={styles.stepRow}>
        {[1, 2].map((n) => (
          <View key={n} style={[styles.step, xferForm.step >= n && styles.stepActive]}>
            <Text style={[styles.stepNum, xferForm.step >= n && { color: C.white }]}>{n}</Text>
          </View>
        ))}
      </View>
      {xferForm.step === 1 ? (
        <>
          <Text style={styles.wizardTitle}>Step 1 · What & from where?</Text>
          <Input label="Variant / SKU ID" value={xferForm.variantId} onChangeText={(v) => setXferForm({ ...xferForm, variantId: v })} placeholder="variant_…" />
          <Input label="From location" value={xferForm.fromLocation} onChangeText={(v) => setXferForm({ ...xferForm, fromLocation: v })} placeholder="location_…" />
          <Input label="Quantity" value={xferForm.quantity} onChangeText={(v) => setXferForm({ ...xferForm, quantity: v })} keyboardType="numeric" />
          <Button label="Next" onPress={() => setXferForm({ ...xferForm, step: 2 })} fullWidth />
        </>
      ) : (
        <>
          <Text style={styles.wizardTitle}>Step 2 · To where?</Text>
          <Input label="Destination location" value={xferForm.toLocation} onChangeText={(v) => setXferForm({ ...xferForm, toLocation: v })} placeholder="location_…" />
          {locList.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hlist}>
              {locList.slice(0, 12).map((l) => (
                <TouchableOpacity key={l.id} onPress={() => setXferForm({ ...xferForm, toLocation: l.id })} style={[styles.quickPick, xferForm.toLocation === l.id && styles.quickPickActive]}>
                  <MapPin size={13} color={xferForm.toLocation === l.id ? C.accent : C.textMuted} />
                  <Text style={styles.quickPickTitle}>{l.label || `${l.zone}-${l.aisle}-${l.bin}`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.navRow}>
            <Button label="Back" onPress={() => setXferForm({ ...xferForm, step: 1 })} variant="secondary" />
            <Button label="Transfer" onPress={() => void submitTransfer()} loading={adjust.isPending} icon={<Move size={15} color={C.white} />} />
          </View>
        </>
      )}
    </View>
  );

  const renderCountWizard = () => {
    const diff = Number(countForm.countedQty) - Number(countForm.systemQty);
    return (
      <View style={styles.wizard}>
        <View style={styles.stepRow}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={[styles.step, countForm.step >= n && styles.stepActive]}>
              <Text style={[styles.stepNum, countForm.step >= n && { color: C.white }]}>{n}</Text>
            </View>
          ))}
        </View>
        {countForm.step === 1 ? (
          <>
            <Text style={styles.wizardTitle}>Step 1 · Pick location to count</Text>
            <Input label="Location ID" value={countForm.locationId} onChangeText={(v) => setCountForm({ ...countForm, locationId: v })} placeholder="location_…" />
            <Input label="Variant / SKU" value={countForm.variantId} onChangeText={(v) => setCountForm({ ...countForm, variantId: v })} placeholder="variant_…" />
            <Button label="Next" onPress={() => setCountForm({ ...countForm, step: 2 })} fullWidth />
          </>
        ) : countForm.step === 2 ? (
          <>
            <Text style={styles.wizardTitle}>Step 2 · Physical count</Text>
            <Input label="System quantity" value={countForm.systemQty} onChangeText={(v) => setCountForm({ ...countForm, systemQty: v })} keyboardType="numeric" />
            <Input label="Counted quantity" value={countForm.countedQty} onChangeText={(v) => setCountForm({ ...countForm, countedQty: v })} keyboardType="numeric" />
            {countForm.countedQty && countForm.systemQty ? (
              <View style={[styles.varianceBox, { backgroundColor: diff === 0 ? C.greenDim : C.red + '15', borderColor: diff === 0 ? C.green : C.red }]}>
                <Text style={[styles.varianceLabel, { color: diff === 0 ? C.green : C.red }]}>{diff === 0 ? 'Match' : `Variance ${diff > 0 ? '+' : ''}${diff}`}</Text>
              </View>
            ) : null}
            <View style={styles.navRow}>
              <Button label="Back" onPress={() => setCountForm({ ...countForm, step: 1 })} variant="secondary" />
              <Button label="Next" onPress={() => setCountForm({ ...countForm, step: 3 })} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.wizardTitle}>Step 3 · Reason & submit</Text>
            <Input label="Reason (required for variance)" value={countForm.reason} onChangeText={(v) => setCountForm({ ...countForm, reason: v })} placeholder="Damaged / miscount / shrink…" multiline numberOfLines={3} />
            <View style={styles.navRow}>
              <Button label="Back" onPress={() => setCountForm({ ...countForm, step: 2 })} variant="secondary" />
              <Button label="Submit count" onPress={() => void submitCount()} loading={adjust.isPending} icon={<ClipboardCheck size={15} color={C.white} />} />
            </View>
          </>
        )}
      </View>
    );
  };

  const activeQuery = tab === 'board' ? stock : tab === 'locations' ? locations : tab === 'receive' ? receipts : tab === 'count' ? counts : stock;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Warehouse Ops</Text>
        <Text style={styles.subtitle}>Receiving · Putaway · Transfer · Cycle count</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}><Text style={styles.statValue}>{totals.onHand}</Text><Text style={styles.statLabel}>On hand</Text></View>
          <View style={styles.stat}><Text style={styles.statValue}>{totals.reserved}</Text><Text style={styles.statLabel}>Reserved</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: totals.open > 0 ? C.accent : C.text }]}>{totals.open}</Text><Text style={styles.statLabel}>Open receipts</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: totals.variance > 0 ? C.red : C.green }]}>{totals.variance}</Text><Text style={styles.statLabel}>Variances</Text></View>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {([
          ['board', 'Stock board', Archive],
          ['receive', 'Receive', PackageOpen],
          ['transfer', 'Transfer', Move],
          ['count', 'Cycle count', ClipboardCheck],
          ['locations', 'Locations', MapPin],
        ] as const).map(([k, label, Icon]) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
            <Icon size={13} color={tab === k ? C.accent : C.textMuted} />
            <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        refreshControl={<RefreshControl refreshing={activeQuery.isFetching} onRefresh={() => void activeQuery.refetch()} tintColor={C.accent} />}
      >
        {activeQuery.isLoading ? <ScreenFeedback state="loading" title="Loading" /> : null}

        {tab === 'board' ? (
          <>
          <View style={styles.stockSearch}>
            <Scan size={13} color={C.textMuted} />
            <TextInput value={stockSearch} onChangeText={setStockSearch} placeholder="Search SKU, location, lot…" placeholderTextColor={C.textMuted} style={styles.stockSearchInput} />
            {stockSearch ? <TouchableOpacity onPress={() => setStockSearch('')}><X size={13} color={C.textMuted} /></TouchableOpacity> : null}
          </View>
          {filteredStock.length === 0 ? (
            <EmptyState icon={Archive} title={stockSearch ? 'No matches' : 'No stock yet'} description={stockSearch ? 'Try another SKU, location or lot.' : 'Receive inventory to build live stock levels.'} />
          ) : filteredStock.map((s) => (
            <View key={s.id} style={styles.stockCard}>
              <View style={styles.stockTop}>
                <Archive size={16} color={C.blue} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.stockTitle}>{s.product_variants?.sku ?? '—'}</Text>
                  <Text style={styles.stockMeta}>{s.product_variants?.name ?? ''} · {s.warehouse_locations?.label ?? `${s.warehouse_locations?.zone ?? ''} ${s.warehouse_locations?.bin ?? ''}`}</Text>
                </View>
                <Text style={styles.stockQty}>{Number(s.on_hand) - Number(s.reserved)}</Text>
              </View>
              <View style={styles.stockBar}>
                <Text style={styles.stockBarLabel}>On-hand {s.on_hand} · Reserved {s.reserved}</Text>
                <View style={styles.adjustRow}>
                  <TouchableOpacity onPress={() => manualAdjust(s.variant_id, s.location_id, 1)} style={styles.adjBtn}><Plus size={13} color={C.green} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => manualAdjust(s.variant_id, s.location_id, -1)} style={styles.adjBtn}><Minus size={13} color={C.red} /></TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          </>
        ) : null}

        {tab === 'receive' ? (
          <>
            {renderReceiveWizard()}
            <Text style={styles.sectionTitle}>Recent receipts</Text>
            {receiptList.length === 0 ? <EmptyState icon={PackageOpen} title="No receipts" description="ASNs arrive here before receiving." /> : receiptList.slice(0, 20).map((r) => (
              <View key={r.id} style={styles.listRow}>
                <PackageOpen size={14} color={C.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{r.reference || r.id.slice(0, 8)}</Text>
                  <Text style={styles.listMeta}>{r.supplier ?? '—'} · {new Date(r.created_at).toLocaleDateString()}</Text>
                </View>
                <StatusBadge status={r.status} size="sm" />
              </View>
            ))}
          </>
        ) : null}

        {tab === 'transfer' ? renderTransferWizard() : null}

        {tab === 'count' ? (
          <>
            {renderCountWizard()}
            <Text style={styles.sectionTitle}>Recent counts</Text>
            {countList.length === 0 ? <EmptyState icon={ClipboardCheck} title="No cycle counts yet" description="Run recurring counts to catch shrink and miscounts." /> : countList.slice(0, 20).map((c) => (
              <View key={c.id} style={styles.listRow}>
                <ClipboardCheck size={14} color={Math.abs(Number(c.variance ?? 0)) > 0 ? C.red : C.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>Count {c.id.slice(0, 8)}</Text>
                  <Text style={styles.listMeta}>Variance {c.variance ?? 0} · {new Date(c.created_at).toLocaleDateString()}</Text>
                </View>
                <StatusBadge status={c.status} size="sm" />
              </View>
            ))}
          </>
        ) : null}

        {tab === 'locations' ? (
          <>
            <View style={styles.navRow}>
              <Text style={styles.sectionTitle}>Bin locations ({locList.length})</Text>
              <Button label="+ New bin" size="sm" onPress={() => setShowLoc(true)} />
            </View>
            {locList.length === 0 ? (
              <EmptyState icon={MapPin} title="No bins defined" description="Create bin locations to enable putaway, pick, and counts." />
            ) : locList.map((l) => (
              <View key={l.id} style={styles.listRow}>
                <MapPin size={14} color={C.purple} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{l.label || `${l.zone}-${l.aisle}-${l.rack}-${l.bin}`}</Text>
                  <Text style={styles.listMeta}>Zone {l.zone || '—'} · Aisle {l.aisle || '—'} · Bin {l.bin || '—'}</Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={showLoc} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowLoc(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New location</Text>
            <TouchableOpacity onPress={() => setShowLoc(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Input label="Label" value={locForm.label} onChangeText={(v) => setLocForm({ ...locForm, label: v })} placeholder="A-12-3-B" autoCapitalize="characters" />
            <View style={styles.navRow}>
              <Input label="Zone" value={locForm.zone} onChangeText={(v) => setLocForm({ ...locForm, zone: v })} placeholder="A" autoCapitalize="characters" containerStyle={{ flex: 1 }} />
              <Input label="Aisle" value={locForm.aisle} onChangeText={(v) => setLocForm({ ...locForm, aisle: v })} placeholder="12" containerStyle={{ flex: 1 }} />
            </View>
            <View style={styles.navRow}>
              <Input label="Rack" value={locForm.rack} onChangeText={(v) => setLocForm({ ...locForm, rack: v })} placeholder="3" containerStyle={{ flex: 1 }} />
              <Input label="Level" value={locForm.level} onChangeText={(v) => setLocForm({ ...locForm, level: v })} placeholder="2" containerStyle={{ flex: 1 }} />
              <Input label="Bin" value={locForm.bin} onChangeText={(v) => setLocForm({ ...locForm, bin: v })} placeholder="B" autoCapitalize="characters" containerStyle={{ flex: 1 }} />
            </View>
            <Button label="Create location" onPress={() => void submitLocation()} loading={createLocation.isPending} fullWidth size="lg" icon={<Scan size={15} color={C.white} />} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  statValue: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  tabRow: { gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const },
  tabTextActive: { color: C.accent },
  body: { padding: 16, gap: 10 },
  wizard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  stepRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  step: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepActive: { backgroundColor: C.accent, borderColor: C.accent },
  stepNum: { fontSize: 12, fontWeight: '800' as const, color: C.textMuted },
  wizardTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  wizardSub: { fontSize: 12, color: C.textSecondary, marginTop: -4 },
  hlist: { gap: 8, paddingVertical: 4 },
  quickPick: { minWidth: 130, backgroundColor: C.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10, gap: 4 },
  quickPickActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  quickPickTitle: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  quickPickMeta: { fontSize: 10, color: C.textMuted },
  navRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  varianceBox: { borderRadius: 10, borderWidth: 1, padding: 12 },
  varianceLabel: { fontSize: 14, fontWeight: '800' as const, textAlign: 'center' as const },
  stockCard: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  stockTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stockTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  stockMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  stockQty: { fontSize: 20, fontWeight: '800' as const, color: C.green },
  stockBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  stockBarLabel: { fontSize: 11, color: C.textMuted },
  adjustRow: { flexDirection: 'row', gap: 6 },
  adjBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stockSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 8 },
  stockSearchInput: { flex: 1, color: C.text, fontSize: 13, padding: 0 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  listTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  listMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
});
