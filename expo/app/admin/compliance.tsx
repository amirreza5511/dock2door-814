import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Modal, TextInput, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Award, Warehouse, AlertTriangle, CheckCircle,
  XCircle, RefreshCw, ClipboardCheck, ExternalLink, FileSearch,
} from 'lucide-react-native';
import C from '@/constants/colors';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { supabase } from '@/lib/supabase';
import { getSignedUrl } from '@/lib/storage-files';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PendingCompany {
  id: string;
  name: string;
  type: string;
  city: string | null;
  created_at: string;
}

interface PendingCert {
  id: string;
  worker_user_id: string;
  type: string;
  expiry_date: string | null;
  file_path: string | null;
  created_at: string;
  worker_name: string | null;
  worker_email: string | null;
}

interface PendingListing {
  id: string;
  company_id: string;
  name: string;
  city: string | null;
  warehouse_type: string;
  created_at: string;
  company_name: string | null;
}

interface OpenDispute {
  id: string;
  status: string;
  description: string;
  created_at: string;
  opener_name: string | null;
  opener_email: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(); }
  catch { return iso; }
}

// ─── Reason Modal ─────────────────────────────────────────────────────────────

interface ReasonModalProps {
  visible: boolean;
  title: string;
  required: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}

function ReasonModal({ visible, title, required, onCancel, onConfirm, loading }: ReasonModalProps) {
  const [reason, setReason] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={rm.overlay}>
        <View style={rm.sheet}>
          <Text style={rm.title}>{title}</Text>
          <Text style={rm.label}>Reason {required ? '(required)' : '(optional)'}</Text>
          <TextInput
            style={rm.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Enter reason…"
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
            autoFocus
          />
          <View style={rm.buttons}>
            <TouchableOpacity onPress={onCancel} style={[rm.btn, rm.btnCancel]}>
              <Text style={rm.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onConfirm(reason); setReason(''); }}
              style={[rm.btn, rm.btnConfirm, (loading || (required && !reason.trim())) && rm.btnDisabled]}
              disabled={loading || (required && !reason.trim())}
            >
              {loading ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Text style={rm.btnConfirmText}>Confirm</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const rm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { backgroundColor: C.bgSecondary, borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 },
  title: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 16 },
  label: { fontSize: 13, color: C.textSecondary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, color: C.text, backgroundColor: C.bg, minHeight: 80, textAlignVertical: 'top', fontSize: 14 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnCancel: { backgroundColor: C.bgTertiary ?? C.border },
  btnCancelText: { color: C.text, fontWeight: '600' as const },
  btnConfirm: { backgroundColor: C.accent },
  btnConfirmText: { color: C.white, fontWeight: '700' as const },
  btnDisabled: { opacity: 0.45 },
});

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = 'companies' | 'certifications' | 'listings' | 'disputes';

interface PendingAction {
  kind:
    | 'approve-company' | 'suspend-company'
    | 'approve-cert'    | 'reject-cert'
    | 'approve-listing' | 'suspend-listing';
  id: string;
  label: string;
  reasonRequired: boolean;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function AdminComplianceScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('companies');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const companiesQ = useQuery({
    queryKey: ['admin-compliance', 'companies'],
    queryFn: async (): Promise<PendingCompany[]> => {
      const { data, error } = await supabase
        .from('companies')
        .select('id,name,type,city,created_at')
        .eq('status', 'PendingApproval')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as PendingCompany[];
    },
    staleTime: 30_000,
  });

