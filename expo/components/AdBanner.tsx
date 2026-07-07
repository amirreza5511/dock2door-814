import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import {
  ExternalLink, X, Megaphone, Phone, Instagram, Play, MessageCircle, Youtube,
} from 'lucide-react-native';
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
  media_type?: string | null;
  video_url?: string | null;
  link_type?: string | null;
  weight?: number | null;
};

// Root segments that render inside a bottom Tabs bar. The banner is lifted above
// the tab bar on these; everywhere else it docks to the bottom safe area.
const TABBED_ROOTS = new Set<string>([
  'warehouse-provider', 'service-provider', 'employer', 'worker',
  'trucking-company', 'driver', 'gate-staff', 'customer', 'admin', 'super-admin',
]);

// Segments where an ad banner should never appear (auth, landing, full-screen flows).
const HIDDEN_ROOTS = new Set<string>(['', 'auth', 'onboarding', '+not-found']);

const ROTATE_MS = 8000;

/** Extract a YouTube video id from any common YouTube URL shape. */
function youtubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Build the real destination URL for a given link type + raw value. */
function resolveLink(linkType: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  switch (linkType) {
    case 'phone':
      return `tel:${value.replace(/[^\d+]/g, '')}`;
    case 'whatsapp':
      return `https://wa.me/${value.replace(/[^\d]/g, '')}`;
    case 'email':
      return value.includes('@') ? `mailto:${value}` : null;
    case 'instagram': {
      if (/^https?:\/\//i.test(value)) return value;
      return `https://instagram.com/${value.replace(/^@/, '')}`;
    }
    case 'youtube':
    case 'website':
    default:
      return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }
}

/**
 * Global sponsored-ad banner docked under every page. Serves the active ads for
 * the current role placement (plus platform-wide 'all' ads), rotates through
 * them in a weighted-random order, supports image / video / YouTube creatives,
 * records impressions & clicks, and opens the advertiser's link (website,
 * Instagram, phone, WhatsApp, email, or YouTube) on tap. Managed entirely from
 * the Super Admin → Ads screen.
 */
export default function AdBanner() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<number>(0);
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

  const rawAds = useMemo<Ad[]>(() => (adsQuery.data as Ad[] | undefined) ?? [], [adsQuery.data]);

  // Build a weighted-random rotation order once per ad set so multiple ads share
  // the slot fairly and don't always appear in the same sequence.
  const ads = useMemo<Ad[]>(() => {
    if (rawAds.length <= 1) return rawAds;
    const pool: Ad[] = [];
    for (const ad of rawAds) {
      const w = Math.max(1, Math.min(10, Number(ad.weight ?? 1)));
      for (let i = 0; i < w; i += 1) pool.push(ad);
    }
    // Fisher–Yates shuffle, then de-dupe consecutive so the same ad isn't shown twice in a row.
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const ordered: Ad[] = [];
    for (const ad of pool) {
      if (ordered.length === 0 || ordered[ordered.length - 1].id !== ad.id) ordered.push(ad);
    }
    return ordered.length > 0 ? ordered : rawAds;
  }, [rawAds]);

  useEffect(() => {
    setStep(0);
    setDismissed(false);
  }, [ads.length, root]);

  useEffect(() => {
    if (ads.length <= 1 || dismissed) return;
    const t = setInterval(() => {
      setStep((i) => (i + 1) % ads.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [ads.length, dismissed]);

  const current = ads.length > 0 ? ads[step % ads.length] : null;
  const mediaType = (current?.media_type ?? 'image') as string;
  const linkType = (current?.link_type ?? 'website') as string;

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
    const raw = linkType === 'youtube' ? (current.video_url || current.target_url) : current.target_url;
    const normalized = resolveLink(linkType, raw ?? '');
    if (!normalized) return;
    const ok = await Linking.canOpenURL(normalized).catch(() => false);
    if (ok) await Linking.openURL(normalized);
    else if (/^https?:/i.test(normalized)) await Linking.openURL(normalized).catch(() => {});
  }, [current, clickM, linkType]);

  if (isHidden || dismissed || !current) return null;

  const bottomOffset = TABBED_ROOTS.has(root)
    ? 64 + Math.max(insets.bottom, 12)
    : Math.max(insets.bottom, 10);

  const isVideo = mediaType === 'video' && !!current.video_url;
  const isYoutube = mediaType === 'youtube' && !!youtubeId(current.video_url || current.target_url || '');
  const isRichMedia = isVideo || isYoutube;

  const CtaIcon = linkType === 'phone' ? Phone
    : linkType === 'whatsapp' ? MessageCircle
    : linkType === 'instagram' ? Instagram
    : linkType === 'youtube' ? Youtube
    : ExternalLink;

  return (
    <View style={[styles.wrap, { bottom: bottomOffset }]} pointerEvents="box-none">
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => void onPress()}
        style={[styles.card, isRichMedia && styles.cardMedia]}
        testID="ad-banner"
        accessibilityRole="button"
        accessibilityLabel={`Sponsored: ${current.title}`}
      >
        {isRichMedia ? (
          <View style={styles.mediaStage}>
            {isVideo ? (
              <AdVideo uri={current.video_url as string} />
            ) : (
              <AdYoutube videoId={youtubeId(current.video_url || current.target_url || '') as string} />
            )}
            <View style={styles.mediaOverlay} pointerEvents="none">
              <View style={styles.sponsorRow}>
                <Text style={styles.sponsorTagLight}>SPONSORED</Text>
                {current.advertiser_name ? (
                  <Text style={styles.sponsorNameLight} numberOfLines={1}> · {current.advertiser_name}</Text>
                ) : null}
              </View>
              <View style={styles.mediaBottom}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.titleLight} numberOfLines={1}>{current.title}</Text>
                  {current.body ? <Text style={styles.subLight} numberOfLines={1}>{current.body}</Text> : null}
                </View>
                <View style={styles.ctaSolid}>
                  <Text style={styles.ctaSolidText} numberOfLines={1}>{current.cta_label || 'Learn more'}</Text>
                  <CtaIcon size={13} color={C.white} />
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.compactRow}>
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
              <CtaIcon size={13} color={C.accent} />
            </View>
          </View>
        )}
      </TouchableOpacity>

      {ads.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {ads.map((a, i) => (
            <View key={`${a.id}-${i}`} style={[styles.dot, i === (step % ads.length) && styles.dotOn]} />
          ))}
        </View>
      ) : null}

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

