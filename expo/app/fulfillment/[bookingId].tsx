import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Package, ClipboardList, Plus, CheckCircle, Truck, Box, Archive } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Tab = 'inventory' | 'orders';

interface InventorySelection {
  inventoryItemId: string;
  quantity: number;
}

export default function FulfillmentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);

  const utils = trpc.useUtils();
  const query = trpc.fulfillment.getBooking.useQuery({ bookingId: bookingId ?? '' }, { enabled: Boolean(bookingId) });

  const refetchAll = async () => {
    await utils.fulfillment.getBooking.invalidate({ bookingId: bookingId ?? '' });
  };

  const addInventory = trpc.fulfillment.addInventory.useMutation({ onSuccess: refetchAll });
  const createOrder = trpc.fulfillment.createOrder.useMutation({ onSuccess: refetchAll });
  const pickOrder = trpc.fulfillment.pickOrder.useMutation({ onSuccess: refetchAll });
  const packOrder = trpc.fulfillment.packOrder.useMutation({ onSuccess: refetchAll });
  const shipOrder = trpc.fulfillment.shipOrder.useMutation({ onSuccess: refetchAll });
  const completeOrder = trpc.fulfillment.completeOrder.useMutation({ onSuccess: refetchAll });

  const [tab, setTab] = useState<Tab>('inventory');

  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');

  const [orderRef, setOrderRef] = useState('');
  const [orderShipTo, setOrderShipTo] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});

  const data = query.data;
  const role = data?.role ?? 'customer';
  const isProvider = role === 'provider';

  const orderItemsByOrder = useMemo(() => {
    const map = new Map<string, typeof data extends { orderItems: infer T } ? T : never>();
    if (!data) return map;
    for (const item of data.orderItems) {
      const arr = (map.get(item.order_id) as typeof data.orderItems | undefined) ?? [];
      arr.push(item);
      map.set(item.order_id, arr as never);
    }
    return map;
  }, [data]);

  const shipmentByOrder = useMemo(() => {
    const map = new Map<string, typeof data extends { shipments: (infer T)[] } ? T : never>();
    if (!data) return map;
    for (const s of data.shipments) {
      map.set(s.order_id, s as never);
    }
    return map;
  }, [data]);

  const handleAddInventory = async () => {
    const qty = Number(quantity);
    if (!sku.trim() || !qty || qty <= 0) {
      Alert.alert('Missing info', 'Please provide SKU and a positive quantity.');
      return;
    }
    try {
      await addInventory.mutateAsync({
        bookingId: bookingId!,
        sku: sku.trim(),
        description: description.trim(),
        quantity: qty,
      });
      setSku('');
      setDescription('');
      setQuantity('');
    } catch (error) {
      Alert.alert('Unable to add inventory', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleCreateOrder = async () => {
    if (!orderRef.trim()) {
      Alert.alert('Missing reference', 'Please provide an order reference.');
      return;
    }
    const items: InventorySelection[] = Object.entries(selection)
      .map(([inventoryItemId, raw]) => ({ inventoryItemId, quantity: Number(raw) }))
      .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0);

    if (items.length === 0) {
      Alert.alert('No items selected', 'Enter quantities for at least one inventory item.');
      return;
    }

    try {
      await createOrder.mutateAsync({
        bookingId: bookingId!,
        reference: orderRef.trim(),
        shipTo: orderShipTo.trim(),
        notes: orderNotes.trim(),
        items,
      });
      setOrderRef('');
      setOrderShipTo('');
      setOrderNotes('');
      setSelection({});
      setTab('orders');
    } catch (error) {
      Alert.alert('Unable to create order', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  if (!bookingId) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.errorText}>Missing booking id</Text>
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ScreenFeedback state="loading" title="Loading fulfillment" />
      </View>
    );
  }

  if (query.isError || !data) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ScreenFeedback
          state="error"
          title="Unable to load fulfillment"
          description={query.error?.message}
          onRetry={() => void query.refetch()}
        />
      </View>
    );
  }

  const booking = data.booking;
  const statusText = typeof booking.data?.status === 'string' ? (booking.data.status as string) : booking.status;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="fulfillment-back">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Fulfillment</Text>
          <Text style={styles.headerSub}>Booking #{booking.id.slice(0, 8).toUpperCase()}</Text>
        </View>
        <StatusBadge status={statusText} size="md" />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity onPress={() => setTab('inventory')} style={[styles.tab, tab === 'inventory' && styles.tabActive]}>
          <Package size={15} color={tab === 'inventory' ? C.accent : C.textMuted} />
          <Text style={[styles.tabText, tab === 'inventory' && styles.tabTextActive]}>Inventory ({data.inventory.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('orders')} style={[styles.tab, tab === 'orders' && styles.tabActive]}>
          <ClipboardList size={15} color={tab === 'orders' ? C.accent : C.textMuted} />
          <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>Orders ({data.orders.length})</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'inventory' ? (
          <>
            {!isProvider ? (
              <Card style={styles.formCard}>
                <Text style={styles.cardTitle}>Add inventory</Text>
                <Text style={styles.cardSub}>Register items stored under this booking.</Text>
                <Input label="SKU" value={sku} onChangeText={setSku} placeholder="SKU-001" autoCapitalize="characters" testID="inv-sku" />
                <Input label="Description (optional)" value={description} onChangeText={setDescription} placeholder="Blue widgets, carton of 24" testID="inv-desc" />
                <Input label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" placeholder="100" testID="inv-qty" />
                <Button
                  label="Add Item"
                  onPress={handleAddInventory}
                  loading={addInventory.isPending}
                  fullWidth
                  icon={<Plus size={15} color={C.white} />}
                />
              </Card>
            ) : (
              <Card style={styles.infoCard}>
                <Text style={styles.infoText}>
                  Inventory is managed by the customer. Orders they create will appear in the Orders tab.
                </Text>
              </Card>
            )}

            <Text style={styles.sectionTitle}>Inventory on hand</Text>
            {data.inventory.length === 0 ? (
              <EmptyState icon={Package} title="No inventory yet" description="Add items to begin fulfilling orders from this booking." />
            ) : (
              data.inventory.map((inv) => (
                <Card key={inv.id} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}>
                      <Archive size={16} color={C.blue} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemSku}>{inv.sku}</Text>
                      {inv.description ? <Text style={styles.itemDesc}>{inv.description}</Text> : null}
                    </View>
                    <View style={styles.qtyBox}>
                      <Text style={styles.qtyValue}>{inv.quantity}</Text>
                      <Text style={styles.qtyLabel}>units</Text>
                    </View>
                  </View>
                </Card>
              ))
            )}
          </>
        ) : (
          <>
            {!isProvider && data.inventory.length > 0 ? (
              <Card style={styles.formCard}>
                <Text style={styles.cardTitle}>Create outbound order</Text>
                <Text style={styles.cardSub}>Select quantities to ship from inventory.</Text>
                <Input label="Reference" value={orderRef} onChangeText={setOrderRef} placeholder="PO-1024" autoCapitalize="characters" testID="order-ref" />
                <Input label="Ship to" value={orderShipTo} onChangeText={setOrderShipTo} placeholder="Receiver address" testID="order-shipto" />
                <Input label="Notes (optional)" value={orderNotes} onChangeText={setOrderNotes} placeholder="Fragile" multiline numberOfLines={2} testID="order-notes" />

                <Text style={styles.inlineLabel}>Items</Text>
                {data.inventory.map((inv) => (
                  <View key={inv.id} style={styles.selectRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemSku}>{inv.sku}</Text>
                      <Text style={styles.itemDesc}>Available: {inv.quantity}</Text>
                    </View>
                    <View style={styles.selectInputWrap}>
                      <Input
                        value={selection[inv.id] ?? ''}
                        onChangeText={(v) => setSelection((prev) => ({ ...prev, [inv.id]: v }))}
                        keyboardType="numeric"
                        placeholder="0"
                        testID={`select-${inv.id}`}
                      />
                    </View>
                  </View>
                ))}

                <Button
                  label="Create Order"
                  onPress={handleCreateOrder}
                  loading={createOrder.isPending}
                  fullWidth
                  icon={<Plus size={15} color={C.white} />}
                />
              </Card>
            ) : null}

            {!isProvider && data.inventory.length === 0 ? (
              <Card style={styles.infoCard}>
                <Text style={styles.infoText}>Add inventory first, then create an order from the Inventory tab.</Text>
              </Card>
            ) : null}

            <Text style={styles.sectionTitle}>Orders</Text>
            {data.orders.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No orders yet" description={isProvider ? 'Customer has not created any orders.' : 'Create your first outbound order above.'} />
            ) : (
              data.orders.map((order) => {
                const items = (orderItemsByOrder.get(order.id) as typeof data.orderItems | undefined) ?? [];
                const shipment = shipmentByOrder.get(order.id) as typeof data.shipments[number] | undefined;
                return (
                  <Card key={order.id} style={styles.orderCard}>
                    <View style={styles.orderTop}>
                      <View style={[styles.iconWrap, { backgroundColor: C.accentDim }]}>
                        <Box size={16} color={C.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.orderRef}>{order.reference}</Text>
                        <Text style={styles.orderMeta}>{items.length} line{items.length === 1 ? '' : 's'} · {new Date(order.created_at).toLocaleString()}</Text>
                      </View>
                      <StatusBadge status={order.status} />
                    </View>

                    {order.ship_to ? <Text style={styles.orderShip}>Ship to: {order.ship_to}</Text> : null}
                    {order.notes ? <Text style={styles.orderNotes}>{order.notes}</Text> : null}

                    <View style={styles.itemList}>
                      {items.map((it) => (
                        <View key={it.id} style={styles.itemLine}>
                          <Text style={styles.itemSkuSmall}>{it.sku}</Text>
                          <Text style={styles.itemQty}>x {it.quantity}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={styles.timeline}>
                      <TimelineDot active={Boolean(order.picked_at)} label="Picked" timestamp={order.picked_at} />
                      <TimelineDot active={Boolean(order.packed_at)} label="Packed" timestamp={order.packed_at} />
                      <TimelineDot active={Boolean(order.shipped_at)} label="Shipped" timestamp={order.shipped_at} />
                      <TimelineDot active={Boolean(order.completed_at)} label="Completed" timestamp={order.completed_at} />
                    </View>

                    {shipment ? (
                      <View style={styles.shipBox}>
                        <Truck size={14} color={C.blue} />
                        <Text style={styles.shipText}>Shipment {shipment.tracking_code}</Text>
                      </View>
                    ) : null}

                    {isProvider ? (
                      <View style={styles.actionsRow}>
                        {order.status === 'Pending' ? (
                          <Button label="Mark Picked" onPress={() => void pickOrder.mutateAsync({ orderId: order.id }).catch((e: unknown) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed'))} loading={pickOrder.isPending && pickOrder.variables?.orderId === order.id} size="sm" icon={<CheckCircle size={14} color={C.white} />} />
                        ) : null}
                        {order.status === 'Picked' ? (
                          <Button label="Mark Packed" onPress={() => void packOrder.mutateAsync({ orderId: order.id }).catch((e: unknown) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed'))} loading={packOrder.isPending && packOrder.variables?.orderId === order.id} size="sm" icon={<Box size={14} color={C.white} />} />
                        ) : null}
                        {order.status === 'Packed' ? (
                          <Button label="Ship" onPress={() => void shipOrder.mutateAsync({ orderId: order.id }).catch((e: unknown) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed'))} loading={shipOrder.isPending && shipOrder.variables?.orderId === order.id} size="sm" icon={<Truck size={14} color={C.white} />} />
                        ) : null}
                        {order.status === 'Shipped' ? (
                          <Button label="Mark Completed" onPress={() => void completeOrder.mutateAsync({ orderId: order.id }).catch((e: unknown) => Alert.alert('Error', e instanceof Error ? e.message : 'Failed'))} loading={completeOrder.isPending && completeOrder.variables?.orderId === order.id} size="sm" icon={<CheckCircle size={14} color={C.white} />} />
                        ) : null}
                        {order.status === 'Completed' ? (
                          <View style={styles.completeBanner}>
                            <CheckCircle size={14} color={C.green} />
                            <Text style={styles.completeText}>Order completed</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                );
              })
            )}
          </>
        )}

        {query.isFetching ? (
          <View style={styles.refreshRow}>
            <ActivityIndicator size="small" color={C.accent} />
            <Text style={styles.refreshText}>Syncing…</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TimelineDot({ active, label, timestamp }: { active: boolean; label: string; timestamp: string | null }) {
  return (
    <View style={styles.timelineStep}>
      <View style={[styles.timelineDot, active && styles.timelineDotActive]} />
      <Text style={[styles.timelineLabel, active && styles.timelineLabelActive]}>{label}</Text>
      {timestamp ? <Text style={styles.timelineTs}>{new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  errorText: { color: C.red, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.accent },
  tabText: { fontSize: 13, color: C.textMuted, fontWeight: '600' as const },
  tabTextActive: { color: C.accent },
  scroll: { padding: 16, gap: 12 },
  formCard: { gap: 12, padding: 16 },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  cardSub: { fontSize: 12, color: C.textSecondary, marginTop: -6 },
  infoCard: { padding: 14 },
  infoText: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 8, marginBottom: 4 },
  itemCard: { padding: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemSku: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  itemSkuSmall: { fontSize: 12, color: C.text, fontWeight: '600' as const },
  itemDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  qtyBox: { alignItems: 'flex-end' },
  qtyValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  qtyLabel: { fontSize: 10, color: C.textMuted },
  inlineLabel: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary, marginTop: 4 },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  selectInputWrap: { width: 90 },
  orderCard: { padding: 14, gap: 10 },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderRef: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  orderMeta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  orderShip: { fontSize: 12, color: C.textSecondary },
  orderNotes: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const },
  itemList: { gap: 4, paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border },
  itemLine: { flexDirection: 'row', justifyContent: 'space-between' },
  itemQty: { fontSize: 12, color: C.textSecondary },
  timeline: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  timelineStep: { alignItems: 'center', gap: 4, flex: 1 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.border },
  timelineDotActive: { backgroundColor: C.green },
  timelineLabel: { fontSize: 10, color: C.textMuted, fontWeight: '600' as const },
  timelineLabelActive: { color: C.text },
  timelineTs: { fontSize: 9, color: C.textMuted },
  shipBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blueDim, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  shipText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  actionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  completeBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.greenDim, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  completeText: { fontSize: 12, color: C.green, fontWeight: '600' as const },
  refreshRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  refreshText: { fontSize: 12, color: C.textMuted },
});
