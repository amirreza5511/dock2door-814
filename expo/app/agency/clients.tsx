import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, X, Building2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface AgencyClientRow {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  status: 'Active' | 'Inactive';
  created_at: string;
}

export default function AgencyClients() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const clientsQuery = trpc.agency.clients.useQuery();
  const addMutation = trpc.agency.addClient.useMutation({
    onSuccess: async () => { await utils.agency.clients.invalidate(); },
  });
  const statusMutation = trpc.agency.setClientStatus.useMutation({
    onSuccess: async () => { await utils.agency.clients.invalidate(); },
  });

  const clients = useMemo(() => (clientsQuery.data as AgencyClientRow[] | undefined) ?? [], [clientsQuery.data]);

  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Client name is required'); return; }
    try {
      await addMutation.mutateAsync({
        name: name.trim(), contactName: contact.trim(), email: email.trim(),
        phone: phone.trim(), notes: notes.trim(),
      });
      setModal(false);
      setName(''); setContact(''); setEmail(''); setPhone(''); setNotes('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to add client');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Your clients</Text>
        <SupportMenu />
      </View>

      {clientsQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading clients" /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          <Text style={styles.hint}>
            Keep your own customer book here — the businesses you staff. Use it alongside Dock2Door booking,
            pricing and invoicing to coordinate everything in one place.
          </Text>
          {clients.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No clients yet</Text>
              <Text style={styles.emptyMsg}>Tap “Add client” to save your first customer.</Text>
            </Card>
          ) : (
            clients.map((c) => (
              <Card key={c.id} style={styles.clientCard}>
                <View style={[styles.avatar, { backgroundColor: c.status === 'Active' ? C.blueDim : C.bgSecondary }]}>
                  <Building2 size={17} color={c.status === 'Active' ? C.blue : C.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{c.name}</Text>
                  {c.contact_name ? <Text style={styles.clientSub}>{c.contact_name}{c.phone ? ` · ${c.phone}` : ''}</Text> : null}
                  {c.email ? <Text style={styles.clientSub}>{c.email}</Text> : null}
                  {c.notes ? <Text style={styles.clientNotes} numberOfLines={2}>{c.notes}</Text> : null}
                </View>
                <TouchableOpacity
                  onPress={() => statusMutation.mutate({ id: c.id, status: c.status === 'Active' ? 'Inactive' : 'Active' })}
                  style={[styles.statusBtn, { backgroundColor: c.status === 'Active' ? C.greenDim : C.bgSecondary }]}
                >
                  <Text style={[styles.statusBtnText, { color: c.status === 'Active' ? C.green : C.textMuted }]}>{c.status}</Text>
                </TouchableOpacity>
              </Card>
            ))
          )}
        </ScrollView>
      )}

      <TouchableOpacity onPress={() => setModal(true)} style={[styles.fab, { bottom: insets.bottom + 84 }]} activeOpacity={0.85} testID="add-client-fab">
        <Plus size={20} color={C.white} />
        <Text style={styles.fabText}>Add client</Text>
      </TouchableOpacity>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Add client</Text>
              <TouchableOpacity onPress={() => setModal(false)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <Input label="Company name" value={name} onChangeText={setName} placeholder="e.g. FreshMart Distribution" testID="input-client-name" />
            <Input label="Contact person (optional)" value={contact} onChangeText={setContact} placeholder="e.g. Sarah Chen" />
            <Input label="Email (optional)" value={email} onChangeText={setEmail} placeholder="ops@client.com" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+1 604 ..." keyboardType="phone-pad" />
            <Input label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Rates, preferences, sites..." multiline numberOfLines={3} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Save client" onPress={submit} loading={addMutation.isPending} fullWidth />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16 },
  hint: { fontSize: 12, color: C.textSecondary, lineHeight: 18, marginBottom: 12 },
  emptyCard: { padding: 20, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const },
  clientCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  clientName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  clientSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  clientNotes: { fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 15 },
  statusBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusBtnText: { fontSize: 11, fontWeight: '700' as const },
  fab: {
    position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 26, paddingHorizontal: 18, paddingVertical: 13,
  },
  fabText: { color: C.white, fontSize: 14, fontWeight: '700' as const },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  error: { fontSize: 12, color: C.red },
});
