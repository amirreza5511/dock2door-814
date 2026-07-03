import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, Package, Ship, Zap } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const DIRECTION_COLOR: Record<string, string> = { Import: C.blue, Export: C.green };

export default function DrayageBoardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<'open' | 'mine'>('open');

  const ordersQuery = trpc.drayage.listOrders.useQuery({ filter });
  const assignMutation = trpc.drayage.assignOrder.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.listOrders.invalidate();
      await utils.drayage.dashboard.invalidate();
    },
  });

  const orders = useMemo(() => (ordersQuery.data ?? []) as any[], [ordersQuery.data]);

  const claimOrder = (orderId: string, ref: string) => {
    Alert.alert(
      'Claim this order?',
      'You will be assigned to ' + ref + '. You can then dispatch drivers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Claim',
          onPress: () =>
            void assignMutation
              .mutateAsync({ orderId })
              .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown')),
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Drayage Orders Board</Text>
          <Text style={styles.headerSub}>
            {filter === 'open' ? 'Available to claim' : 'My assigned orders'}
          </Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          onPress={() => setFilter('open')}
          style={[styles.tab, filter === 'open' && styles.tabActive]}
        >
          <Zap size={14} color={filter === 'open' ? C.white : C.textMuted} />
          <Text style={[styles.tabText, filter === 'open' && styles.tabTextActive]}>Open</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFilter('mine')}
          style={[styles.tab, filter === 'mine' && styles.tabActive]}
        >
          <Package size={14} color={filter === 'mine' ? C.white : C.textMuted} />
          <Text style={[styles.tabText, filter === 'mine' && styles.tabTextActive]}>Mine</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={ordersQuery.isFetching}
            onRefresh={() => void ordersQuery.refetch()}
            tintColor={C.accent}
          />
        }
      >
        {ordersQuery.isLoading ? (
          <ScreenFeedback state="loading" title="Loading orders" />
        ) : ordersQuery.isError ? (
          <ScreenFeedback
            state="error"
            title="Unable to load orders"
            onRetry={() => void ordersQuery.refetch()}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Ship}
            title={filter === 'open' ? 'No open orders' : 'No assigned orders'}
            description={
              filter === 'open'
                ? 'When forwarders post container orders, they appear here.'
                : 'Claim an open order to get started.'
            }
          />
        ) : (
          orders.map((o) => (
            <Card key={o.id} style={styles.orderCard}>
              <View style={styles.orderTop}>
                <View
                  style={[
                    styles.dirBadge,
                    { backgroundColor: (DIRECTION_COLOR[o.direction] ?? C.blue) + '20' },
                  ]}
                >
                  <Text
                    style={[styles.dirBadgeText, { color: DIRECTION_COLOR[o.direction] ?? C.blue }]}
                  >
                    {o.direction}
                  </Text>
                </View>
                <StatusBadge status={o.status} />
              </View>

              <Text style={styles.orderRef}>{o.reference_code}</Text>

              <View style={styles.infoGrid}>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Container</Text>
                  <Text style={styles.infoValue}>{o.container_number || 'TBD'}</Text>
                </View>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Size</Text>
                  <Text style={styles.infoValue}>{o.container_size}</Text>
                </View>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Weight</Text>
                  <Text style={styles.infoValue}>
                    {o.weight_kg ? o.weight_kg + 'kg' : '\u2014'}
                  </Text>
                </View>
              </View>

              {o.commodity ? <Text style={styles.commodity}>{o.commodity}</Text> : null}
              {o.bol_number ? (
                <Text style={styles.metaLine}>BOL: {o.bol_number}</Text>
              ) : null}
              {o.booking_number ? (
                <Text style={styles.metaLine}>Booking: {o.booking_number}</Text>
              ) : null}

              {o.port_reservation_date ? (
                <View style={styles.apptRow}>
                  <CalendarClock size={12} color={C.green} />
                  <Text style={styles.apptText}>
                    Port appt: {o.port_reservation_date} {o.port_reservation_time}
                  </Text>
                </View>
              ) : null}

              {o.is_prepull ? (
                <View style={styles.prepullBadge}>
                  <Text style={styles.prepullText}>
                    PREPULL — pickup {o.prepull_pickup_date ?? 'TBD'}
                  </Text>
                </View>
              ) : null}

              {o.is_hazmat || o.is_overweight || o.is_oversized ? (
                <View style={styles.flagsRow}>
                  {o.is_hazmat ? (
                    <Text style={[styles.flag, { color: C.red, backgroundColor: C.redDim }]}>
                      Hazmat
                    </Text>
                  ) : null}
                  {o.is_overweight ? (
                    <Text style={[styles.flag, { color: C.yellow, backgroundColor: C.yellowDim }]}>
                      Overweight
                    </Text>
                  ) : null}
                  {o.is_oversized ? (
                    <Text style={[styles.flag, { color: C.orange, backgroundColor: C.orangeDim }]}>
                      Oversized
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {o.status === 'Open' ? (
                <Button
                  label="Claim this order"
                  onPress={() => claimOrder(o.id, o.reference_code)}
                  loading={assignMutation.isPending}
                  fullWidth
                  size="md"
                />
              ) : (
                <Button
                  label="View details"
                  variant="ghost"
                  onPress={() =>
                    router.push({
                      pathname: '/drayage-company/[orderId]',
                      params: { orderId: o.id },
                    } as never)
                  }
                  fullWidth
                  size="md"
                />
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabActive: { backgroundColor: C.accent, borderColor: C.accent },
  tabText: { fontSize: 13, fontWeight: '700' as const, color: C.textMuted },
  tabTextActive: { color: C.white },
  scroll: { paddingHorizontal: 20, gap: 12 },
  orderCard: { gap: 10 },
  orderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dirBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  dirBadgeText: { fontSize: 11, fontWeight: '800' as const },
  orderRef: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  infoGrid: { flexDirection: 'row', gap: 8 },
  infoCell: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10 },
  infoLabel: {
    fontSize: 10,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  infoValue: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 3 },
  commodity: { fontSize: 13, color: C.textSecondary },
  metaLine: { fontSize: 12, color: C.textMuted },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apptText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  prepullBadge: {
    backgroundColor: C.purpleDim,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  prepullText: { fontSize: 11, fontWeight: '700' as const, color: C.purple },
  flagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' as const },
  flag: {
    fontSize: 10,
    fontWeight: '700' as const,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden' as const,
  },
});
