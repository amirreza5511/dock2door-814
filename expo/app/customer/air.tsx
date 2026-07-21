import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  Modal, Alert, RefreshControl, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  Plane, Plus, X, ChevronLeft, MapPin, Package, MessageCircle, Send, Check,
  Camera, Sparkles, Ruler,
} from 'lucide-react-native';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import WorldPicker, { type PickerOption } from '@/components/WorldPicker';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { askAssistant } from '@/lib/ai';
import { usePreferences } from '@/store/preferences';
import { AIRPORTS, CURRENCY_CODES, weightUnitFor, dimUnitFor } from '@/constants/world';

const CURRENCIES = CURRENCY_CODES;
const CITY_OPTIONS: PickerOption[] = AIRPORTS.map((a) => ({ value: a.city, label: a.city, sublabel: a.country, keywords: `${a.code} ${a.name}` }));
const AIRPORT_OPTIONS: PickerOption[] = AIRPORTS.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}`, sublabel: `${a.city}, ${a.country}`, keywords: `${a.city} ${a.name}` }));

type AirRequest = {
  id: string; title: string; shipment_kind: string;
  origin_country: string; origin_city: string; origin_airport: string;
  dest_country: string; dest_city: string; dest_airport: string;
  cargo_type: string; photos: string[];
  length_cm: number; width_cm: number; height_cm: number; dim_unit: string;
  weight: number; weight_unit: string; pieces: number; ready_date: string | null;
  commodity: string; declared_value: number; hs_code: string;
  currency: string; notes: string;
  estimate_low: number; estimate_high: number; estimate_currency: string; estimate_note: string;
  status: string; awarded_amount: number; awarded_name: string;
  offer_count: number; created_at: string;
};

type AirOffer = {
  id: string; forwarder_name: string; amount: number; currency: string;
  transit_days: number; departure_date: string | null; note: string; status: string; created_at: string;
};

type AirMessage = { id: string; sender_name: string; body: string; created_at: string };

/** Upload a local image uri to the job-photos bucket, return a public URL. */
async function uploadAirPhoto(uri: string): Promise<string> {
  const resp = await fetch(uri);
  const arrayBuffer = await resp.arrayBuffer();
  const rawExt = (uri.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase();
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const path = `air/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('job-photos')
    .upload(path, arrayBuffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('job-photos').getPublicUrl(path);
  return data.publicUrl;
}

/** Volumetric weight (kg) per IATA: L*W*H(cm) / 6000. Chargeable = max(actual, volumetric). */
function chargeableWeightKg(l: number, w: number, h: number, unit: 'cm' | 'in', actualKg: number): number {
  const f = unit === 'in' ? 2.54 : 1;
  const vol = (l * f) * (w * f) * (h * f) / 6000;
  return Math.max(vol, actualKg);
}

