import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X, ShieldBan, ShieldCheck } from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import type { User, UserRole } from '@/constants/types';
import { trpc } from '@/lib/trpc';
import { useDockBootstrapData } from '@/hooks/useDockBootstrap';

const ROLE_COLORS: Record<UserRole, string> = {
  Admin: C.red,
  SuperAdmin: C.red,
  Customer: C.blue,
  WarehouseProvider: C.accent,
  ServiceProvider: C.green,
  Employer: C.yellow,
  Worker: C.purple,
  TruckingCompany: C.blue,
  Driver: C.green,
  GateStaff: C.yellow,
};

export default function AdminUsers() {
  const insets = useSafeAreaInsets();
  const bootstrapQuery = useDockBootstrapData();
  const utils = trpc.useUtils();
  const updateUserMutation = trpc.dock.updateUser.useMutation({
    onSuccess: async () => { await utils.dock.bootstrap.invalidate(); },
  });
  const setStatusAuditedM = trpc.admin.setUserStatusAudited.useMutation({
    onSuccess: async () => { await utils.dock.bootstrap.invalidate(); },
  });
  const { users, companies } = bootstrapQuery.data;

  const [query, setQuery] = useState('');
  const [filterRole, setFilterRole] = useState<UserRole | 'All'>('All');
  const [selected, setSelected] = useState<User | null>(null);
  const [detailModal, setDetailModal] = useState(false);

  const filtered = useMemo(() => users.filter((u) => {
    const matchQ = u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase());
    const matchRole = filterRole === 'All' || u.role === filterRole;
    return matchQ && matchRole;
  }), [users, query, filterRole]);

  const getCompanyName = (companyId: string | null) => companyId ? companies.find((c) => c.id === companyId)?.name ?? companyId : 'No Company';

  const ROLES: (UserRole | 'All')[] = ['All', 'Admin', 'SuperAdmin', 'Customer', 'WarehouseProvider', 'ServiceProvider', 'Employer', 'Worker', 'TruckingCompany', 'Driver', 'GateStaff'];

  const handleSuspend = (u: User) => {
    Alert.alert('Suspend User', `Suspend ${u.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Suspend',
        style: 'destructive',
        onPress: () => {
          setStatusAuditedM.mutate({ userId: u.id, status: 'Suspended', reason: 'Suspended by admin' }, {
            onSuccess: () => setDetailModal(false),
            onError: (e: Error) => Alert.alert('Unable to suspend user', e.message),
          });
        },
      },
    ]);
  };

  const handleReinstate = (u: User) => {
    setStatusAuditedM.mutate({ userId: u.id, status: 'Active', reason: 'Reinstated by admin' }, {
      onSuccess: () => { setDetailModal(false); Alert.alert('User Reinstated'); },
      onError: (e: Error) => Alert.alert('Unable to reinstate user', e.message),
    });
  };

  if (bootstrapQuery.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="loading" title="Loading users" />
      </View>
    );
  }

  if (bootstrapQuery.isError) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="Unable to load users" onRetry={() => void bootstrapQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Users</Text>
        <Text style={styles.sub}>{users.length} total</Text>
        <View style={styles.searchBar}>
          <Search size={16} color={C.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search by name or email…" placeholderTextColor={C.textMuted} style={styles.searchInput} />
          {query ? <TouchableOpacity onPress={() => setQuery('')}><X size={16} color={C.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {ROLES.map((r) => (
          <TouchableOpacity key={r} onPress={() => setFilterRole(r)} style={[styles.chip, filterRole === r && styles.chipActive]}>
            <Text style={[styles.chipText, filterRole === r && styles.chipTextActive]}>{r === 'WarehouseProvider' ? 'WH Provider' : r === 'ServiceProvider' ? 'SV Provider' : r}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {filtered.map((u) => (
          <TouchableOpacity key={u.id} onPress={() => { setSelected(u); setDetailModal(true); }} activeOpacity={0.85}>
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <View style={[styles.avatar, { backgroundColor: (ROLE_COLORS[u.role] ?? C.textMuted) + '30' }]}>
                  <Text style={[styles.avatarText, { color: ROLE_COLORS[u.role] ?? C.textMuted }]}>{u.name.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{u.name}</Text>
                  <Text style={styles.userEmail}>{u.email}</Text>
                  <Text style={styles.userCompany}>{getCompanyName(u.companyId)}</Text>
                </View>
                <View style={styles.rightCol}>
                  <View style={[styles.roleBadge, { backgroundColor: (ROLE_COLORS[u.role] ?? C.textMuted) + '20' }]}>
                    <Text style={[styles.roleText, { color: ROLE_COLORS[u.role] ?? C.textMuted }]}>{u.role === 'WarehouseProvider' ? 'Warehouse' : u.role === 'ServiceProvider' ? 'Service' : u.role}</Text>
                  </View>
                  <StatusBadge status={u.status} />
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
        {filtered.length === 0 && (
          <View style={styles.empty}><Text style={styles.emptyText}>No users found</Text></View>
        )}
      </ScrollView>

      <Modal visible={detailModal && !!selected} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {selected && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalBody}>
                <View style={styles.modalAvatar}>
                  <View style={[styles.avatarLg, { backgroundColor: (ROLE_COLORS[selected.role] ?? C.textMuted) + '30' }]}>
                    <Text style={[styles.avatarLgText, { color: ROLE_COLORS[selected.role] ?? C.textMuted }]}>{selected.name.charAt(0)}</Text>
                  </View>
                  <View>
                    <Text style={styles.modalName}>{selected.name}</Text>
                    <Text style={styles.modalEmail}>{selected.email}</Text>
                    <StatusBadge status={selected.status} size="md" />
                  </View>
                </View>

                <View style={styles.detailGrid}>
                  {[
                    ['Role', selected.role],
                    ['Company', getCompanyName(selected.companyId)],
                    ['User ID', selected.id],
                    ['Joined', selected.createdAt.split('T')[0]],
                  ].map(([l, v]) => (
                    <View key={l} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{l}</Text>
                      <Text style={styles.detailValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.actionBtns}>
                  {selected.status === 'Active' ? (
                    <Button label="Suspend User" onPress={() => handleSuspend(selected)} variant="danger" fullWidth icon={<ShieldBan size={15} color={C.red} />} />
                  ) : (
                    <Button label="Reinstate User" onPress={() => handleReinstate(selected)} fullWidth icon={<ShieldCheck size={15} color={C.white} />} />
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
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },
  filterScroll: { maxHeight: 50, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  list: { padding: 16, gap: 8 },
  card: {},
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '800' as const },
  userName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  userEmail: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  userCompany: { fontSize: 11, color: C.accent, fontWeight: '600' as const, marginTop: 1 },
  rightCol: { alignItems: 'flex-end', gap: 5 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  roleText: { fontSize: 11, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  modalBody: { padding: 20, gap: 16 },
  modalAvatar: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarLg: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarLgText: { fontSize: 24, fontWeight: '800' as const },
  modalName: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  modalEmail: { fontSize: 13, color: C.textSecondary, marginTop: 2, marginBottom: 6 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  detailItem: { width: '50%', padding: 12, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.border },
  detailLabel: { fontSize: 11, color: C.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 12, color: C.text, fontWeight: '600' as const },
  actionBtns: { gap: 10 },
});
