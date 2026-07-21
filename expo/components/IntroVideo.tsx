import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer } from 'expo-audio';
import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import C from '@/constants/colors';
import { usePreferences } from '@/store/preferences';
import { usePromo } from '@/store/promo';
import {
  PROMO_SCENES,
  PROMO_TAGLINE,
  PROMO_SUBLINE,
  PROMO_MUSIC_URL,
  type PromoScene,
} from '@/constants/promo';

/**
 * Full-screen launch intro. Plays a sequence of branded video clips interleaved
 * with promo/ad slots, with a Skip button and a brand tagline near the end.
 *
 * Robustness: the intro can NEVER trap the user. Every scene has a fallback
 * timer, a global hard timeout dismisses the whole thing, tapping advances,
 * and Skip is available from the first frame.
 */
export default function IntroVideo() {
  const insets = useSafeAreaInsets();
  const hydrated = usePreferences((s) => s.hydrated);
  const playToken = usePromo((s) => s.playToken);
  const play = usePromo((s) => s.play);
  const setActive = usePromo((s) => s.setActive);

  const [visible, setVisible] = useState<boolean>(false);
  const [index, setIndex] = useState<number>(0);
  const [showTagline, setShowTagline] = useState<boolean>(false);

  const fade = useRef(new Animated.Value(0)).current;
  const taglineFade = useRef(new Animated.Value(0)).current;
  const dismissedRef = useRef<boolean>(false);
  const indexRef = useRef<number>(0);
  const loadedUrlRef = useRef<string | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const firstVideo = PROMO_SCENES.find((s): s is Extract<PromoScene, { kind: 'video' }> => s.kind === 'video');

  const player = useVideoPlayer(firstVideo?.url ?? null, (p) => {
    p.muted = true;
    p.loop = false;
  });

  // Background music over the whole intro (video stays muted).
  const music = useAudioPlayer(PROMO_MUSIC_URL ?? undefined);

  // Auto-play once on every launch (the intro doubles as an ad surface).
  const launchedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!hydrated || launchedRef.current) return;
    launchedRef.current = true;
    if (PROMO_SCENES.length > 0) play();
  }, [hydrated, play]);

  // (Re)show whenever a play is requested — launch, idle attract, or replay.
  useEffect(() => {
    if (playToken === 0 || PROMO_SCENES.length === 0) return;
    dismissedRef.current = false;
    indexRef.current = 0;
    setIndex(0);
    loadedUrlRef.current = firstVideo?.url ?? null;
    setVisible(true);
    setActive(true);
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    if (PROMO_MUSIC_URL) {
      try { music.seekTo(0); music.volume = 0.7; music.loop = true; music.play(); } catch {}
    }
  }, [playToken, fade, firstVideo, setActive, music]);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (hardTimer.current) clearTimeout(hardTimer.current);
    Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      setVisible(false);
      setActive(false);
      try { player.pause(); } catch {}
      try { music.pause(); } catch {}
    });
  }, [fade, setActive, player, music]);

  const goNext = useCallback(() => {
    const next = indexRef.current + 1;
    if (next >= PROMO_SCENES.length) {
      dismiss();
      return;
    }
    indexRef.current = next;
    setIndex(next);
  }, [dismiss]);

  // Drive the current scene: play video (with fallback) or hold ad slot for its duration.
  useEffect(() => {
    if (!visible) return;
    const scene = PROMO_SCENES[index];
    if (!scene) { dismiss(); return; }
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setShowTagline(false);
    taglineFade.setValue(0);

    if (scene.kind === 'video') {
      try {
        if (loadedUrlRef.current !== scene.url) {
          player.replace(scene.url);
          loadedUrlRef.current = scene.url;
        }
        player.currentTime = 0;
        player.play();
      } catch {}
      advanceTimer.current = setTimeout(goNext, scene.maxMs ?? 14000);
    } else {
      try { player.pause(); } catch {}
      advanceTimer.current = setTimeout(goNext, scene.durationMs);
    }

    return () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); };
  }, [index, visible, player, goNext, dismiss, taglineFade]);

  // Global hard timeout — no matter what, the intro exits.
  useEffect(() => {
    if (!visible) return;
    const total = PROMO_SCENES.reduce(
      (acc, s) => acc + (s.kind === 'video' ? (s.maxMs ?? 14000) : s.durationMs),
      0,
    );
    hardTimer.current = setTimeout(dismiss, total + 4000);
    return () => { if (hardTimer.current) clearTimeout(hardTimer.current); };
  }, [visible, dismiss]);

  // Advance as soon as a clip actually ends.
  useEventListener(player, 'playToEnd', () => {
    const scene = PROMO_SCENES[indexRef.current];
    if (scene?.kind === 'video') goNext();
  });

  // Brand tagline for the final stretch of a tagline-flagged clip.
  useEventListener(player, 'timeUpdate', (payload: { currentTime: number }) => {
    const scene = PROMO_SCENES[indexRef.current];
    if (scene?.kind !== 'video' || !scene.tagline) return;
    const dur = player.duration || (scene.maxMs ?? 14000) / 1000;
    if (!showTagline && payload.currentTime >= Math.max(0, dur - 4)) {
      setShowTagline(true);
      Animated.timing(taglineFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }
  });

  if (!visible || PROMO_SCENES.length === 0) return null;

  const scene = PROMO_SCENES[index];

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="auto">
      {/* Tap anywhere to advance */}
      <Pressable style={StyleSheet.absoluteFill} onPress={goNext} testID="intro-advance">
        {scene?.kind === 'video' ? (
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            contentFit="cover"
            nativeControls={false}
            allowsPictureInPicture={false}
          />
        ) : (
          <LinearGradient colors={[scene.colors[0], scene.colors[1]]} style={StyleSheet.absoluteFill}>
            <View style={styles.adContent}>
              {scene.badge ? (
                <View style={styles.adBadge}>
                  <Text style={styles.adBadgeText}>{scene.badge}</Text>
                </View>
              ) : null}
              <Text style={styles.adTitle}>{scene.title}</Text>
              <Text style={styles.adSubtitle}>{scene.subtitle}</Text>
              {scene.website ? (
                <View style={styles.adCtaRow}>
                  <View style={styles.adCtaDot} />
                  <Text style={styles.adCtaText}>{scene.website}</Text>
                </View>
              ) : null}
            </View>
            {scene.sponsored ? <Text style={[styles.sponsoredTag, { top: insets.top + 16 }]}>Ad</Text> : null}
          </LinearGradient>
        )}
      </Pressable>

      {/* Bottom scrim + tagline for the brand clip */}
      {scene?.kind === 'video' ? <View style={styles.scrim} pointerEvents="none" /> : null}
      {scene?.kind === 'video' && scene.caption && !showTagline ? (
        <View style={[styles.captionWrap, { paddingBottom: insets.bottom + 40 }]} pointerEvents="none">
          <Text style={styles.caption}>{scene.caption}</Text>
        </View>
      ) : null}
      {showTagline && scene?.kind === 'video' ? (
        <Animated.View
          style={[styles.taglineWrap, { opacity: taglineFade, paddingBottom: insets.bottom + 72 }]}
          pointerEvents="none"
        >
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>Dock2Door</Text>
          </View>
          <Text style={styles.tagline}>{PROMO_TAGLINE}</Text>
          <Text style={styles.subline}>{PROMO_SUBLINE}</Text>
        </Animated.View>
      ) : null}

      {/* Progress segments */}
      <View style={[styles.progressRow, { top: insets.top + 14 }]} pointerEvents="none">
        {PROMO_SCENES.map((_, i) => (
          <View key={i} style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: i <= index ? '100%' : '0%' }]} />
          </View>
        ))}
      </View>

      {/* Skip — always available */}
      <TouchableOpacity
        style={[styles.skipBtn, { top: insets.top + 40 }]}
        onPress={dismiss}
        testID="intro-skip"
        hitSlop={12}
      >
        <Text style={styles.skipText}>Skip</Text>
        <X size={15} color={C.white} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, backgroundColor: C.black },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 260, backgroundColor: '#00000055' },
  captionWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 24 },
  caption: { fontSize: 20, fontWeight: '800' as const, color: C.white, letterSpacing: -0.4, textAlign: 'center' as const, textShadowColor: '#000000AA', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  taglineWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  logoDot: { width: 10, height: 10, borderRadius: 3, backgroundColor: C.accent },
  logoText: { fontSize: 18, fontWeight: '800' as const, color: C.white, letterSpacing: -0.4 },
  tagline: { fontSize: 40, fontWeight: '900' as const, color: C.white, letterSpacing: -1, textAlign: 'center' as const },
  subline: { fontSize: 13, fontWeight: '600' as const, color: '#FFFFFFCC', marginTop: 8, textAlign: 'center' as const },

  adContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  adBadge: { alignSelf: 'flex-start', backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 16 },
  adBadgeText: { color: C.white, fontSize: 12, fontWeight: '800' as const, letterSpacing: 0.5 },
  adTitle: { fontSize: 44, fontWeight: '900' as const, color: C.white, letterSpacing: -1.2, marginBottom: 14 },
  adSubtitle: { fontSize: 17, fontWeight: '500' as const, color: '#FFFFFFCC', lineHeight: 25 },
  sponsoredTag: { position: 'absolute', left: 20, color: '#FFFFFF88', fontSize: 11, fontWeight: '700' as const, letterSpacing: 1 },
  adCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 },
  adCtaDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  adCtaText: { fontSize: 16, fontWeight: '800' as const, color: C.accent, letterSpacing: -0.2 },

  progressRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 5 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF33', overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: C.white },

  skipBtn: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#00000066', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#FFFFFF44',
  },
  skipText: { fontSize: 13, fontWeight: '700' as const, color: C.white },
});
