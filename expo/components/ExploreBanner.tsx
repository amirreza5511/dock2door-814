import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Compass, UserPlus, X } from 'lucide-react-native';
import C from '@/constants/colors';
import { useExploreStore } from '@/store/explore';
import { DOMAIN_LABELS } from '@/lib/access';

/**
 * Sticky top banner shown while the visitor is exploring a role dashboard without
 * an account. Always makes it obvious this is a preview, and offers a one-tap exit
 * plus a "create account" call to action.
 */
export default function ExploreBanner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isExploring = useExploreStore((s) => s.isExploring);
  const exploreDomain = useExploreStore((s) => s.exploreDomain);
  const stopExplore = useExploreStore((s) => s.stopExplore);
  const slide = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: isExploring ? 0 : -80,
      useNativeDriver: true,
      friction: 9,
      tension: 60,
    }).start();
  }, [isExploring, slide]);

  if (!isExploring) return null;

  const label = exploreDomain ? DOMAIN_LABELS[exploreDomain] : 'Dock2Door';

  const exit = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopExplore();
    router.replace('/' as never);
  };

  const signUp = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stopExplore();
    router.push('/auth/signup' as never);
  };

  return (
    <Animated.View
      style={[styles.wrap, { paddingTop: insets.top + 8, transform: [{ translateY: slide }] }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        <TouchableOpacity onPress={exit} style={styles.exitBtn} hitSlop={8} testID="explore-exit">
          <X size={16} color={C.black} />
        </TouchableOpacity>
        <View style={styles.center}>
          <Compass size={14} color={C.black} />
          <Text style={styles.text} numberOfLines={1}>
            Exploring {label} · preview
          </Text>
        </View>
        <TouchableOpacity onPress={signUp} style={styles.signBtn} testID="explore-signup">
          <UserPlus size={13} color={C.white} />
          <Text style={styles.signText}>Sign up</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
    backgroundColor: C.yellow,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exitBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#00000018',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  text: { fontSize: 13, fontWeight: '800' as const, color: C.black, letterSpacing: -0.2 },
  signBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.black,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  signText: { fontSize: 12, fontWeight: '700' as const, color: C.white },
});
