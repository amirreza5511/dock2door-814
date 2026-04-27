import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Modal, Linking, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Store, Plus, X, RefreshCw, AlertTriangle, CheckCircle2, Trash2, Link2, ArrowLeft, Send, Clock } from 'lucide-react-native';
import C from '@/constants/colors';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { supabase } from '@/lib/supabase';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';

interface ConnRow {
  id: string;
  company_id: string;
  kind: 'shopify' | 'amazon';
  external_account_id: string | null;
  display_label: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
interface SyncLogRow { id: string; connection_id: string | null; kind: string; result: string; message: string | null; started_at: string; finished_at: string | null }
interface ChannelOrderRow {
  id: string;
  kind: string;
  external_order_number: string | null;
  status: string;
  customer_name: string | null;
  total_amount: number | null;
  currency: string | null;
  ordered_at: string | null;
  push_status: 'not_required' | 'pending' | 'synced' | 'failed' | null;
  push_last_error: string | null;
  push_attempts: number | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  fulfillment_pushed_at: string | null;
}
interface SkuMapRow { id: string; channel_sku: string; internal_sku: string }

export default function IntegrationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { activeCompany } = useActiveCompany();
  const companyId = activeCompany?.companyId ?? null;

  const connections = useQuery({
    queryKey: ['channel-connections', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ConnRow[]> => {
      const { data, error } = await supabase
        .from('channel_connections_public')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnRow[];
    },
  });

  const logs = useQuery({
    queryKey: ['channel-logs', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<SyncLogRow[]> => {
      const { data, error } = await supabase
        .from('channel_sync_logs')
        .select('*')
        .eq('company_id', companyId)
        .order('started_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as SyncLogRow[];
    },
  });

  const channelOrders = useQuery({
    queryKey: ['channel-orders', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ChannelOrderRow[]> => {
      const { data, error } = await supabase
        .from('channel_orders')
        .select('id, kind, external_order_number, status, customer_name, total_amount, currency, ordered_at, push_status, push_last_error, push_attempts, tracking_number, tracking_carrier, fulfillment_pushed_at')
        .eq('company_id', companyId)
        .order('ordered_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ChannelOrderRow[];
    },
  });

  const skuMappings = useQuery({
    queryKey: ['sku-mappings', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<SkuMapRow[]> => {
      const { data, error } = await supabase
        .from('sku_mappings')
        .select('id, channel_sku, internal_sku')
        .eq('company_id', companyId)
        .order('channel_sku');
      if (error) throw error;
      return (data ?? []) as SkuMapRow[];
    },
  });

  const [showShopify, setShowShopify] = useState<boolean>(false);
  const [showAmazon, setShowAmazon] = useState<boolean>(false);
  const [showMap, setShowMap] = useState<boolean>(false);
  const [shopDomain, setShopDomain] = useState<string>('');
  const [amazonForm, setAmazonForm] = useState({ sellingPartnerId: '', marketplaceId: '', refreshToken: '' });
  const [mapForm, setMapForm] = useState({ connectionId: '', channelSku: '', internalSku: '' });

  const startShopify = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('No active company');
      if (!shopDomain.trim()) throw new Error('Enter your shop domain');
      const { data, error } = await supabase.functions.invoke('shopify-oauth-start', {
        body: { companyId, shop: shopDomain.trim() },
      });
      if (error) throw new Error(error.message);
      const url = (data as { installUrl?: string })?.installUrl;
      if (!url) throw new Error((data as { error?: string })?.error ?? 'No install URL returned');
      if (Platform.OS === 'web') window.open(url, '_blank');
      else await Linking.openURL(url);
      return url;
    },
    onSuccess: () => {
      setShowShopify(false);
      setShopDomain('');
      Alert.alert('Continue in browser', 'Approve the Shopify app, then come back and refresh.');
      void qc.invalidateQueries({ queryKey: ['channel-connections'] });
    },
    onError: (e) => Alert.alert('Shopify connect failed', e instanceof Error ? e.message : 'Unknown'),
  });

  const linkAmazon = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('No active company');
      const { sellingPartnerId, marketplaceId, refreshToken } = amazonForm;
      if (!sellingPartnerId.trim() || !refreshToken.trim()) throw new Error('Selling partner id + refresh token required');
      const { data, error } = await supabase.functions.invoke('amazon-spapi-auth', {
        body: { companyId, sellingPartnerId: sellingPartnerId.trim(), marketplaceId: marketplaceId.trim(), refreshToken: refreshToken.trim() },
      });
      if (error) throw new Error(error.message);
      const err = (data as { error?: string })?.error;
      if (err) throw new Error(err);
      return data;
    },
    onSuccess: () => {
      setShowAmazon(false);
      setAmazonForm({ sellingPartnerId: '', marketplaceId: '', refreshToken: '' });
      Alert.alert('Amazon connected');
      void qc.invalidateQueries({ queryKey: ['channel-connections'] });
    },
    onError: (e) => Alert.alert('Amazon connect failed', e instanceof Error ? e.message : 'Unknown'),
  });

