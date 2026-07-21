import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, BadgeCheck, Plug, X, Check } from 'lucide-react-native';
import C from '@/constants/colors';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { useExploreStore } from '@/store/explore';
import { COURIERS } from '@/constants/couriers';

interface CarrierAccount {
  id: string;
  carrier_code: string;
  display_name?: string;
  account_number?: string;
  mode?: 'test' | 'live';
  is_active?: boolean;
}

export default function ShipCouriers() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isExploring = useExploreStore((s) => s.isExploring);

  const listQuery = trpc.carriers.list.useQuery(undefined, { enabled: !isExploring, retry: false });
  const upsertMut = trpc.carriers.upsert.useMutation();

  const [editing, setEditing] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [mode, setMode] = useState<'test' | 'live'>('test');

  const accounts = (listQuery.data as CarrierAccount[] | undefined) ?? [];
  const byCode = useMemo(() => {
    const m: Record<string, CarrierAccount> = {};
    accounts.forEach((a) => { m[a.carrier_code] = a; });
    return m;
  }, [accounts]);

  const startEdit = (code: string) => {
    const existing = byCode[code];
    setEditing(code);
    setAccountNumber(existing?.account_number ?? '');
    setMode(existing?.mode ?? 'test');
  };

  const save = async (code: string) => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const courier = COURIERS.find((c) => c.code === code);
    try {
      await upsertMut.mutateAsync({
        id: byCode[code]?.id,
        scope: 'company',
        carrierCode: code,
        displayName: courier?.name ?? code,
        accountNumber: accountNumber.trim(),
        mode,
        isActive: true,
      });
      setEditing(null);
      await listQuery.refetch();
    } catch {
      // upsert surfaces its own error
    }
  };

  const toggleActive = async (acc: CarrierAccount) => {
    try {
      await upsertMut.mutateAsync({
        id: acc.id,
        scope: 'company',
        carrierCode: acc.carrier_code,
        displayName: acc.display_name ?? acc.carrier_code,
        accountNumber: acc.account_number ?? '',
        mode: acc.mode ?? 'test',
        isActive: !acc.is_active,
      });
      await listQuery.refetch();
    } catch {
      // ignore
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage couriers</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Connect each courier’s account to switch its prices from estimate to live and buy real labels.
        </Text>

        {isExploring ? (
          <View style={styles.signinCard}>
            <Text style={styles.signinTitle}>Sign in to connect couriers</Text>
            <Text style={styles.signinDesc}>Courier accounts belong to your company. Create an account to manage them.</Text>
            <Button label="Create a free account" onPress={() => router.push('/auth/signup' as never)} />
          </View>
        ) : listQuery.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
        ) : (
          COURIERS.map((c) => {
            const acc = byCode[c.code];
            const connected = Boolean(acc);
            const live = Boolean(acc?.is_active) && acc?.mode === 'live';
            const isEditing = editing === c.code;
            return (
              <View key={c.code} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.badge, { backgroundColor: c.color }]}>
                    <Text style={styles.badgeText}>{c.short}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.sub}>
                      {c.mode === 'aggregator' ? 'Multi-carrier' : 'Direct'} · needs {c.requires.join(', ')}
                    </Text>
                  </View>
                  {connected ? (
                    <View style={[styles.statusPill, { backgroundColor: live ? C.greenDim : C.yellowDim }]}>
                      {live ? <BadgeCheck size={12} color={C.green} /> : null}
                      <Text style={[styles.statusText, { color: live ? C.green : C.yellow }]}>{live ? 'Live' : 'Test'}</Text>
                    </View>
                  ) : (
                    <Text style={styles.notConnected}>Not connected</Text>
                  )}
                </View>

                {isEditing ? (
                  <View style={styles.editBox}>
                    <Input label="Account / key reference" value={accountNumber} onChangeText={setAccountNumber} placeholder="Account number or secret ref" autoCapitalize="none" />
                    <Text style={styles.modeLabel}>MODE</Text>
                    <View style={styles.modeRow}>
                      {(['test', 'live'] as const).map((m) => {
                        const on = mode === m;
                        return (
                          <TouchableOpacity key={m} style={[styles.modeChip, on && styles.modeChipOn]} onPress={() => setMode(m)} activeOpacity={0.85}>
                            <Text style={[styles.modeChipText, on && { color: C.white }]}>{m === 'test' ? 'Test' : 'Live'}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.editActions}>
                      <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} icon={<X size={15} color={C.textSecondary} />} />
                      <Button label={upsertMut.isPending ? 'Saving…' : 'Save'} onPress={() => save(c.code)} loading={upsertMut.isPending} icon={<Check size={15} color={C.white} />} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.linkBtn} onPress={() => startEdit(c.code)} activeOpacity={0.8}>
                      <Plug size={14} color={C.accent} />
                      <Text style={styles.linkText}>{connected ? 'Edit credentials' : 'Connect'}</Text>
                    </TouchableOpacity>
                    {connected ? (
                      <TouchableOpacity style={styles.linkBtn} onPress={() => toggleActive(acc)} activeOpacity={0.8}>
                        <Text style={[styles.linkText, { color: acc.is_active ? C.red : C.green }]}>
                          {acc.is_active ? 'Disable' : 'Enable'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  intro: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: 18 },
  center: { paddingVertical: 60, alignItems: 'center' },
  signinCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 20, alignItems: 'center', gap: 10 },
  signinTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  signinDesc: { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 8 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: C.white, fontSize: 12, fontWeight: '800' as const },
  name: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  sub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  notConnected: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  actionRow: { flexDirection: 'row', gap: 18, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  editBox: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border, gap: 6 },
  modeLabel: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const, letterSpacing: 1, marginTop: 8 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingVertical: 10, alignItems: 'center' },
  modeChipOn: { backgroundColor: C.accent, borderColor: C.accent },
  modeChipText: { fontSize: 13, fontWeight: '700' as const, color: C.textSecondary },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
});
