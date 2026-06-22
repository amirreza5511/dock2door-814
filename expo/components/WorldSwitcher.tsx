import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Boxes, Check, ChevronDown, HardHat } from 'lucide-react-native';
import C from '@/constants/colors';
import { useCurrentWorld } from '@/providers/CurrentWorldProvider';
import { useAuthStore } from '@/store/auth';
import { type Domain, DOMAIN_LABELS, getRoleRoute, isAdminRole } from '@/lib/access';

const WORLD_META: Record<Domain, { icon: typeof HardHat; color: string; bg: string }> = {
  labour: { icon: HardHat, color: C.purple, bg: C.purpleDim },
  logistics: { icon: Boxes, color: C.accent, bg: C.accentDim },
};

/**
 * Header control that lets users with access to more than one world (dual-role
 * users and admins) switch between Labour and Logistics. Pure navigation + UI
 * grouping — it never changes data, permissions, or backend calls.
 */
export default function WorldSwitcher() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { currentWorld, domains, canSwitch, setCurrentWorld } = useCurrentWorld();
  const [open, setOpen] = useState<boolean>(false);

  if (!user || !canSwitch || !currentWorld) {
    return null;
  }

  const active = WORLD_META[currentWorld];
  const ActiveIcon = active.icon;

  const handleSelect = (world: Domain) => {
    setOpen(false);
    if (world === currentWorld) {
      return;
    }
    setCurrentWorld(world);
    // Admins keep their shared admin home; non-admins go to their role's home.
    if (isAdminRole(user.role) || user.isPlatformAdmin) {
      return;
    }
    const destination = getRoleRoute(user.role);
    router.replace(destination as never);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.pill, { backgroundColor: active.bg, borderColor: active.color }]}
        activeOpacity={0.85}
        onPress={() => setOpen(true)}
        testID="world-switcher-pill"
      >
        <ActiveIcon size={14} color={active.color} />
        <Text style={[styles.pillText, { color: active.color }]} numberOfLines={1}>
          {DOMAIN_LABELS[currentWorld]}
        </Text>
        <ChevronDown size={14} color={active.color} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Switch world</Text>
            {domains.map((world) => {
              const meta = WORLD_META[world];
              const Icon = meta.icon;
              const selected = world === currentWorld;
              return (
                <TouchableOpacity
                  key={world}
                  style={[styles.option, selected && styles.optionSelected]}
                  activeOpacity={0.85}
                  onPress={() => handleSelect(world)}
                >
                  <View style={[styles.optionIcon, { backgroundColor: meta.bg }]}>
                    <Icon size={18} color={meta.color} />
                  </View>
                  <Text style={styles.optionText}>{DOMAIN_LABELS[world]}</Text>
                  {selected ? <Check size={18} color={meta.color} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 200,
  },
  pillText: { fontSize: 12, fontWeight: '700' as const, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'center', paddingHorizontal: 32 },
  sheet: {
    backgroundColor: C.cardElevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 10,
  },
  sheetTitle: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary, letterSpacing: 0.5, marginBottom: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 12,
  },
  optionSelected: { borderColor: C.borderLight, backgroundColor: C.bgSecondary },
  optionIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, fontSize: 15, fontWeight: '600' as const, color: C.text },
});
