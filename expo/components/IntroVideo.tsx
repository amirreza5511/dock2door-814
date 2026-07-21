import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import C from '@/constants/colors';
import { usePreferences } from '@/store/preferences';
import { PROMO_VIDEO_URL, PROMO_TAGLINE, PROMO_SUBLINE } from '@/constants/promo';

/**
 * Full-screen launch promo. Plays a 15s brand video the first time the app opens
 * (or when replayed from settings), with a Skip button and an "All you need"
 * tagline overlay near the end. Dismisses to the app and won't auto-play again.
 */
export default function IntroVideo() {
  const insets = useSafeAreaInsets();
  const hydrated = usePreferences((s) => s.hydrated);
  const introSeen = usePreferences((s) => s.introSeen);
  const markIntroSeen = usePreferences((s) => s.markIntroSeen);

  const [visible, setVisible] = useState<boolean>(false);
  const [showTagline, setShowTagline] = useState<boolean>(false);
  const fade = useRef(new Animated.Value(0)).current;
  const taglineFade = useRef(new Animated.Value(0)).current;

  // Decide whether to show once preferences hydrate. No video URL → skip silently.
  useEffect(() => {
    if (!hydrated) return;
    if (!introSeen && PROMO_VIDEO_URL) {
      setVisible(true);
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [hydrated, introSeen, fade]);

  const player = useVideoPlayer(PROMO_VIDEO_URL, (p) => {
    p.muted = true;
    p.loop = false;
    if (PROMO_VIDEO_URL) p.play();
  });

  const dismiss = () => {
    Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      setVisible(false);
      markIntroSeen();
      try { player.pause(); } catch {}
    });
  };

  // Show the tagline overlay for the final stretch of the clip.
  useEventListener(player, 'timeUpdate', (payload: { currentTime: number }) => {
    const dur = player.duration || 15;
    if (!showTagline && payload.currentTime >= Math.max(0, dur - 4)) {
      setShowTagline(true);
      Animated.timing(taglineFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }
  });

  useEventListener(player, 'playToEnd', () => dismiss());

  if (!visible || !PROMO_VIDEO_URL) return null;

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="auto">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />

      {/* Bottom gradient-ish scrim + tagline */}
      <View style={styles.scrim} pointerEvents="none" />
      {showTagline ? (
        <Animated.View style={[styles.taglineWrap, { opacity: taglineFade, paddingBottom: insets.bottom + 60 }]} pointerEvents="none">
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>Dock2Door</Text>
          </View>
          <Text style={styles.tagline}>{PROMO_TAGLINE}</Text>
          <Text style={styles.subline}>{PROMO_SUBLINE}</Text>
        </Animated.View>
      ) : null}

      {/* Skip */}
      <TouchableOpacity
        style={[styles.skipBtn, { top: insets.top + 12 }]}
        onPress={dismiss}
        testID="intro-skip"
        hitSlop={10}
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
  taglineWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  logoDot: { width: 10, height: 10, borderRadius: 3, backgroundColor: C.accent },
  logoText: { fontSize: 18, fontWeight: '800' as const, color: C.white, letterSpacing: -0.4 },
  tagline: { fontSize: 40, fontWeight: '900' as const, color: C.white, letterSpacing: -1, textAlign: 'center' as const },
  subline: { fontSize: 13, fontWeight: '600' as const, color: '#FFFFFFCC', marginTop: 8, textAlign: 'center' as const },
  skipBtn: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#00000066', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#FFFFFF44',
  },
  skipText: { fontSize: 13, fontWeight: '700' as const, color: C.white },
});
