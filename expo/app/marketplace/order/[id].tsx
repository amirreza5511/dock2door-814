import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft, MapPin, Clock, Building2, DollarSign, Send, Check, X,
  Camera, FileText, CircleCheck, Truck, CheckCircle2,
} from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { subcategoryLabel, serviceTypeLabel, isInsuranceType } from '@/constants/serviceMarketplace';

const STATUS_COLOR: Record<string, string> = {
  Requested: C.yellow,
  Accepted: C.blue,
  Scheduled: C.blue,
  InProgress: C.accent,
  Completed: C.green,
  Cancelled: C.textMuted,
};

const QUOTE_LABEL: Record<string, string> = {
  none: 'Direct request',
  requested: 'Quote requested',
  quoted: 'Quote sent',
  accepted: 'Quote accepted',
  declined: 'Quote declined',
};

const COMMISSION_RATE = 0.08;

/** Upload a local image uri to the job-photos bucket, return a public URL. */
async function uploadJobPhoto(jobId: string, uri: string): Promise<string> {
  const resp = await fetch(uri);
  const arrayBuffer = await resp.arrayBuffer();
  const rawExt = (uri.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase();
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const path = `${jobId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('job-photos')
    .upload(path, arrayBuffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('job-photos').getPublicUrl(path);
  return data.publicUrl;
}

export default function MarketplaceOrderDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();

  const bootstrapQuery = useDockBootstrapData();
  const { serviceJobs, serviceListings, companies } = bootstrapQuery.data;

  const job = useMemo(() => serviceJobs.find((j) => j.id === id), [serviceJobs, id]);
  const listing = useMemo(() => serviceListings.find((l) => l.id === job?.serviceId), [serviceListings, job]);
  const providerCompanyId = job?.providerCompanyId ?? listing?.companyId ?? '';
  const isProvider = !!user?.companyId && user.companyId === providerCompanyId;
  const isCustomer = !!user?.companyId && user.companyId === job?.customerCompanyId;

  const providerName = companies.find((c) => c.id === providerCompanyId)?.name ?? listing?.companyName ?? 'Provider';
  const customerName = companies.find((c) => c.id === job?.customerCompanyId)?.name ?? 'Customer';

  const photosQuery = trpc.serviceJobs.listPhotos.useQuery({ id: id! }, { enabled: !!id });
  const invoiceQuery = trpc.invoicing.getWithLines.useQuery(
    { invoiceId: job?.invoiceId ?? '' },
    { enabled: !!job?.invoiceId },
  );

  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      utils.dock.bootstrap.invalidate(),
      utils.serviceJobs.listPhotos.invalidate(),
    ]);
  }, [utils]);

  const insurance = listing ? isInsuranceType(listing.serviceType) : false;
  const quoteStatus = job?.quoteStatus ?? 'none';
  const quotedAmount = job?.quotedAmount ?? null;
  const commission = quotedAmount != null ? Math.round(quotedAmount * COMMISSION_RATE * 100) / 100 : 0;

  const run = useCallback(async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      await refreshAll();
      if (okMsg) Alert.alert('Done', okMsg);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [refreshAll]);

  const sendQuote = trpc.serviceJobs.sendQuote.useMutation();
  const respondQuote = trpc.serviceJobs.respondQuote.useMutation();
  const acceptJob = trpc.serviceJobs.accept.useMutation();
  const checkIn = trpc.serviceJobs.checkIn.useMutation();
  const complete = trpc.serviceJobs.complete.useMutation();
  const invoiceJob = trpc.serviceJobs.invoice.useMutation();
  const addPhoto = trpc.serviceJobs.addPhoto.useMutation();
  const setInvoiceStatus = trpc.invoicing.setStatus.useMutation();

  const handleSendQuote = () => {
    const amt = Number(quoteAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid quote amount.');
      return;
    }
    void run(() => sendQuote.mutateAsync({ id: id!, amount: amt, notes: quoteNote, commissionRate: COMMISSION_RATE }), 'Quote sent to the customer.');
  };

  const pickAndUpload = async (kind: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach job photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploading(true);
    try {
      const url = await uploadJobPhoto(id!, result.assets[0].uri);
      await addPhoto.mutateAsync({ id: id!, url, kind });
      await utils.serviceJobs.listPhotos.invalidate();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Unable to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenFeedback state="loading" title="Loading order" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenFeedback state="error" title="Order not found" />
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  const photos = photosQuery.data ?? [];
  const title = listing?.title || subcategoryLabel(listing?.subcategory) || 'Marketplace order';
  const statusColor = STATUS_COLOR[job.status] ?? C.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.headerSub}>{listing ? serviceTypeLabel(listing.serviceType) : 'Order'} · {isProvider ? 'Incoming' : 'Your request'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{job.status}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Parties + meta */}
        <View style={styles.card}>
          <View style={styles.metaRow}>
            <Building2 size={14} color={C.textMuted} />
            <Text style={styles.metaText}>{isProvider ? `Customer: ${customerName}` : `Provider: ${providerName}`}</Text>
          </View>
          {(job.locationCity || job.locationAddress) ? (
            <View style={styles.metaRow}>
              <MapPin size={14} color={C.textMuted} />
              <Text style={styles.metaText}>{[job.locationAddress, job.locationCity].filter(Boolean).join(', ')}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Clock size={14} color={C.textMuted} />
            <Text style={styles.metaText}>{job.dateTimeStart ? new Date(job.dateTimeStart).toLocaleString() : '—'}{insurance ? '' : ` · ${job.durationHours}h`}</Text>
          </View>
          {insurance && job.cargoValue ? (
            <View style={styles.metaRow}>
              <DollarSign size={14} color={C.textMuted} />
              <Text style={styles.metaText}>Declared cargo value: ${job.cargoValue.toLocaleString()}</Text>
            </View>
          ) : null}
          {job.notes ? <Text style={styles.notes}>{job.notes}</Text> : null}
          <View style={styles.quotePill}>
            <Text style={styles.quotePillText}>{QUOTE_LABEL[quoteStatus] ?? quoteStatus}</Text>
          </View>
        </View>

        {/* Quote section */}
        {quoteStatus === 'requested' && isProvider && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Send an official quote</Text>
            <Text style={styles.inputLabel}>Quote amount ($)</Text>
            <TextInput value={quoteAmount} onChangeText={setQuoteAmount} keyboardType="numeric" placeholder="1200" placeholderTextColor={C.textMuted} style={styles.input} />
            <Text style={styles.inputLabel}>Note to customer</Text>
            <TextInput value={quoteNote} onChangeText={setQuoteNote} placeholder="Includes delivery & operator" placeholderTextColor={C.textMuted} style={[styles.input, styles.inputMultiline]} multiline />
            {Number(quoteAmount) > 0 && (
              <Text style={styles.commissionHint}>Platform commission ({Math.round(COMMISSION_RATE * 100)}%): ${(Number(quoteAmount) * COMMISSION_RATE).toFixed(2)}</Text>
            )}
            <Button label="Send Quote" onPress={handleSendQuote} loading={busy} fullWidth icon={<Send size={16} color={C.white} />} />
            <Button label="Decline request" onPress={() => void run(() => respondQuote.mutateAsync({ id: id!, accept: false }))} variant="ghost" fullWidth />
          </View>
        )}

        {quoteStatus === 'requested' && isCustomer && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Awaiting quote</Text>
            <Text style={styles.dim}>The provider is reviewing your request and will send an official price shortly.</Text>
          </View>
        )}

        {(quoteStatus === 'quoted' || quoteStatus === 'accepted') && quotedAmount != null && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Official quote</Text>
            <View style={styles.quoteAmountRow}>
              <Text style={styles.quoteAmount}>${quotedAmount.toLocaleString()}</Text>
              <Text style={styles.commissionSmall}>incl. ${commission.toFixed(2)} platform fee</Text>
            </View>
            {job.quoteNotes ? <Text style={styles.notes}>{job.quoteNotes}</Text> : null}
            {quoteStatus === 'quoted' && isCustomer && (
              <View style={styles.rowBtns}>
                <View style={{ flex: 1 }}>
                  <Button label="Accept" onPress={() => void run(() => respondQuote.mutateAsync({ id: id!, accept: true }), 'Quote accepted. The provider will schedule the work.')} loading={busy} fullWidth icon={<Check size={16} color={C.white} />} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Decline" onPress={() => void run(() => respondQuote.mutateAsync({ id: id!, accept: false }))} variant="ghost" fullWidth icon={<X size={16} color={C.text} />} />
                </View>
              </View>
            )}
            {quoteStatus === 'quoted' && isProvider && (
              <Text style={styles.dim}>Waiting for the customer to accept your quote.</Text>
            )}
            {quoteStatus === 'accepted' && (
              <View style={styles.acceptedBanner}>
                <CircleCheck size={16} color={C.green} />
                <Text style={styles.acceptedText}>Quote accepted{isProvider ? ' — you can now progress the job below.' : ' — the provider will start the work.'}</Text>
              </View>
            )}
          </View>
        )}

        {/* Provider job progress */}
        {isProvider && quoteStatus !== 'requested' && quoteStatus !== 'declined' && job.status !== 'Cancelled' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Job progress</Text>
            <View style={styles.progressBtns}>
              {job.status === 'Requested' && quoteStatus === 'accepted' && (
                <Button label="Accept & schedule" onPress={() => void run(() => acceptJob.mutateAsync({ id: id! }))} loading={busy} fullWidth icon={<Truck size={16} color={C.white} />} />
              )}
              {job.status === 'Accepted' && (
                <Button label="Start work (check in)" onPress={() => void run(() => checkIn.mutateAsync({ id: id! }))} loading={busy} fullWidth />
              )}
              {job.status === 'Scheduled' && (
                <Button label="Start work (check in)" onPress={() => void run(() => checkIn.mutateAsync({ id: id! }))} loading={busy} fullWidth />
              )}
              {job.status === 'InProgress' && (
                <Button label="Mark completed" onPress={() => void run(() => complete.mutateAsync({ id: id! }))} loading={busy} fullWidth icon={<CheckCircle2 size={16} color={C.white} />} />
              )}
            </View>
          </View>
        )}

        {/* Photos */}
        <View style={styles.card}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>Job photos</Text>
            {(isProvider || isCustomer) && (
              <TouchableOpacity onPress={() => void pickAndUpload('progress')} style={styles.addPhotoBtn} disabled={uploading}>
                <Camera size={14} color={C.accent} />
                <Text style={styles.addPhotoText}>{uploading ? 'Uploading…' : 'Add'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {photos.length === 0 ? (
            <Text style={styles.dim}>No photos yet. Providers can capture before/after evidence here.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {photos.map((p: { id: string; url: string; kind: string }) => (
                <View key={p.id} style={styles.photoWrap}>
                  <Image source={{ uri: p.url }} style={styles.photo} />
                  {p.kind ? <Text style={styles.photoKind}>{p.kind}</Text> : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Invoice */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Invoice</Text>
          {job.invoiceId && invoiceQuery.data ? (
            <View>
              <View style={styles.invHeadRow}>
                <FileText size={16} color={C.accent} />
                <Text style={styles.invNumber}>{invoiceQuery.data.invoice.invoice_number}</Text>
                <View style={[styles.invStatusBadge, { backgroundColor: (invoiceQuery.data.invoice.status === 'Paid' ? C.green : C.yellow) + '22' }]}>
                  <Text style={[styles.invStatusText, { color: invoiceQuery.data.invoice.status === 'Paid' ? C.green : C.yellow }]}>{invoiceQuery.data.invoice.status}</Text>
                </View>
              </View>
              {(invoiceQuery.data.lines ?? []).map((ln: { id: string; description: string; line_total: number }) => (
                <View key={ln.id} style={styles.invLine}>
                  <Text style={styles.invLineDesc} numberOfLines={1}>{ln.description}</Text>
                  <Text style={styles.invLineAmt}>${Number(ln.line_total ?? 0).toFixed(2)}</Text>
                </View>
              ))}
              <View style={styles.invTotalRow}>
                <Text style={styles.invTotalLabel}>Subtotal</Text>
                <Text style={styles.invTotalVal}>${Number(invoiceQuery.data.invoice.subtotal_amount ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.invTotalRow}>
                <Text style={styles.invTotalLabel}>Tax</Text>
                <Text style={styles.invTotalVal}>${Number(invoiceQuery.data.invoice.tax_amount ?? 0).toFixed(2)}</Text>
              </View>
              <View style={styles.invTotalRow}>
                <Text style={styles.invTotalLabel}>Platform commission</Text>
                <Text style={styles.invTotalVal}>${Number(invoiceQuery.data.invoice.commission_amount ?? 0).toFixed(2)}</Text>
              </View>
              <View style={[styles.invTotalRow, styles.invGrand]}>
                <Text style={styles.invGrandLabel}>Total</Text>
                <Text style={styles.invGrandVal}>${Number(invoiceQuery.data.invoice.total_amount ?? 0).toFixed(2)} {String(invoiceQuery.data.invoice.currency ?? 'CAD')}</Text>
              </View>
              {isProvider && invoiceQuery.data.invoice.status !== 'Paid' && (
                <Button label="Mark as paid" onPress={() => void run(async () => { await setInvoiceStatus.mutateAsync({ id: job.invoiceId!, status: 'Paid' }); await utils.invoicing.getWithLines.invalidate(); }, 'Invoice marked paid.')} loading={busy} fullWidth />
              )}
            </View>
          ) : isProvider && job.status === 'Completed' ? (
            <Button
              label="Generate invoice"
              onPress={() => void run(async () => { await invoiceJob.mutateAsync({ id: id!, commissionRate: COMMISSION_RATE }); await utils.dock.bootstrap.invalidate(); }, 'Invoice generated with platform commission.')}
              loading={busy}
              fullWidth
              icon={<FileText size={16} color={C.white} />}
            />
          ) : (
            <Text style={styles.dim}>{job.status === 'Completed' ? 'The provider will issue an invoice for this job.' : 'An invoice can be issued once the job is completed.'}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  scroll: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12, gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  notes: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginTop: 4 },
  quotePill: { alignSelf: 'flex-start', backgroundColor: C.yellowDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 },
  quotePillText: { fontSize: 11, color: C.yellow, fontWeight: '700' as const },
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputLabel: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  input: { backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  commissionHint: { fontSize: 12, color: C.textMuted },
  commissionSmall: { fontSize: 12, color: C.textMuted },
  dim: { fontSize: 13, color: C.textMuted, lineHeight: 19 },
  quoteAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  quoteAmount: { fontSize: 30, fontWeight: '800' as const, color: C.green },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  acceptedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.greenDim, borderRadius: 10, padding: 12, marginTop: 4 },
  acceptedText: { fontSize: 13, color: C.green, flex: 1 },
  progressBtns: { gap: 10 },
  addPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addPhotoText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  photoRow: { gap: 10, paddingVertical: 4 },
  photoWrap: { width: 120 },
  photo: { width: 120, height: 120, borderRadius: 12, backgroundColor: C.bg },
  photoKind: { fontSize: 11, color: C.textMuted, marginTop: 4, textTransform: 'capitalize' as const },
  invHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  invNumber: { fontSize: 14, fontWeight: '700' as const, color: C.text, flex: 1 },
  invStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  invStatusText: { fontSize: 11, fontWeight: '700' as const },
  invLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  invLineDesc: { fontSize: 13, color: C.textSecondary, flex: 1 },
  invLineAmt: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  invTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  invTotalLabel: { fontSize: 13, color: C.textMuted },
  invTotalVal: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  invGrand: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 8 },
  invGrandLabel: { fontSize: 15, color: C.text, fontWeight: '800' as const },
  invGrandVal: { fontSize: 15, color: C.green, fontWeight: '800' as const },
});
