import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ruler, Plus, X, CheckCircle2, XCircle, Layers, Receipt, Trash2, PauseCircle, PlayCircle } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface TierRow { id: string; min_sqft: number; rate_per_sqft_month: number }
interface AddonRow { id: string; name: string; pricing_unit: string; rate: number; is_required: boolean }
interface SpaceRow {
  id: string;
  name: string;
  space_kind: string;
  city: string;
  address: string;
  total_sqft: number;
  booked_sqft: number;
  min_sqft: number;
  max_sqft: number | null;
  base_rate_per_sqft_month: number;
  currency: string;
  min_term_months: number;
  term_discount_3m_pct: number;
  term_discount_6m_pct: number;
  term_discount_12m_pct: number;
  notes: string;
  status: string;
  warehouse_space_tiers?: TierRow[];
  warehouse_space_addons?: AddonRow[];
}
interface BookingRow {
  id: string;
  space_id: string;
  space_name: string;
  customer_name: string;
  sqft: number;
  term_months: number;
  start_date: string;
  monthly_total: number;
  one_time_total: number;
  contract_total: number;
  currency: string;
  status: string;
  quote: Record<string, unknown>;
  customer_notes: string;
  months_billed: number;
}

const KIND_LABEL: Record<string, string> = {
  Floor: 'Floor storage', Rack: 'Racked', ClimateControlled: 'Climate controlled',
  Secured: 'Secured cage', Outdoor: 'Outdoor yard', Hazmat: 'Hazmat certified',
};
const KINDS = Object.keys(KIND_LABEL);
const UNIT_LABEL: Record<string, string> = { per_sqft_month: '$/sqft/mo', per_month: '$/mo', one_time: 'one-time' };

