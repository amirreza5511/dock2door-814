import React, { useMemo, useState } from 'react';
import { Alert, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, FileText, ShieldCheck, Upload, XCircle } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { buildCertPath, getSignedUrl, uploadFileWithMetadata } from '@/lib/storage-files';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import Input from '@/components/ui/Input';
import C from '@/constants/colors';
import {
  CARRIER_DOCS,
  REQUIRED_CARRIER_DOC_COUNT,
  carrierDocKeyFromType,
  carrierDocType,
  isCarrierDocType,
  type CarrierDocKey,
} from '@/constants/carrier-docs';

type DocStatus = 'Pending' | 'Approved' | 'Rejected' | 'Expired';

interface CarrierDocRow {
  id: string;
  type: string;
  status: DocStatus;
  expiry_date: string | null;
  file_path: string | null;
  notes: string | null;
  created_at: string;
}

/** Read a local file URI as a Blob without relying on fetch() (RN-safe). */
async function readLocalFileAsBlob(uri: string, mimeType: string): Promise<Blob> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const byteString = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const buf = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i += 1) buf[i] = byteString.charCodeAt(i);
    return new Blob([buf], { type: mimeType });
  } catch {
    const res = await fetch(uri);
    return await res.blob();
  }
}

const STATUS_META: Record<DocStatus, { color: string; dim: string; label: string; Icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  Approved: { color: C.green, dim: C.greenDim, label: 'Approved', Icon: CheckCircle2 },
  Pending: { color: C.yellow, dim: C.yellowDim, label: 'In review', Icon: Clock },
  Rejected: { color: C.red, dim: C.redDim, label: 'Rejected', Icon: XCircle },
  Expired: { color: C.red, dim: C.redDim, label: 'Expired', Icon: XCircle },
};

