import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { ExternalLink, X, Megaphone } from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

type Ad = {
  id: string;
  title: string;
  body: string;
  image_url: string;
  target_url: string;
  cta_label: string;
  advertiser_name: string;
  placement: string;
  priority: number;
};

// Root segments that render inside a bottom Tabs bar. The banner is lifted above
// the tab bar on these; everywhere else it docks to the bottom safe area.
const TABBED_ROOTS = new Set<string>([
  'warehouse-provider', 'service-provider', 'employer', 'worker',
  'trucking-company', 'driver', 'gate-staff', 'customer', 'admin', 'super-admin',
]);

// Segments where an ad banner should never appear (auth, landing, full-screen flows).
const HIDDEN_ROOTS = new Set<string>(['', 'auth', 'onboarding', '+not-found']);

const ROTATE_MS = 9000;

/**
 * Global sponsored-ad banner docked under every page. It resolves the current
 * role segment, serves the active ads for that placement (plus platform-wide
 * 'all' ads), rotates through them, records impressions/clicks, and opens the
 * advertiser's web page on tap. Managed entirely from the Super Admin → Ads screen.
 */
export default function AdBanner() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);
  const [index, setIndex] = useState<number>(0);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const seenRef = useRef<Set<string>>(new Set());

  const root = (segments[0] ?? '') as string;
  const isHidden = HIDDEN_ROOTS.has(root) || !user;
  const placement = TABBED_ROOTS.has(root) || root.length > 0 ? root : 'all';

  const adsQuery = trpc.ads.serve.useQuery(
    { placement },
    { enabled: !isHidden, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const impressionM = trpc.ads.recordImpression.useMutation();
  const clickM = trpc.ads.recordClick.useMutation();

  const ads = useMemo<Ad[]>(() => (adsQuery.data as Ad[] | undefined) ?? [], [adsQuery.data]);

  // Reset rotation when the ad set changes so we never index out of bounds.
  useEffect(() => {
    setIndex(0);
    setDismissed(false);
  }, [ads.length, root]);

  // Rotate through multiple ads.
  useEffect(() => {
    if (ads.length <= 1 || dismissed) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % ads.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [ads.length, dismissed]);

  const current = ads.length > 0 ? ads[index % ads.length] : null;

  // Record one impression per ad per mount session.
  useEffect(() => {
    if (!current) return;
    if (seenRef.current.has(current.id)) return;
    seenRef.current.add(current.id);
    impressionM.mutate({ id: current.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const onPress = useCallback(async () => {
    if (!current) return;
    clickM.mutate({ id: current.id });
    const url = current.target_url?.trim();
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const ok = await Linking.canOpenURL(normalized).catch(() => false);
    if (ok) await Linking.openURL(normalized);
  }, [current, clickM]);

  if (isHidden || dismissed || !current) return null;

  const bottomOffset = TABBED_ROOTS.has(root)
    ? 64 + Math.max(insets.bottom, 12)
    : Math.max(insets.bottom, 10);

  return (
    <View style={[styles.wrap, { bottom: bottomOffset }]} pointerEvents="box-none">
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => void onPress()}
        style={styles.card}
        testID="ad-banner"
        accessibilityRole="button"
        accessibilityLabel={`Sponsored: ${current.title}`}
      >
        <View style={styles.thumbWrap}>
          {current.image_url ? (
            <Image source={{ uri: current.image_url }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Megaphone size={20} color={C.accent} />
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.sponsorRow}>
            <Text style={styles.sponsorTag}>SPONSORED</Text>
            {current.advertiser_name ? (
              <Text style={styles.sponsorName} numberOfLines={1}> · {current.advertiser_name}</Text>
            ) : null}
          </View>
          <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
          {current.body ? <Text style={styles.sub} numberOfLines={1}>{current.body}</Text> : null}
        </View>

        <View style={styles.cta}>
          <Text style={styles.ctaText} numberOfLines={1}>{current.cta_label || 'Learn more'}</Text>
          <ExternalLink size={13} color={C.accent} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setDismissed(true)}
        style={styles.close}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Hide ad"
      >
        <X size={13} color={C.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    right: 10,
    ...(Platform.OS === 'web' ? { maxWidth: 640, alignSelf: 'center' as const } : null),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.cardElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    shadowColor: C.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  thumbWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: 48, height: 48, borderRadius: 12 },
  thumbFallback: { backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  sponsorRow: { flexDirection: 'row', alignItems: 'center' },
  sponsorTag: { fontSize: 9, fontWeight: '800' as const, color: C.textMuted, letterSpacing: 0.8 },
  sponsorName: { fontSize: 9, fontWeight: '600' as const, color: C.textMuted, flexShrink: 1 },
  title: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 1 },
  sub: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.accentDim, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  ctaText: { fontSize: 12, fontWeight: '700' as const, color: C.accent, maxWidth: 90 },
  close: {
    position: 'absolute', top: -7, right: -3,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
