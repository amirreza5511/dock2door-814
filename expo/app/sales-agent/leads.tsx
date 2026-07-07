import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, X, ChevronDown } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { LeadStatus, SalesVertical } from '@/constants/types';

const VERTICALS: { id: SalesVertical; label: string }[] = [
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'drayage', label: 'Drayage company' },
  { id: 'freight_forwarder', label: 'Freight forwarder' },
  { id: 'employer', label: 'Employer' },
  { id: 'trucking', label: 'Trucking / carrier' },
  { id: 'shipper', label: 'Shipper' },
  { id: 'customer', label: 'Customer' },
  { id: 'service', label: 'Service provider' },
  { id: 'worker', label: 'Worker' },
  { id: 'driver', label: 'Driver' },
  { id: 'owner_operator', label: 'Owner-operator' },
];

const STATUSES: LeadStatus[] = ['New', 'Contacted', 'Onboarding', 'Won', 'Lost'];
const STATUS_TINT: Record<LeadStatus, string> = {
  New: C.blue, Contacted: C.yellow, Onboarding: C.purple, Won: C.green, Lost: C.textMuted,
};

interface LeadRow {
  id: string; business_name: string; contact_name: string; contact_email: string;
  contact_phone: string; vertical: SalesVertical; status: LeadStatus; notes: string;
}

interface Draft {
  id?: string; businessName: string; contactName: string; contactEmail: string;
  contactPhone: string; vertical: SalesVertical; status: LeadStatus; notes: string;
}

const EMPTY_DRAFT: Draft = {
  businessName: '', contactName: '', contactEmail: '', contactPhone: '',
  vertical: 'warehouse', status: 'New', notes: '',
};

export default function SalesAgentLeads() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const leadsQuery = trpc.sales.leads.useQuery();
  const upsert = trpc.sales.upsertLead.useMutation({
    onSuccess: async () => { await utils.sales.leads.invalidate(); await utils.sales.dashboard.invalidate(); },
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [filter, setFilter] = useState<LeadStatus | 'All'>('All');

  const leads = useMemo(() => (leadsQuery.data as LeadRow[] | undefined) ?? [], [leadsQuery.data]);
  const filtered = filter === 'All' ? leads : leads.filter((l) => l.status === filter);

  const openNew = () => { setDraft(EMPTY_DRAFT); setModalOpen(true); };
  const openEdit = (l: LeadRow) => {
    setDraft({
      id: l.id, businessName: l.business_name, contactName: l.contact_name,
      contactEmail: l.contact_email, contactPhone: l.contact_phone,
      vertical: l.vertical, status: l.status, notes: l.notes,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!draft.businessName.trim() && !draft.contactName.trim()) {
      Alert.alert('Add a name', 'Enter a business or contact name for this lead.');
      return;
    }
    try {
      await upsert.mutateAsync(draft);
      setModalOpen(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Leads pipeline</Text>
        <View style={styles.headerActions}>
          <SupportMenu />
          <TouchableOpacity onPress={openNew} style={[styles.iconBtn, styles.addBtn]}><Plus size={20} color={C.white} /></TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
        {(['All', ...STATUSES] as const).map((s) => (
          <TouchableOpacity key={s} onPress={() => setFilter(s)} style={[styles.chip, filter === s && styles.chipActive]}>
            <Text style={[styles.chipText, filter === s && styles.chipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {leadsQuery.isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading leads" /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No leads yet</Text>
          <Text style={styles.emptyMsg}>Add a prospect you&apos;re working — a warehouse, driver, employer or company — and move them through your pipeline.</Text>
          <Button label="Add your first lead" onPress={openNew} icon={<Plus size={16} color={C.white} />} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
          {filtered.map((l) => (
            <TouchableOpacity key={l.id} activeOpacity={0.85} onPress={() => openEdit(l)}>
              <Card style={styles.leadCard}>
                <View style={styles.leadTop}>
                  <Text style={styles.leadName}>{l.business_name || l.contact_name || 'Unnamed lead'}</Text>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_TINT[l.status] + '22' }]}>
                    <Text style={[styles.statusText, { color: STATUS_TINT[l.status] }]}>{l.status}</Text>
                  </View>
                </View>
                <Text style={styles.leadMeta}>{VERTICALS.find((v) => v.id === l.vertical)?.label ?? l.vertical}</Text>
                {l.contact_name || l.contact_phone ? (
                  <Text style={styles.leadContact}>{[l.contact_name, l.contact_phone].filter(Boolean).join(' · ')}</Text>
                ) : null}
              </Card>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{draft.id ? 'Edit lead' : 'New lead'}</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.iconBtn}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              <Input label="Business name" value={draft.businessName} onChangeText={(v) => setDraft((p) => ({ ...p, businessName: v }))} placeholder="Acme Warehousing" />
              <Input label="Contact name" value={draft.contactName} onChangeText={(v) => setDraft((p) => ({ ...p, contactName: v }))} placeholder="Jane Smith" />
              <Input label="Contact email" value={draft.contactEmail} onChangeText={(v) => setDraft((p) => ({ ...p, contactEmail: v }))} placeholder="jane@acme.com" keyboardType="email-address" autoCapitalize="none" />
              <Input label="Contact phone" value={draft.contactPhone} onChangeText={(v) => setDraft((p) => ({ ...p, contactPhone: v }))} placeholder="+1 555 000 0000" keyboardType="phone-pad" />

              <Text style={styles.pickerLabel}>Vertical</Text>
              <View style={styles.pickerWrap}>
                {VERTICALS.map((v) => (
                  <TouchableOpacity key={v.id} onPress={() => setDraft((p) => ({ ...p, vertical: v.id }))} style={[styles.optChip, draft.vertical === v.id && styles.optChipActive]}>
                    <Text style={[styles.optChipText, draft.vertical === v.id && styles.optChipTextActive]}>{v.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.pickerLabel}>Status</Text>
              <View style={styles.pickerWrap}>
                {STATUSES.map((s) => (
                  <TouchableOpacity key={s} onPress={() => setDraft((p) => ({ ...p, status: s }))} style={[styles.optChip, draft.status === s && styles.optChipActive]}>
                    <Text style={[styles.optChipText, draft.status === s && styles.optChipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Input label="Notes" value={draft.notes} onChangeText={(v) => setDraft((p) => ({ ...p, notes: v }))} placeholder="Call back Tuesday, needs 200 pallets…" multiline numberOfLines={3} />
              <Button label={draft.id ? 'Save changes' : 'Add lead'} onPress={() => void save()} loading={upsert.isPending} fullWidth size="lg" />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  addBtn: { backgroundColor: C.accent, borderColor: C.accent },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  filterBar: { maxHeight: 56, flexGrow: 0 },
  filterContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.white },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  emptyMsg: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, marginTop: 8, lineHeight: 19 },
  list: { padding: 16, gap: 10 },
  leadCard: { padding: 14, gap: 4 },
  leadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  leadName: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  statusDot: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  leadMeta: { fontSize: 12, color: C.accent, fontWeight: '600' as const },
  leadContact: { fontSize: 12, color: C.textSecondary },
  modalRoot: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  pickerLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  optChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  optChipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  optChipTextActive: { color: C.accent },
});
