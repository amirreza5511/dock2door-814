import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BadgeDollarSign, Building2, CalendarClock, Check, ChevronDown, FileText, Plus, Receipt,
  Send, Trash2, TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Tab = 'invoices' | 'accounting';

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

interface InvoiceItem {
  id: string;
  invoice_number?: string | null;
  total_amount?: string | number | null;
  currency?: string | null;
  status?: string | null;
  customer_name?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  provider_company_id?: string | null;
}

interface CompanyOpt { id: string; name: string; type: string; city: string }
interface ExpenseItem {
  id: string;
  category?: string | null;
  vendor?: string | null;
  description?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  incurred_on?: string | null;
}

interface AccountingSummary {
  collected: number;
  outstanding: number;
  overdue: number;
  draft: number;
  expenses: number;
  net: number;
  invoiceCount: number;
  aging: { current: number; d1_30: number; d31_60: number; d60_plus: number };
}

interface InvoicingScreenProps {
  title?: string;
  subtitle?: string;
  /** The company id issuing invoices (provider). Used to scope the "your invoices" list. */
  providerCompanyId?: string | null;
}

const newLine = (desc = '', qty = '1', unit = ''): LineDraft => ({ key: Math.random().toString(36).slice(2), description: desc, quantity: qty, unitPrice: unit });

/** Common drayage accessorial charges billed as invoice line items. */
const ACCESSORIALS: { label: string; desc: string }[] = [
  { label: 'Per diem', desc: 'Per diem (container detention)' },
  { label: 'Demurrage', desc: 'Demurrage (terminal storage)' },
  { label: 'Storage', desc: 'Storage' },
  { label: 'Chassis', desc: 'Chassis usage' },
  { label: 'Waiting', desc: 'Waiting / detention time' },
  { label: 'Pre-pull', desc: 'Pre-pull fee' },
];

