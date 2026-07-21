import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Alert, RefreshControl, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Ship, Plus, X, ChevronLeft, MapPin, Package, Anchor, MessageCircle, Send, Check,
  Truck, Warehouse, CircleDot, Route,
} from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import WorldPicker, { type PickerOption } from '@/components/WorldPicker';
import C from '@/constants/colors';
import { trpc, type OceanLeg } from '@/lib/trpc';
import { usePreferences } from '@/store/preferences';
import { COUNTRIES, SEAPORTS, CURRENCY_CODES, weightUnitFor } from '@/constants/world';

const COUNTRY_OPTIONS: PickerOption[] = COUNTRIES.map((c) => ({ value: c.name, label: c.name, sublabel: c.code, glyph: c.flag, keywords: c.code }));
const PORT_OPTIONS: PickerOption[] = SEAPORTS.map((p) => ({ value: p.name, label: p.name, sublabel: `${p.code} · ${p.country}`, keywords: `${p.code} ${p.country}` }));

const LEG_ICON: Record<OceanLeg['leg_type'], React.ComponentType<{ size?: number; color?: string }>> = {
  OriginPort: Anchor, OceanTransit: Ship, DestPort: Anchor, Warehouse, FinalMile: Truck,
};

const CONTAINER_SIZES = ['20ft', '40ft', '40ft HC', 'LCL'] as const;
const CURRENCIES = CURRENCY_CODES;

type OceanRequest = {
  id: string; title: string; origin_country: string; origin_port: string;
  dest_country: string; dest_port: string; container_size: string; cargo_type: string;
  weight: number; weight_unit: string; ready_date: string | null; incoterms: string;
  currency: string; notes: string; status: string; awarded_amount: number;
  awarded_name: string; offer_count: number; created_at: string;
};

type OceanOffer = {
  id: string; forwarder_name: string; amount: number; currency: string;
  transit_days: number; sailing_date: string | null; note: string; status: string; created_at: string;
};

type OceanMessage = { id: string; sender_name: string; body: string; created_at: string };

