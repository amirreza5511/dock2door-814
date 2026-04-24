import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Building2, CheckCircle, XCircle, Edit } from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { Company, CompanyStatus, CompanyType } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';

const TYPE_COLORS: Record<CompanyType, string> = {
  Customer: C.blue,
  WarehouseProvider: C.accent,
  ServiceProvider: C.green,
  Employer: C.yellow,
  TruckingCompany: C.purple,
};

export default function AdminCompanies() {
  const insets = useSafeAreaInsets();
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const updateCompanyMutation = trpc.dock.updateCompany.useMutation({
    onSuccess: async () => { await utils.dock.bootstrap.invalidate(); },
  });
  const setStatusAuditedM = trpc.admin.setCompanyStatusAudited.useMutation({
    onSuccess: async () => { await utils.dock.bootstrap.invalidate(); },
  });
  const { companies, warehouseListings, serviceListings } = bootstrapQuery.data;

  useFocusEffect(useCallback(() => {
    void bootstrapQuery.refetch();
  }, [bootstrapQuery]));

  const initialFilter: CompanyStatus | 'All' = useMemo(() => (
    companies.some((c) => c.status === 'PendingApproval') ? 'PendingApproval' : 'All'
  ), [companies]);
  const [filter, setFilter] = useState<CompanyStatus | 'All'>(initialFilter);
  const [selected, setSelected] = useState<Company | null>(null);
  const [detailModal, setDetailModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');

  const filtered = useMemo(() => filter === 'All' ? companies : companies.filter((c) => c.status === filter), [companies, filter]);

  const pendingCount = useMemo(() => companies.filter((c) => c.status === 'PendingApproval').length, [companies]);

  const openDetail = (c: Company) => {
    setSelected(c);
    setEditName(c.name);
    setEditAddress(c.address);
    setEditCity(c.city);
    setDetailModal(true);
  };

  const handleApprove = (id: string) => {
    setStatusAuditedM.mutate({ companyId: id, status: 'Approved', reason: 'Approved by admin' }, {
      onSuccess: () => { setDetailModal(false); Alert.alert('Company Approved', 'The company is now active on the platform.'); },
      onError: (e: Error) => Alert.alert('Unable to approve company', e.message),
    });
  };

  const handleSuspend = (id: string) => {
    Alert.alert('Suspend Company', 'This will deactivate all their listings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Suspend',
        style: 'destructive',
        onPress: () => {
          setStatusAuditedM.mutate({ companyId: id, status: 'Suspended', reason: 'Suspended by admin' }, {
            onSuccess: () => setDetailModal(false),
            onError: (e: Error) => Alert.alert('Unable to suspend company', e.message),
          });
        },
      },
    ]);
  };

  const handleSaveEdit = (id: string) => {
    void updateCompanyMutation.mutateAsync({ id, payload: { name: editName, address: editAddress, city: editCity } }).then(() => {
      setDetailModal(false);
      Alert.alert('Company Updated');
    }).catch((error: unknown) => {
      Alert.alert('Unable to update company', error instanceof Error ? error.message : 'Unknown error');
    });
  };

  const getListingsCount = (companyId: string) =>
    warehouseListings.filter((l) => l.companyId === companyId).length +
    serviceListings.filter((l) => l.companyId === companyId).length;

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading companies" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load companies" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Companies</Text>
        <Text style={styles.sub}>{companies.length} total · {pendingCount} pending</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {(['All', 'PendingApproval', 'Approved', 'Suspended'] as (CompanyStatus | 'All')[]).map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'PendingApproval' ? 'Pending' : f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={bootstrapQuery.isFetching} onRefresh={() => void bootstrapQuery.refetch()} tintColor={C.accent} />}
      >
        {filtered.length === 0 && (
          <View style={styles.emptyWrap}>
            <Building2 size={28} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No companies{filter !== 'All' ? ` (${filter === 'PendingApproval' ? 'Pending' : filter})` : ''}</Text>
            <Text style={styles.emptySub}>Pull down to refresh. If you just created a company and it isn&apos;t here, make sure you&apos;re logged in as an admin (user_roles.role = &apos;admin&apos;).</Text>
          </View>
        )}
        {filtered.map((c) => (
          <TouchableOpacity key={c.id} onPress={() => openDetail(c)} activeOpacity={0.85}>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <View style={[styles.typeIcon, { backgroundColor: TYPE_COLORS[c.type] + '20' }]}>
                  <Building2 size={18} color={TYPE_COLORS[c.type]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.companyName}>{c.name}</Text>
                  <Text style={styles.companyType}>{c.type} · {c.city}</Text>
                </View>
                <StatusBadge status={c.status} />
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.metaText}>{c.address}</Text>
                <Text style={styles.listingsCount}>{getListingsCount(c.id)} listings</Text>
              </View>
              {c.status === 'PendingApproval' && (
                <View style={styles.pendingActions}>
                  <Button label="Approve" onPress={() => handleApprove(c.id)} size="sm" icon={<CheckCircle size={13} color={C.white} />} />
                  <Button label="Reject" onPress={() => handleSuspend(c.id)} variant="danger" size="sm" icon={<XCircle size={13} color={C.red} />} />
                </View>
              )}
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={detailModal && !!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>{selected.name}</Text>
                  <StatusBadge status={selected.status} size="md" />
                </View>
                <Text style={styles.modalSub}>{selected.type} · {selected.city}</Text>

                <Text style={styles.editSectionTitle}>Edit Company</Text>
                <View style={styles.formGap}>
                  <Input label="Company Name" value={editName} onChangeText={setEditName} />
                  <Input label="Address" value={editAddress} onChangeText={setEditAddress} />
                  <Input label="City" value={editCity} onChangeText={setEditCity} />
                  <Button label="Save Changes" onPress={() => handleSaveEdit(selected.id)} fullWidth icon={<Edit size={15} color={C.white} />} />
                </View>

                <Text style={styles.editSectionTitle}>Actions</Text>
                <View style={styles.actionBtns}>
                  {selected.status !== 'Approved' && (
                    <Button label="Approve Company" onPress={() => handleApprove(selected.id)} fullWidth icon={<CheckCircle size={15} color={C.white} />} />
                  )}
                  {selected.status !== 'Suspended' && (
                    <Button label="Suspend Company" onPress={() => handleSuspend(selected.id)} variant="danger" fullWidth icon={<XCircle size={15} color={C.red} />} />
                  )}
                  {selected.status === 'Suspended' && (
                    <Button label="Reinstate Company" onPress={() => {
                      setStatusAuditedM.mutate({ companyId: selected.id, status: 'Approved', reason: 'Reinstated by admin' }, {
                        onSuccess: () => setDetailModal(false),
                        onError: (e: Error) => Alert.alert('Unable to reinstate company', e.message),
                      });
                    }} variant="outline" fullWidth />
                  )}
                  <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 10 },
  card: {},
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  companyName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  companyType: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaText: { fontSize: 12, color: C.textMuted, flex: 1 },
  listingsCount: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  pendingActions: { flexDirection: 'row', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 14 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text, flex: 1, marginRight: 8 },
  modalSub: { fontSize: 14, color: C.textSecondary },
  editSectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginTop: 8 },
  formGap: { gap: 12 },
  actionBtns: { gap: 10 },
  emptyWrap: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingTop: 48 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 12, color: C.textMuted, textAlign: 'center', lineHeight: 17 },
});
