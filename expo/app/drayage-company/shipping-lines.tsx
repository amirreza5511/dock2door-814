import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Ship, Plus, X, Globe, Building2 } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function DrayageShippingLinesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const linesQuery = trpc.drayage.listShippingLines.useQuery();
  const addMutation = trpc.drayage.addShippingLine.useMutation({
    onSuccess: async () => { await utils.drayage.listShippingLines.invalidate(); setModal(false); setName(''); setScac(''); },
  });

  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [scac, setScac] = useState('');

  const lines = (linesQuery.data ?? []) as any[];
  const custom = lines.filter((l) => l.company_id);
  const global = lines.filter((l) => !l.company_id);

  const submit = useCallback(() => {
    if (name.trim().length < 2) { Alert.alert('Name required', 'Enter the shipping line name.'); return; }
    void addMutation.mutateAsync({ name: name.trim(), scac: scac.trim().toUpperCase() })
      .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
  }, [name, scac, addMutation]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Shipping lines</Text>
          <Text style={styles.headerSub}>Steamship lines you can assign to orders</Text>
        </View>
        <TouchableOpacity onPress={() => { setName(''); setScac(''); setModal(true); }} style={styles.addBtn}><Plus size={18} color={C.white} /></TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={linesQuery.isFetching} onRefresh={() => void linesQuery.refetch()} tintColor={C.accent} />}
      >
        {linesQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading shipping lines" />
        ) : (
          <>
            {custom.length > 0 ? (
              <>
                <View style={styles.sectionRow}><Building2 size={15} color={C.accent} /><Text style={styles.sectionTitle}>Your lines</Text></View>
                {custom.map((l) => (
                  <Card key={l.id} style={styles.lineCard}>
                    <View style={styles.lineIcon}><Ship size={16} color={C.accent} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineName}>{l.name}</Text>
                      {l.scac ? <Text style={styles.lineScac}>{l.scac}</Text> : null}
                    </View>
                  </Card>
                ))}
              </>
            ) : null}

            <View style={styles.sectionRow}><Globe size={15} color={C.blue} /><Text style={styles.sectionTitle}>Global lines</Text></View>
            {global.length === 0 ? (
              <EmptyState icon={Ship} title="No shipping lines" description="Add your first shipping line with the + button." />
            ) : global.map((l) => (
              <Card key={l.id} style={styles.lineCard}>
                <View style={[styles.lineIcon, { backgroundColor: C.blue + '20' }]}><Ship size={16} color={C.blue} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{l.name}</Text>
                  {l.scac ? <Text style={styles.lineScac}>{l.scac}</Text> : null}
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add shipping line</Text>
            <TouchableOpacity onPress={() => setModal(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Input label="Shipping line name" value={name} onChangeText={setName} placeholder="e.g. Swire Shipping" />
            <Input label="SCAC code (optional)" value={scac} onChangeText={setScac} placeholder="e.g. CHVW" autoCapitalize="characters" />
            <Button label="Add shipping line" onPress={submit} loading={addMutation.isPending} fullWidth size="lg" icon={<Plus size={16} color={C.white} />} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  lineCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  lineName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  lineScac: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12 },
});
