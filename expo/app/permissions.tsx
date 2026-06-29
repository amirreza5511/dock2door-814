import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Camera, Mic, Image as ImageIcon, Users, MapPin, ShieldCheck, Check, X, ChevronLeft, ChevronRight,
} from 'lucide-react-native';
import C from '@/constants/colors';
import {
  type PermissionKey, type PermissionState,
  getAllPermissions, requestPermission,
} from '@/lib/device-permissions';

interface PermItem {
  key: PermissionKey;
  icon: typeof Camera;
  title: string;
  desc: string;
  color: string;
  dim: string;
}

const ITEMS: PermItem[] = [
  { key: 'camera', icon: Camera, title: 'Camera', desc: 'Capture proof-of-delivery, documents, and profile photos.', color: C.accent, dim: C.accentDim },
  { key: 'photos', icon: ImageIcon, title: 'Photos & Gallery', desc: 'Attach images and documents from your library.', color: C.blue, dim: C.blueDim },
  { key: 'microphone', icon: Mic, title: 'Microphone', desc: 'Record voice notes and talk to the AI assistant.', color: C.purple, dim: C.purpleDim },
  { key: 'contacts', icon: Users, title: 'Contacts', desc: 'Quickly invite teammates, drivers, and workers.', color: C.green, dim: C.greenDim },
  { key: 'location', icon: MapPin, title: 'Location', desc: 'Verify worksite check-in and share live truck position.', color: C.yellow, dim: C.yellowDim },
];

const ORDER: readonly PermissionKey[] = ['camera', 'photos', 'microphone', 'contacts', 'location'];

function StatusPill({ state }: { state: PermissionState }) {
  if (state === 'granted') {
    return (
      <View style={[styles.pill, { backgroundColor: C.greenDim }]}>
        <Check size={13} color={C.green} />
        <Text style={[styles.pillText, { color: C.green }]}>Allowed</Text>
      </View>
    );
  }
  if (state === 'denied') {
    return (
      <View style={[styles.pill, { backgroundColor: C.redDim }]}>
        <X size={13} color={C.red} />
        <Text style={[styles.pillText, { color: C.red }]}>Blocked</Text>
      </View>
    );
  }
  if (state === 'unsupported') {
    return (
      <View style={[styles.pill, { backgroundColor: C.cardElevated }]}>
        <Text style={[styles.pillText, { color: C.textMuted }]}>N/A on web</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: C.accentDim }]}>
      <Text style={[styles.pillText, { color: C.accent }]}>Allow</Text>
      <ChevronRight size={13} color={C.accent} />
    </View>
  );
}

export default function PermissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [states, setStates] = useState<Record<PermissionKey, PermissionState> | null>(null);
  const [busy, setBusy] = useState<PermissionKey | 'all' | null>(null);

  const refresh = useCallback(async () => {
    const next = await getAllPermissions(ORDER);
    setStates(next);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const ask = useCallback(async (key: PermissionKey) => {
    setBusy(key);
    try {
      const res = await requestPermission(key);
      setStates((prev) => ({ ...(prev ?? {} as Record<PermissionKey, PermissionState>), [key]: res }));
    } finally {
      setBusy(null);
    }
  }, []);

  const askAll = useCallback(async () => {
    setBusy('all');
    try {
      const next = { ...(states ?? {} as Record<PermissionKey, PermissionState>) };
      for (const key of ORDER) {
        if (next[key] === 'granted' || next[key] === 'unsupported') continue;
        next[key] = await requestPermission(key);
      }
      setStates(next);
    } finally {
      setBusy(null);
    }
  }, [states]);

  const grantedCount = states ? ORDER.filter((k) => states[k] === 'granted').length : 0;
  const actionable = states ? ORDER.filter((k) => states[k] === 'undetermined').length : 0;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIcon}>
            <ShieldCheck size={18} color={C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>App Permissions</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{grantedCount}/{ORDER.length} allowed</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Dock2Door asks for these only when you use a feature. You can change them anytime in your phone settings.
        </Text>

        {!states ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : (
          ITEMS.map((item) => {
            const Icon = item.icon;
            const state = states[item.key];
            const isBusy = busy === item.key || busy === 'all';
            const canAsk = state === 'undetermined';
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.card}
                activeOpacity={canAsk ? 0.8 : 1}
                disabled={!canAsk || isBusy}
                onPress={() => void ask(item.key)}
              >
                <View style={[styles.cardIcon, { backgroundColor: item.dim }]}>
                  <Icon size={20} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDesc}>{item.desc}</Text>
                </View>
                {isBusy && canAsk ? <ActivityIndicator color={C.accent} /> : <StatusPill state={state} />}
              </TouchableOpacity>
            );
          })
        )}

        {states && Platform.OS !== 'web' && (
          <Text style={styles.note}>
            Blocked something by mistake? Open your phone&apos;s Settings → Dock2Door to turn it back on.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, (actionable === 0 || busy === 'all') && { opacity: 0.6 }]}
          activeOpacity={0.9}
          disabled={actionable === 0 || busy === 'all'}
          onPress={() => void askAll()}
        >
          {busy === 'all' ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={styles.primaryBtnText}>
              {actionable === 0 ? 'All set' : `Allow all (${actionable})`}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.8} onPress={() => router.back()}>
          <Text style={styles.secondaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingBottom: 14,
    backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },

  scroll: { padding: 16, gap: 10 },
  intro: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: 4 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  cardDesc: { fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 16 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 9 },
  pillText: { fontSize: 12, fontWeight: '700' as const },

  note: { fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 8, textAlign: 'center' as const },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, gap: 8,
    backgroundColor: C.bgSecondary, borderTopWidth: 1, borderTopColor: C.border,
  },
  primaryBtn: {
    height: 52, borderRadius: 14, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800' as const, color: C.white },
  secondaryBtn: { height: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' as const, color: C.textSecondary },
});
