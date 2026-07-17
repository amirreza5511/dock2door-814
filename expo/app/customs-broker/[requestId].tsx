import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft, FileText, Send, CheckCircle2, XCircle, Eye, FilePlus2, Landmark, BadgeDollarSign,
} from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { getSignedUrl } from '@/lib/storage-files';

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
  incoterms: string;
  notes: string;
  status: string;
  quote_amount: number;
  quote_note: string;
  entry_number: string;
  broker_company_id: string | null;
  reject_reason: string;
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

export default function BrokerRequestDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
      utils.broker.requests.invalidate(),
    ]);
  };

  const quoteMutation = trpc.broker.quote.useMutation({ onSuccess: invalidateAll });
  const requestDocMutation = trpc.broker.requestDocument.useMutation({ onSuccess: invalidateAll });
  const docStatusMutation = trpc.broker.setDocumentStatus.useMutation({ onSuccess: invalidateAll });
  const clearedMutation = trpc.broker.markCleared.useMutation({ onSuccess: invalidateAll });
  const rejectMutation = trpc.broker.reject.useMutation({ onSuccess: invalidateAll });
  const sendMutation = trpc.clearance.sendMessage.useMutation({
    onSuccess: () => utils.clearance.messages.invalidate({ requestId: id }),
  });

  const request = requestQuery.data as RequestRow | null | undefined;
  const docs = useMemo(() => (docsQuery.data as DocRow[] | undefined) ?? [], [docsQuery.data]);
  const messages = useMemo(() => (messagesQuery.data as MessageRow[] | undefined) ?? [], [messagesQuery.data]);

  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [docName, setDocName] = useState('');
  const [docNote, setDocNote] = useState('');
  const [showDocForm, setShowDocForm] = useState(false);
  const [entryNumber, setEntryNumber] = useState('');
  const [message, setMessage] = useState('');

  if (!request) {
    return (
      <View style={[styles.root, styles.center]}>
        <ScreenFeedback state={requestQuery.isLoading ? 'loading' : 'error'} title={requestQuery.isLoading ? 'Loading request' : 'Request not found'} />
      </View>
    );
  }

  const tint = STATUS_TINT[request.status] ?? C.textMuted;
  const closed = ['Cleared', 'Rejected', 'Cancelled'].includes(request.status);
  const canQuote = !closed;
  const canClear = ['InProgress', 'DocsRequired', 'Quoted'].includes(request.status) && request.quote_amount > 0;

  const sendQuote = async () => {
    const amount = Number(quoteAmount);
    if (!Number.isFinite(amount) || amount <= 0) { Alert.alert('Enter a valid quote amount'); return; }
    try {
      await quoteMutation.mutateAsync({ requestId: id, amount, note: quoteNote.trim() });
      setQuoteAmount(''); setQuoteNote('');
    } catch (e) { Alert.alert('Unable to quote', e instanceof Error ? e.message : 'Try again'); }
  };

  const requestDoc = async () => {
    if (!docName.trim()) { Alert.alert('Enter the document name'); return; }
    try {
      await requestDocMutation.mutateAsync({ requestId: id, name: docName.trim(), note: docNote.trim() });
      setDocName(''); setDocNote(''); setShowDocForm(false);
    } catch (e) { Alert.alert('Unable to request document', e instanceof Error ? e.message : 'Try again'); }
  };

  const viewDoc = async (doc: DocRow) => {
    if (!doc.file_path) return;
    try {
      const url = await getSignedUrl('clearance-docs', doc.file_path, 300);
      await Linking.openURL(url);
    } catch (e) { Alert.alert('Unable to open document', e instanceof Error ? e.message : 'Try again'); }
  };

  const markCleared = () => {
    Alert.alert('Mark cleared?', `An invoice for $${Number(request.quote_amount).toFixed(2)} will be issued to the customer.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm cleared',
        onPress: async () => {
          try {
            await clearedMutation.mutateAsync({ requestId: id, entryNumber: entryNumber.trim() });
            Alert.alert('Cleared', 'The shipment was marked cleared and the invoice was issued.');
          } catch (e) { Alert.alert('Unable to clear', e instanceof Error ? e.message : 'Try again'); }
        },
      },
    ]);
  };

  const decline = () => {
    Alert.alert('Decline this request?', 'The customer will be notified.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive',
        onPress: async () => {
          try { await rejectMutation.mutateAsync({ requestId: id }); }
          catch (e) { Alert.alert('Unable to decline', e instanceof Error ? e.message : 'Try again'); }
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
        {/* Shipment details */}
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Shipment</Text>
          {[
            ['Container', request.container_no],
            ['BL number', request.bl_number],
            ['Port', request.port_of_entry],
            ['ETA', request.eta ?? ''],
            ['Incoterms', request.incoterms],
            ['Value', request.commercial_value > 0 ? `$${Number(request.commercial_value).toLocaleString()} ${request.currency}` : ''],
            ['Cargo', request.cargo_description],
            ['Notes', request.notes],
            ['Entry #', request.entry_number],
          ].filter(([, v]) => !!v).map(([k, v]) => (
            <View key={k} style={styles.infoRow}>
              <Text style={styles.infoKey}>{k}</Text>
              <Text style={styles.infoValue}>{v}</Text>
            </View>
          ))}
        </Card>

        {/* Quote */}
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <BadgeDollarSign size={16} color={C.green} />
            <Text style={styles.cardTitle}>Brokerage fee</Text>
          </View>
          {request.quote_amount > 0 ? (
            <Text style={styles.quoteCurrent}>
              Current quote: <Text style={{ color: C.green, fontWeight: '800' as const }}>${Number(request.quote_amount).toFixed(2)}</Text>
              {request.status === 'Quoted' ? ' — waiting for customer approval' : ''}
            </Text>
          ) : (
            <Text style={styles.quoteCurrent}>No quote sent yet.</Text>
          )}
          {canQuote ? (
            <View style={{ gap: 8 }}>
              <TextInput
                style={styles.input}
                placeholder="Quote amount (e.g. 350)"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
                value={quoteAmount}
                onChangeText={setQuoteAmount}
              />
              <TextInput
                style={styles.input}
                placeholder="Note to customer (optional)"
                placeholderTextColor={C.textMuted}
                value={quoteNote}
                onChangeText={setQuoteNote}
              />
              <Button
                label={request.quote_amount > 0 ? 'Update quote' : 'Send quote'}
                onPress={sendQuote}
                loading={quoteMutation.isPending}
                fullWidth
                size="sm"
              />
            </View>
          ) : null}
        </Card>

        {/* Documents */}
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <FileText size={16} color={C.accent} />
            <Text style={styles.cardTitle}>Documents</Text>
            {!closed ? (
              <TouchableOpacity onPress={() => setShowDocForm((v) => !v)} style={styles.smallBtn}>
                <FilePlus2 size={14} color={C.accent} />
                <Text style={styles.smallBtnText}>Request doc</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {showDocForm ? (
            <View style={{ gap: 8, marginBottom: 6 }}>
              <TextInput
                style={styles.input}
                placeholder="Document name (e.g. Commercial Invoice)"
                placeholderTextColor={C.textMuted}
                value={docName}
                onChangeText={setDocName}
              />
              <TextInput
                style={styles.input}
                placeholder="Note (optional)"
                placeholderTextColor={C.textMuted}
                value={docNote}
                onChangeText={setDocNote}
              />
              <Button label="Ask customer for this document" onPress={requestDoc} loading={requestDocMutation.isPending} fullWidth size="sm" />
            </View>
          ) : null}
          {docs.length === 0 ? (
            <Text style={styles.emptyText}>No documents yet. Request what you need — the customer uploads it here.</Text>
          ) : (
            docs.map((d) => {
              const dTint = DOC_TINT[d.status] ?? C.textMuted;
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
                  {d.status === 'Uploaded' && !closed ? (
                    <>
                      <TouchableOpacity
                        onPress={() => docStatusMutation.mutate({ documentId: d.id, status: 'Accepted' })}
                        style={styles.docAction}
                      >
                        <CheckCircle2 size={16} color={C.green} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => docStatusMutation.mutate({ documentId: d.id, status: 'Rejected', note: 'Please re-upload a valid copy' })}
                        style={styles.docAction}
                      >
                        <XCircle size={16} color={C.red} />
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>

        {/* Clear / decline */}
        {!closed ? (
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Landmark size={16} color={C.green} />
              <Text style={styles.cardTitle}>Finish clearance</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Customs entry number (optional)"
              placeholderTextColor={C.textMuted}
              value={entryNumber}
              onChangeText={setEntryNumber}
            />
            <Button
              label="Mark cleared & issue invoice"
              onPress={markCleared}
              loading={clearedMutation.isPending}
              disabled={!canClear}
              fullWidth
            />
            {!canClear ? <Text style={styles.hint}>Send a quote first — the invoice is based on your brokerage fee.</Text> : null}
            <TouchableOpacity onPress={decline} style={styles.declineBtn}>
              <Text style={styles.declineText}>Decline this request</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {/* Messages */}
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Messages</Text>
          {messages.length === 0 ? (
            <Text style={styles.emptyText}>No messages yet. Everything you and the customer discuss stays on-platform.</Text>
          ) : (
            messages.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <Text style={styles.msgSender}>{m.sender_name || 'User'}</Text>
                <Text style={styles.msgBody}>{m.body}</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      {/* Message input */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={styles.msgInput}
          placeholder="Message the customer…"
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
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, flex: 1 },
  infoRow: { flexDirection: 'row', gap: 10 },
  infoKey: { width: 90, fontSize: 12, color: C.textMuted },
  infoValue: { flex: 1, fontSize: 12, color: C.text },
  quoteCurrent: { fontSize: 13, color: C.textSecondary },
  input: {
    backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 13,
  },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.accentDim },
  smallBtnText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  emptyText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  docName: { fontSize: 13, fontWeight: '600' as const, color: C.text },
  docNote: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  docPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  docPillText: { fontSize: 10, fontWeight: '700' as const },
  docAction: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, color: C.textMuted },
  declineBtn: { alignItems: 'center', paddingVertical: 8 },
  declineText: { fontSize: 12, fontWeight: '600' as const, color: C.red },
  msgRow: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, gap: 2 },
  msgSender: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  msgBody: { fontSize: 13, color: C.text, lineHeight: 18 },
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
