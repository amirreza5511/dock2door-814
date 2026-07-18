import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, X, Anchor, CalendarDays, Landmark } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface MyRequestRow {
  id: string;
  title: string;
  mode: string;
  container_no: string;
  bl_number: string;
  port_of_entry: string;
  eta: string | null;
  status: string;
  quote_amount: number;
  broker_name: string;
  created_at: string;
}

const STATUS_TINT: Record<string, string> = {
  Submitted: C.yellow, Quoted: C.blue, InProgress: C.accent,
  DocsRequired: C.yellow, Cleared: C.green, Rejected: C.red, Cancelled: C.textMuted,
};

/**
 * Shared customer-side clearance screen — reachable by every business role and
 * guests. Lists the company's clearance requests and lets them submit new ones.
 */
export default function ClearanceRequests() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const mineQuery = trpc.clearance.mine.useQuery(undefined, { refetchInterval: 20000 });
  const createMutation = trpc.clearance.create.useMutation({
    onSuccess: async () => {
      await utils.clearance.mine.invalidate();
    },
  });

  const rows = useMemo(() => (mineQuery.data as MyRequestRow[] | undefined) ?? [], [mineQuery.data]);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'Import' | 'Export'>('Import');
  const [containerNo, setContainerNo] = useState('');
  const [blNumber, setBlNumber] = useState('');
  const [port, setPort] = useState('');
  const [eta, setEta] = useState('');
  const [value, setValue] = useState('');
  const [cargo, setCargo] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const resetForm = () => {
    setTitle(''); setMode('Import'); setContainerNo(''); setBlNumber('');
    setPort(''); setEta(''); setValue(''); setCargo(''); setNotes(''); setFormError('');
  };

  const submit = async () => {
    if (!title.trim()) { setFormError('Give this shipment a short title'); return; }
    if (eta.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(eta.trim())) {
      setFormError('ETA must be in YYYY-MM-DD format'); return;
    }
    setFormError('');
    try {
      await createMutation.mutateAsync({
        title: title.trim(),
        mode,
        containerNo: containerNo.trim(),
        blNumber: blNumber.trim(),
        port: port.trim(),
        eta: eta.trim() || undefined,
        cargoDescription: cargo.trim(),
        commercialValue: Number(value) || 0,
        notes: notes.trim(),
      });
      setShowForm(false);
      resetForm();
      Alert.alert('Request submitted', 'Customs brokers on Dock2Door were notified. You will get a quote soon.');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unable to submit request');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Customs clearance</Text>
          <Text style={styles.subtitle}>Send documents & clear shipments with a licensed broker</Text>
        </View>
        <SupportMenu />
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {mineQuery.isLoading ? (
          <View style={styles.centerPad}><ScreenFeedback state="loading" title="Loading requests" /></View>
        ) : rows.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Landmark size={22} color={C.accent} />
            <Text style={styles.emptyTitle}>No clearance requests yet</Text>
            <Text style={styles.emptyMsg}>
              Submit your shipment details and a customs broker will quote, request documents,
              and clear it — all inside Dock2Door.
            </Text>
          </Card>
        ) : (
          rows.map((r) => {
            const tint = STATUS_TINT[r.status] ?? C.textMuted;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={() => router.push({ pathname: '/clearance/[requestId]', params: { requestId: r.id } })}
              >
                <Card style={styles.reqCard}>
                  <View style={styles.reqTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reqTitle}>{r.title}</Text>
                      <View style={styles.metaRow}>
                        <Anchor size={12} color={C.textMuted} />
                        <Text style={styles.metaText}>
                          {r.mode}{r.container_no ? ` · ${r.container_no}` : ''}{r.port_of_entry ? ` · ${r.port_of_entry}` : ''}
                        </Text>
                      </View>
                      {r.eta ? (
                        <View style={styles.metaRow}>
                          <CalendarDays size={12} color={C.textMuted} />
                          <Text style={styles.metaText}>ETA {r.eta}</Text>
                        </View>
                      ) : null}
                      {r.broker_name ? <Text style={styles.brokerText}>Broker: {r.broker_name}</Text> : null}
                      {r.status === 'Quoted' && r.quote_amount > 0 ? (
                        <Text style={styles.quoteText}>Quote received: ${Number(r.quote_amount).toFixed(2)} — tap to review</Text>
                      ) : null}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: tint + '22' }]}>
                      <Text style={[styles.statusPillText, { color: tint }]}>{r.status}</Text>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={() => setShowForm(true)}>
        <Plus size={22} color={C.bg} />
        <Text style={styles.fabText}>New request</Text>
      </TouchableOpacity>

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Request customs clearance</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 10 }}>
                <TextInput style={styles.input} placeholder="Shipment title (e.g. Electronics from Shanghai) *" placeholderTextColor={C.textMuted} value={title} onChangeText={setTitle} />
                <View style={styles.modeRow}>
                  {(['Import', 'Export'] as const).map((m) => (
                    <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeBtn, mode === m && styles.modeBtnActive]}>
                      <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={styles.input} placeholder="Container number" placeholderTextColor={C.textMuted} value={containerNo} onChangeText={setContainerNo} autoCapitalize="characters" />
                <TextInput style={styles.input} placeholder="Bill of Lading number" placeholderTextColor={C.textMuted} value={blNumber} onChangeText={setBlNumber} autoCapitalize="characters" />
                <TextInput style={styles.input} placeholder="Port of entry (e.g. Vancouver)" placeholderTextColor={C.textMuted} value={port} onChangeText={setPort} />
                <TextInput style={styles.input} placeholder="ETA (YYYY-MM-DD)" placeholderTextColor={C.textMuted} value={eta} onChangeText={setEta} />
                <TextInput style={styles.input} placeholder="Commercial value (CAD)" placeholderTextColor={C.textMuted} keyboardType="decimal-pad" value={value} onChangeText={setValue} />
                <TextInput style={[styles.input, styles.multiline]} placeholder="Cargo description" placeholderTextColor={C.textMuted} value={cargo} onChangeText={setCargo} multiline />
                <TextInput style={[styles.input, styles.multiline]} placeholder="Notes for the broker (optional)" placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline />
              </View>
            </ScrollView>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <Button label="Submit to customs brokers" onPress={submit} loading={createMutation.isPending} fullWidth />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  list: { paddingHorizontal: 16 },
  centerPad: { paddingTop: 60, alignItems: 'center' },
  emptyCard: { padding: 20, alignItems: 'center', gap: 8, marginTop: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  reqCard: { padding: 14, marginBottom: 10 },
  reqTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reqTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { fontSize: 12, color: C.textSecondary },
  brokerText: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginTop: 4 },
  quoteText: { fontSize: 12, color: C.green, fontWeight: '700' as const, marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  fab: {
    position: 'absolute', right: 20, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.accent, borderRadius: 26, paddingHorizontal: 18, paddingVertical: 14,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { fontSize: 14, fontWeight: '700' as const, color: C.bg },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, color: C.text, fontSize: 13,
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' as const },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  modeBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  modeText: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary },
  modeTextActive: { color: C.accent },
  error: { fontSize: 12, color: C.red },
});
