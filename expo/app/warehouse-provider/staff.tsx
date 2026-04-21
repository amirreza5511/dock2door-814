import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserPlus, UserMinus, ShieldCheck } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';

interface MemberRow {
  id: string;
  user_id: string;
  company_role: 'Owner' | 'Staff';
  status: string;
  profiles: { id: string; name: string; email: string; role: string } | null;
}

export default function WarehouseStaff() {
  const insets = useSafeAreaInsets();
  const { activeCompany } = useActiveCompany();
  const companyId = activeCompany?.companyId ?? null;

  const membersQuery = trpc.company.listMembers.useQuery(
    { companyId: companyId ?? '' },
    { enabled: Boolean(companyId) },
  );
  const utils = trpc.useUtils();
  const addM = trpc.company.addMember.useMutation({
    onSuccess: async () => { await utils.company.listMembers.invalidate({ companyId: companyId ?? '' }); },
  });
  const removeM = trpc.company.removeMember.useMutation({
    onSuccess: async () => { await utils.company.listMembers.invalidate({ companyId: companyId ?? '' }); },
  });
  const findByEmailM = trpc.company.findUserByEmail.useMutation();

  const [email, setEmail] = useState<string>('');
  const [role, setRole] = useState<'Staff' | 'Owner'>('Staff');

  const members = useMemo(() => (membersQuery.data ?? []) as unknown as MemberRow[], [membersQuery.data]);

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
      Alert.alert('Staff added');
    } catch (e) {
      Alert.alert('Unable to add member', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const handleRemove = (m: MemberRow) => {
    if (!companyId) return;
    Alert.alert('Remove member?', `Remove ${m.profiles?.name ?? m.user_id}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => removeM.mutate(
          { companyId, userId: m.user_id, reason: 'Removed by owner' },
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

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Staff</Text>
        <Text style={styles.sub}>{members.length} member{members.length === 1 ? '' : 's'} · {activeCompany?.companyName}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}>
        <Card style={styles.addCard}>
          <Text style={styles.sectionTitle}>Add Member</Text>
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
          <View style={styles.roleRow}>
            {(['Staff', 'Owner'] as const).map((r) => (
              <TouchableOpacity key={r} onPress={() => setRole(r)} style={[styles.roleChip, role === r && styles.roleChipActive]}>
                <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Button label="Add Member" onPress={handleAdd} loading={addM.isPending || findByEmailM.isPending} fullWidth icon={<UserPlus size={14} color={C.white} />} />
        </Card>

        <Text style={styles.listHeader}>Current Members</Text>
        {membersQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading members" />
        ) : members.length === 0 ? (
          <Card><Text style={styles.empty}>No members yet</Text></Card>
        ) : members.map((m) => (
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
                    <Text style={styles.roleBadgeText}>{m.company_role}</Text>
                  </View>
                  <StatusBadge status={m.status === 'Active' ? 'Active' : 'Inactive'} />
                </View>
              </View>
              {m.company_role !== 'Owner' && m.status === 'Active' ? (
                <TouchableOpacity onPress={() => handleRemove(m)} style={styles.removeBtn} testID={`remove-${m.user_id}`}>
                  <UserMinus size={16} color={C.red} />
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  hint: { fontSize: 12, color: C.textMuted, marginBottom: 8 },
  addCard: { padding: 14, gap: 10 },
  input: { backgroundColor: C.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleChip: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  roleChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  roleText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  roleTextActive: { color: C.accent },
  listHeader: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary, marginTop: 8, marginBottom: 2, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  empty: { fontSize: 13, color: C.textMuted, textAlign: 'center' },
  memberCard: { padding: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  avatarOwner: { borderColor: C.accent, backgroundColor: C.accentDim },
  avatarText: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  name: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  email: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  roleBadgeOwner: { backgroundColor: C.accentDim, borderColor: C.accent },
  roleBadgeText: { fontSize: 10, color: C.text, fontWeight: '700' as const },
  removeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.redDim, alignItems: 'center', justifyContent: 'center' },
});