/** Muted, looping autoplay video creative. */
function AdVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  // Web autoplay sometimes needs a nudge after mount.
  useEffect(() => {
    const t = setTimeout(() => { try { player.play(); } catch { /* noop */ } }, 300);
    return () => clearTimeout(t);
  }, [player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      pointerEvents="none"
    />
  );
}

/** Inline, muted, looping YouTube creative via an embedded iframe. */
function AdYoutube({ videoId }: { videoId: string }) {
  const src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&controls=0&playsinline=1&modestbranding=1&rel=0&playlist=${videoId}`;
  if (Platform.OS === 'web') {
    return (
      // eslint-disable-next-line react/no-danger-with-children
      <iframe
        title="ad-youtube"
        src={src}
        style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' as const }}
        allow="autoplay; encrypted-media"
      />
    );
  }
  return (
    <WebView
      source={{ uri: src }}
      style={StyleSheet.absoluteFill}
      scrollEnabled={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      pointerEvents="none"
      javaScriptEnabled
    />
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
    backgroundColor: C.cardElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
    shadowColor: C.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: 'hidden',
  },
  cardMedia: { padding: 0 },

  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
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

  // Rich media (video / youtube)
  mediaStage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: C.black,
    justifyContent: 'flex-end',
  },
  mediaOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 0,
    padding: 12,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  mediaBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  sponsorTagLight: { fontSize: 9, fontWeight: '800' as const, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.8 },
  sponsorNameLight: { fontSize: 9, fontWeight: '600' as const, color: 'rgba(255,255,255,0.75)', flexShrink: 1 },
  titleLight: { fontSize: 16, fontWeight: '800' as const, color: C.white, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  subLight: { fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  ctaSolid: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.accent, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  ctaSolidText: { fontSize: 12, fontWeight: '800' as const, color: C.white, maxWidth: 110 },

  dots: { flexDirection: 'row', gap: 4, alignSelf: 'center', marginTop: 6 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.border },
  dotOn: { backgroundColor: C.accent, width: 14 },

  close: {
    position: 'absolute', top: -7, right: -3,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