export default function CustomerOceanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const mineQuery = trpc.ocean.mine.useQuery(undefined);
  const requests = (mineQuery.data ?? []) as OceanRequest[];

  const [postModal, setPostModal] = useState<boolean>(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const createMutation = trpc.ocean.create.useMutation({
    onSuccess: async () => { await utils.ocean.mine.invalidate(); },
  });

  const [title, setTitle] = useState<string>('');
  const [originCountry, setOriginCountry] = useState<string>('');
  const [originPort, setOriginPort] = useState<string>('');
  const [destCountry, setDestCountry] = useState<string>('');
  const [destPort, setDestPort] = useState<string>('');
  const [containerSize, setContainerSize] = useState<string>('40ft');
  const [cargoType, setCargoType] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const prefCurrency = usePreferences((s) => s.currency);
  const prefUnits = usePreferences((s) => s.unitSystem);
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(weightUnitFor(prefUnits));
  const [currency, setCurrency] = useState<string>(prefCurrency);
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const resetForm = useCallback(() => {
    setTitle(''); setOriginCountry(''); setOriginPort(''); setDestCountry('');
    setDestPort(''); setContainerSize('40ft'); setCargoType(''); setWeight('');
    setWeightUnit(weightUnitFor(prefUnits)); setCurrency(prefCurrency); setNotes('');
  }, [prefUnits, prefCurrency]);

  const handlePost = useCallback(async () => {
    if (!title.trim()) { Alert.alert('Missing title', 'Give your shipment a short title.'); return; }
    setSubmitting(true);
    try {
      await createMutation.mutateAsync({
        title: title.trim(), originCountry, originPort, destCountry, destPort,
        containerSize, cargoType, weight: Number(weight) || 0, weightUnit, currency, notes,
      });
      setPostModal(false);
      resetForm();
      Alert.alert('Posted!', 'Freight forwarders can now send you offers.');
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to post request.');
    } finally {
      setSubmitting(false);
    }
  }, [title, originCountry, originPort, destCountry, destPort, containerSize, cargoType, weight, weightUnit, currency, notes, createMutation, resetForm]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Ocean Booking</Text>
            <Text style={styles.headerSub}>Post a container request — forwarders bid</Text>
          </View>
          <TouchableOpacity onPress={() => setPostModal(true)} style={styles.newBtn}>
            <Plus size={18} color={C.bg} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={mineQuery.isFetching} onRefresh={() => mineQuery.refetch()} tintColor={C.accent} />}
      >
        {mineQuery.isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : requests.length === 0 ? (
          <View style={styles.emptyState}>
            <Ship size={44} color={C.textMuted} />
            <Text style={styles.emptyText}>No ocean requests yet</Text>
            <Text style={styles.emptySub}>Post a container shipment to receive offers from freight forwarders worldwide.</Text>
            <Button label="Post a request" onPress={() => setPostModal(true)} />
          </View>
        ) : requests.map((r) => (
          <TouchableOpacity key={r.id} onPress={() => setDetailId(r.id)} style={styles.card} activeOpacity={0.85}>
            <View style={styles.cardHeader}>
              <View style={styles.badge}>
                <Ship size={13} color={C.blue} />
                <Text style={styles.badgeText}>{r.container_size}</Text>
              </View>
              <StatusBadge status={r.status} />
            </View>
            <Text style={styles.cardName}>{r.title}</Text>
            <View style={styles.routeRow}>
              <MapPin size={13} color={C.textMuted} />
              <Text style={styles.routeText} numberOfLines={1}>
                {r.origin_port || r.origin_country || '—'} → {r.dest_port || r.dest_country || '—'}
              </Text>
            </View>
            <View style={styles.cardFooter}>
              {r.status === 'Open' ? (
                <Text style={styles.offerCount}>{r.offer_count} offer{r.offer_count === 1 ? '' : 's'}</Text>
              ) : (
                <Text style={styles.awarded}>{r.awarded_name} · {r.currency} {r.awarded_amount}</Text>
              )}
              <Text style={styles.cargoText}>{r.cargo_type || 'General cargo'}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* POST MODAL */}
      <Modal visible={postModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalTopBar}>
            <Text style={styles.modalTitle}>New ocean request</Text>
            <TouchableOpacity onPress={() => setPostModal(false)}><X size={24} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Input label="Shipment title *" value={title} onChangeText={setTitle} placeholder="Furniture Vancouver → Dubai" />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><WorldPicker label="Origin country" value={originCountry} options={COUNTRY_OPTIONS} placeholder="Canada" onSelect={setOriginCountry} /></View>
              <View style={{ flex: 1 }}><WorldPicker label="Origin port" value={originPort} options={PORT_OPTIONS} placeholder="Vancouver" onSelect={setOriginPort} /></View>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><WorldPicker label="Dest. country" value={destCountry} options={COUNTRY_OPTIONS} placeholder="UAE" onSelect={setDestCountry} /></View>
              <View style={{ flex: 1 }}><WorldPicker label="Dest. port" value={destPort} options={PORT_OPTIONS} placeholder="Jebel Ali" onSelect={setDestPort} /></View>
            </View>
            <Text style={styles.fieldLabel}>Container size</Text>
            <View style={styles.chipRow}>
              {CONTAINER_SIZES.map((s) => (
                <TouchableOpacity key={s} onPress={() => setContainerSize(s)} style={[styles.chip, containerSize === s && styles.chipActive]}>
                  <Text style={[styles.chipText, containerSize === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input label="Cargo type" value={cargoType} onChangeText={setCargoType} placeholder="Furniture, machinery…" />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><Input label="Weight" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="8000" /></View>
              <View style={{ width: 120 }}>
                <Text style={styles.fieldLabel}>Unit</Text>
                <View style={styles.chipRow}>
                  {(['kg', 'lb'] as const).map((u) => (
                    <TouchableOpacity key={u} onPress={() => setWeightUnit(u)} style={[styles.chip, weightUnit === u && styles.chipActive]}>
                      <Text style={[styles.chipText, weightUnit === u && styles.chipTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <Text style={styles.fieldLabel}>Quote currency</Text>
            <View style={styles.chipRow}>
              {CURRENCIES.map((cur) => (
                <TouchableOpacity key={cur} onPress={() => setCurrency(cur)} style={[styles.chip, currency === cur && styles.chipActive]}>
                  <Text style={[styles.chipText, currency === cur && styles.chipTextActive]}>{cur}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} placeholder="Ready date, special requirements…" />
            <Button label="Post request" onPress={handlePost} loading={submitting} fullWidth size="lg" />
          </ScrollView>
        </View>
      </Modal>

      {/* DETAIL MODAL */}
      {detailId && (
        <OceanDetailModal requestId={detailId} onClose={() => setDetailId(null)} />
      )}
    </View>
  );
}

function OceanDetailModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const reqQuery = trpc.ocean.get.useQuery({ requestId });
  const offersQuery = trpc.ocean.offers.useQuery({ requestId });
  const messagesQuery = trpc.ocean.messages.useQuery({ requestId });
  const req = reqQuery.data as (OceanRequest & { customer_company_id: string }) | null;
  const offers = (offersQuery.data ?? []) as OceanOffer[];
  const messages = (messagesQuery.data ?? []) as OceanMessage[];

  const acceptMutation = trpc.ocean.acceptOffer.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.ocean.offers.invalidate({ requestId }), utils.ocean.get.invalidate({ requestId }), utils.ocean.mine.invalidate()]);
    },
  });
  const sendMutation = trpc.ocean.sendMessage.useMutation({
    onSuccess: async () => { await utils.ocean.messages.invalidate({ requestId }); },
  });
  const legsQuery = trpc.ocean.legs.useQuery({ requestId });
  const legs = (legsQuery.data ?? []) as OceanLeg[];
  const setupMutation = trpc.ocean.setupFinalMile.useMutation({
    onSuccess: async () => { await utils.ocean.legs.invalidate({ requestId }); },
  });
  const advanceMutation = trpc.ocean.advanceLeg.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.ocean.legs.invalidate({ requestId }), utils.ocean.get.invalidate({ requestId }), utils.ocean.mine.invalidate()]);
    },
  });

  const [msg, setMsg] = useState<string>('');
  const [fmAddress, setFmAddress] = useState<string>('');
  const [fmCity, setFmCity] = useState<string>('');
  const [fmContact, setFmContact] = useState<string>('');
  const [fmPhone, setFmPhone] = useState<string>('');
  const isBooked = req?.status && req.status !== 'Open';
  const isLcl = req?.container_size === 'LCL';

  const handleSetupFinalMile = useCallback(async () => {
    try {
      await setupMutation.mutateAsync({
        requestId, needsFinalMile: true,
        finalMileAddress: fmAddress.trim(), finalMileCity: fmCity.trim(),
        finalMileContact: fmContact.trim(), finalMilePhone: fmPhone.trim(),
      });
    } catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to set up delivery.'); }
  }, [requestId, fmAddress, fmCity, fmContact, fmPhone, setupMutation]);

  const handleAdvance = useCallback((leg: OceanLeg) => {
    Alert.alert('Complete leg', `Mark "${leg.title}" as done?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete', onPress: async () => {
        try { await advanceMutation.mutateAsync({ legId: leg.id }); }
        catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to update leg.'); }
      } },
    ]);
  }, [advanceMutation]);

  const handleAccept = useCallback((offerId: string, name: string) => {
    Alert.alert('Accept offer', `Book ${name} for this shipment? All other offers will be declined.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept', onPress: async () => {
          try { await acceptMutation.mutateAsync({ offerId }); }
          catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to accept.'); }
        },
      },
    ]);
  }, [acceptMutation]);

  const handleSend = useCallback(async () => {
    if (!msg.trim()) return;
    const body = msg.trim();
    setMsg('');
    try { await sendMutation.mutateAsync({ requestId, body }); }
    catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to send.'); }
  }, [msg, requestId, sendMutation]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalTopBar}>
          <Text style={styles.modalTitle} numberOfLines={1}>{req?.title ?? 'Request'}</Text>
          <TouchableOpacity onPress={onClose}><X size={24} color={C.text} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
          {req && (
            <View style={styles.detailCard}>
              <View style={styles.routeRow}>
                <Anchor size={14} color={C.blue} />
                <Text style={styles.detailRoute}>{req.origin_port || req.origin_country} → {req.dest_port || req.dest_country}</Text>
              </View>
              <View style={styles.detailMetaRow}>
                <View style={styles.metaPill}><Package size={12} color={C.textSecondary} /><Text style={styles.metaText}>{req.container_size}</Text></View>
                <View style={styles.metaPill}><Text style={styles.metaText}>{req.weight} {req.weight_unit}</Text></View>
                <StatusBadge status={req.status} />
              </View>
              {req.cargo_type ? <Text style={styles.detailNotes}>{req.cargo_type}</Text> : null}
              {req.notes ? <Text style={styles.detailNotes}>{req.notes}</Text> : null}
            </View>
          )}

          <Text style={styles.sectionTitle}>Offers ({offers.length})</Text>
          {offersQuery.isLoading ? (
            <ActivityIndicator color={C.accent} />
          ) : offers.length === 0 ? (
            <Text style={styles.emptySub}>No offers yet. Forwarders will send quotes soon.</Text>
          ) : offers.map((o) => (
            <View key={o.id} style={[styles.offerCard, o.status === 'Accepted' && styles.offerAccepted]}>
              <View style={styles.offerTop}>
                <Text style={styles.offerName}>{o.forwarder_name}</Text>
                <Text style={styles.offerAmount}>{o.currency} {o.amount}</Text>
              </View>
              <View style={styles.offerMeta}>
                {o.transit_days > 0 ? <Text style={styles.offerMetaText}>{o.transit_days} days transit</Text> : null}
                {o.sailing_date ? <Text style={styles.offerMetaText}>Sails {o.sailing_date}</Text> : null}
              </View>
              {o.note ? <Text style={styles.offerNote}>{o.note}</Text> : null}
              {o.status === 'Accepted' ? (
                <View style={styles.acceptedPill}><Check size={14} color={C.green} /><Text style={styles.acceptedText}>Accepted</Text></View>
              ) : !isBooked ? (
                <Button label="Accept offer" size="sm" onPress={() => handleAccept(o.id, o.forwarder_name)} loading={acceptMutation.isPending} />
              ) : (
                <Text style={styles.offerMetaText}>{o.status}</Text>
              )}
            </View>
          ))}

          {isBooked && (
            <>
              <Text style={styles.sectionTitle}><Route size={15} color={C.text} /> Delivery & tracking</Text>
              {legs.length === 0 ? (
                <View style={styles.detailCard}>
                  <Text style={styles.emptySub}>
                    {isLcl
                      ? 'This is a shared (LCL) container. Set up a local warehouse deconsolidation + final-mile delivery to see live leg tracking.'
                      : 'Add a final-mile local delivery to track every leg from port to your door.'}
                  </Text>
                  <Input label="Delivery address" value={fmAddress} onChangeText={setFmAddress} placeholder="123 Main St" containerStyle={{ marginBottom: 0 }} />
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}><Input label="City" value={fmCity} onChangeText={setFmCity} placeholder="Burnaby" containerStyle={{ marginBottom: 0 }} /></View>
                    <View style={{ flex: 1 }}><Input label="Contact" value={fmContact} onChangeText={setFmContact} placeholder="Name" containerStyle={{ marginBottom: 0 }} /></View>
                  </View>
                  <Input label="Phone" value={fmPhone} onChangeText={setFmPhone} placeholder="604-555-0100" keyboardType="phone-pad" containerStyle={{ marginBottom: 0 }} />
                  <Button label="Set up delivery & tracking" size="sm" onPress={handleSetupFinalMile} loading={setupMutation.isPending} fullWidth />
                </View>
              ) : (
                <View style={styles.timeline}>
                  {legs.map((leg, idx) => {
                    const Icon = LEG_ICON[leg.leg_type] ?? CircleDot;
                    const done = leg.status === 'Done';
                    const active = leg.status === 'Active';
                    const tint = done ? C.green : active ? C.accent : C.textMuted;
                    return (
                      <View key={leg.id} style={styles.legRow}>
                        <View style={styles.legRail}>
                          <View style={[styles.legDot, { borderColor: tint, backgroundColor: done ? C.green : 'transparent' }]}>
                            <Icon size={13} color={done ? C.bg : tint} />
                          </View>
                          {idx < legs.length - 1 && <View style={[styles.legLine, { backgroundColor: done ? C.green : C.border }]} />}
                        </View>
                        <View style={styles.legBody}>
                          <Text style={[styles.legTitle, done && { color: C.textSecondary }]}>{leg.title}</Text>
                          <Text style={[styles.legStatus, { color: tint }]}>{done ? 'Done' : active ? 'In progress' : 'Pending'}</Text>
                          {active && (
                            <Button label="Mark complete" size="sm" variant="secondary" onPress={() => handleAdvance(leg)} loading={advanceMutation.isPending} />
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              <Text style={styles.sectionTitle}><MessageCircle size={15} color={C.text} /> Chat</Text>
              {messages.length === 0 ? (
                <Text style={styles.emptySub}>No messages yet. Say hello to coordinate documents.</Text>
              ) : messages.map((m) => (
                <View key={m.id} style={styles.msgBubble}>
                  <Text style={styles.msgSender}>{m.sender_name}</Text>
                  <Text style={styles.msgBody}>{m.body}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>

        {isBooked && (
          <View style={[styles.chatBar, { paddingBottom: insets.bottom + 8 }]}>
            <Input value={msg} onChangeText={setMsg} placeholder="Message forwarder…" containerStyle={{ flex: 1, marginBottom: 0 }} />
            <TouchableOpacity onPress={handleSend} style={styles.sendBtn}>
              <Send size={18} color={C.bg} />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.blue + '20' },
  badgeText: { fontSize: 12, fontWeight: '700' as const, color: C.blue },
  cardName: { fontSize: 17, fontWeight: '700' as const, color: C.text, marginBottom: 6 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  routeText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  offerCount: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  awarded: { fontSize: 13, fontWeight: '700' as const, color: C.green },
  cargoText: { fontSize: 12, color: C.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 17, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 19 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text, flex: 1 },
  row2: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: -4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  detailCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 8 },
  detailRoute: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.bgSecondary },
  metaText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  detailNotes: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text, marginTop: 4 },
  offerCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  offerAccepted: { borderColor: C.green },
  offerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offerName: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  offerAmount: { fontSize: 16, fontWeight: '800' as const, color: C.accent },
  offerMeta: { flexDirection: 'row', gap: 12 },
  offerMetaText: { fontSize: 12, color: C.textMuted },
  offerNote: { fontSize: 13, color: C.textSecondary },
  acceptedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  acceptedText: { fontSize: 13, fontWeight: '700' as const, color: C.green },
  msgBubble: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  msgSender: { fontSize: 11, fontWeight: '700' as const, color: C.accent, marginBottom: 3 },
  msgBody: { fontSize: 14, color: C.text, lineHeight: 20 },
  chatBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bgSecondary },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  timeline: { gap: 0 },
  legRow: { flexDirection: 'row', gap: 12 },
  legRail: { alignItems: 'center', width: 30 },
  legDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  legLine: { width: 2, flex: 1, minHeight: 20, marginVertical: 2 },
  legBody: { flex: 1, paddingBottom: 18, gap: 4 },
  legTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  legStatus: { fontSize: 12, fontWeight: '600' as const },
});
