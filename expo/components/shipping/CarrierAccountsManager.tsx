import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Modal } from 'react-native';
import { Plus, Truck, Trash2, Edit3, X, ShieldCheck, ShieldOff, KeyRound } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Scope = 'platform' | 'company';

interface SupportedCarrier {
  code: string;
  name: string;
  implemented: boolean;
  mode: 'aggregator' | 'direct';
  requires: string[];
}

interface CarrierAccount {
  id: string;
  company_id: string | null;
  scope: Scope;
  carrier_code: string;
  display_name: string;
  account_number: string;
  mode: string;
  credentials_secret_ref: string;
  is_active: boolean;
  data: Record<string, unknown>;
  last_verified_at: string | null;
  last_error: string | null;
}

interface Props {
  scope: Scope;
  companyId?: string | null;
}

export default function CarrierAccountsManager({ scope, companyId }: Props) {
  const utils = trpc.useUtils();
  const listQuery = trpc.carriers.list.useQuery({ scope, companyId: companyId ?? undefined });
  const supportedQuery = trpc.carriers.supported.useQuery();
  const upsert = trpc.carriers.upsert.useMutation({
    onSuccess: () => { void utils.carriers.list.invalidate(); setEditing(null); },
  });
  const remove = trpc.carriers.delete.useMutation({
    onSuccess: () => void utils.carriers.list.invalidate(),
  });

  const [editing, setEditing] = useState<Partial<CarrierAccount> | null>(null);
  const accounts = useMemo<CarrierAccount[]>(() => (listQuery.data ?? []) as CarrierAccount[], [listQuery.data]);
  const supported = useMemo<SupportedCarrier[]>(() => (supportedQuery.data ?? []) as SupportedCarrier[], [supportedQuery.data]);

  const handleSave = useCallback(async () => {
    if (!editing?.carrier_code) { Alert.alert('Pick a carrier'); return; }
    if (scope === 'company' && !companyId) { Alert.alert('No active company'); return; }
    try {
      await upsert.mutateAsync({
        id: editing.id,
        scope,
        companyId: scope === 'company' ? companyId : null,
        carrierCode: editing.carrier_code,
        displayName: editing.display_name ?? '',
        accountNumber: editing.account_number ?? '',
        mode: (editing.mode as 'test' | 'live') ?? 'test',
        credentialsSecretRef: editing.credentials_secret_ref ?? '',
        data: (editing.data as Record<string, unknown>) ?? {},
        isActive: editing.is_active ?? true,
      });
    } catch (e) {
      Alert.alert('Unable to save', e instanceof Error ? e.message : 'unknown');
    }
  }, [editing, scope, companyId, upsert]);

  const handleDelete = useCallback((acc: CarrierAccount) => {
    Alert.alert('Remove carrier?', `${acc.carrier_code} (${acc.mode})`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove.mutate({ id: acc.id }) },
    ]);
  }, [remove]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} tintColor={C.accent} />}
      >
        <Card style={styles.headerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{scope === 'platform' ? 'Platform carrier accounts' : 'Company carrier accounts'}</Text>
            <Text style={styles.sub}>
              {scope === 'platform'
                ? 'Dock2Door-managed carrier credentials. Used as fallback when a provider company has no own account.'
                : 'Connect this company\u2019s own Canada Post / UPS / DHL / FedEx / EasyPost / Shippo accounts.'}
            </Text>
          </View>
          <Button label="Add" onPress={() => setEditing({ scope, mode: 'test', is_active: true })} icon={<Plus size={14} color={C.white} />} />
        </Card>

        {accounts.length === 0 ? (
          <EmptyState icon={Truck} title="No carriers connected" description="Add EasyPost, Shippo, Canada Post, UPS, DHL, or FedEx to start rate-shopping and printing labels." />
        ) : accounts.map((acc) => {
          const s = supported.find((x) => x.code === acc.carrier_code);
          return (
            <Card key={acc.id} style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: acc.is_active ? C.greenDim : C.cardElevated }]}>
                  <Truck size={16} color={acc.is_active ? C.green : C.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{s?.name ?? acc.carrier_code} {acc.display_name ? `\u00b7 ${acc.display_name}` : ''}</Text>
                  <Text style={styles.meta}>
                    {acc.mode.toUpperCase()} \u00b7 {s?.mode ?? '-'} \u00b7 {acc.account_number || 'no account#'} \u00b7 secret: {acc.credentials_secret_ref || 'unset'}
                  </Text>
                  {acc.last_error ? <Text style={styles.err}>{acc.last_error}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => setEditing(acc)} style={styles.iconBtn}><Edit3 size={14} color={C.text} /></TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(acc)} style={styles.iconBtn}><Trash2 size={14} color={C.red} /></TouchableOpacity>
              </View>
            </Card>
          );
        })}

        <Card style={styles.helpCard}>
          <Text style={styles.helpTitle}>How credentials work</Text>
          <Text style={styles.helpText}>
            For security, API keys and OAuth secrets never live in the client. Set a Supabase Edge Function secret per carrier
            (e.g. `EASYPOST_API_KEY`, `SHIPPO_API_KEY`, `CANADA_POST_CREDENTIALS`, `UPS_CREDENTIALS`, `DHL_CREDENTIALS`, `FEDEX_CREDENTIALS`)
            and reference its name in the &quot;Secret env name&quot; field below. Direct carriers expect a JSON value such as
            {`{"username":"...","password":"...","customer_number":"..."}`} or {`{"client_id":"...","client_secret":"..."}`}.
          </Text>
        </Card>

        <Card style={styles.helpCard}>
          <Text style={styles.helpTitle}>Supported carriers</Text>
          {supported.map((s) => (
            <View key={s.code} style={styles.supportRow}>
              <Text style={styles.supportName}>{s.name}</Text>
              <Text style={styles.supportMeta}>{s.mode} \u00b7 needs {s.requires.join(', ')}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{editing?.id ? 'Edit carrier' : 'Add carrier'}</Text>
              <TouchableOpacity onPress={() => setEditing(null)} style={styles.iconBtn}><X size={16} color={C.text} /></TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Carrier</Text>
            <View style={styles.chipRow}>
              {supported.map((s) => (
                <TouchableOpacity
                  key={s.code}
                  onPress={() => setEditing((e) => ({ ...e, carrier_code: s.code }))}
                  style={[styles.chip, editing?.carrier_code === s.code && styles.chipActive]}
                >
                  <Text style={[styles.chipText, editing?.carrier_code === s.code && styles.chipTextActive]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input label="Display name" value={editing?.display_name ?? ''} onChangeText={(t) => setEditing((e) => ({ ...e, display_name: t }))} />
            <Input label="Account number" value={editing?.account_number ?? ''} onChangeText={(t) => setEditing((e) => ({ ...e, account_number: t }))} autoCapitalize="none" />
            <Input label="Secret env name (Supabase)" placeholder="e.g. UPS_CREDENTIALS" value={editing?.credentials_secret_ref ?? ''} onChangeText={(t) => setEditing((e) => ({ ...e, credentials_secret_ref: t }))} autoCapitalize="none" />

            <Text style={styles.fieldLabel}>Mode</Text>
            <View style={styles.chipRow}>
              {(['test', 'live'] as const).map((m) => (
                <TouchableOpacity key={m} onPress={() => setEditing((e) => ({ ...e, mode: m }))} style={[styles.chip, editing?.mode === m && styles.chipActive]}>
                  <Text style={[styles.chipText, editing?.mode === m && styles.chipTextActive]}>{m.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.row}>
              <TouchableOpacity onPress={() => setEditing((e) => ({ ...e, is_active: !(e?.is_active ?? true) }))} style={styles.toggleRow}>
                {editing?.is_active === false
                  ? <ShieldOff size={16} color={C.red} />
                  : <ShieldCheck size={16} color={C.green} />}
                <Text style={styles.toggleText}>{editing?.is_active === false ? 'Disabled' : 'Active'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalFoot}>
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
              <Button label="Save" icon={<KeyRound size={14} color={C.white} />} loading={upsert.isPending} onPress={() => void handleSave()} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 12, paddingBottom: 80 },
  headerCard: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  card: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  meta: { fontSize: 11, color: C.textSecondary, marginTop: 4 },
  err: { fontSize: 11, color: C.red, marginTop: 4 },
  iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.cardElevated, borderWidth: 1, borderColor: C.border },
  helpCard: { padding: 14, gap: 6 },
  helpTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  helpText: { fontSize: 11, color: C.textSecondary, lineHeight: 16 },
  supportRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  supportName: { fontSize: 12, fontWeight: '600' as const, color: C.text },
  supportMeta: { fontSize: 11, color: C.textMuted },

  modalRoot: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, gap: 12, maxHeight: '92%' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  fieldLabel: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardElevated },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  chipTextActive: { color: C.accent },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardElevated },
  toggleText: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  modalFoot: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
