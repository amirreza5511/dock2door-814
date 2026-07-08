import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X, Check, DollarSign, Users, SlidersHorizontal, CircleCheck, Clock } from 'lucide-react-native';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { CommissionKind, CommissionStatus } from '@/constants/types';

type Tab = 'agents' | 'payouts' | 'plans';

const BOUNTY_KEYS = ['warehouse', 'drayage', 'employer', 'trucking', 'shipper', 'customer', 'service', 'freight_forwarder'] as const;
const REFERRAL_KEYS = ['worker', 'driver', 'owner_operator'] as const;

const STATUS_TINT: Record<CommissionStatus, string> = {
  Pending: C.yellow, Approved: C.blue, Paid: C.green, Rejected: C.red,
};

const KIND_LABEL: Record<CommissionKind, string> = {
  bounty: 'Signing bounty', recurring: 'Recurring', referral: 'Referral fee', bonus: 'Milestone bonus',
};

interface AgentRow {
  id: string; agent_code: string; status: string; plan_id: string | null;
  name: string; email: string; accounts: number; pending: number; approved: number; paid: number;
}
interface CommissionRow {
  id: string; kind: CommissionKind; vertical: string; amount: number; status: CommissionStatus;
  description: string; created_at: string; agentName: string; agentEmail: string;
}
interface PlanConfig {
  bounty?: Record<string, number>;
  recurring?: Record<string, number>;
  referral?: Record<string, number>;
  tiers?: { threshold: number; bonus: number }[];
}
interface PlanRow {
  id: string; name: string; description: string; config: PlanConfig;
  is_default: boolean; active: boolean;
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function AdminSalesAgents() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>('agents');

  const agentsQuery = trpc.sales.adminAgents.useQuery();
  const commissionsQuery = trpc.sales.adminCommissions.useQuery(undefined);
  const plansQuery = trpc.sales.adminPlans.useQuery();

  const setStatus = trpc.sales.adminSetCommissionStatus.useMutation({
    onSuccess: async () => {
      await utils.sales.adminCommissions.invalidate();
      await utils.sales.adminAgents.invalidate();
    },
  });
  const updateAgent = trpc.sales.adminUpdateAgent.useMutation({
    onSuccess: async () => { await utils.sales.adminAgents.invalidate(); },
  });
  const upsertPlan = trpc.sales.adminUpsertPlan.useMutation({
    onSuccess: async () => { await utils.sales.adminPlans.invalidate(); },
  });
  const awardCommission = trpc.sales.adminAwardCommission.useMutation({
    onSuccess: async () => {
      await utils.sales.adminCommissions.invalidate();
      await utils.sales.adminAgents.invalidate();
    },
  });

  const agents = useMemo(() => (agentsQuery.data as AgentRow[] | undefined) ?? [], [agentsQuery.data]);
  const commissions = useMemo(() => (commissionsQuery.data as CommissionRow[] | undefined) ?? [], [commissionsQuery.data]);
  const plans = useMemo(() => (plansQuery.data as PlanRow[] | undefined) ?? [], [plansQuery.data]);

  const [statusFilter, setStatusFilter] = useState<CommissionStatus | 'All'>('Pending');
  const filteredCommissions = statusFilter === 'All' ? commissions : commissions.filter((c) => c.status === statusFilter);

  const [planDraft, setPlanDraft] = useState<PlanRow | null>(null);
  const [assignAgent, setAssignAgent] = useState<AgentRow | null>(null);
  const [awardAmount, setAwardAmount] = useState<string>('');
  const [awardNote, setAwardNote] = useState<string>('');

  const totals = useMemo(() => {
    const sum = (s: CommissionStatus) => commissions.filter((c) => c.status === s).reduce((a, c) => a + Number(c.amount || 0), 0);
    return { pending: sum('Pending'), approved: sum('Approved'), paid: sum('Paid') };
  }, [commissions]);

