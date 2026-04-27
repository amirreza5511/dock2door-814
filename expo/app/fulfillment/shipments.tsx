import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Truck, ArrowLeft, Package, MapPin, Clock, ExternalLink, Tag, RefreshCcw, XCircle, ClipboardList } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface ShipmentRow {
  id: string;
  order_id: string | null;
  carrier_code: string | null;
  service_level: string | null;
  tracking_code: string | null;
  label_url: string | null;
  status: string;
  rate_amount?: string | number | null;
  currency?: string | null;
  customer_company_id?: string | null;
  provider_company_id?: string | null;
  created_at: string;
}

interface TrackingEventRow {
  id: string;
  shipment_id: string;
  description: string;
  status: string;
  city?: string;
  region?: string;
  occurred_at: string;
}

export default function ShipmentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const listQuery = trpc.shipping.listShipments.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQuery = trpc.shipping.getShipment.useQuery({ id: selectedId ?? '' }, { enabled: Boolean(selectedId) });
  const voidLabel = trpc.shipping.voidLabel.useMutation({
    onSuccess: async () => {
      await utils.shipping.listShipments.invalidate();
      if (selectedId) await utils.shipping.getShipment.invalidate({ id: selectedId });
    },
  });
  const trackPull = trpc.shipping.trackPull.useMutation({
    onSuccess: async () => {
      if (selectedId) await utils.shipping.getShipment.invalidate({ id: selectedId });
    },
  });

  const shipments = useMemo<ShipmentRow[]>(() => (listQuery.data ?? []) as ShipmentRow[], [listQuery.data]);
  const detail = detailQuery.data as { shipment: ShipmentRow; events: TrackingEventRow[] } | undefined;

  const handleVoid = async (shipmentId: string) => {
    Alert.alert('Void label?', 'Refund/void the carrier label and mark this shipment as Voided.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive', onPress: async () => {
          try { await voidLabel.mutateAsync({ shipmentId, reason: 'manual_void' }); }
          catch (e) { Alert.alert('Unable to void', e instanceof Error ? e.message : 'unknown'); }
        },
      },
    ]);
  };

  if (listQuery.isLoading) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading shipments" /></View>;
  if (listQuery.isError) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="error" title="Unable to load" onRetry={() => void listQuery.refetch()} /></View>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Shipments</Text>
          <Text style={styles.sub}>{shipments.length} total</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/fulfillment/manifest')} style={styles.backBtn} testID="open-manifests">
          <ClipboardList size={18} color={C.text} />
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} tintColor={C.accent} />}
      >
        {shipments.length === 0 ? (
          <EmptyState icon={Truck} title="No shipments" description="Shipments created from orders will appear here." />
        ) : shipments.map((s) => (
          <Card key={s.id} style={StyleSheet.flatten([styles.card, selectedId === s.id && styles.cardActive])} onPress={() => setSelectedId(selectedId === s.id ? null : s.id)}>
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}><Package size={16} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{s.carrier_code || 'Carrier pending'} {s.service_level ? `· ${s.service_level}` : ''}</Text>
                <Text style={styles.cardMeta}>{s.tracking_code || 'Not yet shipped'} · {new Date(s.created_at).toLocaleDateString()}</Text>
              </View>
              <StatusBadge status={s.status} />
            </View>

            {selectedId === s.id && detail ? (
              <View style={styles.detail}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Rate</Text>
                  <Text style={styles.detailVal}>${Number(s.rate_amount ?? 0).toFixed(2)} {String(s.currency ?? 'CAD').toUpperCase()}</Text>
                </View>
                {s.label_url ? (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      label="Open label PDF"
                      variant="secondary"
                      icon={<ExternalLink size={14} color={C.text} />}
                      onPress={() => Platform.OS === 'web' ? window.open(String(s.label_url), '_blank') : void Linking.openURL(String(s.label_url))}
                    />
                    <Button
                      label="Refresh tracking"
                      variant="secondary"
                      icon={<RefreshCcw size={14} color={C.text} />}
                      loading={trackPull.isPending}
                      onPress={() => void trackPull.mutate({ shipmentId: s.id })}
                    />
                    {s.status !== 'Voided' && s.status !== 'Delivered' ? (
                      <Button
                        label="Void label"
                        variant="danger"
                        icon={<XCircle size={14} color={C.red} />}
                        loading={voidLabel.isPending}
                        onPress={() => void handleVoid(s.id)}
                      />
                    ) : null}
                  </View>
                ) : (
                  <Button
                    label="Compare rates & buy label"
                    onPress={() => router.push({ pathname: '/fulfillment/rate-shop', params: { shipmentId: s.id } })}
                    icon={<Tag size={14} color={C.white} />}
                  />
                )}

                <Text style={styles.sectionTitle}>Tracking timeline</Text>
                {(detail.events ?? []).length === 0 ? (
                  <Text style={styles.empty}>No tracking events yet.</Text>
                ) : (detail.events ?? []).map((ev) => (
                  <View key={ev.id} style={styles.event}>
                    <View style={[styles.eventDot, { backgroundColor: ev.status === 'Delivered' ? C.green : ev.status === 'Exception' ? C.red : C.accent }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventStatus}>{ev.status || 'Update'}</Text>
                      <Text style={styles.eventDesc}>{ev.description || '—'}</Text>
                      <View style={styles.eventMetaRow}>
                        <Clock size={10} color={C.textMuted} />
                        <Text style={styles.eventMeta}>{new Date(ev.occurred_at).toLocaleString()}</Text>
                        {ev.city ? <><MapPin size={10} color={C.textMuted} /><Text style={styles.eventMeta}>{ev.city}{ev.region ? `, ${ev.region}` : ''}</Text></> : null}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  card: { padding: 14, gap: 10 },
  cardActive: { borderColor: C.accent },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  detail: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailKey: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  detailVal: { fontSize: 13, color: C.text, fontWeight: '700' as const },
  sectionTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text, marginTop: 8 },
  empty: { fontSize: 12, color: C.textMuted, paddingVertical: 8 },
  event: { flexDirection: 'row', gap: 10, paddingVertical: 8, paddingLeft: 2, borderLeftWidth: 0 },
  eventDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  eventStatus: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  eventDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  eventMeta: { fontSize: 10, color: C.textMuted },
});
