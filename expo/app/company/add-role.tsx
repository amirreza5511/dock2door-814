import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Layers, Check, Clock, Plus, ShieldCheck } from 'lucide-react-native';
import C from '@/constants/colors';
import Card from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import {
  ROLE_LABEL, ROLE_BLURB, addableRolesFor, isBusinessRole, domainForRole,
} from '@/lib/relationships';
import type { UserRole } from '@/constants/types';

const WORLD_COLOR: Record<string, string> = {
  labour: C.purple, logistics: C.accent, freight: C.green, drayage: C.blue,
};

interface RoleRequestRow { requested_role: string; status: string; rejection_reason: string | null }

export default function AddRoleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { activeCompany, activeCompanyId } = useActiveCompany();
  const [submitting, setSubmitting] = useState<string | null>(null);

  const primaryRole = (activeCompany?.companyType ?? '') as UserRole;

  const heldQ = useQuery({
    queryKey: ['company-roles', activeCompanyId ?? 'none'],
    enabled: Boolean(activeCompanyId),
    queryFn: async (): Promise<UserRole[]> => {
      const { data, error } = await supabase
        .from('company_roles').select('role,status').eq('company_id', activeCompanyId!).eq('status', 'Active');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.role as UserRole);
    },
  });

  const requestsQ = useQuery({
    queryKey: ['company-role-requests', activeCompanyId ?? 'none'],
    enabled: Boolean(activeCompanyId),
    queryFn: async (): Promise<RoleRequestRow[]> => {
      const { data, error } = await supabase
        .from('company_role_requests')
        .select('requested_role,status,rejection_reason')
        .eq('company_id', activeCompanyId!)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as RoleRequestRow[];
    },
  });

  const held = useMemo<UserRole[]>(() => {
    const set = new Set<UserRole>(heldQ.data ?? []);
    if (primaryRole) set.add(primaryRole);
    return Array.from(set);
  }, [heldQ.data, primaryRole]);

  const pendingByRole = useMemo(() => {
    const map: Record<string, RoleRequestRow> = {};
    for (const r of requestsQ.data ?? []) {
      if (r.status === 'Pending' && !map[r.requested_role]) map[r.requested_role] = r;
    }
    return map;
  }, [requestsQ.data]);

  const addable = useMemo(() => addableRolesFor(primaryRole, held), [primaryRole, held]);

  const requestMut = useMutation({
    mutationFn: async (role: UserRole) => {
      const { error } = await supabase.rpc('request_company_role', {
        p_company_id: activeCompanyId, p_role: role, p_note: '',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company-role-requests', activeCompanyId ?? 'none'] });
    },
    onError: (e: Error) => {
      if (Platform.OS === 'web') window.alert(e.message);
      else Alert.alert('Could not submit', e.message);
    },
    onSettled: () => setSubmitting(null),
  });

  const notBusiness = !isBusinessRole(primaryRole);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Layers size={18} color={C.accent} />
          <Text style={styles.headerTitle}>Add another role</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {!activeCompanyId ? (
          <Card style={styles.infoCard}>
            <Text style={styles.infoText}>Set up your company first to add roles.</Text>
          </Card>
        ) : notBusiness ? (
          <Card style={styles.infoCard}>
            <Text style={styles.infoText}>Individual accounts have a single purpose and can’t add roles.</Text>
          </Card>
        ) : (
          <>
            <Text style={styles.intro}>
              Expand what <Text style={styles.introBold}>{activeCompany?.companyName ?? 'your business'}</Text> can do.
              Only roles compatible with a {ROLE_LABEL[primaryRole] ?? 'business'} are shown. Each addition is reviewed
              by an admin before it goes live.
            </Text>

            {/* Roles you already hold */}
            <Text style={styles.sectionLabel}>Your roles</Text>
            <View style={styles.heldRow}>
              {held.map((r) => {
                const color = WORLD_COLOR[domainForRole(r) ?? 'logistics'] ?? C.accent;
                return (
                  <View key={r} style={[styles.heldChip, { borderColor: color + '55', backgroundColor: color + '18' }]}>
                    <ShieldCheck size={12} color={color} />
                    <Text style={[styles.heldChipText, { color }]}>{ROLE_LABEL[r] ?? r}</Text>
                  </View>
                );
              })}
            </View>

            {/* Addable roles */}
            <Text style={styles.sectionLabel}>Available to add</Text>
            {heldQ.isLoading || requestsQ.isLoading ? (
              <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
            ) : addable.length === 0 ? (
              <Card style={styles.infoCard}>
                <Text style={styles.infoText}>You already hold every role compatible with your business. 🎉</Text>
              </Card>
            ) : (
              <View style={styles.list}>
                {addable.map((role) => {
                  const color = WORLD_COLOR[domainForRole(role) ?? 'logistics'] ?? C.accent;
                  const pending = pendingByRole[role];
                  const busy = submitting === role || (requestMut.isPending && submitting === role);
                  return (
                    <Card key={role} style={styles.roleCard}>
                      <View style={[styles.roleIcon, { backgroundColor: color + '20' }]}>
                        <Layers size={18} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.roleTitle}>{ROLE_LABEL[role] ?? role}</Text>
                        <Text style={styles.roleBlurb}>{ROLE_BLURB[role] ?? ''}</Text>
                      </View>
                      {pending ? (
                        <View style={styles.pendingPill}>
                          <Clock size={12} color={C.yellow} />
                          <Text style={styles.pendingText}>Pending</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.addBtn, busy && { opacity: 0.5 }]}
                          disabled={busy}
                          onPress={() => { setSubmitting(role); requestMut.mutate(role); }}
                        >
                          {busy ? <ActivityIndicator size="small" color={C.white} /> : (
                            <>
                              <Plus size={13} color={C.white} />
                              <Text style={styles.addBtnText}>Request</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </Card>
                  );
                })}
              </View>
            )}

            {/* Rejected requests hint */}
            {(requestsQ.data ?? []).some((r) => r.status === 'Rejected') && (
              <Card style={[styles.infoCard, { marginTop: 16 }]}>
                <Text style={styles.rejectedTitle}>Previously declined</Text>
                {(requestsQ.data ?? []).filter((r) => r.status === 'Rejected').map((r, i) => (
                  <Text key={`${r.requested_role}-${i}`} style={styles.rejectedItem}>
                    • {ROLE_LABEL[r.requested_role as UserRole] ?? r.requested_role}
                    {r.rejection_reason ? ` — ${r.rejection_reason}` : ''}
                  </Text>
                ))}
              </Card>
            )}

            <View style={styles.footerNote}>
              <Check size={13} color={C.textMuted} />
              <Text style={styles.footerNoteText}>
                Approved roles appear in the world switcher at the top of your dashboard.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  intro: { fontSize: 13, color: C.textSecondary, lineHeight: 20, marginBottom: 18 },
  introBold: { color: C.text, fontWeight: '700' as const },
  sectionLabel: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginBottom: 10 },
  heldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  heldChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  heldChipText: { fontSize: 12, fontWeight: '700' as const },
  list: { gap: 10 },
  roleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  roleIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  roleTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 2 },
  roleBlurb: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.white },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.yellowDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pendingText: { fontSize: 12, fontWeight: '700' as const, color: C.yellow },
  infoCard: { padding: 16 },
  infoText: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  rejectedTitle: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted, marginBottom: 6 },
  rejectedItem: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  footerNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingHorizontal: 4 },
  footerNoteText: { flex: 1, fontSize: 11, color: C.textMuted, lineHeight: 16 },
});
