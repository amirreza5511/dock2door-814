import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Modal, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, DollarSign, MapPin, Plus, Trash2, X, Building2, Layers, SlidersHorizontal } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import type { Accessorial, VerticalConfig } from '@/constants/pricing';

type Zone = { id: string; name: string; description: string; is_active: boolean; sort_order: number };
type ZoneRate = { id: string; rate_card_id: string; zone_id: string; base_rate: number };
type RateCard = {
  id: string;
  name: string;
  currency: string;
  base_unit: string;
  is_default: boolean;
  is_active: boolean;
  customer_company_id: string | null;
  customer?: { id: string; name: string } | null;
  accessorials: Accessorial[];
  provider_zone_rates?: ZoneRate[];
};

const num = (v: string): number => {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const typeSuffix = (t: Accessorial['type']): string =>
  t === 'pct' ? '%' : t === 'perHour' ? '/hr' : t === 'perUnit' ? '/unit' : 'flat';

/** Shared rate-card manager, driven by a per-vertical config. */
export default function RatesManagerScreen({ config }: { config: VerticalConfig }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const vertical = config.vertical;

  const zonesQuery = trpc.pricing.myZones.useQuery({ vertical });
  const cardsQuery = trpc.pricing.myRateCards.useQuery({ vertical });
  const companiesQuery = trpc.pricing.listCustomerCompanies.useQuery();

  const upsertZone = trpc.pricing.upsertZone.useMutation();
  const deleteZone = trpc.pricing.deleteZone.useMutation();
  const upsertCard = trpc.pricing.upsertRateCard.useMutation();
  const deleteCard = trpc.pricing.deleteRateCard.useMutation();
  const setZoneRate = trpc.pricing.setZoneRate.useMutation();

  const zones = useMemo(() => (zonesQuery.data ?? []) as Zone[], [zonesQuery.data]);
  const cards = useMemo(() => (cardsQuery.data ?? []) as RateCard[], [cardsQuery.data]);
  const companies = useMemo(() => (companiesQuery.data ?? []) as { id: string; name: string; city?: string }[], [companiesQuery.data]);

  const [zoneModal, setZoneModal] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [cardModal, setCardModal] = useState<RateCard | null>(null);
  const [customerPicker, setCustomerPicker] = useState(false);

  const refreshing = zonesQuery.isFetching || cardsQuery.isFetching;
  const refetchAll = async () => {
    await Promise.all([utils.pricing.myZones.invalidate(), utils.pricing.myRateCards.invalidate()]);
  };

  const haptic = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const saveZone = async () => {
    if (!zoneModal?.name.trim()) { Alert.alert('Required', 'Enter a name.'); return; }
    try {
      await upsertZone.mutateAsync({ id: zoneModal.id ?? null, vertical, name: zoneModal.name.trim(), description: zoneModal.description.trim() });
      haptic();
      setZoneModal(null);
      await refetchAll();
    } catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'); }
  };

  const removeZone = (z: Zone) => {
    Alert.alert(`Delete ${config.zoneLabel.toLowerCase()}?`, `"${z.name}" and its rates will be removed.`, [
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
      await upsertCard.mutateAsync({
        vertical,
        name,
        customerCompanyId,
        isDefault: !customerCompanyId && isFirst,
        baseUnit: config.baseUnit,
        accessorials: config.defaultAccessorials,
      });
      haptic();
      setCustomerPicker(false);
      await utils.pricing.myRateCards.invalidate();
    } catch (e) { Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'); }
  };

  const removeCard = (card: RateCard) => {
    Alert.alert('Delete rate card?', `"${card.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteCard.mutateAsync({ id: card.id }); await utils.pricing.myRateCards.invalidate(); }
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
          <Text style={styles.headerTitle}>{config.title}</Text>
          <Text style={styles.headerSub}>{config.subtitle}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ScreenFeedback state="loading" title="Loading rates" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refetchAll()} tintColor={C.accent} />}
        >
          <View style={styles.intro}>
            <Text style={styles.introText}>
              Set your <Text style={styles.bold}>{config.zoneLabelPlural.toLowerCase()}</Text>, then price each one on a
              <Text style={styles.bold}> rate card</Text>. Keep one published card for everyone, and add
              private per-customer cards for negotiated rates. Extra fees are added on the card.
            </Text>
          </View>

          {/* ZONES */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionTitleRow}>
              <MapPin size={16} color={C.blue} />
              <Text style={styles.sectionTitle}>{config.zoneLabelPlural}</Text>
            </View>
            <TouchableOpacity onPress={() => setZoneModal({ name: '', description: '' })} style={styles.addBtn}>
              <Plus size={15} color={C.accent} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          {zones.length === 0 ? (
            <Card><EmptyState icon={MapPin} title={`No ${config.zoneLabelPlural.toLowerCase()} yet`} description={config.zoneHint} /></Card>
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
              onPress={() => { if (zones.length === 0) { Alert.alert(`Add a ${config.zoneLabel.toLowerCase()} first`, `Create at least one ${config.zoneLabel.toLowerCase()} before pricing a card.`); return; } setCustomerPicker(true); }}
              style={styles.addBtn}
            >
              <Plus size={15} color={C.accent} />
              <Text style={styles.addBtnText}>New card</Text>
            </TouchableOpacity>
          </View>
          {cards.length === 0 ? (
            <Card><EmptyState icon={DollarSign} title="No rate cards" description="Create your published card to set a base rate per zone plus your extra fees." /></Card>
          ) : cards.map((card) => {
            const rateFor = (zoneId: string) => card.provider_zone_rates?.find((r) => r.zone_id === zoneId)?.base_rate ?? 0;
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
                      {card.customer?.name ? `For ${card.customer.name} · ` : ''}{card.currency} · {priced}/{zones.length} priced · {card.base_unit || config.baseUnit}
                    </Text>
                  </View>
                  {!card.is_default ? (
                    <TouchableOpacity onPress={() => removeCard(card)} style={styles.iconDanger}>
                      <Trash2 size={15} color={C.red} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Button label="Edit rates & fees" variant="ghost" size="sm" fullWidth onPress={() => setCardModal(card)} icon={<DollarSign size={14} color={C.accent} />} />
              </Card>
            );
          })}
        </ScrollView>
      )}

      {/* Zone editor */}
      <Modal visible={zoneModal !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setZoneModal(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{zoneModal?.id ? `Edit ${config.zoneLabel.toLowerCase()}` : `New ${config.zoneLabel.toLowerCase()}`}</Text>
            <TouchableOpacity onPress={() => setZoneModal(null)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Input label={`${config.zoneLabel} name`} value={zoneModal?.name ?? ''} onChangeText={(t) => setZoneModal((m) => m ? { ...m, name: t } : m)} placeholder={config.zonePlaceholder} />
            <Input label="Description (optional)" value={zoneModal?.description ?? ''} onChangeText={(t) => setZoneModal((m) => m ? { ...m, description: t } : m)} placeholder="Details / what it covers" multiline numberOfLines={2} />
            <Button label="Save" onPress={() => void saveZone()} loading={upsertZone.isPending} fullWidth size="lg" />
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
          config={config}
          insets={insets}
          onClose={() => setCardModal(null)}
          onSaved={async () => { setCardModal(null); await utils.pricing.myRateCards.invalidate(); }}
          upsertCard={upsertCard}
          setZoneRate={setZoneRate}
        />
      ) : null}
    </View>
  );
}

function RateCardEditor({ card, zones, config, insets, onClose, onSaved, upsertCard, setZoneRate }: {
  card: RateCard;
  zones: Zone[];
  config: VerticalConfig;
  insets: { top: number; bottom: number };
  onClose: () => void;
  onSaved: () => Promise<void>;
  upsertCard: ReturnType<typeof trpc.pricing.upsertRateCard.useMutation>;
  setZoneRate: ReturnType<typeof trpc.pricing.setZoneRate.useMutation>;
}) {
  const initialRates = useMemo(() => {
    const m: Record<string, string> = {};
    for (const z of zones) {
      const r = card.provider_zone_rates?.find((x) => x.zone_id === z.id)?.base_rate ?? 0;
      m[z.id] = r ? String(r) : '';
    }
    return m;
  }, [card, zones]);

  const initialAccessorials = useMemo<Accessorial[]>(() => {
    const existing = Array.isArray(card.accessorials) ? card.accessorials : [];
    return existing.length > 0 ? existing : config.defaultAccessorials;
  }, [card, config]);

  const [rates, setRates] = useState<Record<string, string>>(initialRates);
  const [currency, setCurrency] = useState(card.currency);
  const [baseUnit, setBaseUnit] = useState(card.base_unit || config.baseUnit);
  const [accessorials, setAccessorials] = useState<Accessorial[]>(initialAccessorials);
  const [saving, setSaving] = useState(false);

  const setAmount = (key: string, v: string) => {
    setAccessorials((list) => list.map((a) => (a.key === key ? { ...a, amount: num(v) } : a)));
  };
  const removeAccessorial = (key: string) => setAccessorials((list) => list.filter((a) => a.key !== key));
  const addAccessorial = () => {
    const key = `custom_${Date.now()}`;
    setAccessorials((list) => [...list, { key, label: 'New fee', amount: 0, type: 'flat' }]);
  };
  const setLabel = (key: string, v: string) => setAccessorials((list) => list.map((a) => (a.key === key ? { ...a, label: v } : a)));
  const cycleType = (key: string) => {
    const order: Accessorial['type'][] = ['flat', 'perUnit', 'perHour', 'pct'];
    setAccessorials((list) => list.map((a) => (a.key === key ? { ...a, type: order[(order.indexOf(a.type) + 1) % order.length] } : a)));
  };

  const save = async () => {
    setSaving(true);
    try {
      await upsertCard.mutateAsync({
        id: card.id,
        vertical: config.vertical,
        name: card.name,
        customerCompanyId: card.customer_company_id,
        isDefault: card.is_default,
        currency: currency.trim().toUpperCase() || 'CAD',
        baseUnit: baseUnit.trim(),
        accessorials,
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
          <View style={styles.twoCol}>
            <Input label="Currency" value={currency} onChangeText={setCurrency} placeholder="CAD" autoCapitalize="characters" containerStyle={{ flex: 1 }} />
            <Input label="Base unit" value={baseUnit} onChangeText={setBaseUnit} placeholder={config.baseUnit} containerStyle={{ flex: 1.4 }} />
          </View>

          <View style={styles.editSectionRow}><MapPin size={14} color={C.blue} /><Text style={styles.editSection}>Base rate per {config.zoneLabel.toLowerCase()} ({currency} {baseUnit})</Text></View>
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

          <View style={[styles.editSectionRow, { marginTop: 10 }]}><SlidersHorizontal size={14} color={C.orange} /><Text style={styles.editSection}>Extra fees & surcharges</Text></View>
          {accessorials.map((a) => (
            <View key={a.key} style={styles.accRow}>
              <View style={{ flex: 1, gap: 4 }}>
                <Input value={a.label} onChangeText={(t) => setLabel(a.key, t)} placeholder="Fee name" containerStyle={{ flex: 1 }} />
                <TouchableOpacity onPress={() => cycleType(a.key)} style={styles.typeChip}>
                  <Text style={styles.typeChipText}>{typeSuffix(a.type)}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.accAmountWrap}>
                <Text style={styles.rateCurrency}>{a.type === 'pct' ? '%' : currency}</Text>
                <Input value={a.amount ? String(a.amount) : ''} onChangeText={(t) => setAmount(a.key, t)} placeholder="0" keyboardType="numeric" containerStyle={styles.rateInput} />
              </View>
              <TouchableOpacity onPress={() => removeAccessorial(a.key)} style={styles.iconDangerSm}>
                <Trash2 size={14} color={C.red} />
              </TouchableOpacity>
            </View>
          ))}
          <Button label="Add a fee" variant="ghost" size="sm" onPress={addAccessorial} icon={<Plus size={14} color={C.accent} />} />

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
  iconDangerSm: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.redDim, alignItems: 'center', justifyContent: 'center' },
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
  accRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  accAmountWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 110 },
  typeChip: { alignSelf: 'flex-start', backgroundColor: C.bgSecondary, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 5 },
  typeChipText: { fontSize: 11, fontWeight: '700' as const, color: C.textSecondary },
  twoCol: { flexDirection: 'row', gap: 10 },
});
