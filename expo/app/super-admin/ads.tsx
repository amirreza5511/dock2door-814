import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Megaphone, Plus, X, Pencil, Trash2, ChevronLeft, ExternalLink,
  Eye, MousePointerClick, Play, Pause, Image as ImageIcon, Video as VideoIcon,
  Youtube, Globe, Phone, Instagram, MessageCircle, Mail,
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
  target_url: string;
  cta_label: string;
  advertiser_name: string;
  advertiser_company_id: string | null;
  placement: string;
  status: string;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  media_type?: string | null;
  video_url?: string | null;
  link_type?: string | null;
  max_impressions?: number | null;
  weight?: number | null;
  placements?: string[] | null;
  links?: { type: string; value: string }[] | null;
  link_clicks?: Record<string, number> | null;
};

const LINK_META: Record<string, { label: string; Icon: typeof Globe }> = {
  website: { label: 'Website', Icon: Globe },
  instagram: { label: 'Instagram', Icon: Instagram },
  phone: { label: 'Call', Icon: Phone },
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle },
  youtube: { label: 'YouTube', Icon: Youtube },
  email: { label: 'Email', Icon: Mail },
};

type MediaType = 'image' | 'video' | 'youtube';
type LinkType = 'website' | 'instagram' | 'phone' | 'whatsapp' | 'youtube' | 'email';

const MEDIA_TYPES: { key: MediaType; label: string; Icon: typeof ImageIcon }[] = [
  { key: 'image', label: 'Image', Icon: ImageIcon },
  { key: 'video', label: 'Video', Icon: VideoIcon },
  { key: 'youtube', label: 'YouTube', Icon: Youtube },
];

const LINK_TYPES: { key: LinkType; label: string; Icon: typeof Globe; placeholder: string }[] = [
  { key: 'website', label: 'Website', Icon: Globe, placeholder: 'https://advertiser.com' },
  { key: 'instagram', label: 'Instagram', Icon: Instagram, placeholder: '@handle or profile URL' },
  { key: 'phone', label: 'Call', Icon: Phone, placeholder: '+1 555 123 4567' },
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, placeholder: '+1 555 123 4567' },
  { key: 'youtube', label: 'YouTube', Icon: Youtube, placeholder: 'https://youtu.be/...' },
  { key: 'email', label: 'Email', Icon: Mail, placeholder: 'sales@advertiser.com' },
];

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
  { key: 'sales-agent', label: 'Sales agents' },
];

const placementLabel = (key: string): string =>
  PLACEMENTS.find((p) => p.key === key)?.label ?? key;

type Draft = {
  id: string | null;
  title: string;
  body: string;
  imageUrl: string;
  ctaLabel: string;
  advertiserName: string;
  placements: string[];
  priority: string;
  active: boolean;
  mediaType: MediaType;
  videoUrl: string;
  links: Record<LinkType, string>;
  maxImpressions: string;
  weight: string;
};

const emptyLinks: Record<LinkType, string> = {
  website: '', instagram: '', phone: '', whatsapp: '', youtube: '', email: '',
};

const emptyDraft: Draft = {
  id: null, title: '', body: '', imageUrl: '', ctaLabel: 'Learn more',
  advertiserName: '', placements: ['all'], priority: '0', active: true,
  mediaType: 'image', videoUrl: '', links: { ...emptyLinks }, maxImpressions: '0', weight: '1',
};

/** All selectable page keys (excludes the 'all' meta-option). */
const PAGE_KEYS: string[] = PLACEMENTS.filter((p) => p.key !== 'all').map((p) => p.key);

const placementsSummary = (keys: string[]): string => {
  if (keys.includes('all') || keys.length === 0) return 'Every page';
  if (keys.length === 1) return placementLabel(keys[0]);
  return `${keys.length} pages`;
};