export default function InvoicingScreen({ title = 'Invoicing', subtitle, providerCompanyId }: InvoicingScreenProps) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('invoices');
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [expenseOpen, setExpenseOpen] = useState<boolean>(false);

  const invoicesQuery = trpc.payments.listInvoices.useQuery();
  const summaryQuery = trpc.accounting.summary.useQuery();
  const expensesQuery = trpc.accounting.listExpenses.useQuery(undefined, { enabled: tab === 'accounting' });
  const setStatusMutation = trpc.invoicing.setStatus.useMutation();

  const myInvoices: InvoiceItem[] = useMemo(() => {
    const rows = (invoicesQuery.data ?? []) as InvoiceItem[];
    if (!providerCompanyId) return rows;
    return rows.filter((r) => String(r.provider_company_id ?? '') === String(providerCompanyId));
  }, [invoicesQuery.data, providerCompanyId]);

  const summary = (summaryQuery.data ?? null) as AccountingSummary | null;

  const setStatus = async (id: string, status: 'Issued' | 'Void' | 'Paid', method?: string) => {
    try {
      await setStatusMutation.mutateAsync({ id, status, method });
      await Promise.all([invoicesQuery.refetch(), summaryQuery.refetch()]);
      if (status === 'Paid') Alert.alert('Payment recorded', 'The invoice is marked paid and a payout was queued.');
    } catch (err) {
      Alert.alert('Unable to update invoice', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const markPaid = (id: string) => {
    const choose = (m: string) => void setStatus(id, 'Paid', m);
    if (Platform.OS === 'web') {
      const input = window.prompt('Payment method? cash, bank_transfer, cheque, or other', 'bank_transfer');
      if (!input) return;
      choose(input.trim().toLowerCase().replace(/\s+/g, '_') || 'manual');
      return;
    }
    Alert.alert('Record payment', 'How was this invoice paid?', [
      { text: 'Cash', onPress: () => choose('cash') },
      { text: 'Bank transfer', onPress: () => choose('bank_transfer') },
      { text: 'Cheque', onPress: () => choose('cheque') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (invoicesQuery.isLoading && myInvoices.length === 0 && tab === 'invoices') {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading invoices" /></View>;
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

        <View style={styles.segmentRow}>
          {([['invoices', 'Invoices'], ['accounting', 'Accounting']] as [Tab, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => setTab(key)} style={[styles.segment, tab === key && styles.segmentActive]} testID={`inv-segment-${key}`}>
              <Text style={[styles.segmentText, tab === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'invoices' ? (
          <>
            <Button label="New invoice" icon={<Plus size={16} color={C.white} />} onPress={() => setComposerOpen(true)} fullWidth testID="new-invoice" />

            {myInvoices.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices yet" description="Create an invoice to bill a customer for your services." />
            ) : myInvoices.map((inv) => (
              <Card key={inv.id} style={styles.invCard}>
                <View style={styles.invTop}>
                  <View style={styles.iconWrap}><FileText size={16} color={C.blue} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.invTitle}>{inv.invoice_number ?? String(inv.id).slice(0, 8)}</Text>
                    <Text style={styles.invMeta}>
                      {inv.customer_name ? `${inv.customer_name} · ` : ''}
                      ${Number(inv.total_amount ?? 0).toFixed(2)} {String(inv.currency ?? 'CAD').toUpperCase()}
                      {inv.due_date ? ` · due ${new Date(String(inv.due_date)).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                  <StatusBadge status={String(inv.status ?? 'Draft')} />
                </View>
                <View style={styles.invActions}>
                  {inv.status === 'Draft' ? (
                    <Button label="Issue & send" size="sm" icon={<Send size={13} color={C.white} />} onPress={() => void setStatus(String(inv.id), 'Issued')} loading={setStatusMutation.isPending} />
                  ) : null}
                  {inv.status !== 'Paid' && inv.status !== 'Void' ? (
                    <Button label="Mark paid" size="sm" variant="secondary" icon={<Check size={13} color={C.green} />} onPress={() => markPaid(String(inv.id))} loading={setStatusMutation.isPending} />
                  ) : null}
                  {inv.status !== 'Paid' && inv.status !== 'Void' ? (
                    <Button label="Void" size="sm" variant="ghost" onPress={() => void setStatus(String(inv.id), 'Void')} loading={setStatusMutation.isPending} />
                  ) : null}
                </View>
              </Card>
            ))}
          </>
        ) : (
          <AccountingTab
            summary={summary}
            loading={summaryQuery.isLoading}
            expenses={(expensesQuery.data ?? []) as ExpenseItem[]}
            onAddExpense={() => setExpenseOpen(true)}
            onDeleteExpense={async (id) => {
              try {
                await trpcDelete(id);
                await Promise.all([expensesQuery.refetch(), summaryQuery.refetch()]);
              } catch (err) {
                Alert.alert('Unable to delete', err instanceof Error ? err.message : 'Unknown error');
              }
            }}
          />
        )}
      </ScrollView>

      <InvoiceComposer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={async () => {
          setComposerOpen(false);
          await Promise.all([invoicesQuery.refetch(), summaryQuery.refetch()]);
        }}
      />
      <ExpenseComposer
        visible={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onCreated={async () => {
          setExpenseOpen(false);
          await Promise.all([expensesQuery.refetch(), summaryQuery.refetch()]);
        }}
      />
    </View>
  );
}

// Helper mutation caller usable inside the delete handler above without a hook re-render.
let _deleteExpense: ((id: string) => Promise<unknown>) | null = null;
function trpcDelete(id: string): Promise<unknown> {
  if (!_deleteExpense) return Promise.reject(new Error('not ready'));
  return _deleteExpense(id);
}

function AccountingTab({ summary, loading, expenses, onAddExpense, onDeleteExpense }: {
  summary: AccountingSummary | null;
  loading: boolean;
  expenses: ExpenseItem[];
  onAddExpense: () => void;
  onDeleteExpense: (id: string) => void;
}) {
  const deleteMutation = trpc.accounting.deleteExpense.useMutation();
  _deleteExpense = (id: string) => deleteMutation.mutateAsync({ id });

  if (loading && !summary) {
    return <View style={{ paddingVertical: 40 }}><ScreenFeedback state="loading" title="Loading accounting" /></View>;
  }
  const s = summary ?? { collected: 0, outstanding: 0, overdue: 0, draft: 0, expenses: 0, net: 0, invoiceCount: 0, aging: { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 } };
  const netColor = Number(s.net) >= 0 ? C.green : C.red;

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <View style={styles.kpiHead}><TrendingUp size={14} color={C.green} /><Text style={styles.kpiLabel}>Revenue collected</Text></View>
          <Text style={styles.kpiValue}>${Number(s.collected).toFixed(2)}</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={styles.kpiHead}><Wallet size={14} color={C.yellow} /><Text style={styles.kpiLabel}>Outstanding A/R</Text></View>
          <Text style={[styles.kpiValue, { color: C.yellow }]}>${Number(s.outstanding).toFixed(2)}</Text>
        </View>
      </View>
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <View style={styles.kpiHead}><TrendingDown size={14} color={C.red} /><Text style={styles.kpiLabel}>Expenses</Text></View>
          <Text style={[styles.kpiValue, { color: C.red }]}>${Number(s.expenses).toFixed(2)}</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={styles.kpiHead}><BadgeDollarSign size={14} color={netColor} /><Text style={styles.kpiLabel}>Net profit</Text></View>
          <Text style={[styles.kpiValue, { color: netColor }]}>${Number(s.net).toFixed(2)}</Text>
        </View>
      </View>

      <Card elevated style={styles.agingCard}>
        <View style={styles.agingHead}>
          <CalendarClock size={16} color={C.accent} />
          <Text style={styles.agingTitle}>Accounts receivable aging</Text>
          {Number(s.overdue) > 0 ? <View style={styles.overdueBadge}><Text style={styles.overdueText}>${Number(s.overdue).toFixed(0)} overdue</Text></View> : null}
        </View>
        <View style={styles.agingGrid}>
          <AgingCell label="Current" value={s.aging.current} tint={C.green} />
          <AgingCell label="1–30 days" value={s.aging.d1_30} tint={C.yellow} />
          <AgingCell label="31–60 days" value={s.aging.d31_60} tint={C.orange} />
          <AgingCell label="60+ days" value={s.aging.d60_plus} tint={C.red} />
        </View>
      </Card>

      <View style={styles.expenseHeader}>
        <Text style={styles.sectionTitle}>Expenses</Text>
        <TouchableOpacity onPress={onAddExpense} style={styles.addExpenseBtn} testID="add-expense">
          <Plus size={14} color={C.accent} />
          <Text style={styles.addExpenseText}>Add</Text>
        </TouchableOpacity>
      </View>

      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses recorded" description="Track your business costs to see true net profit." />
      ) : expenses.map((e) => (
        <Card key={e.id} style={styles.expenseCard}>
          <View style={styles.iconWrap}><Receipt size={15} color={C.orange} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.invTitle}>{e.vendor || e.description || e.category || 'Expense'}</Text>
            <Text style={styles.invMeta}>
              {(e.category ? `${e.category} · ` : '')}
              {e.incurred_on ? new Date(String(e.incurred_on)).toLocaleDateString() : ''}
            </Text>
          </View>
          <Text style={styles.expenseAmount}>-${Number(e.amount ?? 0).toFixed(2)}</Text>
          <TouchableOpacity onPress={() => onDeleteExpense(String(e.id))} style={styles.delBtn} testID={`del-expense-${e.id}`}>
            <Trash2 size={15} color={C.red} />
          </TouchableOpacity>
        </Card>
      ))}
    </View>
  );
}

function AgingCell({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <View style={styles.agingCell}>
      <Text style={styles.agingLabel}>{label}</Text>
      <Text style={[styles.agingValue, { color: tint }]}>${Number(value).toFixed(2)}</Text>
    </View>
  );
}

function InvoiceComposer({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const insets = useSafeAreaInsets();
  const companiesQuery = trpc.invoicing.customerCompanies.useQuery(undefined, { enabled: visible });
  const createMutation = trpc.invoicing.create.useMutation();

  const [customer, setCustomer] = useState<CompanyOpt | null>(null);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [taxRate, setTaxRate] = useState<string>('0');
  const [dueDays, setDueDays] = useState<string>('14');
  const [notes, setNotes] = useState<string>('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);

  const reset = () => {
    setCustomer(null); setCustomerName(''); setCustomerEmail(''); setTaxRate('0');
    setDueDays('14'); setNotes(''); setLines([newLine()]);
  };

  const subtotal = useMemo(() =>
    lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0),
    [lines]);
  const tax = useMemo(() => subtotal * ((Number(taxRate) || 0) / 100), [subtotal, taxRate]);
  const total = subtotal + tax;

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async (status: 'Draft' | 'Issued') => {
    const cleanLines = lines
      .filter((l) => l.description.trim().length > 0)
      .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 }));
    if (cleanLines.length === 0) { Alert.alert('Add a line item', 'Every invoice needs at least one line with a description.'); return; }
    try {
      await createMutation.mutateAsync({
        customerCompanyId: customer?.id ?? null,
        customerName: customerName.trim() || customer?.name || '',
        customerEmail: customerEmail.trim(),
        taxRate: Number(taxRate) || 0,
        dueDays: Number(dueDays) || 14,
        notes: notes.trim(),
        status,
        lines: cleanLines,
      });
      reset();
      onCreated();
    } catch (err) {
      Alert.alert('Unable to create invoice', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const companies = (companiesQuery.data ?? []) as CompanyOpt[];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New invoice</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}><X size={20} color={C.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Bill to</Text>
            <TouchableOpacity style={styles.picker} onPress={() => setPickerOpen((o) => !o)} testID="pick-customer">
              <Building2 size={16} color={C.textSecondary} />
              <Text style={[styles.pickerText, !customer && { color: C.textMuted }]}>{customer?.name ?? 'Select a customer company (optional)'}</Text>
              <ChevronDown size={16} color={C.textSecondary} />
            </TouchableOpacity>
            {pickerOpen ? (
              <View style={styles.pickerList}>
                {companies.length === 0 ? (
                  <Text style={styles.pickerEmpty}>No companies available — enter a name below instead.</Text>
                ) : companies.map((c) => (
                  <TouchableOpacity key={c.id} style={styles.pickerRow} onPress={() => { setCustomer(c); setPickerOpen(false); }}>
                    <Text style={styles.pickerRowText}>{c.name}</Text>
                    {c.city ? <Text style={styles.pickerRowSub}>{c.city}</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <Input label="Customer name (if not listed)" value={customerName} onChangeText={setCustomerName} placeholder="Acme Importers Ltd." />
            <Input label="Customer email" value={customerEmail} onChangeText={setCustomerEmail} placeholder="ap@acme.com" keyboardType="email-address" autoCapitalize="none" />

            <Text style={[styles.fieldLabel, { marginTop: 6 }]}>Line items</Text>
            <Text style={styles.accessorialHint}>Quick-add a common charge, then set days and rate:</Text>
            <View style={styles.accessorialRow}>
              {ACCESSORIALS.map((a) => (
                <TouchableOpacity
                  key={a.label}
                  style={styles.accessorialChip}
                  onPress={() => setLines((prev) => {
                    const blankFirst = prev.length === 1 && !prev[0].description.trim();
                    const line = newLine(a.desc, '1', '');
                    return blankFirst ? [line] : [...prev, line];
                  })}
                  testID={`accessorial-${a.label}`}
                >
                  <Plus size={12} color={C.accent} />
                  <Text style={styles.accessorialChipText}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {lines.map((l, idx) => (
              <View key={l.key} style={styles.lineRow}>
                <View style={{ flex: 1, gap: 8 }}>
                  <Input value={l.description} onChangeText={(t) => updateLine(l.key, { description: t })} placeholder={`Item ${idx + 1} description`} />
                  <View style={styles.lineInputs}>
                    <Input containerStyle={{ flex: 1 }} value={l.quantity} onChangeText={(t) => updateLine(l.key, { quantity: t.replace(/[^0-9.]/g, '') })} placeholder="Qty" keyboardType="numeric" />
                    <Input containerStyle={{ flex: 1.4 }} value={l.unitPrice} onChangeText={(t) => updateLine(l.key, { unitPrice: t.replace(/[^0-9.]/g, '') })} placeholder="Unit price" keyboardType="numeric" />
                    <Text style={styles.lineTotal}>${((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2)}</Text>
                  </View>
                </View>
                {lines.length > 1 ? (
                  <TouchableOpacity onPress={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} style={styles.delBtn}>
                    <Trash2 size={15} color={C.red} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            <TouchableOpacity onPress={() => setLines((prev) => [...prev, newLine()])} style={styles.addLineBtn} testID="add-line">
              <Plus size={14} color={C.accent} /><Text style={styles.addLineText}>Add line</Text>
            </TouchableOpacity>

            <View style={styles.lineInputs}>
              <Input containerStyle={{ flex: 1 }} label="Tax %" value={taxRate} onChangeText={(t) => setTaxRate(t.replace(/[^0-9.]/g, ''))} placeholder="0" keyboardType="numeric" />
              <Input containerStyle={{ flex: 1 }} label="Due (days)" value={dueDays} onChangeText={(t) => setDueDays(t.replace(/[^0-9]/g, ''))} placeholder="14" keyboardType="numeric" />
            </View>
            <Input label="Notes / terms" value={notes} onChangeText={setNotes} placeholder="Payment terms, PO number, thank-you note…" multiline numberOfLines={3} />

            <View style={styles.totalsBox}>
              <TotalRow label="Subtotal" value={subtotal} />
              <TotalRow label={`Tax (${Number(taxRate) || 0}%)`} value={tax} />
              <TotalRow label="Total" value={total} strong />
            </View>

            <View style={styles.composerActions}>
              <Button label="Save draft" variant="secondary" onPress={() => void submit('Draft')} loading={createMutation.isPending} style={{ flex: 1 }} />
              <Button label="Issue & send" icon={<Send size={14} color={C.white} />} onPress={() => void submit('Issued')} loading={createMutation.isPending} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ExpenseComposer({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const insets = useSafeAreaInsets();
  const addMutation = trpc.accounting.addExpense.useMutation();
  const [vendor, setVendor] = useState<string>('');
  const [category, setCategory] = useState<string>('general');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  const CATS = ['general', 'fuel', 'labour', 'equipment', 'rent', 'insurance', 'fees', 'other'];

  const submit = async () => {
    if (!(Number(amount) > 0)) { Alert.alert('Enter an amount', 'Expense amount must be greater than 0.'); return; }
    try {
      await addMutation.mutateAsync({ vendor: vendor.trim(), category, description: description.trim(), amount: Number(amount) });
      setVendor(''); setDescription(''); setAmount(''); setCategory('general');
      onCreated();
    } catch (err) {
      Alert.alert('Unable to record expense', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Record expense</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}><X size={20} color={C.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Input label="Vendor / payee" value={vendor} onChangeText={setVendor} placeholder="Shell, ABC Rentals…" />
            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.catRow}>
              {CATS.map((cat) => (
                <TouchableOpacity key={cat} onPress={() => setCategory(cat)} style={[styles.catChip, category === cat && styles.catChipActive]}>
                  <Text style={[styles.catChipText, category === cat && styles.catChipTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input label="Description" value={description} onChangeText={setDescription} placeholder="What was this for?" />
            <Input label="Amount" value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))} placeholder="0.00" keyboardType="numeric" />
            <Button label="Record expense" icon={<Check size={14} color={C.white} />} onPress={() => void submit()} loading={addMutation.isPending} fullWidth />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalLabelStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalValueStrong]}>${Number(value).toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: -6 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  segmentActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  segmentText: { fontSize: 13, color: C.textSecondary, fontWeight: '700' as const },
  segmentTextActive: { color: C.accent },
  invCard: { gap: 12 },
  invTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgSecondary },
  invTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  invMeta: { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  invActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  kpiRow: { flexDirection: 'row', gap: 10 },
  kpiCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  kpiHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kpiLabel: { fontSize: 11, color: C.textMuted, flex: 1 },
  kpiValue: { fontSize: 19, fontWeight: '800' as const, color: C.text, letterSpacing: -0.4 },
  agingCard: { gap: 12 },
  agingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agingTitle: { flex: 1, fontSize: 14, fontWeight: '800' as const, color: C.text },
  overdueBadge: { backgroundColor: C.redDim, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  overdueText: { fontSize: 11, color: C.red, fontWeight: '800' as const },
  agingGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  agingCell: { flexBasis: '48%', backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  agingLabel: { fontSize: 11, color: C.textMuted, marginBottom: 5 },
  agingValue: { fontSize: 16, fontWeight: '800' as const },
  expenseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  addExpenseBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  addExpenseText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  expenseCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  expenseAmount: { fontSize: 15, fontWeight: '800' as const, color: C.red },
  delBtn: { padding: 8 },
  modalBackdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', borderTopWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { padding: 4 },
  modalScroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary, letterSpacing: 0.3 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, minHeight: 48 },
  pickerText: { flex: 1, fontSize: 15, color: C.text },
  pickerList: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' },
  pickerEmpty: { fontSize: 13, color: C.textMuted, padding: 14 },
  pickerRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border },
  pickerRowText: { fontSize: 14, color: C.text, fontWeight: '600' as const },
  pickerRowSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineInputs: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineTotal: { fontSize: 13, fontWeight: '700' as const, color: C.text, minWidth: 64, textAlign: 'right' as const },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  addLineText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  accessorialHint: { fontSize: 11.5, color: C.textMuted, lineHeight: 16, marginTop: -4 },
  accessorialRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  accessorialChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55' },
  accessorialChipText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  totalsBox: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8, marginTop: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, color: C.textSecondary },
  totalLabelStrong: { fontSize: 15, color: C.text, fontWeight: '800' as const },
  totalValue: { fontSize: 13, color: C.text, fontWeight: '600' as const },
  totalValueStrong: { fontSize: 17, color: C.accent, fontWeight: '800' as const },
  composerActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  catChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  catChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  catChipTextActive: { color: C.accent },
});
