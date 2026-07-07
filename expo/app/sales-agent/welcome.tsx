import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sparkles, UserPlus, HandHeart, Wallet, ChevronRight, X } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

export const WELCOME_SEEN_KEY = 'd2d.sales.welcomeSeen';

interface Slide {
  icon: React.ReactNode;
  tint: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: <Sparkles size={30} color={C.accent} />, tint: C.accentDim,
    title: 'Welcome, Sales Agent',
    body: "You're the bridge between businesses and Dock2Door. You bring warehouses, carriers, employers and more onto the platform — and earn commission on every one you sign.",
  },
  {
    icon: <UserPlus size={30} color={C.blue} />, tint: C.blueDim,
    title: 'Onboard a business',
    body: 'Share your personal invite link. When a business signs up with it, they’re automatically credited to you and appear in your client book — no paperwork, no manual steps.',
  },
  {
    icon: <HandHeart size={30} color={C.purple} />, tint: C.purpleDim,
    title: 'Help them get set up',
    body: 'Track each client through onboarding — signed up, setting up, active. Nudge them along and keep every relationship in one place.',
  },
  {
    icon: <Wallet size={30} color={C.green} />, tint: C.greenDim,
    title: 'Get paid',
    body: 'Earn a signing bounty for each account plus recurring commission on the revenue they generate. Watch it all stack up in your ledger.',
  },
];

export default function SalesAgentWelcome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const finish = useCallback(async (target: 'onboard' | 'home') => {
    try { await AsyncStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch {}
    if (target === 'onboard') router.replace('/sales-agent/onboard' as never);
    else router.back();
  }, [router]);

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  }, [width]);

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#12253D', C.bg]} style={StyleSheet.absoluteFill} />
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => void finish('home')} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip</Text>
          <X size={16} color={C.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flexGrow: 0 }}
      >
        {SLIDES.map((s, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <View style={[styles.iconWrap, { backgroundColor: s.tint }]}>{s.icon}</View>
            <Text style={styles.stepTag}>STEP {i + 1} OF {SLIDES.length}</Text>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <Dot key={i} active={i === index} />
          ))}
        </View>
        <Button
          label={isLast ? 'Onboard your first client' : 'Continue'}
          onPress={() => (isLast ? void finish('onboard') : goTo(index + 1))}
          fullWidth
          size="lg"
          icon={isLast ? <UserPlus size={18} color={C.white} /> : <ChevronRight size={18} color={C.white} />}
        />
        {isLast ? (
          <TouchableOpacity onPress={() => void finish('home')} style={styles.laterBtn}>
            <Text style={styles.laterText}>I’ll explore on my own</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function Dot({ active }: { active: boolean }) {
  const w = useRef(new Animated.Value(active ? 22 : 8)).current;
  React.useEffect(() => {
    Animated.spring(w, { toValue: active ? 22 : 8, useNativeDriver: false, speed: 20, bounciness: 8 }).start();
  }, [active, w]);
  return <Animated.View style={[styles.dot, { width: w, backgroundColor: active ? C.accent : C.border }]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topBar: { paddingHorizontal: 16, alignItems: 'flex-end' },
  skipBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  skipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  slide: { flex: 1, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', gap: 14 },
  iconWrap: { width: 84, height: 84, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  stepTag: { fontSize: 12, color: C.accent, fontWeight: '800' as const, letterSpacing: 1.4 },
  title: { fontSize: 28, fontWeight: '800' as const, color: C.text, textAlign: 'center' as const, letterSpacing: -0.6 },
  body: { fontSize: 15, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 23 },
  footer: { paddingHorizontal: 24, gap: 18 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center' },
  dot: { height: 8, borderRadius: 4 },
  laterBtn: { alignItems: 'center', paddingVertical: 4 },
  laterText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
});
