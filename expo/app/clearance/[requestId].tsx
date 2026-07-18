import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { ArrowLeft, FileText, Send, Eye, Upload, BadgeDollarSign, FilePlus2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { buildClearanceDocPath, getSignedUrl, pickAndUploadFromUri } from '@/lib/storage-files';

interface RequestRow {
  id: string;
  title: string;
  mode: string;
  container_no: string;
  bl_number: string;
  port_of_entry: string;
  eta: string | null;
  cargo_description: string;
  commercial_value: number;
  currency: string;
  notes: string;
  status: string;
  quote_amount: number;
  quote_note: string;
  entry_number: string;
  reject_reason: string;
  broker_company_id: string | null;
}

interface DocRow {
  id: string;
  name: string;
  doc_type: string;
  file_path: string;
  status: 'Requested' | 'Uploaded' | 'Accepted' | 'Rejected';
  note: string;
}

interface MessageRow {
  id: string;
  sender_user_id: string | null;
  sender_name: string;
  body: string;
  created_at: string;
}

const STATUS_TINT: Record<string, string> = {
  Submitted: C.yellow, Quoted: C.blue, InProgress: C.accent,
  DocsRequired: C.yellow, Cleared: C.green, Rejected: C.red, Cancelled: C.textMuted,
};
const DOC_TINT: Record<string, string> = {
  Requested: C.yellow, Uploaded: C.blue, Accepted: C.green, Rejected: C.red,
};

/** Customer-side clearance request detail — shared across all requester roles. */
export default function ClearanceDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const id = typeof requestId === 'string' ? requestId : '';
  const utils = trpc.useUtils();

  const requestQuery = trpc.clearance.get.useQuery({ requestId: id }, { enabled: !!id, refetchInterval: 15000 });
  const docsQuery = trpc.clearance.documents.useQuery({ requestId: id }, { enabled: !!id, refetchInterval: 15000 });
  const messagesQuery = trpc.clearance.messages.useQuery({ requestId: id }, { enabled: !!id, refetchInterval: 5000 });

  const invalidateAll = async () => {
    await Promise.all([
      utils.clearance.get.invalidate({ requestId: id }),
      utils.clearance.documents.invalidate({ requestId: id }),
      utils.clearance.mine.invalidate(),
    ]);
  };

  const acceptMutation = trpc.clearance.acceptQuote.useMutation({ onSuccess: invalidateAll });
  const cancelMutation = trpc.clearance.cancel.useMutation({ onSuccess: invalidateAll });
  const submitDocMutation = trpc.clearance.submitDocument.useMutation({ onSuccess: invalidateAll });
  const sendMutation = trpc.clearance.sendMessage.useMutation({
    onSuccess: () => utils.clearance.messages.invalidate({ requestId: id }),
  });

  const request = requestQuery.data as RequestRow | null | undefined;
  const docs = useMemo(() => (docsQuery.data as DocRow[] | undefined) ?? [], [docsQuery.data]);
  const messages = useMemo(() => (messagesQuery.data as MessageRow[] | undefined) ?? [], [messagesQuery.data]);

  const [message, setMessage] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  if (!request) {
    return (
      <View style={[styles.root, styles.center]}>
        <ScreenFeedback state={requestQuery.isLoading ? 'loading' : 'error'} title={requestQuery.isLoading ? 'Loading request' : 'Request not found'} />
      </View>
    );
  }

  const tint = STATUS_TINT[request.status] ?? C.textMuted;
  const closed = ['Cleared', 'Rejected', 'Cancelled'].includes(request.status);

  /** Pick a file and upload it, optionally fulfilling a broker-requested doc slot. */
  const uploadDoc = async (slot?: DocRow) => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/pdf', 'image/*'],
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const filename = asset.name ?? `document-${Date.now()}`;
      const mime = asset.mimeType ?? 'application/octet-stream';
      setUploadingId(slot?.id ?? 'new');

      const path = buildClearanceDocPath(id, user?.id ?? 'user', filename);
      await pickAndUploadFromUri({
        uri: asset.uri,
        bucket: 'clearance-docs',
        path,
        contentType: mime,
        entityType: 'clearance_document',
        entityId: id,
        companyId: user?.companyId ?? null,
      });
      await submitDocMutation.mutateAsync({
        requestId: id,
        filePath: path,
        name: slot?.name ?? filename,
        docType: slot?.doc_type ?? 'Other',
        documentId: slot?.id,
      });
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again');
    } finally {
      setUploadingId(null);
    }
  };

  const viewDoc = async (doc: DocRow) => {
    if (!doc.file_path) return;
    try {
      const url = await getSignedUrl('clearance-docs', doc.file_path, 300);
      await Linking.openURL(url);
    } catch (e) { Alert.alert('Unable to open document', e instanceof Error ? e.message : 'Try again'); }
  };

  const acceptQuote = () => {
    Alert.alert('Accept quote?', `Your broker's fee is $${Number(request.quote_amount).toFixed(2)}. Clearance work starts right after you accept.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Accept quote',
        onPress: async () => {
          try { await acceptMutation.mutateAsync({ requestId: id }); }
          catch (e) { Alert.alert('Unable to accept', e instanceof Error ? e.message : 'Try again'); }
        },
      },
    ]);
  };

  const cancel = () => {
    Alert.alert('Cancel this request?', 'Your broker will be notified.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel request', style: 'destructive',
        onPress: async () => {
          try { await cancelMutation.mutateAsync({ requestId: id }); }
          catch (e) { Alert.alert('Unable to cancel', e instanceof Error ? e.message : 'Try again'); }
        },
      },
    ]);
  };

  const sendMsg = async () => {
    if (!message.trim()) return;
    const body = message.trim();
    setMessage('');
    try { await sendMutation.mutateAsync({ requestId: id, body }); }
    catch (e) { Alert.alert('Unable to send', e instanceof Error ? e.message : 'Try again'); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{request.title}</Text>
          <Text style={styles.subtitle}>{request.mode} clearance</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: tint + '22' }]}>
          <Text style={[styles.statusPillText, { color: tint }]}>{request.status}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]} showsVerticalScrollIndicator={false}>
        {/* Quote banner */}
        {request.status === 'Quoted' && request.quote_amount > 0 ? (
          <Card style={[styles.card, styles.quoteCard]}>
            <View style={styles.cardHead}>
              <BadgeDollarSign size={16} color={C.green} />
              <Text style={styles.cardTitle}>Quote received</Text>
            </View>
            <Text style={styles.quoteAmount}>${Number(request.quote_amount).toFixed(2)} {request.currency}</Text>
            {request.quote_note ? <Text style={styles.quoteNote}>{request.quote_note}</Text> : null}
            <Button label="Accept quote & start clearance" onPress={acceptQuote} loading={acceptMutation.isPending} fullWidth />
          </Card>
        ) : null}

        {request.status === 'Cleared' ? (
          <Card style={[styles.card, styles.clearedCard]}>
            <Text style={styles.clearedTitle}>✓ Shipment cleared customs</Text>
            {request.entry_number ? <Text style={styles.clearedSub}>Entry number: {request.entry_number}</Text> : null}
            <Text style={styles.clearedSub}>The brokerage invoice was issued to your company.</Text>
          </Card>
        ) : null}

        {request.status === 'Rejected' && request.reject_reason ? (
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: C.red }]}>Declined by broker</Text>
            <Text style={styles.infoValue}>{request.reject_reason}</Text>
          </Card>
        ) : null}

        {/* Shipment details */}
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Shipment</Text>
          {[
            ['Container', request.container_no],
            ['BL number', request.bl_number],
            ['Port', request.port_of_entry],
            ['ETA', request.eta ?? ''],
            ['Value', request.commercial_value > 0 ? `$${Number(request.commercial_value).toLocaleString()} ${request.currency}` : ''],
            ['Cargo', request.cargo_description],
            ['Notes', request.notes],
          ].filter(([, v]) => !!v).map(([k, v]) => (
            <View key={k} style={styles.infoRow}>
              <Text style={styles.infoKey}>{k}</Text>
              <Text style={styles.infoValue}>{v}</Text>
            </View>
          ))}
        </Card>

        {/* Documents */}
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <FileText size={16} color={C.accent} />
            <Text style={styles.cardTitle}>Documents</Text>
            {!closed ? (
              <TouchableOpacity onPress={() => void uploadDoc()} style={styles.smallBtn} disabled={uploadingId !== null}>
                <FilePlus2 size={14} color={C.accent} />
                <Text style={styles.smallBtnText}>{uploadingId === 'new' ? 'Uploading…' : 'Add document'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {docs.length === 0 ? (
            <Text style={styles.emptyText}>
              No documents yet. Your broker will request what they need — or add your commercial
              invoice, packing list and BL now to speed things up.
            </Text>
          ) : (
            docs.map((d) => {
              const dTint = DOC_TINT[d.status] ?? C.textMuted;
              const needsUpload = d.status === 'Requested' || d.status === 'Rejected';
              return (
                <View key={d.id} style={styles.docRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docName}>{d.name}</Text>
                    {d.note ? <Text style={styles.docNote}>{d.note}</Text> : null}
                  </View>
                  <View style={[styles.docPill, { backgroundColor: dTint + '22' }]}>
                    <Text style={[styles.docPillText, { color: dTint }]}>{d.status}</Text>
                  </View>
                  {d.file_path ? (
                    <TouchableOpacity onPress={() => void viewDoc(d)} style={styles.docAction}>
                      <Eye size={16} color={C.blue} />
                    </TouchableOpacity>
                  ) : null}
                  {needsUpload && !closed ? (
                    <TouchableOpacity onPress={() => void uploadDoc(d)} style={[styles.docAction, { backgroundColor: C.accentDim }]} disabled={uploadingId !== null}>
                      <Upload size={16} color={C.accent} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>

        {/* Messages */}
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Messages</Text>
          {messages.length === 0 ? (
            <Text style={styles.emptyText}>No messages yet. Talk to your broker here — everything stays on-platform.</Text>
          ) : (
            messages.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <Text style={styles.msgSender}>{m.sender_name || 'User'}</Text>
                <Text style={styles.msgBody}>{m.body}</Text>
              </View>
            ))
          )}
        </Card>

        {!closed ? (
          <TouchableOpacity onPress={cancel} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel this request</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* Message input */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={styles.msgInput}
          placeholder="Message your broker…"
          placeholderTextColor={C.textMuted}
          value={message}
          onChangeText={setMessage}
        />
        <TouchableOpacity onPress={() => void sendMsg()} style={styles.sendBtn} disabled={sendMutation.isPending}>
          <Send size={18} color={C.bg} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  scroll: { paddingHorizontal: 16 },
  card: { padding: 14, marginBottom: 12, gap: 8 },
  quoteCard: { borderColor: C.green, borderWidth: 1 },
  quoteAmount: { fontSize: 24, fontWeight: '800' as const, color: C.green, letterSpacing: -0.5 },
  quoteNote: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  clearedCard: { borderColor: C.green, borderWidth: 1 },
  clearedTitle: { fontSize: 15, fontWeight: '800' as const, color: C.green },
  clearedSub: { fontSize: 12, color: C.textSecondary },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, flex: 1 },
  infoRow: { flexDirection: 'row', gap: 10 },
  infoKey: { width: 90, fontSize: 12, color: C.textMuted },
  infoValue: { flex: 1, fontSize: 12, color: C.text },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.accentDim },
  smallBtnText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  emptyText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  docName: { fontSize: 13, fontWeight: '600' as const, color: C.text },
  docNote: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  docPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  docPillText: { fontSize: 10, fontWeight: '700' as const },
  docAction: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  msgRow: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, gap: 2 },
  msgSender: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  msgBody: { fontSize: 13, color: C.text, lineHeight: 18 },
  cancelBtn: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  cancelText: { fontSize: 12, fontWeight: '600' as const, color: C.red },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 8,
    backgroundColor: C.bgSecondary, borderTopWidth: 1, borderTopColor: C.border,
  },
  msgInput: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10, color: C.text, fontSize: 13,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
});
