import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, X, UserCheck, MailQuestion, Trash2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface AgencyWorkerRow {
  id: string;
  worker_user_id: string | null;
  name: string;
  email: string;
  phone: string;
  hourly_cost: number;
  status: 'Invited' | 'Active' | 'Removed';
  created_at: string;
}

export default function AgencyWorkers() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const workersQuery = trpc.agency.workers.useQuery();
  const addMutation = trpc.agency.addWorker.useMutation({
    onSuccess: async () => { await utils.agency.workers.invalidate(); },
  });
  const statusMutation = trpc.agency.setWorkerStatus.useMutation({
    onSuccess: async () => { await utils.agency.workers.invalidate(); },
  });

  const workers = useMemo(() => (workersQuery.data as AgencyWorkerRow[] | undefined) ?? [], [workersQuery.data]);

  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Worker name is required'); return; }
    try {
      await addMutation.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        hourlyCost: rate.trim() ? Number(rate) : 0,
      });
      setModal(false);
      setName(''); setEmail(''); setPhone(''); setRate('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to add worker');
    }
  };

  const remove = (w: AgencyWorkerRow) => {
    Alert.alert('Remove worker', `Remove ${w.name} from your roster?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => statusMutation.mutate({ id: w.id, status: 'Removed' }) },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Worker roster</Text>
        <SupportMenu />
      </View>

      {workersQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading roster" /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          <Text style={styles.hint}>
            Add your own workers. If they sign up on Dock2Door as a Worker with the same email, they link
            automatically and you can book shifts for them.
          </Text>
          {workers.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No workers yet</Text>
              <Text style={styles.emptyMsg}>Tap “Add worker” to build your roster.</Text>
            </Card>
          ) : (
            workers.map((w) => {
              const linked = !!w.worker_user_id && w.status === 'Active';
              return (
                <Card key={w.id} style={styles.workerCard}>
                  <View style={[styles.avatar, { backgroundColor: linked ? C.greenDim : C.yellowDim }]}>
                    {linked ? <UserCheck size={17} color={C.green} /> : <MailQuestion size={17} color={C.yellow} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.workerName}>{w.name}</Text>
                    {w.email ? <Text style={styles.workerSub}>{w.email}</Text> : null}
                    <View style={styles.badgeRow}>
                      <View style={[styles.badge, { backgroundColor: linked ? C.greenDim : C.yellowDim }]}>
                        <Text style={[styles.badgeText, { color: linked ? C.green : C.yellow }]}>
                          {linked ? 'Linked account' : 'Invited — no account yet'}
                        </Text>
                      </View>
                      {Number(w.hourly_cost) > 0 ? (
                        <Text style={styles.rateText}>You pay ${Number(w.hourly_cost).toFixed(2)}/h</Text>
                      ) : null}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => remove(w)} style={styles.removeBtn} testID={`remove-worker-${w.id}`}>
                    <Trash2 size={16} color={C.red} />
                  </TouchableOpacity>
                </Card>
              );
            })
          )}
        </ScrollView>
      )}

      <TouchableOpacity onPress={() => setModal(true)} style={[styles.fab, { bottom: insets.bottom + 84 }]} activeOpacity={0.85} testID="add-worker-fab">
        <Plus size={20} color={C.white} />
        <Text style={styles.fabText}>Add worker</Text>
      </TouchableOpacity>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Add worker</Text>
              <TouchableOpacity onPress={() => setModal(false)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <Input label="Full name" value={name} onChangeText={setName} placeholder="e.g. Marcus Lee" testID="input-worker-name" />
            <Input label="Email (links their Dock2Door account)" value={email} onChangeText={setEmail} placeholder="worker@email.com" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+1 604 ..." keyboardType="phone-pad" />
            <Input label="Your pay rate to them ($/h, optional)" value={rate} onChangeText={setRate} placeholder="e.g. 22" keyboardType="numeric" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Add to roster" onPress={submit} loading={addMutation.isPending} fullWidth />
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
  workerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  workerName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  workerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700' as const },
  rateText: { fontSize: 11, color: C.textMuted },
  removeBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
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
