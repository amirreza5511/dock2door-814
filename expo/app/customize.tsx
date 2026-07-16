import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, SlidersHorizontal, Send, Check, Clock, X, EyeOff,
  ListPlus, Sparkles, Building2, Tag, ArrowUp, ArrowDown, ArrowUpDown, Settings2,
} from 'lucide-react-native';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

/** Modules a company can ask to hide from its own workspace. */
const HIDEABLE: { key: string; label: string }[] = [
  { key: 'reports', label: 'Reports & KPIs' },
  { key: 'settlement', label: 'Driver settlement' },
  { key: 'fuel-surcharge', label: 'Fuel surcharge' },
  { key: 'shipping-lines', label: 'Shipping lines' },
  { key: 'equipment-report', label: 'Equipment & charges' },
  { key: 'dead-runs', label: 'Dead runs' },
  { key: 'terminals', label: 'Terminals' },
  { key: 'orders-board', label: 'Orders Board' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'rates', label: 'Rates & Zones' },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'stat-open', label: 'Stat: Open Orders' },
  { key: 'stat-active', label: 'Stat: Active' },
  { key: 'stat-in-transit', label: 'Stat: In Transit' },
  { key: 'stat-drivers', label: 'Stat: Drivers' },
];

type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';
const FIELD_TYPES: { key: FieldType; label: string }[] = [
  { key: 'text', label: 'Text' },
  { key: 'number', label: 'Number' },
  { key: 'date', label: 'Date' },
  { key: 'boolean', label: 'Yes / No' },
  { key: 'select', label: 'Dropdown' },
];

interface DraftField {
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

/** Common terms a company may want to rename across its workspace. */
const RENAMABLE = ['Terminals', 'Fleet', 'Equipment & charges', 'Custom fields', 'Chassis', 'Driver'];

/** Sections a company can reorder (most-used first). Keys match dashboard moduleKeys. */
const ORDERABLE: { key: string; label: string }[] = [
  { key: 'orders-board', label: 'Orders Board' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'terminals', label: 'Terminals' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'rates', label: 'Rates & Zones' },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'settlement', label: 'Driver settlement' },
  { key: 'reports', label: 'Reports & KPIs' },
  { key: 'fuel-surcharge', label: 'Fuel surcharge' },
  { key: 'shipping-lines', label: 'Shipping lines' },
  { key: 'equipment-report', label: 'Equipment & charges' },
  { key: 'dead-runs', label: 'Dead runs' },
];

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'];

interface ReqRow {
  id: string;
  title: string;
  details: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  createdAt?: string;
  payload?: Record<string, unknown>;
}

const STATUS_META: Record<string, { color: string; label: string; Icon: typeof Check }> = {
  pending: { color: C.yellow, label: 'Pending review', Icon: Clock },
  approved: { color: C.green, label: 'Approved & applied', Icon: Check },
  rejected: { color: C.red, label: 'Not approved', Icon: X },
};

