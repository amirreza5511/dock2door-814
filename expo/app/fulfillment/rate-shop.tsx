import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Truck, RefreshCcw, Tag, Package, ExternalLink, Clock } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface RateQuote {
  id: string;
  shipment_id: string;
  carrier_code: string;
  service_level: string;
  service_name: string;
  rate_amount: string | number;
  currency: string;
  est_delivery_days: number | null;
  est_delivery_date: string | null;
  carrier_rate_id: string;
}

export default function RateShopScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { shipmentId } = useLocalSearchParams<{ shipmentId: string }>();
  const sid = String(shipmentId ?? '');

  const utils = trpc.useUtils();
  const detailQuery = trpc.shipping.getShipment.useQuery({ id: sid }, { enabled: Boolean(sid) });
  const quotesQuery = trpc.shipping.listRateQuotes.useQuery({ shipmentId: sid }, { enabled: Boolean(sid) });
  const rateShop = trpc.shipping.rateShop.useMutation({
    onSuccess: () => void utils.shipping.listRateQuotes.invalidate({ shipmentId: sid }),
  });
  const purchase = trpc.shipping.purchaseLabel.useMutation({
    onSuccess: async () => {
      await utils.shipping.getShipment.invalidate({ id: sid });
      await utils.shipping.listShipments.invalidate();
    },
  });

  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const quotes = useMemo<RateQuote[]>(() => (quotesQuery.data ?? []) as RateQuote[], [quotesQuery.data]);
  const detail = detailQuery.data as { shipment: any; events: any[] } | undefined;

  const handleShop = async () => {
    try { await rateShop.mutateAsync({ shipmentId: sid }); }
    catch (e) { Alert.alert('Rate shop failed', e instanceof Error ? e.message : 'unknown'); }
  };

  const handlePurchase = async () => {
    if (!selectedQuoteId) { Alert.alert('Pick a rate first'); return; }
    try {
      const res = await purchase.mutateAsync({ shipmentId: sid, rateQuoteId: selectedQuoteId }) as { tracking_code: string; label_url: string };
      Alert.alert('Label purchased', `Tracking: ${res.tracking_code}`, [
        { text: 'Open label', onPress: () => Platform.OS === 'web' ? window.open(res.label_url, '_blank') : void Linking.openURL(res.label_url) },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Purchase failed', e instanceof Error ? e.message : 'unknown');
    }
  };

  if (!sid) return <View style={styles.root}><ScreenFeedback state="error" title="Missing shipment id" /></View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Rate comparison</Text>
          <Text style={styles.sub}>Compare Canada Post, UPS, DHL, FedEx, EasyPost, Shippo</Text>
        </View>
        <TouchableOpacity onPress={handleShop} style={styles.refreshBtn}>
          <RefreshCcw size={16} color={C.white} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={<RefreshControl refreshing={quotesQuery.isFetching} onRefresh={() => void quotesQuery.refetch()} tintColor={C.accent} />}
      >
        {detail?.shipment ? (
          <Card style={styles.summary}>
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: C.blueDim }]}><Package size={16} color={C.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Shipment</Text>
                <Text style={styles.cardMeta}>
                  {Number(detail.shipment.weight_kg ?? 0).toFixed(2)} kg \u00b7 {detail.shipment.length_cm}\u00d7{detail.shipment.width_cm}\u00d7{detail.shipment.height_cm} cm
                </Text>
                <Text style={styles.cardMeta}>
                  {(detail.shipment.ship_from?.city ?? '\u2013')} \u2192 {(detail.shipment.ship_to?.city ?? '\u2013')}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        <Button label={rateShop.isPending ? 'Comparing\u2026' : 'Compare rates across all carriers'} onPress={() => void handleShop()} loading={rateShop.isPending} icon={<Truck size={14} color={C.white} />} fullWidth />

        {rateShop.data && (rateShop.data as any).errors?.length ? (
          <Card style={styles.warnCard}>
            <Text style={styles.warnTitle}>Some carriers failed</Text>
            {(rateShop.data as any).errors.map((er: any, i: number) => (
              <Text key={i} style={styles.warnLine}>\u2022 {er.carrier}: {er.error}</Text>
            ))}
          </Card>
        ) : null}

        {quotes.length === 0 ? (
          <EmptyState icon={Tag} title="No rates yet" description="Tap Compare rates to fetch live prices from every connected carrier." />
        ) : (
          quotes
            .slice()
            .sort((a, b) => Number(a.rate_amount) - Number(b.rate_amount))
            .map((q) => {
              const active = selectedQuoteId === q.id;
              return (
                <Card key={q.id} style={StyleSheet.flatten([styles.card, active && styles.cardActive])} onPress={() => setSelectedQuoteId(q.id)}>
                  <View style={styles.row}>
                    <View style={[styles.iconWrap, { backgroundColor: active ? C.accentDim : C.cardElevated }]}>
                      <Truck size={16} color={active ? C.accent : C.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{q.service_name || `${q.carrier_code} ${q.service_level}`}</Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.cardMeta}>{q.carrier_code}</Text>
                        {q.est_delivery_days ? (
                          <View style={styles.dot}><Clock size={10} color={C.textMuted} /><Text style={styles.cardMeta}>{q.est_delivery_days}d</Text></View>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.price}>${Number(q.rate_amount).toFixed(2)}</Text>
                  </View>
                </Card>
              );
            })
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Button
          label={selectedQuoteId ? 'Buy selected label' : 'Select a rate'}
          onPress={() => void handlePurchase()}
          loading={purchase.isPending}
          disabled={!selectedQuoteId}
          icon={<ExternalLink size={14} color={C.white} />}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  summary: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  dot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  card: { padding: 14 },
  cardActive: { borderColor: C.accent, borderWidth: 2 },
  price: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  warnCard: { padding: 12, backgroundColor: C.yellowDim, borderColor: C.yellow },
  warnTitle: { fontSize: 12, fontWeight: '700' as const, color: C.yellow, marginBottom: 4 },
  warnLine: { fontSize: 11, color: C.text, marginTop: 2 },
  footer: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: C.bgSecondary, borderTopWidth: 1, borderTopColor: C.border },
});