  const certsQ = useQuery({
    queryKey: ['admin-compliance', 'certs'],
    queryFn: async (): Promise<PendingCert[]> => {
      const { data, error } = await supabase
        .from('worker_certifications')
        .select('id,worker_user_id,type,expiry_date,file_path,created_at,profiles!worker_user_id(name,email)')
        .eq('status', 'Pending')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        worker_user_id: r.worker_user_id,
        type: r.type,
        expiry_date: r.expiry_date,
        file_path: r.file_path,
        created_at: r.created_at,
        worker_name: r.profiles?.name ?? null,
        worker_email: r.profiles?.email ?? null,
      }));
    },
    staleTime: 30_000,
  });

  const listingsQ = useQuery({
    queryKey: ['admin-compliance', 'listings'],
    queryFn: async (): Promise<PendingListing[]> => {
      const { data, error } = await supabase
        .from('warehouse_listings')
        .select('id,company_id,name,city,warehouse_type,created_at,companies!company_id(name)')
        .eq('status', 'PendingApproval')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        company_id: r.company_id,
        name: r.name,
        city: r.city,
        warehouse_type: r.warehouse_type,
        created_at: r.created_at,
        company_name: r.companies?.name ?? null,
      }));
    },
    staleTime: 30_000,
  });

  const disputesQ = useQuery({
    queryKey: ['admin-compliance', 'disputes'],
    queryFn: async (): Promise<OpenDispute[]> => {
      const { data, error } = await supabase
        .from('disputes')
        .select('id,status,description,created_at,profiles!opened_by_user_id(name,email)')
        .in('status', ['Open', 'UnderReview'])
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        status: r.status,
        description: r.description,
        created_at: r.created_at,
        opener_name: r.profiles?.name ?? null,
        opener_email: r.profiles?.email ?? null,
      }));
    },
    staleTime: 30_000,
  });

  const refetchAll = () => {
    void companiesQ.refetch();
    void certsQ.refetch();
    void listingsQ.refetch();
    void disputesQ.refetch();
  };

  // ── Mutation ───────────────────────────────────────────────────────────────

  const actionMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: PendingAction; reason: string }) => {
      const r = reason.trim() || null;
      switch (action.kind) {
        case 'approve-company': {
          const { error } = await supabase.rpc('admin_set_company_status', {
            p_company_id: action.id, p_status: 'Approved', p_reason: r ?? 'Approved via compliance queue',
          });
          if (error) throw new Error(error.message);
          break;
        }
        case 'suspend-company': {
          if (!r) throw new Error('Reason required to suspend a company');
          const { error } = await supabase.rpc('admin_set_company_status', {
            p_company_id: action.id, p_status: 'Suspended', p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case 'approve-cert': {
          const { error } = await supabase.rpc('admin_approve_certification', {
            p_cert_id: action.id, p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case 'reject-cert': {
          if (!r) throw new Error('Reason required to reject a certification');
          const { error } = await supabase.rpc('admin_reject_certification', {
            p_cert_id: action.id, p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
        case 'approve-listing': {
          const { error } = await supabase.rpc('admin_set_listing_status', {
            p_listing_id: action.id, p_status: 'Available', p_reason: r ?? 'Approved via compliance queue',
          });
          if (error) throw new Error(error.message);
          break;
        }
        case 'suspend-listing': {
          if (!r) throw new Error('Reason required to suspend a listing');
          const { error } = await supabase.rpc('admin_set_listing_status', {
            p_listing_id: action.id, p_status: 'Suspended', p_reason: r,
          });
          if (error) throw new Error(error.message);
          break;
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-compliance'] });
      setPendingAction(null);
    },
    onError: (err: Error) => {
      Alert.alert('Action failed', err.message);
    },
  });

  // ── Open cert file ─────────────────────────────────────────────────────────

  const openCertFile = async (certId: string, filePath: string) => {
    setOpeningFileId(certId);
    try {
      const url = await getSignedUrl('certifications', filePath, 60);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (err) {
      Alert.alert('Unable to open file', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setOpeningFileId(null);
    }
  };

  // ── Totals ─────────────────────────────────────────────────────────────────

  const counts = {
    companies:      companiesQ.data?.length ?? 0,
    certifications: certsQ.data?.length ?? 0,
    listings:       listingsQ.data?.length ?? 0,
    disputes:       disputesQ.data?.length ?? 0,
  };
  const totalPending = counts.companies + counts.certifications + counts.listings + counts.disputes;
  const isLoading = companiesQ.isLoading || certsQ.isLoading || listingsQ.isLoading || disputesQ.isLoading;

  const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
    { id: 'companies',      label: 'Companies', icon: Building2 },
    { id: 'certifications', label: 'Certs',     icon: Award },
    { id: 'listings',       label: 'Listings',  icon: Warehouse },
    { id: 'disputes',       label: 'Disputes',  icon: AlertTriangle },
  ];

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <ClipboardCheck size={20} color={C.accent} />
          <Text style={styles.headerTitle}>Compliance Queue</Text>
        </View>
        <View style={styles.headerRight}>
          {totalPending > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{totalPending}</Text>
            </View>
          )}
          <TouchableOpacity onPress={refetchAll} disabled={isLoading} style={styles.refreshBtn}>
            <RefreshCw size={18} color={isLoading ? C.textMuted : C.accent} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Sub-header summary */}
      <View style={styles.summaryRow}>
        {totalPending > 0 ? (
          <Text style={styles.summaryText}>{totalPending} item{totalPending !== 1 ? 's' : ''} need admin action</Text>
        ) : isLoading ? (
          <Text style={styles.summaryText}>Loading…</Text>
        ) : (
          <View style={styles.allClearRow}>
            <CheckCircle size={13} color={C.green} />
            <Text style={[styles.summaryText, { color: C.green }]}>All clear — nothing pending</Text>
          </View>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(({ id, label, icon: Icon }) => {
          const count = counts[id];
          const active = tab === id;
          return (
            <TouchableOpacity
              key={id}
              onPress={() => setTab(id)}
              style={[styles.tabItem, active && styles.tabItemActive]}
            >
              <Icon size={15} color={active ? C.accent : C.textMuted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
              {count > 0 && (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Companies ── */}
        {tab === 'companies' && (
          <View style={styles.list}>
            {companiesQ.isLoading ? (
              <ActivityIndicator color={C.accent} style={styles.loader} />
            ) : (companiesQ.data ?? []).length === 0 ? (
              <QueueEmptyState icon={Building2} message="No companies pending approval" />
            ) : (
              (companiesQ.data ?? []).map((c) => (
                <Card key={c.id} style={styles.itemCard}>
                  <Text style={styles.itemTitle}>{c.name}</Text>
                  <Text style={styles.itemMeta}>
                    {c.type.replace(/([A-Z])/g, ' $1').trim()} · {c.city ?? 'Unknown city'} · {fmtDate(c.created_at)}
                  </Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => setPendingAction({ kind: 'suspend-company', id: c.id, label: `Reject company: ${c.name}`, reasonRequired: true })}
                      style={[styles.actionBtn, styles.actionBtnDanger]}
                    >
                      <XCircle size={13} color={C.red} />
                      <Text style={[styles.actionBtnText, { color: C.red }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setPendingAction({ kind: 'approve-company', id: c.id, label: `Approve company: ${c.name}`, reasonRequired: false })}
                      style={[styles.actionBtn, styles.actionBtnApprove]}
                    >
                      <CheckCircle size={13} color={C.white} />
                      <Text style={[styles.actionBtnText, { color: C.white }]}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* ── Certifications ── */}
        {tab === 'certifications' && (
          <View style={styles.list}>
            {certsQ.isLoading ? (
              <ActivityIndicator color={C.accent} style={styles.loader} />
            ) : (certsQ.data ?? []).length === 0 ? (
              <QueueEmptyState icon={Award} message="No certifications pending review" />
            ) : (
              (certsQ.data ?? []).map((c) => (
                <Card key={c.id} style={styles.itemCard}>
                  <Text style={styles.itemTitle}>{c.type}</Text>
                  <Text style={styles.itemMeta}>
                    {c.worker_name ?? 'Unknown worker'}{c.worker_email ? ` · ${c.worker_email}` : ''}{'\n'}
                    Expires: {c.expiry_date ?? 'N/A'} · Submitted {fmtDate(c.created_at)}
                  </Text>
                  {c.file_path ? (
                    <TouchableOpacity
                      onPress={() => void openCertFile(c.id, c.file_path!)}
                      disabled={openingFileId === c.id}
                      style={styles.filePreviewBtn}
                    >
                      {openingFileId === c.id ? (
                        <ActivityIndicator size="small" color={C.accent} />
                      ) : (
                        <FileSearch size={13} color={C.accent} />
                      )}
                      <Text style={styles.filePreviewText}>
                        {openingFileId === c.id ? 'Opening…' : 'Preview certificate file'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.noFileBadge}>⚠ No file uploaded</Text>
                  )}
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => setPendingAction({ kind: 'reject-cert', id: c.id, label: `Reject cert for ${c.worker_name ?? 'worker'}`, reasonRequired: true })}
                      style={[styles.actionBtn, styles.actionBtnDanger]}
                    >
                      <XCircle size={13} color={C.red} />
                      <Text style={[styles.actionBtnText, { color: C.red }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setPendingAction({ kind: 'approve-cert', id: c.id, label: `Approve cert for ${c.worker_name ?? 'worker'}`, reasonRequired: false })}
                      style={[styles.actionBtn, styles.actionBtnApprove]}
                    >
                      <CheckCircle size={13} color={C.white} />
                      <Text style={[styles.actionBtnText, { color: C.white }]}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* ── Listings ── */}
        {tab === 'listings' && (
          <View style={styles.list}>
            {listingsQ.isLoading ? (
              <ActivityIndicator color={C.accent} style={styles.loader} />
            ) : (listingsQ.data ?? []).length === 0 ? (
              <QueueEmptyState icon={Warehouse} message="No listings pending approval" />
            ) : (
              (listingsQ.data ?? []).map((l) => (
                <Card key={l.id} style={styles.itemCard}>
                  <Text style={styles.itemTitle}>{l.name}</Text>
                  <Text style={styles.itemMeta}>
                    {l.company_name ?? 'Unknown company'} · {l.warehouse_type} · {l.city ?? 'Unknown city'}
                    {'\n'}Submitted {fmtDate(l.created_at)}
                  </Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => setPendingAction({ kind: 'suspend-listing', id: l.id, label: `Reject listing: ${l.name}`, reasonRequired: true })}
                      style={[styles.actionBtn, styles.actionBtnDanger]}
                    >
                      <XCircle size={13} color={C.red} />
                      <Text style={[styles.actionBtnText, { color: C.red }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setPendingAction({ kind: 'approve-listing', id: l.id, label: `Approve listing: ${l.name}`, reasonRequired: false })}
                      style={[styles.actionBtn, styles.actionBtnApprove]}
                    >
                      <CheckCircle size={13} color={C.white} />
                      <Text style={[styles.actionBtnText, { color: C.white }]}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* ── Disputes ── */}
        {tab === 'disputes' && (
          <View style={styles.list}>
            {disputesQ.isLoading ? (
              <ActivityIndicator color={C.accent} style={styles.loader} />
            ) : (disputesQ.data ?? []).length === 0 ? (
              <QueueEmptyState icon={AlertTriangle} message="No open disputes" />
            ) : (
              <>
                <Card style={[styles.infoCard]}>
                  <AlertTriangle size={14} color={C.yellow} />
                  <Text style={styles.infoCardText}>
                    Dispute resolution is on the Disputes tab. Items here are shown for visibility.
                  </Text>
                </Card>
                {(disputesQ.data ?? []).map((d) => (
                  <Card key={d.id} style={styles.itemCard}>
                    <View style={styles.disputeHeader}>
                      <View style={[styles.statusPill, d.status === 'UnderReview' ? styles.pillBlue : styles.pillAmber]}>
                        <Text style={styles.pillText}>{d.status}</Text>
                      </View>
                      <Text style={styles.itemMeta}>{d.opener_name ?? 'Unknown'} · {fmtDate(d.created_at)}</Text>
                    </View>
                    <Text style={styles.disputeDesc} numberOfLines={3}>{d.description}</Text>
                  </Card>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Action modal */}
      <ReasonModal
        visible={pendingAction !== null}
        title={pendingAction?.label ?? ''}
        required={pendingAction?.reasonRequired ?? false}
        loading={actionMutation.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={(reason) => {
          if (!pendingAction) return;
          actionMutation.mutate({ action: pendingAction, reason });
        }}
      />
    </View>
  );
}

// ─── QueueEmptyState ─────────────────────────────────────────────────────────

function QueueEmptyState({ icon: Icon, message }: { icon: typeof Building2; message: string }) {
  return (
    <View style={es.wrap}>
      <View style={es.iconWrap}><Icon size={28} color={C.textMuted} /></View>
      <Text style={es.msg}>{message}</Text>
      <View style={es.clearRow}>
        <CheckCircle size={13} color={C.green} />
        <Text style={es.clearText}>All clear</Text>
      </View>
    </View>
  );
}

const es = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  msg: { fontSize: 15, fontWeight: '600' as const, color: C.text, textAlign: 'center', marginBottom: 6 },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearText: { fontSize: 12, color: C.green },
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700' as const, color: C.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { backgroundColor: C.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: C.white },
  refreshBtn: { padding: 6 },
  summaryRow: { paddingHorizontal: 16, paddingBottom: 8 },
  summaryText: { fontSize: 13, color: C.textSecondary },
  allClearRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginHorizontal: 8 },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: C.accent },
  tabLabel: { fontSize: 11, fontWeight: '600' as const, color: C.textMuted },
  tabLabelActive: { color: C.accent },
  tabBadge: { backgroundColor: C.bgSecondary, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeActive: { backgroundColor: C.accent },
  tabBadgeText: { fontSize: 10, fontWeight: '700' as const, color: C.textMuted },
  tabBadgeTextActive: { color: C.white },
  scroll: { paddingHorizontal: 12, paddingTop: 12 },
  list: { gap: 10 },
  loader: { marginTop: 32 },
  itemCard: { padding: 14 },
  itemTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 3 },
  itemMeta: { fontSize: 12, color: C.textSecondary, marginBottom: 8, lineHeight: 17 },
  filePreviewBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10, opacity: 1 },
  filePreviewText: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  noFileBadge: { fontSize: 11, color: C.yellow, marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8 },
  actionBtnDanger: { borderWidth: 1, borderColor: C.red + '66', backgroundColor: C.redDim ?? '#fee2e2' },
  actionBtnApprove: { backgroundColor: C.green },
  actionBtnText: { fontSize: 13, fontWeight: '700' as const },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, backgroundColor: C.yellowDim ?? '#fefce8' },
  infoCardText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  disputeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillBlue: { backgroundColor: C.blueDim ?? '#dbeafe' },
  pillAmber: { backgroundColor: C.yellowDim ?? '#fef3c7' },
  pillText: { fontSize: 11, fontWeight: '600' as const, color: C.text },
  disputeDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
});
