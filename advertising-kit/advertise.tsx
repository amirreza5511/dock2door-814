import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Megaphone, Plus, X, Pencil, Trash2, ChevronLeft, CreditCard,
  Image as ImageIcon, Video as VideoIcon, Youtube, Globe, Phone,
  Instagram, MessageCircle, Mail, Clock, CheckCircle2, XCircle, Sparkles,
} from 'lucide-react-native';
import Button from '@/components/ui/Button';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type Ad = {
  id: string;
  title: string;
  body: string;
  image_url: string;
  cta_label: string;
  advertiser_name: string;
  status: string;
  review_status: string | null;
  price: number | null;
  currency: string | null;
  admin_note: string | null;
  media_type?: string | null;
  video_url?: string | null;
  placements?: string[] | null;
  links?: { type: string; value: string }[] | null;
};

type MediaType = 'image' | 'video' | 'youtube';
type LinkType = 'website' | 'instagram' | 'phone' | 'whatsapp' | 'youtube' | 'email';

const MEDIA_TYPES: { key: MediaType; label: string; Icon: typeof ImageIcon }[] = [
  { key: 'image', label: 'Image', Icon: ImageIcon },
  { key: 'video', label: 'Video', Icon: VideoIcon },
  { key: 'youtube', label: 'YouTube', Icon: Youtube },
];

const LINK_TYPES: { key: LinkType; label: string; Icon: typeof Globe; placeholder: string }[] = [
  { key: 'website', label: 'Website', Icon: Globe, placeholder: 'https://yourbusiness.com' },
  { key: 'instagram', label: 'Instagram', Icon: Instagram, placeholder: '@handle or profile URL' },
  { key: 'phone', label: 'Call', Icon: Phone, placeholder: '+1 555 123 4567' },
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, placeholder: '+1 555 123 4567' },
  { key: 'youtube', label: 'YouTube', Icon: Youtube, placeholder: 'https://youtu.be/...' },
  { key: 'email', label: 'Email', Icon: Mail, placeholder: 'sales@yourbusiness.com' },
];

// EDIT THESE placements to match the sections/roles in the NEW project.
const PLACEMENTS: { key: string; label: string }[] = [
  { key: 'all', label: 'Every page' },
  { key: 'customer', label: 'Customers' },
  { key: 'warehouse-provider', label: 'Warehouses' },
  { key: 'trucking-company', label: 'Trucking' },
  { key: 'drayage-company', label: 'Drayage' },
  { key: 'freight-forwarder', label: 'Freight forwarders' },
  { key: 'service-provider', label: 'Service providers' },
  { key: 'employer', label: 'Employers' },
  { key: 'worker', label: 'Workers' },
  { key: 'driver', label: 'Drivers' },
  { key: 'shipper', label: 'Shippers' },
];

const PAGE_KEYS: string[] = PLACEMENTS.filter((p) => p.key !== 'all').map((p) => p.key);
const placementLabel = (key: string): string => PLACEMENTS.find((p) => p.key === key)?.label ?? key;
const placementsSummary = (keys: string[]): string => {
  if (keys.includes('all') || keys.length === 0) return 'Every page';
  if (keys.length === 1) return placementLabel(keys[0]);
  return `${keys.length} pages`;
};

const emptyLinks: Record<LinkType, string> = {
  website: '', instagram: '', phone: '', whatsapp: '', youtube: '', email: '',
};

type Draft = {
  id: string | null;
  title: string;
  body: string;
  imageUrl: string;
  ctaLabel: string;
  advertiserName: string;
  placements: string[];
  mediaType: MediaType;
  videoUrl: string;
  links: Record<LinkType, string>;
};

const emptyDraft: Draft = {
  id: null, title: '', body: '', imageUrl: '', ctaLabel: 'Learn more',
  advertiserName: '', placements: ['all'], mediaType: 'image', videoUrl: '', links: { ...emptyLinks },
};

