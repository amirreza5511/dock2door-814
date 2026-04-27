import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserPlus, UserMinus, ShieldCheck, Pencil, Pause, Play, X, Search } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { COMPANY_ROLES, ROLE_LABEL, ROLE_DESCRIPTION, permissionsFor, type CompanyRole } from '@/lib/permissions';

interface MemberRow {
  id: string;
  user_id: string;
  company_role: CompanyRole;
  status: string;
  profiles: { id: string; name: string; email: string; role: string } | null;
}

export default function WarehouseStaff() {
  const insets = useSafeAreaInsets();
  const { activeCompany } = useActiveCompany();
  const companyId = activeCompany?.companyId ?? null;
  const myRole = activeCompany?.role ?? null;
  const canManage = myRole === 'Owner' || myRole === 'Manager';

  const membersQuery = trpc.company.listMembers.useQuery(
    { companyId: companyId ?? '' },
    { enabled: Boolean(companyId) },
  );
  const utils = trpc.useUtils();
  const invalidateMembers = async () => {
    if (companyId) await utils.company.listMembers.invalidate({ companyId });
  };
  const addM = trpc.company.addMember.useMutation({ onSuccess: invalidateMembers });
  const updateRoleM = trpc.company.updateMemberRole.useMutation({ onSuccess: invalidateMembers });
  const setStatusM = trpc.company.setMemberStatus.useMutation({ onSuccess: invalidateMembers });
  const removeM = trpc.company.removeMember.useMutation({ onSuccess: invalidateMembers });
  const findByEmailM = trpc.company.findUserByEmail.useMutation();

  const [search, setSearch] = useState<string>('');
  const [filterRole, setFilterRole] = useState<CompanyRole | 'All'>('All');

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [role, setRole] = useState<CompanyRole>('Receiver');

  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<CompanyRole>('Receiver');

  const members = useMemo(() => (membersQuery.data ?? []) as unknown as MemberRow[], [membersQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (filterRole !== 'All' && m.company_role !== filterRole) return false;
      if (!q) return true;
      const hay = `${m.profiles?.name ?? ''} ${m.profiles?.email ?? ''} ${m.user_id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [members, search, filterRole]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: members.length };
    for (const m of members) c[m.company_role] = (c[m.company_role] ?? 0) + 1;
    return c;
  }, [members]);

  const handleAdd = async () => {
    if (!companyId) { Alert.alert('No active company'); return; }
    const clean = email.trim().toLowerCase();
    if (!clean) { Alert.alert('Enter user email'); return; }
    try {
      const user = (await findByEmailM.mutateAsync({ email: clean })) as { id: string; email: string } | null;
      if (!user) {
        Alert.alert('User not found', 'Ask them to sign up first, then add them here.');
        return;
      }
      await addM.mutateAsync({ companyId, userId: user.id, role });
      setEmail('');
      setAddOpen(false);
      Alert.alert('Staff added', `${clean} added as ${ROLE_LABEL[role]}.`);
    } catch (e) {
      Alert.alert('Unable to add member', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const handleSaveRole = async () => {
    if (!companyId || !editing) return;
    try {
      await updateRoleM.mutateAsync({ companyId, userId: editing.user_id, role: editRole, reason: 'Role changed by owner/manager' });
      setEditing(null);
      Alert.alert('Role updated');
    } catch (e) {
      Alert.alert('Unable to update role', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const handleSuspend = (m: MemberRow) => {
    if (!companyId) return;
    Alert.alert('Suspend member?', `Suspend ${m.profiles?.name ?? m.user_id}? They keep their account but cannot act for this company.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Suspend', style: 'destructive',
        onPress: () => setStatusM.mutate(
          { companyId, userId: m.user_id, status: 'Suspended', reason: 'Suspended by owner/manager' },
          { onError: (e: Error) => Alert.alert('Unable to suspend', e.message) },
        ),
      },
    ]);
  };

  const handleReactivate = (m: MemberRow) => {
    if (!companyId) return;
    setStatusM.mutate(
      { companyId, userId: m.user_id, status: 'Active' },
      { onError: (e: Error) => Alert.alert('Unable to reactivate', e.message) },
    );
  };

  const handleRemove = (m: MemberRow) => {
    if (!companyId) return;
    Alert.alert('Remove member?', `Remove ${m.profiles?.name ?? m.user_id}? This is recorded in audit logs.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => removeM.mutate(
          { companyId, userId: m.user_id, reason: 'Removed by owner/manager' },
          { onError: (e: Error) => Alert.alert('Unable to remove', e.message) },
        ),
      },
    ]);
  };

  if (!companyId) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', padding: 20 }]}>
        <ScreenFeedback state="error" title="No active company" />
      </View>
    );
  }

  const filterChips: (CompanyRole | 'All')[] = ['All', 'Owner', 'Manager', 'Supervisor', 'Receiver', 'Picker', 'Packer', 'ShippingClerk', 'InventoryClerk', 'DockStaff', 'ReadOnly'];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Staff</Text>
            <Text style={styles.sub}>{members.length} member{members.length === 1 ? '' : 's'} · {activeCompany?.companyName}</Text>
          </View>
          {canManage && (
            <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addHeaderBtn} testID="open-add-staff">
              <UserPlus size={16} color={C.white} />
              <Text style={styles.addHeaderText}>Invite</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.searchRow}>
          <Search size={14} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, email"
            placeholderTextColor={C.textMuted}
            style={styles.searchInput}
            testID="staff-search"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {filterChips.map((r) => (
            <TouchableOpacity key={r} onPress={() => setFilterRole(r)} style={[styles.chip, filterRole === r && styles.chipActive]}>
              <Text style={[styles.chipText, filterRole === r && styles.chipTextActive]}>
                {r === 'All' ? 'All' : ROLE_LABEL[r]} · {counts[r] ?? 0}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}>
        {!canManage && (
          <Card style={styles.notice}>
            <Text style={styles.noticeText}>You have view-only access to staff. Only Owner or Manager can invite or change roles.</Text>
          </Card>
        )}

        {membersQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading members" />
        ) : filtered.length === 0 ? (
          <Card><Text style={styles.empty}>No members match your filter</Text></Card>
        ) : filtered.map((m) => (
          <Card key={m.id} style={styles.memberCard}>
            <View style={styles.memberRow}>
              <View style={[styles.avatar, m.company_role === 'Owner' && styles.avatarOwner]}>
                <Text style={styles.avatarText}>{(m.profiles?.name ?? '?').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{m.profiles?.name ?? m.user_id}</Text>
                <Text style={styles.email}>{m.profiles?.email ?? '—'}</Text>
                <View style={styles.metaRow}>
                  <View style={[styles.roleBadge, m.company_role === 'Owner' && styles.roleBadgeOwner]}>
                    {m.company_role === 'Owner' && <ShieldCheck size={10} color={C.accent} />}
                    <Text style={styles.roleBadgeText}>{ROLE_LABEL[m.company_role] ?? m.company_role}</Text>
                  </View>
                  <StatusBadge status={m.status === 'Active' ? 'Active' : m.status === 'Suspended' ? 'Pending' : 'Inactive'} />
                  <Text style={styles.permCount}>{permissionsFor(m.company_role).length} perms</Text>
                </View>
              </View>
              {canManage && m.company_role !== 'Owner' && (
                <View style={styles.actionsCol}>
                  <TouchableOpacity onPress={() => { setEditing(m); setEditRole(m.company_role); }} style={styles.iconBtn} testID={`edit-role-${m.user_id}`}>
                    <Pencil size={14} color={C.text} />
                  </TouchableOpacity>
                  {m.status === 'Active' ? (
                    <TouchableOpacity onPress={() => handleSuspend(m)} style={styles.iconBtn} testID={`suspend-${m.user_id}`}>
                      <Pause size={14} color={C.text} />
                    </TouchableOpacity>
                  ) : m.status === 'Suspended' ? (
                    <TouchableOpacity onPress={() => handleReactivate(m)} style={styles.iconBtn} testID={`reactivate-${m.user_id}`}>
                      <Play size={14} color={C.text} />
                    </TouchableOpacity>
                  ) : null}
                  {m.status === 'Active' && (
                    <TouchableOpacity onPress={() => handleRemove(m)} style={[styles.iconBtn, styles.iconBtnDanger]} testID={`remove-${m.user_id}`}>
                      <UserMinus size={14} color={C.red} />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </Card>
        ))}
      </ScrollView>

      {/* Invite modal */}
      <Modal visible={addOpen} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Member</Text>
              <TouchableOpacity onPress={() => setAddOpen(false)}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <Text style={styles.hint}>User must already have a Dock2Door account.</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="user@example.com"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              testID="staff-email-input"
            />
            <Text style={styles.modalLabel}>Role</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {COMPANY_ROLES.filter((r) => r !== 'Owner').map((r) => (
                <TouchableOpacity key={r} onPress={() => setRole(r)} style={[styles.roleOption, role === r && styles.roleOptionActive]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.roleOptionTitle, role === r && styles.roleOptionTitleActive]}>{ROLE_LABEL[r]}</Text>
                    <Text style={styles.roleOptionDesc}>{ROLE_DESCRIPTION[r]}</Text>
                  </View>
                  <View style={[styles.radio, role === r && styles.radioActive]} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Button label="Send Invite" onPress={handleAdd} loading={addM.isPending || findByEmailM.isPending} fullWidth icon={<UserPlus size={14} color={C.white} />} />
          </View>
        </View>
      </Modal>

      {/* Edit role modal */}
      <Modal visible={Boolean(editing)} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Role</Text>
              <TouchableOpacity onPress={() => setEditing(null)}><X size={18} color={C.text} /></TouchableOpacity>
            </View>
            <Text style={styles.hint}>{editing?.profiles?.name ?? editing?.user_id}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {COMPANY_ROLES.map((r) => (
                <TouchableOpacity key={r} onPress={() => setEditRole(r)} style={[styles.roleOption, editRole === r && styles.roleOptionActive]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.roleOptionTitle, editRole === r && styles.roleOptionTitleActive]}>{ROLE_LABEL[r]}</Text>
                    <Text style={styles.roleOptionDesc}>{ROLE_DESCRIPTION[r]}</Text>
                  </View>
                  <View style={[styles.radio, editRole === r && styles.radioActive]} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Button label="Save" onPress={handleSaveRole} loading={updateRoleM.isPending} fullWidth />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  addHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  addHeaderText: { fontSize: 13, fontWeight: '700' as const, color: C.white },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, color: C.text, fontSize: 14, padding: 0 },
  chipsRow: { gap: 6, paddingRight: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent },
  scroll: { padding: 16, gap: 12 },
  notice: { padding: 12, backgroundColor: C.bgSecondary, borderColor: C.border },
  noticeText: { fontSize: 12, color: C.textSecondary },
  hint: { fontSize: 12, color: C.textMuted, marginBottom: 8 },
  input: { backgroundColor: C.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, marginBottom: 12 },
  empty: { fontSize: 13, color: C.textMuted, textAlign: 'center', padding: 16 },
  memberCard: { padding: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  avatarOwner: { borderColor: C.accent, backgroundColor: C.accentDim },
  avatarText: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  name: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  email: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' as const },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  roleBadgeOwner: { backgroundColor: C.accentDim, borderColor: C.accent },
  roleBadgeText: { fontSize: 10, color: C.text, fontWeight: '700' as const },
  permCount: { fontSize: 10, color: C.textMuted },
  actionsCol: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBtnDanger: { backgroundColor: C.redDim, borderColor: C.red },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 480, backgroundColor: C.bg, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  modalLabel: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 4, marginBottom: 4 },
  roleOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgSecondary, marginBottom: 6 },
  roleOptionActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  roleOptionTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  roleOptionTitleActive: { color: C.accent },
  roleOptionDesc: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.border, backgroundColor: C.bg },
  radioActive: { borderColor: C.accent, backgroundColor: C.accent },
});
