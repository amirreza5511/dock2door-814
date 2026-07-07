import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Modal, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, DollarSign, MapPin, Plus, Trash2, X, Building2, Layers, Fuel, Clock, Package } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Zone = { id: string; name: string; description: string; is_active: boolean; sort_order: number };
type ZoneRate = { id: string; rate_card_id: string; zone_id: string; base_rate: number };
type RateCard = {
  id: string;
  name: string;
  currency: string;
  is_default: boolean;
  is_active: boolean;
  customer_company_id: string | null;
  customer?: { id: string; name: string } | null;
  fuel_surcharge_pct: number;
  prepull_fee: number;
  drop_pick_fee: number;
  chassis_per_day: number;
  waiting_free_min: number;
  waiting_per_hour: number;
  hourly_rate: number;
  hazmat_fee: number;
  overweight_fee: number;
  drayage_zone_rates?: ZoneRate[];
};

const num = (v: string): number => {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export default function DrayageRatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const zonesQuery = trpc.drayage.myZones.useQuery();
  const cardsQuery = trpc.drayage.myRateCards.useQuery();
  const companiesQuery = trpc.drayage.listCompanies.useQuery();

  const upsertZone = trpc.drayage.upsertZone.useMutation();
  const deleteZone = trpc.drayage.deleteZone.useMutation();
  const upsertCard = trpc.drayage.upsertRateCard.useMutation();
  const deleteCard = trpc.drayage.deleteRateCard.useMutation();
  const setZoneRate = trpc.drayage.setZoneRate.useMutation();

  const zones = useMemo(() => (zonesQuery.data ?? []) as Zone[], [zonesQuery.data]);
  const cards = useMemo(() => (cardsQuery.data ?? []) as RateCard[], [cardsQuery.data]);
  const companies = useMemo(() => (companiesQuery.data ?? []) as { id: string; name: string; city?: string }[], [companiesQuery.data]);

  const [zoneModal, setZoneModal] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [cardModal, setCardModal] = useState<RateCard | null>(null);
  const [customerPicker, setCustomerPicker] = useState(false);

  const refreshing = zonesQuery.isFetching || cardsQuery.isFetching;
  const refetchAll = async () => {
    await Promise.all([utils.drayage.myZones.invalidate(), utils.drayage.myRateCards.invalidate()]);
  };

  const haptic = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const saveZone = async () => {
    if (!zoneModal?.name.trim()) { Alert.alert('Required', 'Enter a zone name.'); return; }
    try {
      await upsertZone.mutateAsync({ id: zoneModal.id ?? null, name: zoneModal.name.trim(), description: zoneModal.description.trim() });
      haptic();
      setZoneModal(null);
      await refetchAll();
    } catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'); }
  };

  const removeZone = (z: Zone) => {
    Alert.alert('Delete zone?', `"${z.name}" and its rates will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteZone.mutateAsync({ id: z.id }); await refetchAll(); }
        catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'); }
      } },
    ]);
  };

  const createCard = async (customerCompanyId: string | null) => {
    const isFirst = cards.length === 0;
    try {
      const name = customerCompanyId
        ? companies.find((c) => c.id === customerCompanyId)?.name ?? 'Customer rates'
        : 'Published rates';
      await upsertCard.mutateAsync({ name, customerCompanyId, isDefault: !customerCompanyId && isFirst });
      haptic();
      setCustomerPicker(false);
      await utils.drayage.myRateCards.invalidate();
    } catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'); }
  };

  const removeCard = (card: RateCard) => {
    Alert.alert('Delete rate card?', `"${card.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteCard.mutateAsync({ id: card.id }); await utils.drayage.myRateCards.invalidate(); }
        catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'); }
      } },
    ]);
  };

  const isLoading = zonesQuery.isLoading || cardsQuery.isLoading;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Rates & Zones</Text>
          <Text style={styles.headerSub}>Publish your pricing so customers see the charge</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={[styles.centered]}><ScreenFeedback state="loading" title="Loading rates" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refetchAll()} tintColor={C.accent} />}
        >
          {/* Intro */}
          <View style={styles.intro}>
            <Text style={styles.introText}>
              Set your delivery <Text style={styles.bold}>zones</Text>, then price each zone on a
              <Text style={styles.bold}> rate card</Text>. Keep one published card for everyone, and add
              private per-customer cards for negotiated rates. Accessorials like prepull, waiting time and
              hourly work are added on the card.
            </Text>
          </View>

          {/* ZONES */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionTitleRow}>
              <MapPin size={16} color={C.blue} />
              <Text style={styles.sectionTitle}>Zones</Text>
            </View>
            <TouchableOpacity onPress={() => setZoneModal({ name: '', description: '' })} style={styles.addBtn}>
              <Plus size={15} color={C.accent} />
              <Text style={styles.addBtnText}>Add zone</Text>
            </TouchableOpacity>
          </View>
          {zones.length === 0 ? (
            <Card><EmptyState icon={MapPin} title="No zones yet" description="Add zones like 'Vancouver Metro', 'Fraser Valley' or 'Interior' to price deliveries by area." /></Card>
          ) : zones.map((z) => (
            <Card key={z.id} style={styles.zoneCard}>
              <TouchableOpacity style={styles.zoneMain} onPress={() => setZoneModal({ id: z.id, name: z.name, description: z.description })} activeOpacity={0.7}>
                <View style={styles.zoneIcon}><MapPin size={16} color={C.blue} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneName}>{z.name}</Text>
                  {z.description ? <Text style={styles.zoneDesc}>{z.description}</Text> : null}
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeZone(z)} style={styles.iconDanger}>
                <Trash2 size={16} color={C.red} />
              </TouchableOpacity>
            </Card>
          ))}

          {/* RATE CARDS */}
          <View style={[styles.sectionRow, { marginTop: 12 }]}>
            <View style={styles.sectionTitleRow}>
              <Layers size={16} color={C.accent} />
              <Text style={styles.sectionTitle}>Rate cards</Text>
            </View>
            <TouchableOpacity
              onPress={() => { if (zones.length === 0) { Alert.alert('Add a zone first', 'Create at least one zone before pricing a card.'); return; } setCustomerPicker(true); }}
              style={styles.addBtn}
            >
              <Plus size={15} color={C.accent} />
              <Text style={styles.addBtnText}>New card</Text>
            </TouchableOpacity>
          </View>
          {cards.length === 0 ? (
            <Card><EmptyState icon={DollarSign} title="No rate cards" description="Create your published card to set a base rate per zone plus fuel, prepull and waiting-time charges." /></Card>
          ) : cards.map((card) => {
            const rateFor = (zoneId: string) => card.drayage_zone_rates?.find((r) => r.zone_id === zoneId)?.base_rate ?? 0;
            const priced = zones.filter((z) => rateFor(z.id) > 0).length;
            return (
              <Card key={card.id} style={styles.cardCard}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardName}>{card.name}</Text>
                      {card.is_default ? <View style={styles.defaultBadge}><Text style={styles.defaultText}>PUBLISHED</Text></View> : null}
                      {card.customer_company_id ? <View style={styles.privateBadge}><Text style={styles.privateText}>PRIVATE</Text></View> : null}
                    </View>
                    <Text style={styles.cardMeta}>
                      {card.customer?.name ? `For ${card.customer.name} · ` : ''}{card.currency} · {priced}/{zones.length} zones priced · {card.fuel_surcharge_pct}% fuel
                    </Text>
                  </View>
                  {!card.is_default ? (
                    <TouchableOpacity onPress={() => removeCard(card)} style={styles.iconDanger}>
                      <Trash2 size={15} color={C.red} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Button label="Edit rates & accessorials" variant="ghost" size="sm" fullWidth onPress={() => setCardModal(card)} icon={<DollarSign size={14} color={C.accent} />} />
              </Card>
            );
          })}
        </ScrollView>
      )}

      {/* Zone editor */}
      <Modal visible={zoneModal !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setZoneModal(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{zoneModal?.id ? 'Edit zone' : 'New zone'}</Text>
            <TouchableOpacity onPress={() => setZoneModal(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Input label="Zone name" value={zoneModal?.name ?? ''} onChangeText={(t) => setZoneModal((m) => m ? { ...m, name: t } : m)} placeholder="e.g. Vancouver Metro" />
            <Input label="Description (optional)" value={zoneModal?.description ?? ''} onChangeText={(t) => setZoneModal((m) => m ? { ...m, description: t } : m)} placeholder="Postal codes / cities covered" multiline numberOfLines={2} />
            <Button label="Save zone" onPress={() => void saveZone()} loading={upsertZone.isPending} fullWidth size="lg" />
          </ScrollView>
        </View>
      </Modal>

      {/* Customer picker (new card) */}
      <Modal visible={customerPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCustomerPicker(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New rate card</Text>
            <TouchableOpacity onPress={() => setCustomerPicker(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
            <Text style={styles.pickerHint}>Choose who this card is for:</Text>
            {!cards.some((c) => c.is_default) ? (
              <TouchableOpacity style={styles.pickRow} onPress={() => void createCard(null)}>
                <View style={[styles.pickIcon, { backgroundColor: C.green + '20' }]}><DollarSign size={16} color={C.green} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickName}>Published card (everyone)</Text>
                  <Text style={styles.pickMeta}>Your default rate all customers see</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            <Text style={[styles.pickerHint, { marginTop: 8 }]}>Private card for a specific customer:</Text>
            {companies.length === 0 ? (
              <Text style={styles.pickMeta}>No customer companies available yet.</Text>
            ) : companies.map((c) => (
              <TouchableOpacity key={c.id} style={styles.pickRow} onPress={() => void createCard(c.id)}>
                <View style={[styles.pickIcon, { backgroundColor: C.accent + '20' }]}><Building2 size={16} color={C.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickName}>{c.name}</Text>
                  <Text style={styles.pickMeta}>{c.city ?? 'Private negotiated rates'}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Card editor */}
      {cardModal ? (
        <RateCardEditor
          card={cardModal}
          zones={zones}
          insets={insets}
          onClose={() => setCardModal(null)}
          onSaved={async () => { setCardModal(null); await utils.drayage.myRateCards.invalidate(); }}
          upsertCard={upsertCard}
          setZoneRate={setZoneRate}
        />
      ) : null}
    </View>
  );
}

function RateCardEditor({ card, zones, insets, onClose, onSaved, upsertCard, setZoneRate }: {
  card: RateCard;
  zones: Zone[];
  insets: { top: number; bottom: number };
  onClose: () => void;
  onSaved: () => Promise<void>;
  upsertCard: ReturnType<typeof trpc.drayage.upsertRateCard.useMutation>;
  setZoneRate: ReturnType<typeof trpc.drayage.setZoneRate.useMutation>;
}) {
  const initialRates = useMemo(() => {
    const m: Record<string, string> = {};
    for (const z of zones) {
      const r = card.drayage_zone_rates?.find((x) => x.zone_id === z.id)?.base_rate ?? 0;
      m[z.id] = r ? String(r) : '';
    }
    return m;
  }, [card, zones]);

  const [rates, setRates] = useState<Record<string, string>>(initialRates);
  const [currency, setCurrency] = useState(card.currency);
  const [fuel, setFuel] = useState(String(card.fuel_surcharge_pct ?? 0));
  const [prepull, setPrepull] = useState(String(card.prepull_fee ?? 0));
  const [dropPick, setDropPick] = useState(String(card.drop_pick_fee ?? 0));
  const [chassis, setChassis] = useState(String(card.chassis_per_day ?? 0));
  const [waitFree, setWaitFree] = useState(String(card.waiting_free_min ?? 120));
  const [waitHour, setWaitHour] = useState(String(card.waiting_per_hour ?? 0));
  const [hourly, setHourly] = useState(String(card.hourly_rate ?? 0));
  const [hazmat, setHazmat] = useState(String(card.hazmat_fee ?? 0));
  const [overweight, setOverweight] = useState(String(card.overweight_fee ?? 0));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await upsertCard.mutateAsync({
        id: card.id,
        name: card.name,
        customerCompanyId: card.customer_company_id,
        isDefault: card.is_default,
        currency: currency.trim().toUpperCase() || 'CAD',
        fuelSurchargePct: num(fuel),
        prepullFee: num(prepull),
        dropPickFee: num(dropPick),
        chassisPerDay: num(chassis),
        waitingFreeMin: num(waitFree),
        waitingPerHour: num(waitHour),
        hourlyRate: num(hourly),
        hazmatFee: num(hazmat),
        overweightFee: num(overweight),
      });
      for (const z of zones) {
        await setZoneRate.mutateAsync({ rateCardId: card.id, zoneId: z.id, baseRate: num(rates[z.id] ?? '') });
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSaved();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{card.name}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.editSectionRow}><MapPin size={14} color={C.blue} /><Text style={styles.editSection}>Base rate per zone ({currency})</Text></View>
          {zones.map((z) => (
            <View key={z.id} style={styles.rateRow}>
              <Text style={styles.rateZone} numberOfLines={1}>{z.name}</Text>
              <View style={styles.rateInputWrap}>
                <Text style={styles.rateCurrency}>{currency}</Text>
                <Input
                  value={rates[z.id] ?? ''}
                  onChangeText={(t) => setRates((m) => ({ ...m, [z.id]: t }))}
                  placeholder="0"
                  keyboardType="numeric"
                  containerStyle={styles.rateInput}
                />
              </View>
            </View>
          ))}

          <View style={[styles.editSectionRow, { marginTop: 10 }]}><Fuel size={14} color={C.orange} /><Text style={styles.editSection}>Surcharges & accessorials</Text></View>
          <Input label="Currency" value={currency} onChangeText={setCurrency} placeholder="CAD" autoCapitalize="characters" />
          <Input label="Fuel surcharge (%)" value={fuel} onChangeText={setFuel} placeholder="0" keyboardType="numeric" />
          <View style={styles.twoCol}>
            <Input label="Prepull fee" value={prepull} onChangeText={setPrepull} placeholder="0" keyboardType="numeric" containerStyle={{ flex: 1 }} />
            <Input label="Drop & pick fee" value={dropPick} onChangeText={setDropPick} placeholder="0" keyboardType="numeric" containerStyle={{ flex: 1 }} />
          </View>
          <Input label="Chassis per day" value={chassis} onChangeText={setChassis} placeholder="0" keyboardType="numeric" />

          <View style={[styles.editSectionRow, { marginTop: 10 }]}><Clock size={14} color={C.purple} /><Text style={styles.editSection}>Waiting & hourly</Text></View>
          <View style={styles.twoCol}>
            <Input label="Free wait (min)" value={waitFree} onChangeText={setWaitFree} placeholder="120" keyboardType="numeric" containerStyle={{ flex: 1 }} />
            <Input label="Waiting / hour" value={waitHour} onChangeText={setWaitHour} placeholder="0" keyboardType="numeric" containerStyle={{ flex: 1 }} />
          </View>
          <Input label="Hourly work rate" value={hourly} onChangeText={setHourly} placeholder="0" keyboardType="numeric" />

          <View style={[styles.editSectionRow, { marginTop: 10 }]}><Package size={14} color={C.yellow} /><Text style={styles.editSection}>Special cargo</Text></View>
          <View style={styles.twoCol}>
            <Input label="Hazmat fee" value={hazmat} onChangeText={setHazmat} placeholder="0" keyboardType="numeric" containerStyle={{ flex: 1 }} />
            <Input label="Overweight fee" value={overweight} onChangeText={setOverweight} placeholder="0" keyboardType="numeric" containerStyle={{ flex: 1 }} />
          </View>

          <Button label="Save rate card" onPress={() => void save()} loading={saving} fullWidth size="lg" icon={<DollarSign size={16} color={C.white} />} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  scroll: { padding: 20, gap: 10 },
  intro: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  introText: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  bold: { fontWeight: '800' as const, color: C.text },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accentDim, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnText: { fontSize: 12, fontWeight: '700' as const, color: C.accent },
  zoneCard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zoneMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  zoneIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.blue + '20', alignItems: 'center', justifyContent: 'center' },
  zoneName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  zoneDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  iconDanger: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.redDim, alignItems: 'center', justifyContent: 'center' },
  cardCard: { gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  cardName: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  defaultBadge: { backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  defaultText: { fontSize: 9, fontWeight: '800' as const, color: C.green, letterSpacing: 0.5 },
  privateBadge: { backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  privateText: { fontSize: 9, fontWeight: '800' as const, color: C.accent, letterSpacing: 0.5 },
  cardMeta: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text, flex: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12, paddingBottom: 60 },
  pickerHint: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  pickIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pickName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  pickMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  editSectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  editSection: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rateZone: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: C.text },
  rateInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 150 },
  rateCurrency: { fontSize: 12, color: C.textMuted, fontWeight: '700' as const },
  rateInput: { flex: 1 },
  twoCol: { flexDirection: 'row', gap: 10 },
});