  const confirmStatus = useCallback((row: CommissionRow, next: CommissionStatus) => {
    Alert.alert(`${next} commission`, `${KIND_LABEL[row.kind]} · ${money(row.amount)} for ${row.agentName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: next, onPress: () => setStatus.mutate({ id: row.id, status: next }) },
    ]);
  }, [setStatus]);

  const submitAward = useCallback(() => {
    if (!assignAgent) return;
    const amount = Number(awardAmount.replace(/[^0-9.]/g, '')) || 0;
    if (amount <= 0) { Alert.alert('Enter an amount', 'Set a dollar amount to award.'); return; }
    awardCommission.mutate(
      { agentId: assignAgent.id, kind: 'manual', vertical: '', amount, description: awardNote.trim() || 'Manual adjustment by admin' },
      { onSuccess: () => { setAwardAmount(''); setAwardNote(''); Alert.alert('Commission added', `${money(amount)} added to ${assignAgent.name} as Pending.`); } },
    );
  }, [assignAgent, awardAmount, awardNote, awardCommission]);

  const savePlan = useCallback(() => {
    if (!planDraft) return;
    upsertPlan.mutate({
      id: planDraft.id || undefined,
      name: planDraft.name,
      description: planDraft.description,
      config: planDraft.config,
      isDefault: planDraft.is_default,
      active: planDraft.active,
    }, { onSuccess: () => setPlanDraft(null) });
  }, [planDraft, upsertPlan]);

  const isLoading = agentsQuery.isLoading || commissionsQuery.isLoading || plansQuery.isLoading;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Sales & Commissions</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.summaryRow}>
        <SummaryTile label="Pending" value={money(totals.pending)} tint={C.yellow} />
        <SummaryTile label="Approved" value={money(totals.approved)} tint={C.blue} />
        <SummaryTile label="Paid" value={money(totals.paid)} tint={C.green} />
      </View>

      <View style={styles.tabBar}>
        {(['agents', 'payouts', 'plans'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            {t === 'agents' ? <Users size={15} color={tab === t ? C.accent : C.textSecondary} /> :
             t === 'payouts' ? <DollarSign size={15} color={tab === t ? C.accent : C.textSecondary} /> :
             <SlidersHorizontal size={15} color={tab === t ? C.accent : C.textSecondary} />}
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'agents' ? 'Agents' : t === 'payouts' ? 'Payouts' : 'Plans'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ScreenFeedback state="loading" title="Loading" /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          {tab === 'agents' && (
            agents.length === 0 ? (
              <View style={styles.center}><Text style={styles.emptyTitle}>No sales agents yet</Text><Text style={styles.emptyMsg}>When someone signs up as a Sales Agent, they&apos;ll appear here with their code and earnings.</Text></View>
            ) : agents.map((a) => {
              const plan = plans.find((p) => p.id === a.plan_id);
              return (
                <Card key={a.id} style={styles.agentCard}>
                  <View style={styles.agentTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.agentName}>{a.name}</Text>
                      <Text style={styles.agentMeta}>{a.email}</Text>
                    </View>
                    <View style={styles.codePill}><Text style={styles.codePillText}>{a.agent_code}</Text></View>
                  </View>
                  <View style={styles.agentStats}>
                    <MiniStat label="Accounts" value={String(a.accounts)} />
                    <MiniStat label="Pending" value={money(a.pending)} tint={C.yellow} />
                    <MiniStat label="Approved" value={money(a.approved)} tint={C.blue} />
                    <MiniStat label="Paid" value={money(a.paid)} tint={C.green} />
                  </View>
                  <View style={styles.agentActions}>
                    <TouchableOpacity onPress={() => setAssignAgent(a)} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>{plan?.name ?? 'Default plan'} · Change</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => updateAgent.mutate({ agentId: a.id, status: a.status === 'Active' ? 'Paused' : 'Active' })}
                      style={[styles.smallBtn, { borderColor: a.status === 'Active' ? C.green + '55' : C.textMuted + '55' }]}
                    >
                      <Text style={[styles.smallBtnText, { color: a.status === 'Active' ? C.green : C.textSecondary }]}>{a.status}</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          )}

          {tab === 'payouts' && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
                {(['Pending', 'Approved', 'Paid', 'Rejected', 'All'] as const).map((s) => (
                  <TouchableOpacity key={s} onPress={() => setStatusFilter(s)} style={[styles.chip, statusFilter === s && styles.chipActive]}>
                    <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {filteredCommissions.length === 0 ? (
                <View style={styles.center}><Text style={styles.emptyTitle}>Nothing here</Text><Text style={styles.emptyMsg}>Commission lines will appear as agents onboard accounts and generate revenue.</Text></View>
              ) : filteredCommissions.map((r) => (
                <Card key={r.id} style={styles.commCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commTitle}>{KIND_LABEL[r.kind]}{r.vertical ? ` · ${r.vertical}` : ''}</Text>
                    <Text style={styles.commAgent}>{r.agentName}</Text>
                    {r.description ? <Text style={styles.commDesc} numberOfLines={2}>{r.description}</Text> : null}
                    <View style={styles.commRow}>
                      <Text style={styles.commAmount}>{money(r.amount)}</Text>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_TINT[r.status] + '22' }]}>
                        <Text style={[styles.statusText, { color: STATUS_TINT[r.status] }]}>{r.status}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.commActions}>
                    {r.status === 'Pending' && (
                      <>
                        <TouchableOpacity onPress={() => confirmStatus(r, 'Approved')} style={[styles.actionBtn, { backgroundColor: C.blueDim }]}>
                          <Check size={16} color={C.blue} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmStatus(r, 'Rejected')} style={[styles.actionBtn, { backgroundColor: C.redDim }]}>
                          <X size={16} color={C.red} />
                        </TouchableOpacity>
                      </>
                    )}
                    {r.status === 'Approved' && (
                      <TouchableOpacity onPress={() => confirmStatus(r, 'Paid')} style={[styles.actionBtn, { backgroundColor: C.greenDim, paddingHorizontal: 12, flexDirection: 'row', gap: 5 }]}>
                        <CircleCheck size={16} color={C.green} />
                        <Text style={[styles.payText]}>Pay</Text>
                      </TouchableOpacity>
                    )}
                    {r.status === 'Paid' && <CircleCheck size={18} color={C.green} />}
                    {r.status === 'Rejected' && <X size={18} color={C.red} />}
                  </View>
                </Card>
              ))}
            </>
          )}

          {tab === 'plans' && (
            <>
              <TouchableOpacity
                onPress={() => setPlanDraft({ id: '', name: '', description: '', config: { bounty: {}, recurring: {}, referral: {}, tiers: [] }, is_default: false, active: true })}
                style={styles.newPlanBtn}
              >
                <Text style={styles.newPlanText}>+ New commission plan</Text>
              </TouchableOpacity>
              {plans.map((p) => (
                <Card key={p.id} style={styles.planCard} onPress={() => setPlanDraft(p)}>
                  <View style={styles.planTop}>
                    <Text style={styles.planName}>{p.name}</Text>
                    <View style={styles.planBadges}>
                      {p.is_default && <View style={[styles.badge, { backgroundColor: C.accentDim }]}><Text style={[styles.badgeText, { color: C.accent }]}>Default</Text></View>}
                      <View style={[styles.badge, { backgroundColor: p.active ? C.greenDim : C.redDim }]}>
                        <Text style={[styles.badgeText, { color: p.active ? C.green : C.red }]}>{p.active ? 'Active' : 'Off'}</Text>
                      </View>
                    </View>
                  </View>
                  {p.description ? <Text style={styles.planDesc}>{p.description}</Text> : null}
                  <Text style={styles.planHint}>Tap to edit bounties, recurring %, referral fees & tiers</Text>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Assign plan / status sheet */}
      <Modal visible={!!assignAgent} transparent animationType="slide" onRequestClose={() => setAssignAgent(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Assign plan</Text>
              <TouchableOpacity onPress={() => setAssignAgent(null)}><X size={22} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <Text style={styles.sheetSub}>{assignAgent?.name} · {assignAgent?.agent_code}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.awardGroupTitle}>Commission plan</Text>
              {plans.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { if (assignAgent) updateAgent.mutate({ agentId: assignAgent.id, planId: p.id }); setAssignAgent(null); }}
                  style={[styles.planPick, assignAgent?.plan_id === p.id && styles.planPickActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planPickName}>{p.name}</Text>
                    {p.is_default && <Text style={styles.planPickMeta}>Default plan</Text>}
                  </View>
                  {assignAgent?.plan_id === p.id && <Check size={18} color={C.accent} />}
                </TouchableOpacity>
              ))}

              <Text style={styles.awardGroupTitle}>Award / adjust commission</Text>
              <Text style={styles.awardHint}>Add a one-off commission line for this agent (e.g. a manual bonus or correction). It lands as Pending in Payouts.</Text>
              <View style={styles.awardRow}>
                <View style={{ width: 130 }}>
                  <Input value={awardAmount} onChangeText={setAwardAmount} keyboardType="numeric" placeholder="$ amount" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input value={awardNote} onChangeText={setAwardNote} placeholder="Reason (optional)" />
                </View>
              </View>
              <Button title={awardCommission.isPending ? 'Adding…' : 'Add commission'} onPress={submitAward} disabled={awardCommission.isPending} style={{ marginTop: 4 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Plan editor */}
      <Modal visible={!!planDraft} transparent animationType="slide" onRequestClose={() => setPlanDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, maxHeight: '90%' }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{planDraft?.id ? 'Edit plan' : 'New plan'}</Text>
                <TouchableOpacity onPress={() => setPlanDraft(null)}><X size={22} color={C.textSecondary} /></TouchableOpacity>
              </View>
              {planDraft && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Input label="Plan name" value={planDraft.name} onChangeText={(v) => setPlanDraft({ ...planDraft, name: v })} placeholder="e.g. Q3 Campaign" />
                  <Input label="Description" value={planDraft.description} onChangeText={(v) => setPlanDraft({ ...planDraft, description: v })} placeholder="Optional" />

                  <View style={styles.toggleRow}>
                    <Toggle label="Set as default" on={planDraft.is_default} onPress={() => setPlanDraft({ ...planDraft, is_default: !planDraft.is_default })} />
                    <Toggle label="Active" on={planDraft.active} onPress={() => setPlanDraft({ ...planDraft, active: !planDraft.active })} />
                  </View>

                  <Text style={styles.groupTitle}>Signing bounty ($ per account)</Text>
                  {BOUNTY_KEYS.map((k) => (
                    <NumRow key={k} label={k.replace('_', ' ')} value={planDraft.config.bounty?.[k]}
                      onChange={(n) => setPlanDraft({ ...planDraft, config: { ...planDraft.config, bounty: { ...planDraft.config.bounty, [k]: n } } })} />
                  ))}

                  <Text style={styles.groupTitle}>Recurring revenue share (%)</Text>
                  {BOUNTY_KEYS.map((k) => (
                    <NumRow key={k} label={k.replace('_', ' ')} value={planDraft.config.recurring?.[k]} suffix="%"
                      onChange={(n) => setPlanDraft({ ...planDraft, config: { ...planDraft.config, recurring: { ...planDraft.config.recurring, [k]: n } } })} />
                  ))}

                  <Text style={styles.groupTitle}>Referral fee ($ per person)</Text>
                  {REFERRAL_KEYS.map((k) => (
                    <NumRow key={k} label={k.replace('_', ' ')} value={planDraft.config.referral?.[k]}
                      onChange={(n) => setPlanDraft({ ...planDraft, config: { ...planDraft.config, referral: { ...planDraft.config.referral, [k]: n } } })} />
                  ))}

                  <Text style={styles.groupTitle}>Milestone bonuses</Text>
                  {(planDraft.config.tiers ?? []).map((t, i) => (
                    <View key={i} style={styles.tierRow}>
                      <View style={styles.tierField}>
                        <Text style={styles.tierLabel}>At</Text>
                        <Input value={String(t.threshold ?? '')} keyboardType="numeric" placeholder="10"
                          onChangeText={(v) => {
                            const tiers = [...(planDraft.config.tiers ?? [])];
                            tiers[i] = { ...tiers[i], threshold: Number(v.replace(/[^0-9]/g, '')) || 0 };
                            setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers } });
                          }} />
                      </View>
                      <View style={styles.tierField}>
                        <Text style={styles.tierLabel}>Bonus $</Text>
                        <Input value={String(t.bonus ?? '')} keyboardType="numeric" placeholder="500"
                          onChangeText={(v) => {
                            const tiers = [...(planDraft.config.tiers ?? [])];
                            tiers[i] = { ...tiers[i], bonus: Number(v.replace(/[^0-9]/g, '')) || 0 };
                            setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers } });
                          }} />
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          const tiers = (planDraft.config.tiers ?? []).filter((_, idx) => idx !== i);
                          setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers } });
                        }}
                        style={styles.tierRemove}
                      ><X size={16} color={C.red} /></TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={() => setPlanDraft({ ...planDraft, config: { ...planDraft.config, tiers: [...(planDraft.config.tiers ?? []), { threshold: 0, bonus: 0 }] } })}
                    style={styles.addTierBtn}
                  ><Text style={styles.addTierText}>+ Add tier</Text></TouchableOpacity>

                  <Button title={upsertPlan.isPending ? 'Saving…' : 'Save plan'} onPress={savePlan} disabled={upsertPlan.isPending || !planDraft.name.trim()} style={{ marginTop: 18 }} />
                </ScrollView>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function SummaryTile({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={[styles.summaryValue, { color: tint }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function MiniStat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.toggle, on && styles.toggleOn]}>
      {on ? <Check size={14} color={C.white} /> : <Clock size={14} color={C.textMuted} />}
      <Text style={[styles.toggleText, on && { color: C.white }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function NumRow({ label, value, onChange, suffix }: { label: string; value?: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <View style={styles.numRow}>
      <Text style={styles.numLabel}>{label}</Text>
      <View style={styles.numInputWrap}>
        <View style={{ flex: 1 }}>
          <Input
            value={value != null && value !== 0 ? String(value) : ''}
            onChangeText={(v) => onChange(Number(v.replace(/[^0-9.]/g, '')) || 0)}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
        {suffix ? <Text style={styles.numSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  summaryTile: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: 'center' },
  summaryValue: { fontSize: 18, fontWeight: '800' as const },
  summaryLabel: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  tabBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabActive: { backgroundColor: C.accentDim, borderColor: C.accent + '66' },
  tabText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  tabTextActive: { color: C.accent },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const },
  emptyMsg: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, marginTop: 8, lineHeight: 19 },
  list: { paddingHorizontal: 16, gap: 10 },

  agentCard: { padding: 14, gap: 12 },
  agentTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  agentName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  agentMeta: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  codePill: { backgroundColor: C.bgSecondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: C.border },
  codePillText: { fontSize: 13, fontWeight: '800' as const, color: C.accent, letterSpacing: 1.5 },
  agentStats: { flexDirection: 'row', gap: 8 },
  miniStat: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 8, alignItems: 'center' },
  miniValue: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  miniLabel: { fontSize: 10, color: C.textMuted, marginTop: 2 },
  agentActions: { flexDirection: 'row', gap: 8 },
  smallBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  smallBtnText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },

  filterBar: { maxHeight: 48, flexGrow: 0 },
  filterContent: { gap: 8, paddingBottom: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.white },

  commCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  commTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, textTransform: 'capitalize' as const },
  commAgent: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  commDesc: { fontSize: 11, color: C.textMuted, marginTop: 3 },
  commRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  commAmount: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  statusDot: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  commActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  payText: { fontSize: 13, fontWeight: '700' as const, color: C.green },

  newPlanBtn: { borderWidth: 1, borderColor: C.accent + '55', borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: C.accentDim },
  newPlanText: { fontSize: 14, fontWeight: '700' as const, color: C.accent },
  planCard: { padding: 14, gap: 6 },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  planBadges: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '700' as const },
  planDesc: { fontSize: 12, color: C.textSecondary },
  planHint: { fontSize: 11, color: C.textMuted },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderTopWidth: 1, borderColor: C.border },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  sheetSub: { fontSize: 13, color: C.textSecondary, marginBottom: 12 },
  planPick: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8, backgroundColor: C.card },
  planPickActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  planPickName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  planPickMeta: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  awardGroupTitle: { fontSize: 13, fontWeight: '800' as const, color: C.accent, marginTop: 14, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  awardHint: { fontSize: 12, color: C.textSecondary, marginBottom: 10, lineHeight: 17 },
  awardRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },

  toggleRow: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 4 },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  toggleOn: { backgroundColor: C.accent, borderColor: C.accent },
  toggleText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  groupTitle: { fontSize: 13, fontWeight: '800' as const, color: C.accent, marginTop: 18, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  numRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  numLabel: { fontSize: 14, color: C.text, textTransform: 'capitalize' as const, flex: 1 },
  numInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 110 },
  numInput: { flex: 1, textAlign: 'right' as const },
  numSuffix: { fontSize: 14, color: C.textSecondary, fontWeight: '700' as const },
  tierRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginBottom: 8 },
  tierField: { flex: 1 },
  tierLabel: { fontSize: 12, color: C.textSecondary, marginBottom: 4 },
  tierRemove: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.redDim },
  addTierBtn: { paddingVertical: 10, alignItems: 'center' },
  addTierText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
});
