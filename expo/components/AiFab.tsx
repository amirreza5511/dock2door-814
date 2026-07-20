import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles } from 'lucide-react-native';
import C from '@/constants/colors';
import { useAuthStore } from '@/store/auth';

/** Routes where the floating AI button must stay hidden. */
const HIDDEN_PREFIXES = ['/copilot', '/assistant', '/auth', '/onboarding', '/messages'];

/**
 * Floating AI copilot button, visible on every authenticated screen.
 * Opens the copilot chat from anywhere with one tap.
 */
export default function AiFab() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (!user) return null;
  if (pathname === '/' || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { bottom: insets.bottom + 84, transform: [{ scale: pulse }] },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.btn}
        activeOpacity={0.85}
        testID="ai-fab"
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push('/copilot' as never);
        }}
      >
        <Sparkles size={22} color={C.white} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 18, zIndex: 60 },
  btn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: 1,
    borderColor: '#ffffff30',
  },
});