  const syncOrders = useMutation({
    mutationFn: async (conn: ConnRow) => {
      const fn = conn.kind === 'shopify' ? 'shopify-sync-orders' : 'amazon-sync-orders';
      const { data, error } = await supabase.functions.invoke(fn, { body: { connectionId: conn.id, sinceDays: 7 } });
      if (error) throw new Error(error.message);
      const err = (data as { error?: string })?.error;
      if (err) throw new Error(err);
      return data as { imported?: number; fetched?: number };
    },
    onSuccess: (res) => {
      Alert.alert('Sync complete', `Imported ${res?.imported ?? 0} of ${res?.fetched ?? 0} orders.`);
      void qc.invalidateQueries({ queryKey: ['channel-orders'] });
      void qc.invalidateQueries({ queryKey: ['channel-logs'] });
    },
    onError: (e) => Alert.alert('Sync failed', e instanceof Error ? e.message : 'Unknown'),
  });

  const disconnect = useMutation({
    mutationFn: async (conn: ConnRow) => {
      const { error } = await supabase.rpc('channel_connection_disconnect', { p_id: conn.id, p_reason: 'manual_disconnect' });
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('Disconnected');
      void qc.invalidateQueries({ queryKey: ['channel-connections'] });
    },
    onError: (e) => Alert.alert('Disconnect failed', e instanceof Error ? e.message : 'Unknown'),
  });

  const retryPush = useMutation({
    mutationFn: async (channelOrderId: string) => {
      const { error: rpcErr } = await supabase.rpc('channel_retry_fulfillment_push', { p_channel_order_id: channelOrderId });
      if (rpcErr) throw rpcErr;
      const { data, error: fnErr } = await supabase.functions.invoke('channel-fulfillment-worker', {
        body: { channelOrderId },
        headers: { 'x-cron-secret': process.env.EXPO_PUBLIC_CHANNEL_FULFILLMENT_SECRET ?? '' },
      });
      if (fnErr) throw new Error(fnErr.message);
      const err = (data as { error?: string })?.error;
      if (err) throw new Error(err);
      return data;
    },
    onSuccess: () => {
      Alert.alert('Fulfillment push queued', 'The order will sync back to Shopify/Amazon shortly.');
      void qc.invalidateQueries({ queryKey: ['channel-orders'] });
      void qc.invalidateQueries({ queryKey: ['channel-logs'] });
    },
    onError: (e) => Alert.alert('Retry failed', e instanceof Error ? e.message : 'Unknown'),
  });

