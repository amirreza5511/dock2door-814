import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Lock, UserPlus, ArrowRight, X } from 'lucide-react-native';
import C from '@/constants/colors';
import { useExploreStore } from '@/store/explore';

/**
 * Bottom sheet shown when a visitor in explore mode tries a real action.
 * Invites them to create an account (which is the only way to actually do work).
 */
export default function ActionGate() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const gateAction = useExploreStore((s) => s.gateAction);
  const dismissGate = useExploreStore((s) => s.dismissGate);
  const stopExplore = useExploreStore((s) => s.stopExplore);
  const visible = gateAction !== null;

  const slide = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : 400,
      useNativeDriver: true,
      friction: 11,
      tension: 70,
    }).start();
  }, [visible, slide]);

  useEffect(() => {
    if (visible && Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [visible]);

  const goSignup = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dismissGate();
    stopExplore();
    router.push('/auth/signup' as never);
  };

  const goLogin = () => {
    dismissGate();
    stopExplore();
    router.push('/auth/login' as never);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissGate}>
      <Pressable style={styles.backdrop} onPress={dismissGate}>
        <Animated.View style={{ transform: [{ translateY: slide }], width: '100%' }}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            <View style={styles.grabber} />
            <TouchableOpacity style={styles.closeBtn} onPress={dismissGate} hitSlop={8}>
              <X size={18} color={C.textSecondary} />
            </TouchableOpacity>

            <View style={styles.iconWrap}>
              <Lock size={26} color={C.accent} />
            </View>

            <Text style={styles.title}>Create an account to continue</Text>
            <Text style={styles.sub}>
              {gateAction ? `“${gateAction}” needs an account. ` : ''}
              You’ve been exploring with sample data — sign up free to do it for real, with your own orders, quotes and messages.
            </Text>

            <TouchableOpacity style={styles.primary} activeOpacity={0.85} onPress={goSignup} testID="gate-signup">
              <UserPlus size={16} color={C.white} />
              <Text style={styles.primaryText}>Create free account</Text>
              <ArrowRight size={16} color={C.white} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondary} activeOpacity={0.85} onPress={goLogin}>
              <Text style={styles.secondaryText}>I already have an account</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.keep} onPress={dismissGate}>
              <Text style={styles.keepText}>Keep exploring</Text>
            </TouchableOpacity>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.cardElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: C.borderLight,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 16 },
  closeBtn: { position: 'absolute', right: 16, top: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  iconWrap: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 21, fontWeight: '800' as const, color: C.text, letterSpacing: -0.4, marginBottom: 8 },
  sub: { fontSize: 14, color: C.textSecondary, lineHeight: 21, marginBottom: 22 },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15, marginBottom: 10,
  },
  primaryText: { fontSize: 15, fontWeight: '700' as const, color: C.white },
  secondary: {
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: C.border, marginBottom: 6,
  },
  secondaryText: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  keep: { alignItems: 'center', paddingVertical: 10 },
  keepText: { fontSize: 13, fontWeight: '600' as const, color: C.textMuted },
});