export default function CustomizeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.customization.mySettings.useQuery();
  const requestsQuery = trpc.customization.myRequests.useQuery();
  const submit = trpc.customization.submit.useMutation();

  const [title, setTitle] = useState<string>('');
  const [details, setDetails] = useState<string>('');
  const [hide, setHide] = useState<Set<string>>(new Set());
  const [fieldLabel, setFieldLabel] = useState<string>('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [fieldOptions, setFieldOptions] = useState<string>('');
  const [customFields, setCustomFields] = useState<DraftField[]>([]);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [invoiceDueDays, setInvoiceDueDays] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');

  const settings = (settingsQuery.data ?? {}) as { hiddenModules?: string[]; customFields?: { label?: string }[]; terminology?: Record<string, string> };
  const requests = useMemo(() => (requestsQuery.data ?? []) as ReqRow[], [requestsQuery.data]);
  const activeHidden = settings.hiddenModules ?? [];

  const toggleHide = (key: string) =>
    setHide((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const addField = () => {
    const l = fieldLabel.trim();
    if (!l) return;
    const opts = fieldType === 'select'
      ? fieldOptions.split(',').map((o) => o.trim()).filter(Boolean)
      : undefined;
    if (fieldType === 'select' && (!opts || opts.length === 0)) {
      Alert.alert('Add choices', 'A dropdown field needs at least one comma-separated choice.');
      return;
    }
    setCustomFields((prev) =>
      prev.some((f) => f.label === l) ? prev : [...prev, { label: l, type: fieldType, required: false, ...(opts ? { options: opts } : {}) }],
    );
    setFieldLabel('');
    setFieldOptions('');
    setFieldType('text');
  };

  const setRename = (t: string, value: string) =>
    setRenames((prev) => {
      const next = { ...prev };
      if (value.trim()) next[t] = value.trim(); else delete next[t];
      return next;
    });

  const orderedList = useMemo(() => {
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...ORDERABLE].sort((a, b) => {
      const ra = rank.has(a.key) ? (rank.get(a.key) as number) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.key) ? (rank.get(b.key) as number) : Number.MAX_SAFE_INTEGER;
      return ra === rb ? 0 : ra - rb;
    });
  }, [order]);

  const moveSection = (key: string, dir: -1 | 1) => {
    setOrder(() => {
      const base = orderedList.map((o) => o.key);
      const idx = base.indexOf(key);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= base.length) return base;
      const next = [...base];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const buildPayload = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    if (hide.size > 0) payload.hiddenModules = Array.from(hide);
    if (customFields.length > 0) {
      payload.customFields = customFields.map((f) => ({
        key: f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        label: f.label,
        type: f.type,
        required: f.required,
        ...(f.options ? { options: f.options } : {}),
      }));
    }
    if (Object.keys(renames).length > 0) payload.terminology = renames;
    if (order.length > 0) payload.sectionOrder = order;
    const defaults: Record<string, unknown> = {};
    if (invoiceDueDays.trim() && Number.isFinite(Number(invoiceDueDays))) defaults.invoiceDueDays = Number(invoiceDueDays);
    if (currency.trim()) defaults.currency = currency.trim();
    if (Object.keys(defaults).length > 0) payload.defaults = defaults;
    return payload;
  }, [hide, customFields, renames, order, invoiceDueDays, currency]);

  const canSubmit = title.trim().length > 0 || hide.size > 0 || customFields.length > 0 || Object.keys(renames).length > 0 || order.length > 0 || invoiceDueDays.trim().length > 0 || currency.trim().length > 0;

  const doSubmit = useCallback(async () => {
    const payload = buildPayload();
    const derivedTitle = title.trim()
      || (hide.size > 0 ? `Hide ${hide.size} module(s)` : '')
      || (customFields.length > 0 ? `Add ${customFields.length} custom field(s)` : '')
      || (Object.keys(renames).length > 0 ? `Rename ${Object.keys(renames).length} term(s)` : '')
      || (order.length > 0 ? 'Reorder my sections' : '')
      || (invoiceDueDays.trim() || currency.trim() ? 'Set workspace defaults' : '');
    if (!derivedTitle) {
      Alert.alert('Add a request', 'Describe what you want changed, or pick a module / field below.');
      return;
    }
    try {
      await submit.mutateAsync({ title: derivedTitle, details: details.trim(), payload });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTitle(''); setDetails(''); setHide(new Set()); setCustomFields([]); setRenames({}); setOrder([]); setInvoiceDueDays(''); setCurrency('');
      await utils.customization.myRequests.invalidate();
      Alert.alert('Request sent', 'Our team will review it and apply the changes to your workspace.');
    } catch (e) {
      Alert.alert('Unable to send', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [buildPayload, title, details, hide, customFields, renames, order, invoiceDueDays, currency, submit, utils]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <View style={styles.badge}><SlidersHorizontal size={14} color={C.purple} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Customize workspace</Text>
            <Text style={styles.headerSub} numberOfLines={1}>Tailor this app to how your company works</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={requestsQuery.isFetching} onRefresh={() => void requestsQuery.refetch()} tintColor={C.accent} />}
      >
        <Card style={styles.introCard}>
          <Building2 size={18} color={C.purple} />
          <Text style={styles.introText}>
            Every company works differently. Tell us what to change — hide sections you never use, add your own
            fields, or describe anything else. We review each request and apply it to your workspace only.
          </Text>
        </Card>

        {/* Active customizations */}
        {(activeHidden.length > 0 || (settings.customFields?.length ?? 0) > 0) ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Active in your workspace</Text>
            {activeHidden.length > 0 ? (
              <Text style={styles.activeLine}>Hidden: {activeHidden.map((k) => HIDEABLE.find((h) => h.key === k)?.label ?? k).join(', ')}</Text>
            ) : null}
            {(settings.customFields?.length ?? 0) > 0 ? (
              <Text style={styles.activeLine}>Custom fields: {(settings.customFields ?? []).map((f) => f.label).join(', ')}</Text>
            ) : null}
          </Card>
        ) : null}

        {/* Composer */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Request a change</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What do you want to change? (short title)"
            placeholderTextColor={C.textMuted}
            style={styles.input}
          />
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Add any detail or context for our team…"
            placeholderTextColor={C.textMuted}
            style={[styles.input, styles.inputMulti]}
            multiline
          />

          <View style={styles.subHead}><EyeOff size={14} color={C.textSecondary} /><Text style={styles.subHeadText}>Hide sections you do not use</Text></View>
          <View style={styles.chipsWrap}>
            {HIDEABLE.map((h) => {
              const on = hide.has(h.key);
              const already = activeHidden.includes(h.key);
              return (
                <TouchableOpacity
                  key={h.key}
                  disabled={already}
                  onPress={() => toggleHide(h.key)}
                  style={[styles.chip, on && styles.chipOn, already && styles.chipDisabled]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn, already && styles.chipTextDisabled]}>
                    {h.label}{already ? ' · hidden' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.subHead}><ListPlus size={14} color={C.textSecondary} /><Text style={styles.subHeadText}>Add custom fields to your orders</Text></View>
          <View style={styles.chipsWrap}>
            {FIELD_TYPES.map((ft) => (
              <TouchableOpacity key={ft.key} onPress={() => setFieldType(ft.key)} style={[styles.chip, fieldType === ft.key && styles.chipOn]}>
                <Text style={[styles.chipText, fieldType === ft.key && styles.chipTextOn]}>{ft.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {fieldType === 'select' ? (
            <TextInput
              value={fieldOptions}
              onChangeText={setFieldOptions}
              placeholder="Choices, comma-separated (e.g. Yard A, Yard B)"
              placeholderTextColor={C.textMuted}
              style={styles.input}
            />
          ) : null}
          <View style={styles.fieldAddRow}>
            <TextInput
              value={fieldLabel}
              onChangeText={setFieldLabel}
              placeholder="e.g. PO number, Yard slot…"
              placeholderTextColor={C.textMuted}
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              onSubmitEditing={addField}
            />
            <TouchableOpacity style={styles.fieldAddBtn} onPress={addField}>
              <Text style={styles.fieldAddBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          {customFields.length > 0 ? (
            <View style={styles.chipsWrap}>
              {customFields.map((f) => (
                <TouchableOpacity key={f.label} onPress={() => setCustomFields((prev) => prev.filter((x) => x.label !== f.label))} style={[styles.chip, styles.chipOn]}>
                  <Text style={styles.chipTextOn}>{f.label} · {f.type}  ×</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <View style={styles.subHead}><Tag size={14} color={C.textSecondary} /><Text style={styles.subHeadText}>Rename terms to match your company</Text></View>
          {RENAMABLE.map((t) => (
            <View key={t} style={styles.renameRow}>
              <Text style={styles.renameLabel}>{t}</Text>
              <TextInput
                value={renames[t] ?? ''}
                onChangeText={(v) => setRename(t, v)}
                placeholder={`Keep "${t}"`}
                placeholderTextColor={C.textMuted}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
              />
            </View>
          ))}

          <View style={styles.subHead}><ArrowUpDown size={14} color={C.textSecondary} /><Text style={styles.subHeadText}>Reorder your sections (most-used first)</Text></View>
          {orderedList.map((s, i) => (
            <View key={s.key} style={styles.orderRow}>
              <Text style={styles.orderIndex}>{i + 1}</Text>
              <Text style={styles.orderLabel}>{s.label}</Text>
              <TouchableOpacity disabled={i === 0} onPress={() => moveSection(s.key, -1)} style={[styles.orderBtn, i === 0 && styles.orderBtnDisabled]}>
                <ArrowUp size={16} color={i === 0 ? C.textMuted : C.text} />
              </TouchableOpacity>
              <TouchableOpacity disabled={i === orderedList.length - 1} onPress={() => moveSection(s.key, 1)} style={[styles.orderBtn, i === orderedList.length - 1 && styles.orderBtnDisabled]}>
                <ArrowDown size={16} color={i === orderedList.length - 1 ? C.textMuted : C.text} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.subHead}><Settings2 size={14} color={C.textSecondary} /><Text style={styles.subHeadText}>Workspace defaults for new records</Text></View>
          <View style={styles.renameRow}>
            <Text style={styles.renameLabel}>Invoice due</Text>
            <TextInput
              value={invoiceDueDays}
              onChangeText={setInvoiceDueDays}
              placeholder="Days (e.g. 21)"
              placeholderTextColor={C.textMuted}
              keyboardType="numeric"
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
            />
          </View>
          <View style={styles.chipsWrap}>
            {CURRENCIES.map((cur) => (
              <TouchableOpacity key={cur} onPress={() => setCurrency((prev) => (prev === cur ? '' : cur))} style={[styles.chip, currency === cur && styles.chipOn]}>
                <Text style={[styles.chipText, currency === cur && styles.chipTextOn]}>{cur}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            disabled={!canSubmit || submit.isPending}
            onPress={() => void doSubmit()}
          >
            <Send size={16} color={C.white} />
            <Text style={styles.submitBtnText}>{submit.isPending ? 'Sending…' : 'Send request for review'}</Text>
          </TouchableOpacity>
        </Card>

        {/* History */}
        <Text style={styles.historyTitle}>Your requests</Text>
        {requests.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Sparkles size={20} color={C.textMuted} />
            <Text style={styles.emptyText}>No requests yet. Anything you send will show here with its status.</Text>
          </Card>
        ) : requests.map((r) => {
          const meta = STATUS_META[r.status] ?? STATUS_META.pending;
          return (
            <Card key={r.id} style={styles.reqCard}>
              <View style={styles.reqTop}>
                <Text style={styles.reqTitle}>{r.title}</Text>
                <View style={[styles.statusPill, { backgroundColor: meta.color + '18', borderColor: meta.color + '55' }]}>
                  <meta.Icon size={12} color={meta.color} />
                  <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              {r.details ? <Text style={styles.reqDetails}>{r.details}</Text> : null}
              {r.adminNote ? <Text style={styles.reqNote}>Note from our team: {r.adminNote}</Text> : null}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  badge: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.purple + '22', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  scroll: { padding: 16, gap: 14 },
  introCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.purple + '10', borderColor: C.purple + '33' },
  introText: { flex: 1, fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  activeLine: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  input: { backgroundColor: C.bgSecondary, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 14, marginBottom: 4 },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' as const },
  subHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  subHeadText: { fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.purpleDim, borderColor: C.purple },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 12.5, fontWeight: '600' as const, color: C.textSecondary },
  chipTextOn: { color: C.purple, fontWeight: '700' as const, fontSize: 12.5 },
  chipTextDisabled: { color: C.textMuted },
  fieldAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  renameLabel: { width: 96, fontSize: 12.5, fontWeight: '700' as const, color: C.textSecondary },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orderIndex: { width: 20, fontSize: 12, fontWeight: '800' as const, color: C.textMuted, textAlign: 'center' as const },
  orderLabel: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: C.text },
  orderBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  orderBtnDisabled: { opacity: 0.4 },
  fieldAddBtn: { paddingHorizontal: 16, height: 46, borderRadius: 12, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  fieldAddBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.accent },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.purple, borderRadius: 12, paddingVertical: 13, marginTop: 4 },
  submitBtnDisabled: { backgroundColor: C.border },
  submitBtnText: { fontSize: 14, fontWeight: '800' as const, color: C.white },
  historyTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text, marginTop: 4 },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyText: { flex: 1, fontSize: 12.5, color: C.textMuted, lineHeight: 18 },
  reqCard: { gap: 8 },
  reqTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqTitle: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: C.text },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: '800' as const },
  reqDetails: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  reqNote: { fontSize: 12, color: C.text, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, lineHeight: 17 },
});