export default function SuperAdminAdsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const adsQuery = trpc.admin.listAds.useQuery();
  const upsertM = trpc.admin.upsertAd.useMutation();
  const setStatusM = trpc.admin.setAdStatus.useMutation();
  const deleteM = trpc.admin.deleteAd.useMutation();

  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const ads = useMemo<Ad[]>(() => (adsQuery.data as Ad[] | undefined) ?? [], [adsQuery.data]);

  const openNew = useCallback(() => { setDraft(emptyDraft); setEditorOpen(true); }, []);
  const openEdit = useCallback((ad: Ad) => {
    const placements = Array.isArray(ad.placements) && ad.placements.length > 0
      ? ad.placements
      : [ad.placement || 'all'];
    const links: Record<LinkType, string> = { ...emptyLinks };
    if (Array.isArray(ad.links) && ad.links.length > 0) {
      for (const l of ad.links) {
        if (l && l.type && (l.type as LinkType) in links) links[l.type as LinkType] = l.value ?? '';
      }
    } else if (ad.target_url) {
      const lt = (ad.link_type as LinkType) || 'website';
      if (lt in links) links[lt] = ad.target_url;
    }
    setDraft({
      id: ad.id,
      title: ad.title,
      body: ad.body,
      imageUrl: ad.image_url,
      ctaLabel: ad.cta_label || 'Learn more',
      advertiserName: ad.advertiser_name,
      placements,
      priority: String(ad.priority ?? 0),
      active: ad.status === 'Active',
      mediaType: (ad.media_type as MediaType) || 'image',
      videoUrl: ad.video_url ?? '',
      links,
      maxImpressions: String(ad.max_impressions ?? 0),
      weight: String(ad.weight ?? 1),
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
      placements: d.placements.length >= PAGE_KEYS.length && !d.placements.includes('all')
        ? ['all']
        : [...PAGE_KEYS],
    }));
  }, []);

  const save = useCallback(async () => {
    if (!draft.title.trim()) { Alert.alert('Title required', 'Give the ad a short title.'); return; }
    try {
      const links = (Object.keys(draft.links) as LinkType[])
        .map((type) => ({ type, value: draft.links[type].trim() }))
        .filter((l) => l.value.length > 0);
      await upsertM.mutateAsync({
        id: draft.id,
        title: draft.title.trim(),
        body: draft.body.trim(),
        imageUrl: draft.imageUrl.trim(),
        ctaLabel: draft.ctaLabel.trim() || 'Learn more',
        advertiserName: draft.advertiserName.trim(),
        placements: draft.placements,
        status: draft.active ? 'Active' : 'Paused',
        priority: Number.parseInt(draft.priority, 10) || 0,
        mediaType: draft.mediaType,
        videoUrl: draft.videoUrl.trim(),
        links,
        maxImpressions: Number.parseInt(draft.maxImpressions, 10) || 0,
        weight: Math.max(1, Math.min(10, Number.parseInt(draft.weight, 10) || 1)),
      });
      setEditorOpen(false);
      await adsQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to save ad', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [draft, upsertM, adsQuery]);

  const toggleStatus = useCallback(async (ad: Ad) => {
    try {
      await setStatusM.mutateAsync({ id: ad.id, status: ad.status === 'Active' ? 'Paused' : 'Active' });
      await adsQuery.refetch();
    } catch (error) {
      Alert.alert('Unable to update ad', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [setStatusM, adsQuery]);

  const remove = useCallback((ad: Ad) => {
    Alert.alert('Delete ad', `Remove "${ad.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteM.mutateAsync({ id: ad.id });
            await adsQuery.refetch();
          } catch (error) {
            Alert.alert('Unable to delete ad', error instanceof Error ? error.message : 'Unknown error');
          }
        },
      },
    ]);
  }, [deleteM, adsQuery]);

  if (adsQuery.isLoading) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="loading" title="Loading ads" /></View>;
  }
  if (adsQuery.isError) {
    return <View style={[styles.root, styles.centered]}><ScreenFeedback state="error" title="Unable to load ads" onRetry={() => void adsQuery.refetch()} /></View>;
  }

  const activeCount = ads.filter((a) => a.status === 'Active').length;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 120 }]}
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
            <Text style={styles.title}>Ad Manager</Text>
          </View>
        </View>

        <Text style={styles.subtitle}>
          Sponsored banners shown under every page. {activeCount} active · {ads.length} total.
        </Text>

        <TouchableOpacity onPress={openNew} style={styles.newBtn} activeOpacity={0.85}>
          <Plus size={18} color={C.white} />
          <Text style={styles.newBtnText}>New advertisement</Text>
        </TouchableOpacity>

        {ads.length === 0 ? (
          <View style={styles.empty}>
            <Megaphone size={30} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No ads yet</Text>
            <Text style={styles.emptySub}>Create your first sponsored banner for warehouses, carriers, realtors and more.</Text>
          </View>
        ) : ads.map((ad) => (
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
                {ad.advertiser_name ? <Text style={styles.adAdvertiser} numberOfLines={1}>{ad.advertiser_name}</Text> : null}
                <View style={styles.pillRow}>
                  <View style={styles.placePill}><Text style={styles.placePillText}>{placementLabel(ad.placement)}</Text></View>
                  <View style={[styles.statusPill, { backgroundColor: ad.status === 'Active' ? C.greenDim : C.card, borderColor: ad.status === 'Active' ? C.green + '50' : C.border }]}>
                    <Text style={[styles.statusPillText, { color: ad.status === 'Active' ? C.green : C.textMuted }]}>{ad.status}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metric}><Eye size={13} color={C.textMuted} /><Text style={styles.metricText}>{ad.impressions ?? 0} views</Text></View>
              <View style={styles.metric}><MousePointerClick size={13} color={C.textMuted} /><Text style={styles.metricText}>{ad.clicks ?? 0} clicks</Text></View>
              {ad.target_url ? (
                <View style={styles.metric}><ExternalLink size={12} color={C.textMuted} /><Text style={styles.metricText} numberOfLines={1}>{ad.target_url.replace(/^https?:\/\//, '')}</Text></View>
              ) : null}
            </View>

            <LinkClicks ad={ad} />

            <View style={styles.actionsRow}>
              <Button
                label={ad.status === 'Active' ? 'Pause' : 'Activate'}
                onPress={() => void toggleStatus(ad)}
                size="sm"
                variant="secondary"
                icon={ad.status === 'Active' ? <Pause size={14} color={C.text} /> : <Play size={14} color={C.text} />}
                loading={setStatusM.isPending}
              />
              <Button label="Edit" onPress={() => openEdit(ad)} size="sm" variant="outline" icon={<Pencil size={14} color={C.accent} />} />
              <TouchableOpacity onPress={() => remove(ad)} style={styles.deleteBtn} accessibilityLabel="Delete ad">
                <Trash2 size={16} color={C.red} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
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
              <Field label="Advertiser name">
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
                  <Field label="Poster image URL (optional fallback)">
                    <TextInput style={styles.input} value={draft.imageUrl} onChangeText={(t) => setDraft((d) => ({ ...d, imageUrl: t }))} placeholder="https://…" placeholderTextColor={C.textMuted} autoCapitalize="none" />
                  </Field>
                </>
              )}

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Tap destinations</Text>
                <Text style={styles.hint}>Fill in any you want — website, YouTube, Instagram, phone and more. Users get a button for each. Leave the rest blank.</Text>
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
                    <Text style={styles.selectAllText}>
                      {draft.placements.includes('all') ? 'Clear' : 'Select all pages'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.placeGrid}>
                  {PLACEMENTS.map((p) => {
                    const selected = p.key === 'all'
                      ? draft.placements.includes('all')
                      : draft.placements.includes(p.key);
                    return (
                      <TouchableOpacity
                        key={p.key}
                        onPress={() => togglePlacement(p.key)}
                        style={[styles.placeChip, selected && styles.placeChipOn]}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.placeChipText, selected && styles.placeChipTextOn]}>{p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.dualRow}>
                <View style={{ flex: 1 }}>
                  <Field label="Priority">
                    <TextInput style={styles.input} value={draft.priority} onChangeText={(t) => setDraft((d) => ({ ...d, priority: t.replace(/[^0-9]/g, '') }))} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="number-pad" />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Rotation weight (1–10)">
                    <TextInput style={styles.input} value={draft.weight} onChangeText={(t) => setDraft((d) => ({ ...d, weight: t.replace(/[^0-9]/g, '') }))} placeholder="1" placeholderTextColor={C.textMuted} keyboardType="number-pad" />
                  </Field>
                </View>
              </View>

              <Field label="Max plays (0 = unlimited)">
                <TextInput style={styles.input} value={draft.maxImpressions} onChangeText={(t) => setDraft((d) => ({ ...d, maxImpressions: t.replace(/[^0-9]/g, '') }))} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="number-pad" />
                <Text style={styles.hint}>The ad stops showing after this many total views. Leave 0 to run forever.</Text>
              </Field>

              <View style={styles.activeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activeLabel}>Active</Text>
                  <Text style={styles.activeSub}>Paused ads are hidden from users.</Text>
                </View>
                <Switch
                  value={draft.active}
                  onValueChange={(v) => setDraft((d) => ({ ...d, active: v }))}
                  trackColor={{ false: C.border, true: C.accent }}
                  thumbColor={C.white}
                />
              </View>
            </ScrollView>

            <Button label={draft.id ? 'Save changes' : 'Create ad'} onPress={() => void save()} fullWidth loading={upsertM.isPending} style={{ marginTop: 14 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Per-destination click breakdown for one ad (which button people tap most). */
function LinkClicks({ ad }: { ad: Ad }) {
  const breakdown = useMemo<{ type: string; count: number }[]>(() => {
    const raw = ad.link_clicks;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw)
      .map(([type, count]) => ({ type, count: Number(count) || 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [ad.link_clicks]);

  if (breakdown.length === 0) return null;
  return (
    <View style={styles.linkClicksRow}>
      {breakdown.map(({ type, count }) => {
        const meta = LINK_META[type] ?? { label: type, Icon: ExternalLink };
        const Icon = meta.Icon;
        return (
          <View key={type} style={styles.linkClickPill}>
            <Icon size={12} color={C.accent} />
            <Text style={styles.linkClickLabel}>{meta.label}</Text>
            <Text style={styles.linkClickCount}>{count}</Text>
          </View>
        );
      })}
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
  subtitle: { fontSize: 13, color: C.textSecondary, marginTop: -4 },

  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14 },
  newBtnText: { fontSize: 15, fontWeight: '700' as const, color: C.white },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center', paddingHorizontal: 30 },

  adCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },
  adTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  adThumbWrap: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden' },
  adThumb: { width: 52, height: 52 },
  adThumbFallback: { backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  adTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  adAdvertiser: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  pillRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  placePill: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  placePillText: { fontSize: 10, fontWeight: '700' as const, color: C.blue },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusPillText: { fontSize: 10, fontWeight: '700' as const },

  metricsRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160 },
  metricText: { fontSize: 12, color: C.textSecondary },

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
  linkChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  linkChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  linkChipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  linkChipTextOn: { color: C.accent },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingRight: 12, paddingLeft: 8, paddingVertical: 6 },
  linkRowOn: { borderColor: C.accent, backgroundColor: C.accentDim },
  linkRowIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  linkRowIconOn: { backgroundColor: C.card },
  linkRowInput: { flex: 1, fontSize: 13, color: C.text, paddingVertical: 6 },
  placeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  selectAllText: { fontSize: 12, fontWeight: '700' as const, color: C.accent },
  dualRow: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 11, color: C.textMuted, marginTop: 6 },

  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  placeChip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  placeChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  placeChipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  placeChipTextOn: { color: C.accent },

  linkClicksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 },
  linkClickPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accentDim, borderRadius: 999, paddingLeft: 8, paddingRight: 9, paddingVertical: 4 },
  linkClickLabel: { fontSize: 11, fontWeight: '600' as const, color: C.textSecondary },
  linkClickCount: { fontSize: 11, fontWeight: '800' as const, color: C.accent },

  activeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginTop: 2 },
  activeLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  activeSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
