import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wrench, Eye, EyeOff, Edit, CheckCircle } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';
import { trpc } from '@/lib/trpc';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ServiceListing, ServiceCategory } from '@/constants/types';

const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  Labour: 'Labour', Forklift: 'Forklift', PalletRework: 'Pallet Rework',
  Devanning: 'Devanning', LocalTruck: 'Local Truck', IndustrialCleaning: 'Cleaning',
};

export default function SPListings() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const bootstrapQuery = useDockBootstrapData();
  const { serviceListings, serviceJobs } = bootstrapQuery.data;
  const utils = trpc.useUtils();
  const invalidate = async () => {
    await Promise.all([
      utils.dock.bootstrap.invalidate(),
      utils.services.listMine.invalidate(),
    ]);
  };
  const updateMutation = trpc.services.updateListing.useMutation({ onSuccess: invalidate });
  const setStatusMutation = trpc.services.setListingStatus.useMutation({ onSuccess: invalidate });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<boolean>(false);
  const [editData, setEditData] = useState<Partial<ServiceListing>>({});

  const myListings = useMemo(() => serviceListings.filter((l) => l.companyId === user?.companyId), [serviceListings, user]);
  const jobCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    serviceJobs.forEach((j) => { counts[j.serviceId] = (counts[j.serviceId] ?? 0) + 1; });
    return counts;
  }, [serviceJobs]);

  const openEdit = (l: ServiceListing) => {
    setEditingId(l.id);
    setEditData({
      hourlyRate: l.hourlyRate,
      perJobRate: l.perJobRate,
      minimumHours: l.minimumHours,
      certifications: l.certifications,
      coverageArea: l.coverageArea,
    });
    setEditModal(true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        hourlyRate: editData.hourlyRate !== undefined ? Number(editData.hourlyRate) : undefined,
        perJobRate: editData.perJobRate != null ? Number(editData.perJobRate) : editData.perJobRate === null ? null : undefined,
        minimumHours: editData.minimumHours !== undefined ? Number(editData.minimumHours) : undefined,
        certifications: editData.certifications,
        coverageArea: editData.coverageArea,
      });
      setEditModal(false);
    } catch (error) {
      Alert.alert('Unable to save changes', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const toggleStatus = async (l: ServiceListing) => {
    const next = l.status === 'Available' ? 'Hidden' : l.status === 'Hidden' ? 'Available' : 'PendingApproval';
    try {
      await setStatusMutation.mutateAsync({ id: l.id, status: next });
    } catch (error) {
      Alert.alert('Unable to update status', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Services</Text>
        <Text style={styles.sub}>{myListings.length} listings</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {myListings.length === 0 && (
          <View style={styles.empty}><Wrench size={40} color={C.textMuted} /><Text style={styles.emptyText}>No service listings yet.</Text></View>
        )}
        {myListings.map((l) => (
          <Card key={l.id} elevated style={styles.card}>
            <View style={styles.cardTop}>
              <View style={[styles.catIcon, { backgroundColor: C.accentDim }]}>
                <Wrench size={18} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardCat}>{CATEGORY_LABELS[l.category] ?? l.category}</Text>
                <Text style={styles.cardDetail}>{(l.coverageArea ?? []).join(' · ') || l.city}</Text>
              </View>
              <StatusBadge status={l.status} />
            </View>
            <View style={styles.cardStats}>
              <View style={styles.stat}><Text style={styles.statValue}>${l.hourlyRate}/hr</Text><Text style={styles.statLabel}>hourly</Text></View>
              {l.perJobRate ? <View style={styles.stat}><Text style={styles.statValue}>${l.perJobRate}</Text><Text style={styles.statLabel}>per job</Text></View> : null}
              <View style={styles.stat}><Text style={styles.statValue}>{l.minimumHours}h</Text><Text style={styles.statLabel}>minimum</Text></View>
              <View style={styles.stat}><Text style={styles.statValue}>{jobCounts[l.id] ?? 0}</Text><Text style={styles.statLabel}>jobs</Text></View>
            </View>
            <View style={styles.cardActions}>
              <Button label="Edit" onPress={() => openEdit(l)} variant="secondary" size="sm" icon={<Edit size={13} color={C.textSecondary} />} />
              <Button
                label={l.status === 'Available' ? 'Hide' : l.status === 'Hidden' ? 'Unhide' : 'Submit'}
                onPress={() => toggleStatus(l)}
                variant="ghost" size="sm"
                icon={l.status === 'Available' ? <EyeOff size={13} color={C.textMuted} /> : <Eye size={13} color={C.textMuted} />}
              />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={editModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Edit Service Listing</Text>
            <View style={styles.formGap}>
              <Input label="Hourly Rate ($)" value={String(editData.hourlyRate ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, hourlyRate: Number(v) }))} keyboardType="numeric" />
              <Input label="Per Job Rate ($ optional)" value={String(editData.perJobRate ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, perJobRate: v ? Number(v) : null }))} keyboardType="numeric" />
              <Input label="Minimum Hours" value={String(editData.minimumHours ?? '')} onChangeText={(v) => setEditData((d) => ({ ...d, minimumHours: Number(v) }))} keyboardType="numeric" />
              <Input label="Certifications" value={editData.certifications ?? ''} onChangeText={(v) => setEditData((d) => ({ ...d, certifications: v }))} multiline numberOfLines={3} />
              <Input label="Coverage Cities (comma separated)" value={(editData.coverageArea ?? []).join(', ')} onChangeText={(v) => setEditData((d) => ({ ...d, coverageArea: v.split(',').map((s) => s.trim()).filter(Boolean) }))} />
              <Button label="Save Changes" onPress={saveEdit} fullWidth size="lg" icon={<CheckCircle size={16} color={C.white} />} loading={updateMutation.isPending} />
              <Button label="Cancel" onPress={() => setEditModal(false)} variant="ghost" fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  list: { padding: 16, gap: 12 },
  card: { gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  catIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardCat: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  cardDetail: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardStats: { flexDirection: 'row', gap: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, flexWrap: 'wrap' },
  stat: { gap: 2 },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textMuted },
  cardActions: { flexDirection: 'row', gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20 },
  modalTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text, marginBottom: 20 },
  formGap: { gap: 14 },
});
