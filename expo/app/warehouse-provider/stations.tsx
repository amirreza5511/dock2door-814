import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  PackageOpen,
  ListChecks,
  Package,
  Truck,
  Archive,
  ShieldCheck,
  ChevronRight,
  Lock,
  User as UserIcon,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { useAuthStore } from '@/store/auth';
import { can, ROLE_LABEL, type CompanyRole, type Permission } from '@/lib/permissions';

interface Station {
  id: string;
  title: string;
  subtitle: string;
  route: '/warehouse-provider/station-receiving' | '/warehouse-provider/station-picking' | '/warehouse-provider/station-packing' | '/warehouse-provider/station-shipping' | '/warehouse-provider/station-inventory' | '/warehouse-provider/station-dock';
  perms: Permission[];
  icon: React.ComponentType<{ size?: number; color?: string }>;
  accent: string;
}

const STATIONS: Station[] = [
  { id: 'recv', title: 'Receiving Station', subtitle: 'ASN check-in · receive · putaway', route: '/warehouse-provider/station-receiving', perms: ['wms.receive', 'wms.putaway'], icon: PackageOpen, accent: C.green },
  { id: 'pick', title: 'Picking Station', subtitle: 'Wave queue · pick lists · exceptions', route: '/warehouse-provider/station-picking', perms: ['orders.pick'], icon: ListChecks, accent: C.blue },
  { id: 'pack', title: 'Packing Station', subtitle: 'Verify · pack · slips', route: '/warehouse-provider/station-packing', perms: ['orders.pack'], icon: Package, accent: C.purple },
  { id: 'ship', title: 'Shipping Station', subtitle: 'Rate shop · labels · manifest', route: '/warehouse-provider/station-shipping', perms: ['orders.ship'], icon: Truck, accent: C.orange },
  { id: 'inv', title: 'Inventory Station', subtitle: 'Cycle count · transfers · adjust', route: '/warehouse-provider/station-inventory', perms: ['wms.cycleCount', 'wms.transfer'], icon: Archive, accent: C.accent },
  { id: 'dock', title: 'Dock / Gate Station', subtitle: 'Check-in · yard moves · POD', route: '/warehouse-provider/station-dock', perms: ['dock.manage'], icon: ShieldCheck, accent: C.red },
];

export default function StationsLauncher() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeCompany } = useActiveCompany();
  const user = useAuthStore((s) => s.user);
  const role: CompanyRole | null = (activeCompany?.role ?? null) as CompanyRole | null;

  const allowed = useMemo(() => {
    return STATIONS.map((s) => ({ ...s, ok: s.perms.some((p) => can(role, p)) || role === 'Owner' || role === 'Manager' || role === 'Supervisor' }));
  }, [role]);

  const onPick = (s: typeof allowed[number]) => {
    if (!s.ok) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(s.route);
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Warehouse Stations</Text>
        <Text style={styles.subtitle}>Open the workstation for your shift.</Text>
        <View style={styles.identity} testID="station-identity">
          <UserIcon size={13} color={C.textMuted} />
          <Text style={styles.identityText}>
            {user?.name ?? user?.email ?? 'Unknown operator'} · {role ? ROLE_LABEL[role] : 'No role'}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 80 }]}>
        {allowed.map((s) => {
          const Icon = s.icon;
          return (
            <TouchableOpacity
              key={s.id}
              testID={`station-${s.id}`}
              activeOpacity={0.85}
              onPress={() => onPick(s)}
              disabled={!s.ok}
              style={[styles.card, !s.ok && styles.cardDisabled]}
            >
              <View style={[styles.iconBox, { backgroundColor: s.accent + '20', borderColor: s.accent + '60' }]}>
                <Icon size={20} color={s.ok ? s.accent : C.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, !s.ok && { color: C.textMuted }]}>{s.title}</Text>
                <Text style={styles.cardSubtitle}>{s.subtitle}</Text>
                {!s.ok ? (
                  <View style={styles.lockRow}>
                    <Lock size={11} color={C.red} />
                    <Text style={styles.lockText}>Requires: {s.perms.join(', ')}</Text>
                  </View>
                ) : null}
              </View>
              {s.ok ? <ChevronRight size={18} color={C.textMuted} /> : <Lock size={16} color={C.textMuted} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 18, paddingBottom: 14, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border, gap: 6 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 12, color: C.textSecondary },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignSelf: 'flex-start' },
  identityText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' as const },
  body: { padding: 16, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardDisabled: { opacity: 0.55 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  cardTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  cardSubtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  lockText: { fontSize: 10, color: C.red, fontWeight: '600' as const },
});