export default function DriverDocumentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [uploadingKey, setUploadingKey] = useState<CarrierDocKey | null>(null);
  const [expiryDrafts, setExpiryDrafts] = useState<Record<string, string>>({});

  const docsQuery = useQuery({
    queryKey: ['carrier-docs', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<CarrierDocRow[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('worker_certifications')
        .select('id,type,status,expiry_date,file_path,notes,created_at')
        .eq('worker_user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as CarrierDocRow[]).filter((r) => isCarrierDocType(r.type));
    },
    staleTime: 20_000,
  });

  // Latest row per document key.
  const latestByKey = useMemo(() => {
    const map: Partial<Record<CarrierDocKey, CarrierDocRow>> = {};
    for (const row of docsQuery.data ?? []) {
      const key = carrierDocKeyFromType(row.type);
      if (!key) continue;
      if (!map[key] || row.created_at > (map[key] as CarrierDocRow).created_at) map[key] = row;
    }
    return map;
  }, [docsQuery.data]);

  const approvedRequired = useMemo(
    () => CARRIER_DOCS.filter((d) => d.required && latestByKey[d.key]?.status === 'Approved').length,
    [latestByKey],
  );

  const uploadMutation = useMutation({
    mutationFn: async ({ key, expiry }: { key: CarrierDocKey; expiry: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const spec = CARRIER_DOCS.find((d) => d.key === key);
      if (spec?.hasExpiry && !expiry.trim()) throw new Error('Enter the expiry date (YYYY-MM-DD) first.');

      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/pdf', 'image/*'],
      });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const asset = picked.assets[0];
      const filename = asset.name ?? `${key}-${Date.now()}`;
      const mime = asset.mimeType ?? 'application/octet-stream';
      const docType = carrierDocType(key);

      // Reuse an existing Pending row for this type to avoid duplicates.
      const { data: existingPending } = await supabase
        .from('worker_certifications')
        .select('id')
        .eq('worker_user_id', user.id)
        .eq('type', docType)
        .eq('status', 'Pending')
        .maybeSingle();

      let certId: string;
      if (existingPending) {
        certId = existingPending.id as string;
        await supabase
          .from('worker_certifications')
          .update({ expiry_date: expiry.trim() || null })
          .eq('id', certId);
      } else {
        const { data: row, error: insertErr } = await supabase
          .from('worker_certifications')
          .insert({ worker_user_id: user.id, type: docType, expiry_date: expiry.trim() || null, file_path: '', certificate_file: '', notes: '' })
          .select('id').single();
        if (insertErr || !row) throw new Error(insertErr?.message ?? 'Unable to create document record');
        certId = row.id as string;
      }

      const path = buildCertPath(user.id, certId, filename);
      let body: Blob;
      if (Platform.OS === 'web' && (asset as unknown as { file?: File }).file) {
        body = (asset as unknown as { file: File }).file;
      } else {
        body = await readLocalFileAsBlob(asset.uri, mime);
      }
      try {
        await uploadFileWithMetadata({ bucket: 'certifications', path, file: body, contentType: mime, entityType: 'carrier_document', entityId: certId, companyId: null });
      } catch (err) {
        if (!existingPending) await supabase.from('worker_certifications').delete().eq('id', certId);
        throw err;
      }
      const { error: updateErr } = await supabase
        .from('worker_certifications')
        .update({ file_path: path, certificate_file: path })
        .eq('id', certId);
      if (updateErr) throw new Error(updateErr.message);
      return certId;
    },
    onSuccess: (result, vars) => {
      if (!result) return;
      setExpiryDrafts((p) => ({ ...p, [vars.key]: '' }));
      void queryClient.invalidateQueries({ queryKey: ['carrier-docs', user?.id] });
      Alert.alert('Document submitted', 'Our compliance team will review it shortly. You\u2019ll be notified once it\u2019s approved.');
    },
    onError: (err: unknown) => Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error'),
    onSettled: () => setUploadingKey(null),
  });

  const openFile = async (path: string | null) => {
    if (!path) { Alert.alert('No file attached'); return; }
    try {
      const url = await getSignedUrl('certifications', path, 60);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Unable to open file', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (docsQuery.isLoading) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading your documents" /></View>;
  if (docsQuery.isError) return <View style={[styles.root, styles.centered]}><ScreenFeedback state="error" title="Unable to load documents" onRetry={() => void docsQuery.refetch()} /></View>;

  const allApproved = approvedRequired >= REQUIRED_CARRIER_DOC_COUNT;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={docsQuery.isFetching} onRefresh={() => void docsQuery.refetch()} tintColor={C.accent} />}
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
          <Text style={styles.topTitle}>Carrier Compliance</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={[styles.hero, allApproved && styles.heroDone]}>
          <View style={styles.heroIcon}>
            <ShieldCheck size={26} color={allApproved ? C.green : C.accent} />
          </View>
          <Text style={styles.heroTitle}>{allApproved ? 'You\u2019re road-legal' : 'Verify your authority to haul'}</Text>
          <Text style={styles.heroSub}>
            {approvedRequired} of {REQUIRED_CARRIER_DOC_COUNT} required documents approved.
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round((approvedRequired / REQUIRED_CARRIER_DOC_COUNT) * 100)}%`, backgroundColor: allApproved ? C.green : C.accent }]} />
          </View>
          {!allApproved ? (
            <Text style={styles.heroHint}>Upload each document below. Our team reviews them before you can accept loads.</Text>
          ) : null}
        </View>

        {CARRIER_DOCS.map((spec) => {
          const row = latestByKey[spec.key];
          const status = (row?.status ?? null) as DocStatus | null;
          const meta = status ? STATUS_META[status] : null;
          const busy = uploadingKey === spec.key && uploadMutation.isPending;
          const draft = expiryDrafts[spec.key] ?? '';
          return (
            <View key={spec.key} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardIcon}>{spec.icon}</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{spec.label}</Text>
                    {spec.required ? <Text style={styles.requiredTag}>Required</Text> : <Text style={styles.optionalTag}>Optional</Text>}
                  </View>
                  <Text style={styles.cardDesc}>{spec.desc}</Text>
                </View>
              </View>

              {meta ? (
                <TouchableOpacity
                  onPress={() => void openFile(row?.file_path ?? null)}
                  style={[styles.statusRow, { backgroundColor: meta.dim }]}
                  activeOpacity={0.85}
                >
                  <meta.Icon size={15} color={meta.color} />
                  <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  {row?.expiry_date ? <Text style={styles.expiryText}>Exp {row.expiry_date}</Text> : null}
                  {row?.file_path ? <Text style={styles.viewText}>View</Text> : null}
                </TouchableOpacity>
              ) : null}

              {status === 'Rejected' && row?.notes ? (
                <Text style={styles.rejectNote}>Reason: {row.notes}</Text>
              ) : null}

              {status !== 'Approved' ? (
                <View style={styles.uploadArea}>
                  {spec.hasExpiry ? (
                    <Input
                      label="Expiry date"
                      value={draft}
                      onChangeText={(v) => setExpiryDrafts((p) => ({ ...p, [spec.key]: v }))}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                    />
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      setUploadingKey(spec.key);
                      uploadMutation.mutate({ key: spec.key, expiry: draft });
                    }}
                    disabled={busy}
                    style={[styles.uploadBtn, busy && { opacity: 0.6 }]}
                  >
                    <Upload size={15} color={C.white} />
                    <Text style={styles.uploadBtnText}>
                      {busy ? 'Uploading\u2026' : status ? 'Replace document' : 'Upload document'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.fileHint}>PDF or photo (front & back if applicable).</Text>
                </View>
              ) : (
                <View style={styles.approvedFootRow}>
                  <FileText size={13} color={C.textMuted} />
                  <Text style={styles.approvedFootText}>On file · verified by compliance</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 16, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  hero: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 18, gap: 8 },
  heroDone: { borderColor: C.green + '60', backgroundColor: C.greenDim },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  heroSub: { fontSize: 13, color: C.textSecondary },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: C.bgSecondary, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: 8, borderRadius: 999 },
  heroHint: { fontSize: 12, color: C.textMuted, marginTop: 2, lineHeight: 17 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', gap: 12 },
  cardIcon: { fontSize: 26 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  requiredTag: { fontSize: 9, fontWeight: '800' as const, color: C.accent, backgroundColor: C.accentDim, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  optionalTag: { fontSize: 9, fontWeight: '800' as const, color: C.textMuted, backgroundColor: C.bgSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  cardDesc: { fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 17 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  statusText: { fontSize: 13, fontWeight: '700' as const },
  expiryText: { fontSize: 11, color: C.textMuted, marginLeft: 'auto' as const },
  viewText: { fontSize: 12, fontWeight: '700' as const, color: C.accent },
  rejectNote: { fontSize: 12, color: C.red, lineHeight: 17 },
  uploadArea: { gap: 10 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13 },
  uploadBtnText: { fontSize: 14, fontWeight: '800' as const, color: C.white },
  fileHint: { fontSize: 11, color: C.textMuted, textAlign: 'center' as const },
  approvedFootRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  approvedFootText: { fontSize: 12, color: C.textMuted },
});