  const upsertMap = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('No active company');
      const { connectionId, channelSku, internalSku } = mapForm;
      if (!channelSku.trim() || !internalSku.trim()) throw new Error('Both SKUs required');
      const { error } = await supabase.rpc('sku_mapping_upsert', {
        p_company_id: companyId,
        p_connection_id: connectionId || null,
        p_channel_sku: channelSku.trim(),
        p_internal_sku: internalSku.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setShowMap(false);
      setMapForm({ connectionId: '', channelSku: '', internalSku: '' });
      void qc.invalidateQueries({ queryKey: ['sku-mappings'] });
    },
    onError: (e) => Alert.alert('Save failed', e instanceof Error ? e.message : 'Unknown'),
  });

  const conns = useMemo(() => connections.data ?? [], [connections.data]);
  const shopify = useMemo(() => conns.filter((c) => c.kind === 'shopify'), [conns]);
  const amazon = useMemo(() => conns.filter((c) => c.kind === 'amazon'), [conns]);

  const refreshAll = () => {
    void connections.refetch();
    void logs.refetch();
    void channelOrders.refetch();
    void skuMappings.refetch();
  };

  if (!companyId) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg }]}>
        <Stack.Screen options={{ title: 'Integrations' }} />
        <View style={{ padding: 24, paddingTop: insets.top + 60 }}>
          <EmptyState icon={AlertTriangle} title="Pick a company" description="Switch to a company to manage Shopify / Amazon integrations." />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Sales channels</Text>
          <Text style={styles.subtitle}>Connect Shopify & Amazon → orders flow into fulfillment.</Text>
        </View>
        <TouchableOpacity onPress={refreshAll} style={styles.refreshBtn}>
          <RefreshCw size={16} color={C.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={connections.isFetching} onRefresh={refreshAll} tintColor={C.accent} />}
      >
        <View style={styles.row2}>
          <ChannelTile
            title="Shopify"
            count={shopify.length}
            color={C.green}
            icon={ShoppingBag}
            onConnect={() => setShowShopify(true)}
          />
          <ChannelTile
            title="Amazon"
            count={amazon.length}
            color={C.orange}
            icon={Store}
            onConnect={() => setShowAmazon(true)}
          />
        </View>

        <Text style={styles.sectionTitle}>Connected stores</Text>
        {conns.length === 0 ? (
          <EmptyState icon={Link2} title="No stores connected" description="Connect Shopify or Amazon to import orders automatically." />
        ) : conns.map((c) => (
          <View key={c.id} style={styles.connCard}>
            <View style={styles.connTop}>
              {c.kind === 'shopify' ? <ShoppingBag size={16} color={C.green} /> : <Store size={16} color={C.orange} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.connTitle}>{c.display_label || c.external_account_id || c.id.slice(0, 8)}</Text>
                <Text style={styles.connMeta}>{c.kind} · {c.last_synced_at ? `synced ${new Date(c.last_synced_at).toLocaleString()}` : 'never synced'}</Text>
              </View>
              <StatusBadge status={c.status} size="sm" />
            </View>
            {c.last_error ? (
              <View style={styles.errBox}>
                <AlertTriangle size={12} color={C.red} />
                <Text style={styles.errText} numberOfLines={2}>{c.last_error}</Text>
              </View>
            ) : null}
            <View style={styles.connBtns}>
              <Button label="Sync now" size="sm" onPress={() => syncOrders.mutate(c)} loading={syncOrders.isPending && syncOrders.variables?.id === c.id} icon={<RefreshCw size={13} color={C.white} />} />
              <Button label="Disconnect" size="sm" variant="secondary" onPress={() => Alert.alert('Disconnect?', `Stop syncing ${c.display_label}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate(c) },
              ])} icon={<Trash2 size={13} color={C.text} />} />
            </View>
          </View>
        ))}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>SKU mappings</Text>
          <Button label="+ Add" size="sm" onPress={() => setShowMap(true)} />
        </View>
        {(skuMappings.data ?? []).length === 0 ? (
          <EmptyState icon={Link2} title="No SKU mappings" description="Map channel SKUs → your internal SKUs to keep inventory accurate." />
        ) : (skuMappings.data ?? []).map((m) => (
          <View key={m.id} style={styles.mapRow}>
            <Text style={styles.mapText}>{m.channel_sku}</Text>
            <Text style={styles.mapArrow}>→</Text>
            <Text style={styles.mapTextInternal}>{m.internal_sku}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Channel orders ({(channelOrders.data ?? []).length})</Text>
        {(channelOrders.data ?? []).length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No imported orders yet" />
        ) : (channelOrders.data ?? []).slice(0, 30).map((o) => {
          const push = o.push_status ?? 'not_required';
          const pushColor = push === 'synced' ? C.green : push === 'failed' ? C.red : push === 'pending' ? C.orange : C.textMuted;
          const PushIcon = push === 'synced' ? CheckCircle2 : push === 'failed' ? AlertTriangle : push === 'pending' ? Clock : Send;
          const canRetry = push === 'failed' || push === 'pending';
          return (
            <View key={o.id} style={styles.orderRow}>
              <View style={[styles.kindDot, { backgroundColor: o.kind === 'shopify' ? C.green : C.orange }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{o.external_order_number || o.id.slice(0, 8)}</Text>
                <Text style={styles.rowMeta}>{o.customer_name ?? '—'} · {o.total_amount ?? 0} {o.currency ?? ''} · {o.ordered_at ? new Date(o.ordered_at).toLocaleString() : ''}</Text>
                <View style={styles.pushRow}>
                  <PushIcon size={11} color={pushColor} />
                  <Text style={[styles.pushText, { color: pushColor }]}>
                    {push === 'synced' ? `Synced${o.fulfillment_pushed_at ? ` · ${new Date(o.fulfillment_pushed_at).toLocaleDateString()}` : ''}` :
                     push === 'failed' ? `Failed${o.push_attempts ? ` (${o.push_attempts}x)` : ''}` :
                     push === 'pending' ? 'Push pending' :
                     'Awaiting shipment'}
                  </Text>
                  {o.tracking_number ? <Text style={styles.pushTracking} numberOfLines={1}>· {o.tracking_carrier ?? ''} {o.tracking_number}</Text> : null}
                </View>
                {push === 'failed' && o.push_last_error ? (
                  <Text style={styles.pushErr} numberOfLines={2}>{o.push_last_error}</Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <StatusBadge status={o.status} size="sm" />
                {canRetry ? (
                  <Button
                    label={push === 'failed' ? 'Retry' : 'Push'}
                    size="sm"
                    variant="secondary"
                    onPress={() => retryPush.mutate(o.id)}
                    loading={retryPush.isPending && retryPush.variables === o.id}
                    icon={<Send size={11} color={C.text} />}
                  />
                ) : null}
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Recent sync logs</Text>
        {(logs.data ?? []).length === 0 ? (
          <EmptyState icon={RefreshCw} title="No logs yet" />
        ) : (logs.data ?? []).map((l) => (
          <View key={l.id} style={styles.logRow}>
            {l.result === 'ok' ? <CheckCircle2 size={13} color={C.green} /> : l.result === 'error' ? <AlertTriangle size={13} color={C.red} /> : <RefreshCw size={13} color={C.orange} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{l.kind} · {l.result}</Text>
              <Text style={styles.rowMeta} numberOfLines={2}>{l.message ?? '—'} · {new Date(l.started_at).toLocaleString()}</Text>
            </View>
          </View>
        ))}

        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>External setup required</Text>
          <Text style={styles.helpText}>
            • Shopify: register a custom app and set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_REDIRECT_URL, SHOPIFY_WEBHOOK_URL as Supabase secrets.{"\n"}
            • Amazon: enrol in Amazon SP-API developer programme, create LWA credentials, set AMAZON_LWA_CLIENT_ID + AMAZON_LWA_CLIENT_SECRET. Merchant must paste their refresh token after authorising your app.{"\n"}
            • channel-sync-worker: schedule via Supabase cron with header x-cron-secret = CHANNEL_SYNC_SECRET.{"\n"}
            • channel-fulfillment-worker: schedule every 1–5 min with header x-cron-secret = CHANNEL_FULFILLMENT_SECRET. Pushes tracking back to Shopify/Amazon when shipments are marked Shipped.
          </Text>
        </View>
      </ScrollView>

      {/* Shopify modal */}
      <Modal visible={showShopify} transparent animationType="slide" onRequestClose={() => setShowShopify(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Connect Shopify</Text>
              <TouchableOpacity onPress={() => setShowShopify(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Input label="Shop domain" value={shopDomain} onChangeText={setShopDomain} placeholder="my-store.myshopify.com" autoCapitalize="none" autoCorrect={false} />
              <Text style={styles.helpText}>You will be redirected to Shopify to install the app and grant access.</Text>
              <Button label="Continue to Shopify" onPress={() => startShopify.mutate()} loading={startShopify.isPending} fullWidth icon={<Plus size={15} color={C.white} />} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Amazon modal */}
      <Modal visible={showAmazon} transparent animationType="slide" onRequestClose={() => setShowAmazon(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Connect Amazon</Text>
              <TouchableOpacity onPress={() => setShowAmazon(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Text style={styles.helpText}>Authorize the Dock2Door app inside Seller Central → SP-API, then paste the refresh token below.</Text>
              <Input label="Selling partner ID" value={amazonForm.sellingPartnerId} onChangeText={(v) => setAmazonForm({ ...amazonForm, sellingPartnerId: v })} autoCapitalize="characters" />
              <Input label="Marketplace ID" value={amazonForm.marketplaceId} onChangeText={(v) => setAmazonForm({ ...amazonForm, marketplaceId: v })} placeholder="ATVPDKIKX0DER (US)" autoCapitalize="characters" />
              <Input label="LWA refresh token" value={amazonForm.refreshToken} onChangeText={(v) => setAmazonForm({ ...amazonForm, refreshToken: v })} secureTextEntry multiline numberOfLines={3} />
              <Button label="Connect Amazon" onPress={() => linkAmazon.mutate()} loading={linkAmazon.isPending} fullWidth icon={<Plus size={15} color={C.white} />} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* SKU map modal */}
      <Modal visible={showMap} transparent animationType="slide" onRequestClose={() => setShowMap(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SKU mapping</Text>
              <TouchableOpacity onPress={() => setShowMap(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Input label="Channel SKU" value={mapForm.channelSku} onChangeText={(v) => setMapForm({ ...mapForm, channelSku: v })} autoCapitalize="characters" />
              <Input label="Your internal SKU" value={mapForm.internalSku} onChangeText={(v) => setMapForm({ ...mapForm, internalSku: v })} autoCapitalize="characters" />
              <Input label="Connection (optional)" value={mapForm.connectionId} onChangeText={(v) => setMapForm({ ...mapForm, connectionId: v })} placeholder="leave empty for global" />
              <Button label="Save mapping" onPress={() => upsertMap.mutate()} loading={upsertMap.isPending} fullWidth />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ChannelTile({ title, count, color, icon: Icon, onConnect }: { title: string; count: number; color: string; icon: React.ComponentType<{ size?: number; color?: string }>; onConnect: () => void }) {
  return (
    <View style={[styles.tile, { borderColor: color + '60' }]}>
      <View style={[styles.tileIcon, { backgroundColor: color + '20' }]}>
        <Icon size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileMeta}>{count} connected</Text>
      </View>
      <Button label="Connect" size="sm" onPress={onConnect} icon={<Plus size={13} color={C.white} />} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  body: { padding: 16, gap: 10 },
  row2: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, padding: 12 },
  tileIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  tileMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12 },
  connCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  connTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  connTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  connMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  connBtns: { flexDirection: 'row', gap: 8 },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: C.red + '15', borderRadius: 8, borderWidth: 1, borderColor: C.red },
  errText: { flex: 1, fontSize: 11, color: C.red },
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  mapText: { fontSize: 12, fontWeight: '700' as const, color: C.text, flex: 1 },
  mapTextInternal: { fontSize: 12, fontWeight: '700' as const, color: C.accent, flex: 1, textAlign: 'right' as const },
  mapArrow: { fontSize: 14, color: C.textMuted, fontWeight: '800' as const },
  orderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' as const },
  pushText: { fontSize: 10, fontWeight: '700' as const },
  pushTracking: { fontSize: 10, color: C.textMuted, flexShrink: 1 },
  pushErr: { fontSize: 10, color: C.red, marginTop: 4 },
  kindDot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  rowMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  helpBox: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginTop: 16 },
  helpTitle: { fontSize: 12, fontWeight: '800' as const, color: C.text, marginBottom: 6 },
  helpText: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' },
  modal: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
});
