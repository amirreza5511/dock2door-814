import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ClipboardList, Plus, ExternalLink, CheckCircle, AlertTriangle } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';

interface ManifestRow {
  id: string;
  company_id: string;
  carrier_code: string;
  status: 'Open' | 'Closed' | 'Submitted' | 'Failed';
  manifest_number: string;
  manifest_url: string;
  shipment_count: number;
  failed_reason: string;
  created_at: string;
  submitted_at: string | null;
}

interface ShipmentRow {
  id: string;
  carrier_code: string | null;
  tracking_code: string | null;
  status: string;
  manifest_id: string | null;
  provider_company_id: string | null;
  carrier_account_id: string | null;
}

export default function ManifestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeCompany } = useActiveCompany();
  const utils = trpc.useUtils();

  const manifestsQuery = trpc.shipping.listManifests.useQuery({ companyId: activeCompany?.companyId });
  const shipmentsQuery = trpc.shipping.listShipments.useQuery();
  const create = trpc.shipping.createManifest.useMutation({
    onSuccess: async () => {
      await utils.shipping.listManifests.invalidate();
      await utils.shipping.listShipments.invalidate();
      setSelected({});
    },
  });

  const manifests = useMemo<ManifestRow[]>(() => (manifestsQuery.data ?? []) as ManifestRow[], [manifestsQuery.data]);
  const shipments = useMemo<ShipmentRow[]>(() => (shipmentsQuery.data ?? []) as ShipmentRow[], [shipmentsQuery.data]);

  const manifestable = useMemo(
    () => shipments.filter((s) => s.status === 'LabelPurchased' && !s.manifest_id),
    [shipments],
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const groupedByCarrier = useMemo(() => {
    const g: Record<string, ShipmentRow[]> = {};
    for (const s of manifestable) {
      const c = (s.carrier_code ?? 'UNKNOWN').toUpperCase();
      if (!g[c]) g[c] = [];
      g[c].push(s);
    }
    return g;
  }, [manifestable]);

  const handleClose = async (carrier: string) => {
    if (!activeCompany?.companyId) { Alert.alert('No active company'); return; }
    const ids = Object.keys(selected).filter((k) => selected[k] && groupedByCarrier[carrier]?.some((s) => s.id === k));
    if (ids.length === 0) { Alert.alert('Select shipments to manifest'); return; }
    try {
      const res = await create.mutateAsync({
        companyId: activeCompany.companyId,
        carrierCode: carrier,
        shipmentIds: ids,
      }) as { manifest_id: string; failed_reason: string };
      if (res.failed_reason) {
        Alert.alert('Manifest closed with errors', res.failed_reason);
      } else {
        Alert.alert('Manifest closed', `${ids.length} shipments manifested.`);
      }
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'unknown');
    }
  };

  const openUrl = (url: string) => Platform.OS === 'web' ? window.open(url, '_blank') : void Linking.openURL(url);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>End-of-day manifests</Text>
          <Text style={styles.sub}>Close out shipments per carrier</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={manifestsQuery.isFetching} onRefresh={() => void manifestsQuery.refetch()} tintColor={C.accent} />}
      >
        <Text style={styles.sectionTitle}>Open manifests</Text>
        {Object.keys(groupedByCarrier).length === 0 ? (
          <EmptyState icon={ClipboardList} title="No labels to manifest" description="Shipments with purchased labels will show up here for end-of-day closeout." />
        ) : (
          Object.entries(groupedByCarrier).map(([carrier, list]) => (
            <Card key={carrier} style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: C.accentDim }]}><ClipboardList size={16} color={C.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{carrier}</Text>
                  <Text style={styles.cardMeta}>{list.length} ready to manifest</Text>
                </View>
                <Button label="Close out" loading={create.isPending} onPress={() => void handleClose(carrier)} icon={<Plus size={14} color={C.white} />} />
              </View>
              <View style={styles.shipList}>
                {list.map((s) => {
                  const checked = !!selected[s.id];
                  return (
                    <TouchableOpacity key={s.id} style={[styles.shipRow, checked && styles.shipRowActive]} onPress={() => setSelected((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                      <View style={[styles.checkbox, checked && styles.checkboxActive]}>
                        {checked ? <CheckCircle size={12} color={C.white} /> : null}
                      </View>
                      <Text style={styles.shipText}>{s.tracking_code ?? s.id.slice(0, 8)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>
          ))
        )}

        <Text style={styles.sectionTitle}>History</Text>
        {manifests.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No manifests yet" />
        ) : manifests.map((m) => (
          <Card key={m.id} style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: m.status === 'Failed' ? C.redDim : C.greenDim }]}>
                {m.status === 'Failed' ? <AlertTriangle size={16} color={C.red} /> : <CheckCircle size={16} color={C.green} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{m.carrier_code} \u00b7 {m.shipment_count} shipments</Text>
                <Text style={styles.cardMeta}>
                  {m.manifest_number || (m.status === 'Failed' ? m.failed_reason : 'No number')} \u00b7 {new Date(m.created_at).toLocaleString()}
                </Text>
              </View>
              <StatusBadge status={m.status} />
              {m.manifest_url ? (
                <TouchableOpacity onPress={() => openUrl(m.manifest_url)} style={styles.iconBtn}><ExternalLink size={14} color={C.text} /></TouchableOpacity>
              ) : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, marginTop: 6, marginBottom: 2 },
  card: { padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  cardMeta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  shipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardElevated },
  shipRowActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: C.accent, borderColor: C.accent },
  shipText: { fontSize: 11, color: C.text, fontWeight: '600' as const },
  iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.cardElevated, borderWidth: 1, borderColor: C.border },
});
