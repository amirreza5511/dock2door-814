import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Megaphone, Plus, X, Pencil, Trash2, ChevronLeft, ExternalLink,
  Eye, MousePointerClick, Play, Pause,
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
};

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
  targetUrl: string;
  ctaLabel: string;
  advertiserName: string;
  placement: string;
  priority: string;
  active: boolean;
};

const emptyDraft: Draft = {
  id: null, title: '', body: '', imageUrl: '', targetUrl: '', ctaLabel: 'Learn more',
  advertiserName: '', placement: 'all', priority: '0', active: true,
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
    setDraft({
      id: ad.id,
      title: ad.title,
      body: ad.body,
      imageUrl: ad.image_url,
      targetUrl: ad.target_url,
      ctaLabel: ad.cta_label || 'Learn more',
      advertiserName: ad.advertiser_name,
      placement: ad.placement || 'all',
      priority: String(ad.priority ?? 0),
      active: ad.status === 'Active',
    });
    setEditorOpen(true);
  }, []);

  const save = useCallback(async () => {
    if (!draft.title.trim()) { Alert.alert('Title required', 'Give the ad a short title.'); return; }
    try {
      await upsertM.mutateAsync({
        id: draft.id,
        title: draft.title.trim(),
        body: draft.body.trim(),
        imageUrl: draft.imageUrl.trim(),
        targetUrl: draft.targetUrl.trim(),
        ctaLabel: draft.ctaLabel.trim() || 'Learn more',
        advertiserName: draft.advertiserName.trim(),
        placement: draft.placement,
        status: draft.active ? 'Active' : 'Paused',
        priority: Number.parseInt(draft.priority, 10) || 0,
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
              <Field label="Image URL">
                <TextInput style={styles.input} value={draft.imageUrl} onChangeText={(t) => setDraft((d) => ({ ...d, imageUrl: t }))} placeholder="https://…" placeholderTextColor={C.textMuted} autoCapitalize="none" />
              </Field>
              <Field label="Destination link (opens on tap)">
                <TextInput style={styles.input} value={draft.targetUrl} onChangeText={(t) => setDraft((d) => ({ ...d, targetUrl: t }))} placeholder="https://advertiser.com" placeholderTextColor={C.textMuted} autoCapitalize="none" keyboardType="url" />
              </Field>
              <Field label="Button label">
                <TextInput style={styles.input} value={draft.ctaLabel} onChangeText={(t) => setDraft((d) => ({ ...d, ctaLabel: t }))} placeholder="Learn more" placeholderTextColor={C.textMuted} />
              </Field>

              <Field label="Show on">
                <View style={styles.placeGrid}>
                  {PLACEMENTS.map((p) => {
                    const selected = draft.placement === p.key;
                    return (
                      <TouchableOpacity
                        key={p.key}
                        onPress={() => setDraft((d) => ({ ...d, placement: p.key }))}
                        style={[styles.placeChip, selected && styles.placeChipOn]}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.placeChipText, selected && styles.placeChipTextOn]}>{p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Field>

              <Field label="Priority (higher shows first)">
                <TextInput style={styles.input} value={draft.priority} onChangeText={(t) => setDraft((d) => ({ ...d, priority: t.replace(/[^0-9]/g, '') }))} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="number-pad" />
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

  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  placeChip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  placeChipOn: { backgroundColor: C.accentDim, borderColor: C.accent },
  placeChipText: { fontSize: 12, fontWeight: '600' as const, color: C.textSecondary },
  placeChipTextOn: { color: C.accent },

  activeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginTop: 2 },
  activeLabel: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  activeSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
