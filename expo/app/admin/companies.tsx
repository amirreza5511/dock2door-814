import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Modal, Alert, RefreshControl, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Building2, CheckCircle, XCircle, Edit, FileText, CreditCard } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
  Shipper: C.blue,
  DrayageCompany: C.blue,
  FreightForwarder: C.blue,
  EquipmentRentalCompany: C.blue,
  MobileRepairProvider: C.purple,
  CargoInsurer: C.yellow,
  MarketplaceBuyer: C.accent,
  EmploymentAgency: C.purple,
  CustomsBroker: C.blue,
  ImporterExporter: C.blue,
  GlobalFreightForwarder: C.blue,
  Carrier: C.blue,
};

/**
 * Approval intents the UI exposes. These are NOT the DB enum — the
 * `company_status` enum only has `PendingApproval | Approved | Suspended`
 * (no `Active`, no `Rejected`). `toEnumStatus` collapses every intent down to
 * a real enum value so the server-side `::company_status` cast can never throw
 * `invalid input value for enum company_status: "Active"`.
 */
type ApprovalAction = 'Approve' | 'Reinstate' | 'Reject' | 'Suspend';

const toEnumStatus = (action: ApprovalAction): CompanyStatus => {
  switch (action) {
    case 'Approve':
    case 'Reinstate':
      return 'Approved';
    case 'Reject':
    case 'Suspend':
      return 'Suspended';
  }
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
  // IMPORTANT: depend on the stable `refetch` fn, NOT the whole query object.
  // `useDockBootstrapData()` returns a fresh `{...query, data}` object every
  // render, so depending on it here would re-fire the focus effect on every
  // render → infinite refetch storm (frozen taps + auth-lock "steal" errors).
  const refetchBootstrap = bootstrapQuery.refetch;

  useFocusEffect(useCallback(() => {
    void refetchBootstrap();
  }, [refetchBootstrap]));

  const [filter, setFilter] = useState<CompanyStatus | 'All'>('All');
  // Auto-switch to the Pending filter whenever new pending companies arrive
  // (useState initial value is only read once, so we need an effect).
  useEffect(() => {
    if (companies.some((c) => c.status === 'PendingApproval')) {
      setFilter((prev) => prev === 'All' ? 'PendingApproval' : prev);
    }
  }, [companies.length, companies]);
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
    setActionMode('none');
    setRejectReason('');
  };

  // Load full profile context for the selected company so Super Admin can
  // make an informed approval decision (industry, bio, legal name, admin
  // contact, billing status, rejection reason).
  const profileQ = useQuery({
    queryKey: ['admin-company-profile', selected?.id],
    enabled: Boolean(selected?.id && detailModal),
    queryFn: async () => {
      const { data } = await supabase
        .from('companies')
        .select('display_name,industry,public_bio,website,legal_business_name,business_number,business_address,admin_contact_name,admin_contact_email,admin_contact_phone,billing_setup_completed_at,billing_mode,payment_terms_days,profile_completed_at,submitted_for_approval_at,verified_at,approval_rejection_reason')
        .eq('id', selected!.id)
        .maybeSingle();
      return data as Record<string, string | null> | null;
    },
  });

  const [rejectReason, setRejectReason] = useState('');
  const [actionMode, setActionMode] = useState<'none' | 'reject' | 'suspend'>('none');
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Set a company's approval status.
   *
   * IMPORTANT: the `company_status` enum only has three values —
   * `PendingApproval | Approved | Suspended`. There is NO `Active` and NO
   * `Rejected`. Sending those to a `::company_status` cast throws
   * `invalid input value for enum company_status: "Active"`. So we normalise
   * every approval intent down to a real enum value before hitting the DB:
   *   Approve / Reinstate / Active → Approved
   *   Reject / Suspend             → Suspended
   *
   * We try `admin_set_company_approval` first (it also stores
   * `approval_rejection_reason` for the company to see), and fall back to
   * `admin_set_company_status` if that RPC isn't deployed. Both receive an
   * already-valid enum value, so the cast can never fail.
   */
  const setCompanyStatus = async (id: string, action: ApprovalAction, reason?: string): Promise<void> => {
    const enumStatus = toEnumStatus(action);
    setBusyId(id);
    try {
      const approvalCall = await supabase.rpc('admin_set_company_approval', {
        p_company_id: id,
        p_status: enumStatus,
        p_reason: reason ?? null,
      });
      if (approvalCall.error) {
        // Fall back to the core enum RPC (always deployed since 0007).
        const statusCall = await supabase.rpc('admin_set_company_status', {
          p_company_id: id,
          p_status: enumStatus,
          p_reason: reason ?? null,
        });
        if (statusCall.error) throw statusCall.error;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Unable to update company', message);
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = (id: string) => {
    void (async () => {
      try {
        await setCompanyStatus(id, 'Approve');
        setDetailModal(false);
        Alert.alert('Company Approved', 'The company is now active on the platform.');
        await bootstrapQuery.refetch();
      } catch {
        // error already surfaced via Alert
      }
    })();
  };

  const submitNegative = (id: string, status: 'Reject' | 'Suspend', reason: string) => {
    if (reason.trim().length < 10) {
      Alert.alert('Reason required', 'Please provide at least 10 characters explaining why.');
      return;
    }
    void (async () => {
      try {
        await setCompanyStatus(id, status, reason.trim());
        setDetailModal(false);
        setActionMode('none');
        setRejectReason('');
        await bootstrapQuery.refetch();
      } catch {
        // error already surfaced via Alert
      }
    })();
  };

  const handleSuspend = (_id: string) => { setActionMode('suspend'); setRejectReason(''); };
  const handleReject = (_id: string) => { setActionMode('reject'); setRejectReason(''); };

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
          <Card key={c.id} style={styles.card}>
            {/* Tappable area for detail view */}
            <Pressable onPress={() => openDetail(c)} android_ripple={{ color: C.border }}>
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
            </Pressable>
            {/* Pending action buttons — outside the Pressable so they get their own touch responder */}
            {c.status === 'PendingApproval' && (
              <View style={styles.pendingActions}>
                <TouchableOpacity
                  style={[styles.inlineBtn, busyId === c.id && styles.inlineBtnDisabled]}
                  onPress={() => handleApprove(c.id)}
                  activeOpacity={0.75}
                  disabled={busyId === c.id}
                >
                  {busyId === c.id ? (
                    <ActivityIndicator size="small" color={C.white} />
                  ) : (
                    <>
                      <CheckCircle size={13} color={C.white} />
                      <Text style={styles.inlineBtnText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inlineBtn, styles.inlineBtnDanger]}
                  onPress={() => { openDetail(c); }}
                  activeOpacity={0.75}
                  disabled={busyId === c.id}
                >
                  <XCircle size={13} color={C.red} />
                  <Text style={[styles.inlineBtnText, { color: C.red }]}>Review / Reject</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>
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

                {/* Profile context — required by Super Admin to make an informed decision */}
                <Text style={styles.editSectionTitle}>Approval context</Text>
                <View style={styles.contextCard}>
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Industry" value={profileQ.data?.industry} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Public bio" value={profileQ.data?.public_bio} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Website" value={profileQ.data?.website} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Legal name" value={profileQ.data?.legal_business_name} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Business #" value={profileQ.data?.business_number} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Business address" value={profileQ.data?.business_address} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Admin contact" value={(profileQ.data?.admin_contact_name ?? '') + (profileQ.data?.admin_contact_email ? ` · ${profileQ.data.admin_contact_email}` : '') + (profileQ.data?.admin_contact_phone ? ` · ${profileQ.data.admin_contact_phone}` : '')} />
                  <ContextRow icon={<CreditCard size={13} color={profileQ.data?.billing_setup_completed_at ? C.green : C.yellow} />} label="Billing" value={profileQ.data?.billing_setup_completed_at ? `${profileQ.data?.billing_mode ?? 'ManualInvoice'} · Net ${profileQ.data?.payment_terms_days ?? 14}d` : 'Not set up'} />
                  <ContextRow icon={<FileText size={13} color={C.textMuted} />} label="Submitted" value={profileQ.data?.submitted_for_approval_at ? new Date(profileQ.data.submitted_for_approval_at).toLocaleString() : '—'} />
                  {profileQ.data?.approval_rejection_reason ? (
                    <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '40' }}>
                      <Text style={{ fontSize: 11, color: C.red, fontWeight: '700' as const }}>Previous rejection / suspension reason</Text>
                      <Text style={{ fontSize: 12, color: C.red, marginTop: 2 }}>{profileQ.data.approval_rejection_reason}</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={styles.editSectionTitle}>Actions</Text>
                {actionMode !== 'none' ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 12, color: C.textMuted }}>
                      {actionMode === 'reject' ? 'Rejection reason (visible to the company, min 10 chars)' : 'Suspension reason (visible to the company, min 10 chars)'}
                    </Text>
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder="e.g. Missing valid business registration"
                      placeholderTextColor={C.textMuted}
                      style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 }}
                      multiline
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button label={actionMode === 'reject' ? 'Confirm reject' : 'Confirm suspend'} onPress={() => submitNegative(selected.id, actionMode === 'reject' ? 'Reject' : 'Suspend', rejectReason)} variant="danger" />
                      <Button label="Cancel" onPress={() => { setActionMode('none'); setRejectReason(''); }} variant="ghost" />
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionBtns}>
                    {selected.status !== 'Approved' && (
                      <Button label="Approve Company" onPress={() => handleApprove(selected.id)} fullWidth icon={<CheckCircle size={15} color={C.white} />} />
                    )}
                    {String(selected.status) !== 'Rejected' && (
                      <Button label="Reject Company" onPress={() => handleReject(selected.id)} variant="danger" fullWidth icon={<XCircle size={15} color={C.red} />} />
                    )}
                    {selected.status !== 'Suspended' && (
                      <Button label="Suspend Company" onPress={() => handleSuspend(selected.id)} variant="danger" fullWidth icon={<XCircle size={15} color={C.red} />} />
                    )}
                    {selected.status === 'Suspended' && (
                      <Button label="Reinstate Company" onPress={() => { void setCompanyStatus(selected.id, 'Reinstate').then(() => { setDetailModal(false); void bootstrapQuery.refetch(); }).catch(() => {}); }} variant="outline" fullWidth />
                    )}
                    <Button label="Close" onPress={() => setDetailModal(false)} variant="ghost" fullWidth />
                  </View>
                )}
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
  inlineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8 },
  inlineBtnDanger: { backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '60' },
  inlineBtnDisabled: { opacity: 0.6 },
  inlineBtnText: { fontSize: 13, fontWeight: '600' as const, color: C.white },
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
  contextCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, gap: 8 },
  ctxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  ctxLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const, width: 110 },
  ctxValue: { fontSize: 13, color: C.text, flex: 1, lineHeight: 18 },
});

function ContextRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <View style={styles.ctxRow}>
      <View style={{ marginTop: 2 }}>{icon}</View>
      <Text style={styles.ctxLabel}>{label}</Text>
      <Text style={styles.ctxValue}>{value && value.toString().trim() ? value : '—'}</Text>
    </View>
  );
}