/** Provider-side shared-space manager: publish SF space, tune pricing, handle requests. */
export default function ProviderSpacesScreen() {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();

  const spacesQuery = trpc.spaces.mySpaces.useQuery(undefined, { refetchInterval: 30000 });
  const bookingsQuery = trpc.spaces.bookings.useQuery({ scope: 'provider' }, { refetchInterval: 15000 });

  const invalidate = () => {
    utils.spaces.mySpaces.invalidate();
    utils.spaces.bookings.invalidate();
  };
  const createMutation = trpc.spaces.createSpace.useMutation({ onSuccess: invalidate });
  const updateMutation = trpc.spaces.updateSpace.useMutation({ onSuccess: invalidate });
  const respondMutation = trpc.spaces.respond.useMutation({ onSuccess: invalidate });
  const billMutation = trpc.spaces.billMonth.useMutation({ onSuccess: invalidate });
  const endMutation = trpc.spaces.endBooking.useMutation({ onSuccess: invalidate });
  const addTierMutation = trpc.spaces.addTier.useMutation({ onSuccess: invalidate });
  const removeTierMutation = trpc.spaces.removeTier.useMutation({ onSuccess: invalidate });
  const addAddonMutation = trpc.spaces.addAddon.useMutation({ onSuccess: invalidate });
  const removeAddonMutation = trpc.spaces.removeAddon.useMutation({ onSuccess: invalidate });

  const spaces = useMemo(() => (spacesQuery.data as SpaceRow[] | undefined) ?? [], [spacesQuery.data]);
  const bookings = useMemo(() => (bookingsQuery.data as BookingRow[] | undefined) ?? [], [bookingsQuery.data]);
  const requests = bookings.filter((b) => b.status === 'Requested');
  const active = bookings.filter((b) => b.status === 'Active');

  const totalSqft = spaces.reduce((s, x) => s + Number(x.total_sqft ?? 0), 0);
  const bookedSqft = spaces.reduce((s, x) => s + Number(x.booked_sqft ?? 0), 0);
  const monthlyRevenue = active.reduce((s, b) => s + Number(b.monthly_total ?? 0), 0);

  // ── New space form ──
  const [showForm, setShowForm] = useState<boolean>(false);
  const [fName, setFName] = useState<string>('');
  const [fKind, setFKind] = useState<string>('Floor');
  const [fCity, setFCity] = useState<string>('');
  const [fAddress, setFAddress] = useState<string>('');
  const [fTotal, setFTotal] = useState<string>('');
  const [fMin, setFMin] = useState<string>('100');
  const [fRate, setFRate] = useState<string>('');
  const [fMinTerm, setFMinTerm] = useState<string>('1');
  const [fD3, setFD3] = useState<string>('5');
  const [fD6, setFD6] = useState<string>('10');
  const [fD12, setFD12] = useState<string>('15');
  const [fNotes, setFNotes] = useState<string>('');

  const submitSpace = async () => {
    const total = Number(fTotal);
    const rate = Number(fRate);
    if (!fName.trim() || !total || total <= 0 || !rate || rate <= 0) {
      Alert.alert('Missing info', 'Name, total sqft and a base $/sqft/month rate are required.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: fName.trim(), spaceKind: fKind, city: fCity.trim(), address: fAddress.trim(),
        totalSqft: total, minSqft: Number(fMin) || 100, baseRate: rate,
        minTermMonths: Number(fMinTerm) || 1,
        discount3m: Number(fD3) || 0, discount6m: Number(fD6) || 0, discount12m: Number(fD12) || 0,
        notes: fNotes.trim(),
      });
      setShowForm(false);
      setFName(''); setFCity(''); setFAddress(''); setFTotal(''); setFRate(''); setFNotes('');
      Alert.alert('Published', 'Your space is live. Add volume tiers and add-on services to sharpen the pricing.');
    } catch (e) {
      Alert.alert('Could not publish', e instanceof Error ? e.message : 'Try again');
    }
  };

  // ── Tier / addon inline forms ──
  const [tierSpaceId, setTierSpaceId] = useState<string | null>(null);
  const [tierMin, setTierMin] = useState<string>('');
  const [tierRate, setTierRate] = useState<string>('');
  const [addonSpaceId, setAddonSpaceId] = useState<string | null>(null);
  const [addonName, setAddonName] = useState<string>('');
  const [addonUnit, setAddonUnit] = useState<string>('per_month');
  const [addonRate, setAddonRate] = useState<string>('');

  const submitTier = async (spaceId: string) => {
    if (!Number(tierMin) || !Number(tierRate)) return;
    try {
      await addTierMutation.mutateAsync({ spaceId, minSqft: Number(tierMin), rate: Number(tierRate) });
      setTierSpaceId(null); setTierMin(''); setTierRate('');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Try again');
    }
  };
  const submitAddon = async (spaceId: string) => {
    if (!addonName.trim() || !Number(addonRate)) return;
    try {
      await addAddonMutation.mutateAsync({ spaceId, name: addonName.trim(), pricingUnit: addonUnit, rate: Number(addonRate) });
      setAddonSpaceId(null); setAddonName(''); setAddonRate('');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Try again');
    }
  };

  const respond = (b: BookingRow, action: 'approve' | 'decline') => {
    Alert.alert(
      action === 'approve' ? 'Approve this rental?' : 'Decline this request?',
      action === 'approve'
        ? `${b.customer_name} — ${b.sqft} sqft for ${b.term_months} mo at $${Number(b.monthly_total).toFixed(2)}/mo. Approving reserves the footprint and issues the first invoice.`
        : `Decline ${b.customer_name}'s request for ${b.sqft} sqft?`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: action === 'approve' ? 'Approve & invoice' : 'Decline',
          style: action === 'approve' ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await respondMutation.mutateAsync({ bookingId: b.id, action });
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Try again');
            }
          },
        },
      ],
    );
  };

  const billNext = async (b: BookingRow) => {
    try {
      await billMutation.mutateAsync({ bookingId: b.id });
      Alert.alert('Invoice issued', `Month ${b.months_billed + 1} of ${b.term_months} billed to ${b.customer_name}.`);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Try again');
    }
  };

  const endRental = (b: BookingRow) => {
    Alert.alert('End this rental?', `Release ${b.sqft} sqft back to availability. ${b.customer_name} will be notified.`, [
      { text: 'Back', style: 'cancel' },
      {
        text: 'End rental', style: 'destructive',
        onPress: async () => {
          try { await endMutation.mutateAsync({ bookingId: b.id }); }
          catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Try again'); }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Space rentals</Text>
          <Text style={styles.subtitle}>Rent your warehouse by the square foot</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
          <Plus size={16} color={C.bg} />
          <Text style={styles.newBtnText}>New space</Text>
        </TouchableOpacity>
        <SupportMenu />
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
        {/* Stats */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{totalSqft.toLocaleString()}</Text>
            <Text style={styles.statLabel}>sqft listed</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{totalSqft > 0 ? Math.round((bookedSqft / totalSqft) * 100) : 0}%</Text>
            <Text style={styles.statLabel}>occupied</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>${monthlyRevenue.toLocaleString()}</Text>
            <Text style={styles.statLabel}>monthly</Text>
          </Card>
        </View>

        {/* Pending requests */}
        {requests.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Requests ({requests.length})</Text>
            {requests.map((b) => {
              const q = b.quote ?? {};
              const rate = Number((q as Record<string, unknown>).applied_rate ?? 0);
              const disc = Number((q as Record<string, unknown>).term_discount_pct ?? 0);
              return (
                <Card key={b.id} style={styles.reqCard}>
                  <View style={styles.reqTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reqCustomer}>{b.customer_name}</Text>
                      <Text style={styles.reqMeta}>{b.space_name} · from {b.start_date}</Text>
                    </View>
                    <Text style={styles.reqSqft}>{Number(b.sqft).toLocaleString()} sqft</Text>
                  </View>
                  <View style={styles.quoteBox}>
                    <View style={styles.quoteLine}>
                      <Text style={styles.quoteLabel}>Rate applied</Text>
                      <Text style={styles.quoteValue}>${rate.toFixed(2)}/sqft/mo{disc > 0 ? ` · −${disc}% term` : ''}</Text>
                    </View>
                    <View style={styles.quoteLine}>
                      <Text style={styles.quoteLabel}>Monthly × {b.term_months} mo</Text>
                      <Text style={styles.quoteValue}>${Number(b.monthly_total).toFixed(2)}</Text>
                    </View>
                    {Number(b.one_time_total) > 0 ? (
                      <View style={styles.quoteLine}>
                        <Text style={styles.quoteLabel}>One-time</Text>
                        <Text style={styles.quoteValue}>${Number(b.one_time_total).toFixed(2)}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.quoteLine, styles.quoteTotalLine]}>
                      <Text style={styles.quoteTotalLabel}>Contract total</Text>
                      <Text style={styles.quoteTotalValue}>${Number(b.contract_total).toFixed(2)} {b.currency}</Text>
                    </View>
                  </View>
                  {b.customer_notes ? <Text style={styles.reqNotes}>“{b.customer_notes}”</Text> : null}
                  <View style={styles.reqActions}>
                    <TouchableOpacity style={styles.declineBtn} onPress={() => respond(b, 'decline')} disabled={respondMutation.isPending}>
                      <XCircle size={14} color={C.red} />
                      <Text style={styles.declineText}>Decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.approveBtn} onPress={() => respond(b, 'approve')} disabled={respondMutation.isPending}>
                      <CheckCircle2 size={14} color={C.bg} />
                      <Text style={styles.approveText}>Approve & invoice</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })}
          </>
        ) : null}

        {/* Active rentals */}
        {active.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Active rentals ({active.length})</Text>
            {active.map((b) => (
              <Card key={b.id} style={styles.activeCard}>
                <View style={styles.reqTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reqCustomer}>{b.customer_name}</Text>
                    <Text style={styles.reqMeta}>
                      {b.space_name} · {Number(b.sqft).toLocaleString()} sqft · ${Number(b.monthly_total).toFixed(2)}/mo
                    </Text>
                  </View>
                  <View style={styles.billedPill}>
                    <Text style={styles.billedPillText}>{b.months_billed}/{b.term_months} billed</Text>
                  </View>
                </View>
                <View style={styles.reqActions}>
                  <TouchableOpacity style={styles.endBtn} onPress={() => endRental(b)} disabled={endMutation.isPending}>
                    <Text style={styles.endText}>End rental</Text>
                  </TouchableOpacity>
                  {b.months_billed < b.term_months ? (
                    <TouchableOpacity style={styles.billBtn} onPress={() => billNext(b)} disabled={billMutation.isPending}>
                      <Receipt size={14} color={C.bg} />
                      <Text style={styles.approveText}>Bill month {b.months_billed + 1}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {/* My spaces */}
        <Text style={styles.sectionTitle}>My spaces ({spaces.length})</Text>
        {spacesQuery.isLoading ? (
          <View style={styles.centerPad}><ScreenFeedback state="loading" title="Loading spaces" /></View>
        ) : spaces.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ruler size={22} color={C.accent} />
            <Text style={styles.emptyTitle}>No spaces published yet</Text>
            <Text style={styles.emptyMsg}>
              Publish unused square footage and earn from it — set a base rate, volume tiers for big footprints, term discounts, and add-on services. Every price is quoted transparently to the customer.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowForm(true)}>
              <Plus size={14} color={C.bg} />
              <Text style={styles.emptyBtnText}>Publish first space</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          spaces.map((s) => {
            const availPct = s.total_sqft > 0 ? Math.max(0, (s.total_sqft - s.booked_sqft) / s.total_sqft) : 0;
            const tiers = s.warehouse_space_tiers ?? [];
            const addons = s.warehouse_space_addons ?? [];
            const isPaused = s.status !== 'Active';
            return (
              <Card key={s.id} style={styles.spaceCard}>
                <View style={styles.reqTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spaceName}>{s.name}</Text>
                    <Text style={styles.reqMeta}>{KIND_LABEL[s.space_kind] ?? s.space_kind}{s.city ? ` · ${s.city}` : ''}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => updateMutation.mutate({ id: s.id, status: isPaused ? 'Active' : 'Paused' })}
                    style={styles.pauseBtn}
                  >
                    {isPaused ? <PlayCircle size={18} color={C.green} /> : <PauseCircle size={18} color={C.yellow} />}
                  </TouchableOpacity>
                </View>

                <View style={styles.availTrack}>
                  <View style={[styles.availFill, { width: `${Math.round(availPct * 100)}%` as `${number}%` }]} />
                </View>
                <Text style={styles.availText}>
                  {(s.total_sqft - s.booked_sqft).toLocaleString()} of {Number(s.total_sqft).toLocaleString()} sqft free · base ${Number(s.base_rate_per_sqft_month).toFixed(2)}/sqft/mo
                  {isPaused ? ' · PAUSED' : ''}
                </Text>

                {/* Volume tiers */}
                <View style={styles.subBlock}>
                  <View style={styles.subHead}>
                    <Layers size={13} color={C.textSecondary} />
                    <Text style={styles.subTitle}>Volume tiers</Text>
                    <TouchableOpacity onPress={() => { setTierSpaceId(tierSpaceId === s.id ? null : s.id); setAddonSpaceId(null); }}>
                      <Plus size={15} color={C.accent} />
                    </TouchableOpacity>
                  </View>
                  {tiers.length === 0 ? (
                    <Text style={styles.subEmpty}>No tiers — everyone pays the base rate. Add tiers so bigger footprints get better $/sqft.</Text>
                  ) : (
                    tiers.sort((a, b2) => a.min_sqft - b2.min_sqft).map((t) => (
                      <View key={t.id} style={styles.subRow}>
                        <Text style={styles.subRowText}>{Number(t.min_sqft).toLocaleString()}+ sqft → ${Number(t.rate_per_sqft_month).toFixed(2)}/sqft/mo</Text>
                        <TouchableOpacity onPress={() => removeTierMutation.mutate({ tierId: t.id })}>
                          <Trash2 size={13} color={C.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                  {tierSpaceId === s.id ? (
                    <View style={styles.inlineForm}>
                      <TextInput style={styles.inlineInput} placeholder="Min sqft" placeholderTextColor={C.textMuted} keyboardType="numeric" value={tierMin} onChangeText={setTierMin} />
                      <TextInput style={styles.inlineInput} placeholder="$/sqft/mo" placeholderTextColor={C.textMuted} keyboardType="numeric" value={tierRate} onChangeText={setTierRate} />
                      <TouchableOpacity style={styles.inlineAdd} onPress={() => submitTier(s.id)} disabled={addTierMutation.isPending}>
                        <Text style={styles.inlineAddText}>Add</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {/* Add-ons */}
                <View style={styles.subBlock}>
                  <View style={styles.subHead}>
                    <Receipt size={13} color={C.textSecondary} />
                    <Text style={styles.subTitle}>Add-on services</Text>
                    <TouchableOpacity onPress={() => { setAddonSpaceId(addonSpaceId === s.id ? null : s.id); setTierSpaceId(null); }}>
                      <Plus size={15} color={C.accent} />
                    </TouchableOpacity>
                  </View>
                  {addons.length === 0 ? (
                    <Text style={styles.subEmpty}>None yet — e.g. forklift & handling, 24/7 access, insurance, pallet in/out.</Text>
                  ) : (
                    addons.map((a) => (
                      <View key={a.id} style={styles.subRow}>
                        <Text style={styles.subRowText}>{a.name} — ${Number(a.rate).toFixed(2)} {UNIT_LABEL[a.pricing_unit] ?? a.pricing_unit}</Text>
                        <TouchableOpacity onPress={() => removeAddonMutation.mutate({ addonId: a.id })}>
                          <Trash2 size={13} color={C.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                  {addonSpaceId === s.id ? (
                    <View style={{ gap: 8 }}>
                      <View style={styles.inlineForm}>
                        <TextInput style={[styles.inlineInput, { flex: 2 }]} placeholder="Service name" placeholderTextColor={C.textMuted} value={addonName} onChangeText={setAddonName} />
                        <TextInput style={styles.inlineInput} placeholder="Rate" placeholderTextColor={C.textMuted} keyboardType="numeric" value={addonRate} onChangeText={setAddonRate} />
                      </View>
                      <View style={styles.unitRow}>
                        {Object.entries(UNIT_LABEL).map(([u, label]) => (
                          <TouchableOpacity key={u} style={[styles.unitChip, addonUnit === u && styles.unitChipActive]} onPress={() => setAddonUnit(u)}>
                            <Text style={[styles.unitChipText, addonUnit === u && styles.unitChipTextActive]}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity style={styles.inlineAdd} onPress={() => submitAddon(s.id)} disabled={addAddonMutation.isPending}>
                          <Text style={styles.inlineAddText}>Add</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* New space modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Publish space</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Space name *</Text>
              <TextInput style={styles.input} placeholder="e.g. Bay C — floor storage" placeholderTextColor={C.textMuted} value={fName} onChangeText={setFName} />

              <Text style={styles.fieldLabel}>Space type</Text>
              <View style={styles.kindRow}>
                {KINDS.map((k) => (
                  <TouchableOpacity key={k} style={[styles.unitChip, fKind === k && styles.unitChipActive]} onPress={() => setFKind(k)}>
                    <Text style={[styles.unitChipText, fKind === k && styles.unitChipTextActive]}>{KIND_LABEL[k]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TextInput style={styles.input} placeholder="Vancouver" placeholderTextColor={C.textMuted} value={fCity} onChangeText={setFCity} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Address</Text>
                  <TextInput style={styles.input} placeholder="Street" placeholderTextColor={C.textMuted} value={fAddress} onChangeText={setFAddress} />
                </View>
              </View>

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Total sqft *</Text>
                  <TextInput style={styles.input} placeholder="10000" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fTotal} onChangeText={setFTotal} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Min per booking</Text>
                  <TextInput style={styles.input} placeholder="100" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fMin} onChangeText={setFMin} />
                </View>
              </View>

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Base $/sqft/month *</Text>
                  <TextInput style={styles.input} placeholder="1.50" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fRate} onChangeText={setFRate} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Min term (months)</Text>
                  <TextInput style={styles.input} placeholder="1" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fMinTerm} onChangeText={setFMinTerm} />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Term discounts (%) — 3 / 6 / 12 month commitments</Text>
              <View style={styles.twoCol}>
                <TextInput style={[styles.input, { flex: 1 }]} placeholder="3m %" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fD3} onChangeText={setFD3} />
                <TextInput style={[styles.input, { flex: 1 }]} placeholder="6m %" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fD6} onChangeText={setFD6} />
                <TextInput style={[styles.input, { flex: 1 }]} placeholder="12m %" placeholderTextColor={C.textMuted} keyboardType="numeric" value={fD12} onChangeText={setFD12} />
              </View>

              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput style={[styles.input, styles.inputMultiline]} placeholder="Dock access, racking specs, hours…" placeholderTextColor={C.textMuted} value={fNotes} onChangeText={setFNotes} multiline />

              <TouchableOpacity style={styles.submitBtn} onPress={submitSpace} disabled={createMutation.isPending}>
                <Text style={styles.submitText}>{createMutation.isPending ? 'Publishing…' : 'Publish space'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  newBtnText: { fontSize: 12, fontWeight: '700' as const, color: C.bg },
  list: { paddingHorizontal: 16 },
  centerPad: { paddingTop: 40, alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: { flex: 1, padding: 12, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 10, color: C.textMuted },
  sectionTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text, marginTop: 8, marginBottom: 10 },
  emptyCard: { padding: 20, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  emptyMsg: { fontSize: 12, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
  emptyBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.bg },
  reqCard: { padding: 14, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: C.yellow + '44' },
  activeCard: { padding: 14, marginBottom: 10, gap: 10 },
  reqTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reqCustomer: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  reqMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  reqSqft: { fontSize: 15, fontWeight: '800' as const, color: C.accent },
  quoteBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 12, gap: 6 },
  quoteLine: { flexDirection: 'row', justifyContent: 'space-between' },
  quoteLabel: { fontSize: 12, color: C.textSecondary },
  quoteValue: { fontSize: 12, fontWeight: '600' as const, color: C.text },
  quoteTotalLine: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6, marginTop: 2 },
  quoteTotalLabel: { fontSize: 12, fontWeight: '700' as const, color: C.text },
  quoteTotalValue: { fontSize: 13, fontWeight: '800' as const, color: C.green },
  reqNotes: { fontSize: 12, color: C.textSecondary, fontStyle: 'italic' as const },
  reqActions: { flexDirection: 'row', gap: 10 },
  declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: C.red + '55', borderRadius: 10, paddingVertical: 10 },
  declineText: { fontSize: 12, fontWeight: '700' as const, color: C.red },
  approveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 10, paddingVertical: 10 },
  approveText: { fontSize: 12, fontWeight: '700' as const, color: C.bg },
  billBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.green, borderRadius: 10, paddingVertical: 10 },
  endBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 10 },
  endText: { fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  billedPill: { backgroundColor: C.blue + '22', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  billedPillText: { fontSize: 11, fontWeight: '700' as const, color: C.blue },
  spaceCard: { padding: 14, marginBottom: 10, gap: 10 },
  spaceName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  pauseBtn: { padding: 4 },
  availTrack: { height: 6, borderRadius: 3, backgroundColor: C.bgSecondary, overflow: 'hidden' as const },
  availFill: { height: 6, borderRadius: 3, backgroundColor: C.green },
  availText: { fontSize: 11, color: C.textSecondary },
  subBlock: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, gap: 6 },
  subHead: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'space-between' },
  subTitle: { flex: 1, fontSize: 12, fontWeight: '700' as const, color: C.textSecondary },
  subEmpty: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  subRowText: { flex: 1, fontSize: 12, color: C.text },
  inlineForm: { flexDirection: 'row', gap: 8 },
  inlineInput: { flex: 1, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, color: C.text },
  inlineAdd: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
  inlineAddText: { fontSize: 12, fontWeight: '700' as const, color: C.bg },
  unitRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' },
  unitChip: { borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.card },
  unitChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  unitChipText: { fontSize: 11, fontWeight: '600' as const, color: C.textSecondary },
  unitChipTextActive: { color: C.accent },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '90%' as const },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: C.text },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' as const },
  twoCol: { flexDirection: 'row', gap: 10 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  submitBtn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18, marginBottom: 8 },
  submitText: { fontSize: 14, fontWeight: '800' as const, color: C.bg },
});