function statusMeta(ad: Ad): { label: string; color: string; tint: string; Icon: typeof Clock; note: string } {
  const rs = ad.review_status ?? 'Pending';
  if (rs === 'Approved' || ad.status === 'Active') {
    return { label: 'Live', color: C.green, tint: C.greenDim, Icon: CheckCircle2, note: 'Your ad is running on the pages you chose.' };
  }
  if (rs === 'Paid') {
    return { label: 'Awaiting approval', color: C.purple, tint: C.purpleDim, Icon: Clock, note: 'Payment received — our team will approve it shortly.' };
  }
  if (rs === 'Quoted') {
    return { label: 'Price ready', color: C.blue, tint: C.blueDim, Icon: CreditCard, note: 'We\u2019ve set a price. Pay to publish your ad.' };
  }
  if (rs === 'Rejected') {
    return { label: 'Not approved', color: C.red, tint: C.redDim, Icon: XCircle, note: ad.admin_note || 'This ad wasn\u2019t approved. Edit and resubmit.' };
  }
  return { label: 'Pending review', color: C.yellow, tint: C.yellowDim, Icon: Clock, note: 'Submitted — we\u2019ll send you a price soon.' };
}

const money = (n: number | null | undefined, cur: string | null | undefined): string =>
  `${cur ?? 'CAD'} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function AdvertiseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const adsQuery = trpc.ads.mySubmissions.useQuery();
  const submitM = trpc.ads.submitAd.useMutation();
  const payM = trpc.ads.payAd.useMutation();
  const cancelM = trpc.ads.cancelSubmission.useMutation();

  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const ads = useMemo<Ad[]>(() => (adsQuery.data as Ad[] | undefined) ?? [], [adsQuery.data]);

  const openNew = useCallback(() => { setDraft(emptyDraft); setEditorOpen(true); }, []);
  const openEdit = useCallback((ad: Ad) => {
    const placements = Array.isArray(ad.placements) && ad.placements.length > 0 ? ad.placements : ['all'];
    const links: Record<LinkType, string> = { ...emptyLinks };
    if (Array.isArray(ad.links)) {
      for (const l of ad.links) {
        if (l && l.type && (l.type as LinkType) in links) links[l.type as LinkType] = l.value ?? '';
      }
    }
    setDraft({
      id: ad.id,
      title: ad.title,
      body: ad.body,
      imageUrl: ad.image_url,
      ctaLabel: ad.cta_label || 'Learn more',
      advertiserName: ad.advertiser_name,
      placements,
      mediaType: (ad.media_type as MediaType) || 'image',
      videoUrl: ad.video_url ?? '',
      links,
    });
    setEditorOpen(true);
  }, []);

  const togglePlacement = useCallback((key: string) => {
    setDraft((d) => {
      if (key === 'all') return { ...d, placements: ['all'] };
      const withoutAll = d.placements.filter((p) => p !== 'all');
      const has = withoutAll.includes(key);
      const next = has ? withoutAll.filter((p) => p !== key) : [...withoutAll, key];
      return { ...d, placements: next.length === 0 ? ['all'] : next };
    });
  }, []);

  const selectAllPages = useCallback(() => {
    setDraft((d) => ({
      ...d,
      placements: d.placements.length >= PAGE_KEYS.length && !d.placements.includes('all') ? ['all'] : [...PAGE_KEYS],
    }));
  }, []);

  const save = useCallback(async () => {
    if (!draft.title.trim()) { Alert.alert('Title required', 'Give your ad a short title.'); return; }
    const links = (Object.keys(draft.links) as LinkType[])
      .map((type) => ({ type, value: draft.links[type].trim() }))
      .filter((l) => l.value.length > 0);
    if (links.length === 0) { Alert.alert('Add a destination', 'Add at least one link (website, phone, Instagram…) so people can reach you.'); return; }
    try {
      await submitM.mutateAsync({
        id: draft.id,
        title: draft.title.trim(),
        body: draft.body.trim(),
        imageUrl: draft.imageUrl.trim(),
        ctaLabel: draft.ctaLabel.trim() || 'Learn more',
        advertiserName: draft.advertiserName.trim(),
        placements: draft.placements,
        mediaType: draft.mediaType,
        videoUrl: draft.videoUrl.trim(),
        links,
      });
      setEditorOpen(false);
      await adsQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to submit', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [draft, submitM, adsQuery]);

  const pay = useCallback((ad: Ad) => {
    Alert.alert(
      'Confirm payment',
      `Pay ${money(ad.price, ad.currency)} to publish "${ad.title}"? Once paid, our team approves it and it goes live.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay now', onPress: async () => {
            try {
              await payM.mutateAsync({ id: ad.id });
              await adsQuery.refetch();
            } catch (error) {
              Alert.alert('Payment failed', error instanceof Error ? error.message : 'Unknown error');
            }
          },
        },
      ],
    );
  }, [payM, adsQuery]);

  const remove = useCallback((ad: Ad) => {
    Alert.alert('Cancel ad', `Remove "${ad.title}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await cancelM.mutateAsync({ id: ad.id });
            await adsQuery.refetch();
          } catch (error) {
            Alert.alert('Unable to remove', error instanceof Error ? error.message : 'Unknown error');
          }
        },
      },
    ]);
  }, [cancelM, adsQuery]);

  if (adsQuery.isLoading) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading your ads" /></View>;
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <ChevronLeft size={20} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <Megaphone size={13} color={C.accent} />
              <Text style={styles.badgeText}>Advertising</Text>
            </View>
            <Text style={styles.title}>Advertise your business</Text>
          </View>
        </View>

        <View style={styles.howCard}>
          <View style={styles.howIcon}><Sparkles size={18} color={C.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.howTitle}>How it works</Text>
            <Text style={styles.howStep}>1 · Create your ad — image or video, with your links.</Text>
            <Text style={styles.howStep}>2 · We set a price for the pages you chose.</Text>
            <Text style={styles.howStep}>3 · Pay, we approve, and your ad goes live.</Text>
          </View>
        </View>

        <TouchableOpacity onPress={openNew} style={styles.newBtn} activeOpacity={0.85}>
          <Plus size={18} color={C.white} />
          <Text style={styles.newBtnText}>Create advertisement</Text>
        </TouchableOpacity>

        {ads.length === 0 ? (
          <View style={styles.empty}>
            <Megaphone size={30} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No ads yet</Text>
            <Text style={styles.emptySub}>Promote your business across the app. Create your first ad above.</Text>
          </View>
        ) : ads.map((ad) => {
          const meta = statusMeta(ad);
          const StatusIcon = meta.Icon;
          const canEdit = (ad.review_status ?? 'Pending') === 'Pending' || ad.review_status === 'Rejected';
          const canPay = ad.review_status === 'Quoted';
          const canRemove = ['Pending', 'Quoted', 'Rejected'].includes(ad.review_status ?? 'Pending');
          return (
            <View key={ad.id} style={styles.adCard}>
              <View style={styles.adTop}>
                <View style={styles.adThumbWrap}>
                  {ad.image_url ? (
                    <Image source={{ uri: ad.image_url }} style={styles.adThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.adThumb, styles.adThumbFallback]}><Megaphone size={18} color={C.accent} /></View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adTitle} numberOfLines={1}>{ad.title}</Text>
                  <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
                    <StatusIcon size={12} color={meta.color} />
                    <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                {ad.price && ad.price > 0 ? (
                  <View style={styles.priceWrap}>
                    <Text style={styles.priceLabel}>Price</Text>
                    <Text style={styles.priceValue}>{money(ad.price, ad.currency)}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.adNote}>{meta.note}</Text>

              {(canPay || canEdit || canRemove) ? (
                <View style={styles.actionsRow}>
                  {canPay ? (
                    <Button
                      label={`Pay ${money(ad.price, ad.currency)}`}
                      onPress={() => pay(ad)}
                      size="sm"
                      icon={<CreditCard size={14} color={C.white} />}
                      loading={payM.isPending}
                    />
                  ) : null}
                  {canEdit ? (
                    <Button label="Edit" onPress={() => openEdit(ad)} size="sm" variant="outline" icon={<Pencil size={14} color={C.accent} />} />
                  ) : null}
                  {canRemove ? (
                    <TouchableOpacity onPress={() => remove(ad)} style={styles.deleteBtn} accessibilityLabel="Remove ad">
                      <Trash2 size={16} color={C.red} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditorOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{draft.id ? 'Edit advertisement' : 'New advertisement'}</Text>
              <TouchableOpacity onPress={() => setEditorOpen(false)} style={styles.closeBtn}><X size={18} color={C.textSecondary} /></TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Field label="Title">
                <TextInput style={styles.input} value={draft.title} onChangeText={(t) => setDraft((d) => ({ ...d, title: t }))} placeholder="e.g. Cold storage in Toronto" placeholderTextColor={C.textMuted} />
              </Field>
              <Field label="Description">
                <TextInput style={styles.input} value={draft.body} onChangeText={(t) => setDraft((d) => ({ ...d, body: t }))} placeholder="One short line" placeholderTextColor={C.textMuted} />
              </Field>
              <Field label="Business name">
                <TextInput style={styles.input} value={draft.advertiserName} onChangeText={(t) => setDraft((d) => ({ ...d, advertiserName: t }))} placeholder="e.g. Maple Logistics" placeholderTextColor={C.textMuted} />
              </Field>
              <Field label="Creative type">
                <View style={styles.segRow}>
                  {MEDIA_TYPES.map(({ key, label, Icon }) => {
                    const on = draft.mediaType === key;
                    return (
                      <TouchableOpacity key={key} onPress={() => setDraft((d) => ({ ...d, mediaType: key }))} style={[styles.seg, on && styles.segOn]} activeOpacity={0.85}>
                        <Icon size={15} color={on ? C.accent : C.textSecondary} />
                        <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Field>

              {draft.mediaType === 'image' ? (
                <Field label="Image URL">
                  <TextInput style={styles.input} value={draft.imageUrl} onChangeText={(t) => setDraft((d) => ({ ...d, imageUrl: t }))} placeholder="https://…" placeholderTextColor={C.textMuted} autoCapitalize="none" />
                </Field>
              ) : (
                <>
                  <Field label={draft.mediaType === 'youtube' ? 'YouTube video link' : 'Video URL (.mp4)'}>
                    <TextInput style={styles.input} value={draft.videoUrl} onChangeText={(t) => setDraft((d) => ({ ...d, videoUrl: t }))} placeholder={draft.mediaType === 'youtube' ? 'https://youtu.be/…' : 'https://cdn.com/clip.mp4'} placeholderTextColor={C.textMuted} autoCapitalize="none" keyboardType="url" />
                  </Field>
                  <Field label="Poster image URL (optional)">
                    <TextInput style={styles.input} value={draft.imageUrl} onChangeText={(t) => setDraft((d) => ({ ...d, imageUrl: t }))} placeholder="https://…" placeholderTextColor={C.textMuted} autoCapitalize="none" />
                  </Field>
                </>
              )}

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Tap destinations</Text>
                <Text style={styles.hint}>Fill in any you want — website, Instagram, phone and more. Leave the rest blank.</Text>
                <View style={{ gap: 10, marginTop: 8 }}>
                  {LINK_TYPES.map(({ key, label, Icon, placeholder }) => {
                    const filled = draft.links[key].trim().length > 0;
                    return (
                      <View key={key} style={[styles.linkRow, filled && styles.linkRowOn]}>
                        <View style={[styles.linkRowIcon, filled && styles.linkRowIconOn]}>
                          <Icon size={15} color={filled ? C.accent : C.textSecondary} />
                        </View>
                        <TextInput
                          style={styles.linkRowInput}
                          value={draft.links[key]}
                          onChangeText={(t) => setDraft((d) => ({ ...d, links: { ...d.links, [key]: t } }))}
                          placeholder={`${label} — ${placeholder}`}
                          placeholderTextColor={C.textMuted}
                          autoCapitalize="none"
                          keyboardType={key === 'phone' || key === 'whatsapp' ? 'phone-pad' : key === 'email' ? 'email-address' : 'url'}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
              <Field label="Button label">
                <TextInput style={styles.input} value={draft.ctaLabel} onChangeText={(t) => setDraft((d) => ({ ...d, ctaLabel: t }))} placeholder="Learn more" placeholderTextColor={C.textMuted} />
              </Field>

              <View style={styles.field}>
                <View style={styles.placeHead}>
                  <Text style={styles.fieldLabel}>Show on · {placementsSummary(draft.placements)}</Text>
                  <TouchableOpacity onPress={selectAllPages} activeOpacity={0.8}>
                    <Text style={styles.selectAllText}>{draft.placements.includes('all') ? 'Clear' : 'Select all'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.placeGrid}>
                  {PLACEMENTS.map((p) => {
                    const selected = p.key === 'all' ? draft.placements.includes('all') : draft.placements.includes(p.key);
                    return (
                      <TouchableOpacity key={p.key} onPress={() => togglePlacement(p.key)} style={[styles.placeChip, selected && styles.placeChipOn]} activeOpacity={0.8}>
                        <Text style={[styles.placeChipText, selected && styles.placeChipTextOn]}>{p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.priceHint}>
                <CreditCard size={15} color={C.textSecondary} />
                <Text style={styles.priceHintText}>After you submit, our team sets a price for your selected pages. You only pay once you approve it.</Text>
              </View>
            </ScrollView>

            <Button label={draft.id ? 'Save changes' : 'Submit for pricing'} onPress={() => void save()} fullWidth loading={submitM.isPending} style={{ marginTop: 14 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 20, gap: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.accentDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' as const, color: C.accent },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, marginTop: 6 },

  howCard: { flexDirection: 'row', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 },
  howIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  howTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text, marginBottom: 4 },
  howStep: { fontSize: 12.5, color: C.textSecondary, marginTop: 2 },

  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14 },
  newBtnText: { fontSize: 15, fontWeight: '700' as const, color: C.white },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center', paddingHorizontal: 30 },

  adCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  adTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  adThumbWrap: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden' },
  adThumb: { width: 52, height: 52 },
  adThumbFallback: { backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  adTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  priceWrap: { alignItems: 'flex-end' },
  priceLabel: { fontSize: 10, fontWeight: '600' as const, color: C.textMuted },
  priceValue: { fontSize: 14, fontWeight: '800' as const, color: C.text, marginTop: 1 },
  adNote: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },

  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deleteBtn: { marginLeft: 'auto', width: 38, height: 34, borderRadius: 8, backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '40', alignItems: 'center', justifyContent: 'center' },

  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderColor: C.border },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },

  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 6 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: C.text },

  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seg: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  segOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  segText: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary },
  segTextOn: { color: C.accent },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingRight: 12, paddingLeft: 8, paddingVertical: 6 },
  linkRowOn: { borderColor: C.accent, backgroundColor: C.accentDim },
  linkRowIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  linkRowIconOn: { backgroundColor: C.card },
  linkRowInput: { flex: 1, fontSize: 13, color: C.text, paddingVertical: 6 },

  placeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  selectAllText: { fontSize: 12, fontWeight: '700' as const, color: C.accent },
  hint: { fontSize: 11, color: C.textMuted, marginTop: 6 },
  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  placeChip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  placeChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  placeChipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  placeChipTextOn: { color: C.accent },

  priceHint: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginTop: 2 },
  priceHintText: { flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 17 },
});