export default function CustomerAirScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const mineQuery = trpc.air.mine.useQuery(undefined);
  const requests = (mineQuery.data ?? []) as AirRequest[];

  const [postModal, setPostModal] = useState<boolean>(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const createMutation = trpc.air.create.useMutation();
  const estimateMutation = trpc.air.setEstimate.useMutation();

  const [kind, setKind] = useState<'personal' | 'commercial'>('personal');
  const [title, setTitle] = useState<string>('');
  const [originCity, setOriginCity] = useState<string>('');
  const [originAirport, setOriginAirport] = useState<string>('');
  const [destCity, setDestCity] = useState<string>('');
  const [destAirport, setDestAirport] = useState<string>('');
  const [cargoType, setCargoType] = useState<string>('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [len, setLen] = useState<string>('');
  const [wid, setWid] = useState<string>('');
  const [hei, setHei] = useState<string>('');
  const prefCurrency = usePreferences((s) => s.currency);
  const prefUnits = usePreferences((s) => s.unitSystem);
  const [dimUnit, setDimUnit] = useState<'cm' | 'in'>(dimUnitFor(prefUnits));
  const [weight, setWeight] = useState<string>('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(weightUnitFor(prefUnits));
  const [pieces, setPieces] = useState<string>('1');
  const [commodity, setCommodity] = useState<string>('');
  const [declaredValue, setDeclaredValue] = useState<string>('');
  const [hsCode, setHsCode] = useState<string>('');
  const [currency, setCurrency] = useState<string>(prefCurrency);
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const resetForm = useCallback(() => {
    setKind('personal'); setTitle(''); setOriginCity(''); setOriginAirport('');
    setDestCity(''); setDestAirport(''); setCargoType(''); setPhotos([]);
    setLen(''); setWid(''); setHei(''); setDimUnit(dimUnitFor(prefUnits)); setWeight(''); setWeightUnit(weightUnitFor(prefUnits));
    setPieces('1'); setCommodity(''); setDeclaredValue(''); setHsCode(''); setCurrency(prefCurrency); setNotes('');
  }, [prefUnits, prefCurrency]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to add images.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(true);
    try {
      const url = await uploadAirPhoto(result.assets[0].uri);
      setPhotos((p) => [...p, url]);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload photo.');
    } finally {
      setUploading(false);
    }
  }, []);

  const handlePost = useCallback(async () => {
    if (!title.trim()) { Alert.alert('Missing title', 'Give your shipment a short title.'); return; }
    setSubmitting(true);
    try {
      const w = Number(weight) || 0;
      const created = await createMutation.mutateAsync({
        title: title.trim(), shipmentKind: kind,
        originCity, originAirport, destCity, destAirport, cargoType, photos,
        lengthCm: Number(len) || 0, widthCm: Number(wid) || 0, heightCm: Number(hei) || 0, dimUnit,
        weight: w, weightUnit, pieces: Number(pieces) || 1,
        commodity, declaredValue: Number(declaredValue) || 0, hsCode, currency, notes,
      });
      // Fire off an AI estimate in the background — never blocks the post.
      void runEstimate(created.id, {
        title: title.trim(), kind, originCity, originAirport, destCity, destAirport,
        cargoType, l: Number(len) || 0, w: Number(wid) || 0, h: Number(hei) || 0,
        dimUnit, actualKg: weightUnit === 'lb' ? w * 0.453592 : w, pieces: Number(pieces) || 1, currency,
      });
      setPostModal(false);
      resetForm();
      await utils.air.mine.invalidate();
      Alert.alert('Posted!', 'We are estimating a price range and notifying freight forwarders.');
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unable to post request.');
    } finally {
      setSubmitting(false);
    }
  }, [title, kind, originCity, originAirport, destCity, destAirport, cargoType, photos, len, wid, hei, dimUnit, weight, weightUnit, pieces, commodity, declaredValue, hsCode, currency, notes, createMutation, resetForm, utils]);

  const runEstimate = useCallback(async (requestId: string, p: {
    title: string; kind: string; originCity: string; originAirport: string; destCity: string;
    destAirport: string; cargoType: string; l: number; w: number; h: number; dimUnit: string;
    actualKg: number; pieces: number; currency: string;
  }) => {
    try {
      const chargeable = chargeableWeightKg(p.l, p.w, p.h, p.dimUnit as 'cm' | 'in', p.actualKg);
      const prompt = `You are an air-freight pricing assistant. Estimate a rough all-in price RANGE (not binding) for this shipment. Reply ONLY as JSON: {"low": number, "high": number, "note": string}. Currency is ${p.currency}. Keep the note under 12 words.
Shipment: ${p.title} (${p.kind}); ${p.cargoType || 'general cargo'}; route ${p.originCity || p.originAirport || 'origin'} → ${p.destCity || p.destAirport || 'destination'}; ${p.pieces} piece(s); dimensions ${p.l}x${p.w}x${p.h} ${p.dimUnit}; chargeable weight ~${chargeable.toFixed(1)} kg.`;
      const reply = await askAssistant([{ role: 'user', content: prompt }]);
      const match = reply.match(/\{[\s\S]*\}/);
      if (!match) return;
      const parsed = JSON.parse(match[0]) as { low?: number; high?: number; note?: string };
      const low = Number(parsed.low) || 0;
      const high = Number(parsed.high) || 0;
      if (low <= 0 && high <= 0) return;
      await estimateMutation.mutateAsync({
        requestId, low, high, currency: p.currency,
        note: (parsed.note ?? '') + ` (chargeable ~${chargeable.toFixed(0)}kg)`,
      });
      await utils.air.mine.invalidate();
    } catch (e) {
      console.log('[air] estimate failed', e instanceof Error ? e.message : 'unknown');
    }
  }, [estimateMutation, utils]);

  const isCommercial = kind === 'commercial';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Air Cargo</Text>
            <Text style={styles.headerSub}>Post cargo — instant AI estimate + forwarder bids</Text>
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
            <Plane size={44} color={C.textMuted} />
            <Text style={styles.emptyText}>No air cargo yet</Text>
            <Text style={styles.emptySub}>Post a shipment with photos and get an instant AI price estimate plus offers from forwarders.</Text>
            <Button label="Post a shipment" onPress={() => setPostModal(true)} />
          </View>
        ) : requests.map((r) => (
          <TouchableOpacity key={r.id} onPress={() => setDetailId(r.id)} style={styles.card} activeOpacity={0.85}>
            <View style={styles.cardHeader}>
              <View style={styles.badge}>
                <Plane size={13} color={C.purple} />
                <Text style={styles.badgeText}>{r.shipment_kind === 'commercial' ? 'Commercial' : 'Personal'}</Text>
              </View>
              <StatusBadge status={r.status} />
            </View>
            <Text style={styles.cardName}>{r.title}</Text>
            <View style={styles.routeRow}>
              <MapPin size={13} color={C.textMuted} />
              <Text style={styles.routeText} numberOfLines={1}>
                {r.origin_airport || r.origin_city || '—'} → {r.dest_airport || r.dest_city || '—'}
              </Text>
            </View>
            {(r.estimate_low > 0 || r.estimate_high > 0) && (
              <View style={styles.estPill}>
                <Sparkles size={12} color={C.accent} />
                <Text style={styles.estText}>AI estimate: {r.estimate_currency} {r.estimate_low}–{r.estimate_high}</Text>
              </View>
            )}
            <View style={styles.cardFooter}>
              {r.status === 'Open' ? (
                <Text style={styles.offerCount}>{r.offer_count} offer{r.offer_count === 1 ? '' : 's'}</Text>
              ) : (
                <Text style={styles.awarded}>{r.awarded_name} · {r.currency} {r.awarded_amount}</Text>
              )}
              <Text style={styles.cargoText}>{r.weight} {r.weight_unit} · {r.pieces} pc</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* POST MODAL */}
      <Modal visible={postModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalTopBar}>
            <Text style={styles.modalTitle}>New air shipment</Text>
            <TouchableOpacity onPress={() => setPostModal(false)}><X size={24} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {(['personal', 'commercial'] as const).map((k) => (
                <TouchableOpacity key={k} onPress={() => setKind(k)} style={[styles.segChip, kind === k && styles.chipActive]}>
                  <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{k === 'personal' ? 'Personal' : 'Commercial'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input label="Shipment title *" value={title} onChangeText={setTitle} placeholder="Boxes Vancouver → Tehran" />

            <Text style={styles.fieldLabel}>Photos of the goods</Text>
            <View style={styles.photoRow}>
              {photos.map((p) => (
                <Image key={p} source={{ uri: p }} style={styles.thumb} />
              ))}
              <TouchableOpacity onPress={pickPhoto} style={styles.addPhoto} disabled={uploading}>
                {uploading ? <ActivityIndicator color={C.accent} /> : <Camera size={22} color={C.textSecondary} />}
              </TouchableOpacity>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}><WorldPicker label="Origin city" value={originCity} options={CITY_OPTIONS} placeholder="Vancouver" onSelect={setOriginCity} /></View>
              <View style={{ flex: 1 }}><WorldPicker label="Origin airport" value={originAirport} options={AIRPORT_OPTIONS} placeholder="YVR" onSelect={setOriginAirport} /></View>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><WorldPicker label="Dest. city" value={destCity} options={CITY_OPTIONS} placeholder="Tehran" onSelect={setDestCity} /></View>
              <View style={{ flex: 1 }}><WorldPicker label="Dest. airport" value={destAirport} options={AIRPORT_OPTIONS} placeholder="IKA" onSelect={setDestAirport} /></View>
            </View>
            <Input label="Cargo type" value={cargoType} onChangeText={setCargoType} placeholder="Electronics, clothing…" />

            <Text style={styles.fieldLabel}><Ruler size={13} color={C.textSecondary} /> Dimensions ({dimUnit})</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}><Input label="Length" value={len} onChangeText={setLen} keyboardType="numeric" placeholder="60" /></View>
              <View style={{ flex: 1 }}><Input label="Width" value={wid} onChangeText={setWid} keyboardType="numeric" placeholder="40" /></View>
              <View style={{ flex: 1 }}><Input label="Height" value={hei} onChangeText={setHei} keyboardType="numeric" placeholder="30" /></View>
            </View>
            <View style={styles.chipRow}>
              {(['cm', 'in'] as const).map((u) => (
                <TouchableOpacity key={u} onPress={() => setDimUnit(u)} style={[styles.chip, dimUnit === u && styles.chipActive]}>
                  <Text style={[styles.chipText, dimUnit === u && styles.chipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}><Input label="Weight" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="12" /></View>
              <View style={{ width: 110 }}>
                <Text style={styles.fieldLabel}>Unit</Text>
                <View style={styles.chipRow}>
                  {(['kg', 'lb'] as const).map((u) => (
                    <TouchableOpacity key={u} onPress={() => setWeightUnit(u)} style={[styles.chip, weightUnit === u && styles.chipActive]}>
                      <Text style={[styles.chipText, weightUnit === u && styles.chipTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={{ width: 90 }}><Input label="Pieces" value={pieces} onChangeText={setPieces} keyboardType="numeric" placeholder="1" /></View>
            </View>

            {isCommercial && (
              <>
                <Input label="Commodity" value={commodity} onChangeText={setCommodity} placeholder="Auto parts" />
                <View style={styles.row2}>
                  <View style={{ flex: 1 }}><Input label="Declared value" value={declaredValue} onChangeText={setDeclaredValue} keyboardType="numeric" placeholder="5000" /></View>
                  <View style={{ flex: 1 }}><Input label="HS code" value={hsCode} onChangeText={setHsCode} placeholder="8708.99" /></View>
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>Quote currency</Text>
            <View style={styles.chipRow}>
              {CURRENCIES.map((cur) => (
                <TouchableOpacity key={cur} onPress={() => setCurrency(cur)} style={[styles.chip, currency === cur && styles.chipActive]}>
                  <Text style={[styles.chipText, currency === cur && styles.chipTextActive]}>{cur}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input label="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={3} placeholder="Ready date, fragile, batteries…" />
            <Button label="Post & get AI estimate" onPress={handlePost} loading={submitting} fullWidth size="lg" />
          </ScrollView>
        </View>
      </Modal>

      {detailId && <AirDetailModal requestId={detailId} onClose={() => setDetailId(null)} />}
    </View>
  );
}

function AirDetailModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const mineQuery = trpc.air.mine.useQuery(undefined);
  const offersQuery = trpc.air.offers.useQuery({ requestId });
  const messagesQuery = trpc.air.messages.useQuery({ requestId });
  const req = ((mineQuery.data ?? []) as AirRequest[]).find((r) => r.id === requestId) ?? null;
  const offers = (offersQuery.data ?? []) as AirOffer[];
  const messages = (messagesQuery.data ?? []) as AirMessage[];

  const acceptMutation = trpc.air.acceptOffer.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.air.offers.invalidate({ requestId }), utils.air.mine.invalidate()]);
    },
  });
  const sendMutation = trpc.air.sendMessage.useMutation({
    onSuccess: async () => { await utils.air.messages.invalidate({ requestId }); },
  });

  const [msg, setMsg] = useState<string>('');
  const isBooked = req?.status && req.status !== 'Open';

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
          <Text style={styles.modalTitle} numberOfLines={1}>{req?.title ?? 'Shipment'}</Text>
          <TouchableOpacity onPress={onClose}><X size={24} color={C.text} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
          {req && (
            <View style={styles.detailCard}>
              <View style={styles.routeRow}>
                <Plane size={14} color={C.purple} />
                <Text style={styles.detailRoute}>{req.origin_airport || req.origin_city} → {req.dest_airport || req.dest_city}</Text>
              </View>
              {req.photos?.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {req.photos.map((p) => <Image key={p} source={{ uri: p }} style={styles.detailThumb} />)}
                </ScrollView>
              )}
              <View style={styles.detailMetaRow}>
                <View style={styles.metaPill}><Package size={12} color={C.textSecondary} /><Text style={styles.metaText}>{req.weight} {req.weight_unit}</Text></View>
                <View style={styles.metaPill}><Text style={styles.metaText}>{req.length_cm}×{req.width_cm}×{req.height_cm} {req.dim_unit}</Text></View>
                <View style={styles.metaPill}><Text style={styles.metaText}>{req.pieces} pc</Text></View>
                <StatusBadge status={req.status} />
              </View>
              {(req.estimate_low > 0 || req.estimate_high > 0) && (
                <View style={styles.estBanner}>
                  <Sparkles size={14} color={C.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.estBannerTitle}>AI estimate (guide only): {req.estimate_currency} {req.estimate_low}–{req.estimate_high}</Text>
                    {req.estimate_note ? <Text style={styles.estBannerNote}>{req.estimate_note}</Text> : null}
                  </View>
                </View>
              )}
              {req.cargo_type ? <Text style={styles.detailNotes}>{req.cargo_type}</Text> : null}
              {req.commodity ? <Text style={styles.detailNotes}>Commodity: {req.commodity} · Value {req.currency} {req.declared_value}{req.hs_code ? ` · HS ${req.hs_code}` : ''}</Text> : null}
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
                {o.departure_date ? <Text style={styles.offerMetaText}>Departs {o.departure_date}</Text> : null}
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
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.purple + '20' },
  badgeText: { fontSize: 12, fontWeight: '700' as const, color: C.purple },
  cardName: { fontSize: 17, fontWeight: '700' as const, color: C.text, marginBottom: 6 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  routeText: { fontSize: 13, color: C.textSecondary, flex: 1 },
  estPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.accentDim, marginBottom: 8 },
  estText: { fontSize: 12, fontWeight: '700' as const, color: C.accent },
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
  segChip: { flex: 1, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: C.accent, fontWeight: '700' as const },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: C.card },
  addPhoto: { width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' as const, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  detailCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10 },
  detailRoute: { fontSize: 15, fontWeight: '700' as const, color: C.text, flex: 1 },
  detailThumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: C.bgSecondary },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.bgSecondary },
  metaText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  estBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, backgroundColor: C.accentDim },
  estBannerTitle: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  estBannerNote: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
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
});
