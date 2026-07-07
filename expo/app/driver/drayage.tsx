import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform, Modal } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Anchor, CalendarClock, Camera, ChevronRight, Clock, HelpCircle, ImageIcon, LogOut, MapPin, MessageCircle, Package, Play, Radio, Ship, Truck, X, CheckCircle2, Navigation, Users } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { pickAndUploadFromUri } from '@/lib/storage-files';

type WorkOrder = {
  id: string;
  move_type: string;
  status: string;
  appt_date?: string | null;
  appt_time?: string;
  from_address?: string;
  to_address?: string;
  from_terminal_id?: string | null;
  to_terminal_id?: string | null;
  drayage_orders?: any;
  order_id: string;
};

const MOVE_NEXT: Record<string, { label: string; status: string; icon: any }> = {
  Assigned: { label: 'Start trip', status: 'EnRoute', icon: Play },
  EnRoute: { label: 'Arrived at pickup', status: 'AtOrigin', icon: MapPin },
  AtOrigin: { label: 'Container loaded', status: 'Loaded', icon: Package },
  Loaded: { label: 'In transit', status: 'InTransit', icon: Truck },
  InTransit: { label: 'At destination', status: 'AtDestination', icon: Navigation },
  AtDestination: { label: 'Container dropped', status: 'Unloaded', icon: CheckCircle2 },
  Unloaded: { label: 'Complete', status: 'Completed', icon: CheckCircle2 },
};

export default function DriverDrayageWorkOrders() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const utils = trpc.useUtils();
  const ordersQuery = trpc.drayage.driverWorkOrders.useQuery(undefined, { refetchInterval: 15000 });
  const advanceMutation = trpc.drayage.advanceMove.useMutation({
    onSuccess: async () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.drayage.driverWorkOrders.invalidate();
    },
  });
  const pingMutation = trpc.drayage.pingLocation.useMutation();
  const openThreadMutation = trpc.drayage.openThread.useMutation();

  // Join a fleet by code (for drivers created without a fleet code at signup)
  const [joinVisible, setJoinVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const joinMutation = trpc.operations.joinFleetByCode.useMutation({
    onSuccess: async (res: { companyName: string }) => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJoinVisible(false);
      setJoinCode('');
      await utils.drayage.driverWorkOrders.invalidate();
      Alert.alert('Joined fleet', `You're now linked to ${res.companyName}. Dispatch can assign you container moves.`);
    },
    onError: (e: Error) => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Unable to join', e.message);
    },
  });

  const submitJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) { Alert.alert('Fleet code required', 'Enter the code your drayage company shared with you.'); return; }
    void joinMutation.mutateAsync({ code });
  };

  const messageDispatch = React.useCallback((order: WorkOrder) => {
    void openThreadMutation
      .mutateAsync({ orderId: order.order_id })
      .then((res) => router.push(`/messages/${res.threadId}` as never))
      .catch((e) => Alert.alert('Unable to open chat', e instanceof Error ? e.message : 'Unknown'));
  }, [openThreadMutation, router]);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [terminals, setTerminals] = useState<any[]>([]);
  const watchRef = React.useRef<Location.LocationSubscription | null>(null);

  // Proof capture (pickup = Loaded, delivery = AtDestination)
  const [proofOrder, setProofOrder] = useState<WorkOrder | null>(null);
  const [proofKind, setProofKind] = useState<'pickup' | 'delivery'>('pickup');
  const [proofNextStatus, setProofNextStatus] = useState<string>('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [containerNumberInput, setContainerNumberInput] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);

  React.useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('terminals').select('*').eq('is_active', true);
      setTerminals(data ?? []);
    })();
  }, []);

  const terminalName = (id: string | null) => {
    if (!id) return null;
    const t = terminals.find((t) => t.id === id);
    return t ? `${t.name} (${t.code})` : null;
  };

  const stopShareLocation = React.useCallback(() => {
    try { watchRef.current?.remove(); } catch {}
    watchRef.current = null;
    setSharingLocation(false);
  }, []);

  const toggleShareLocation = async (activeOrder: WorkOrder | null) => {
    if (sharingLocation) { stopShareLocation(); return; }
    if (!activeOrder) { Alert.alert('No active order', 'Start a trip first to share location.'); return; }
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Not supported', 'Live GPS sharing is available on iOS and Android only.');
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Enable Location to share your live position with dispatch.');
        return;
      }
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 15000 },
        (loc) => {
          void pingMutation.mutateAsync({
            orderId: activeOrder.order_id,
            moveId: activeOrder.id,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            heading: loc.coords.heading ?? 0,
            speedKph: loc.coords.speed ? Math.round(loc.coords.speed * 3.6) : 0,
            accuracy: loc.coords.accuracy ?? null,
          }).catch(() => {});
        },
      );
      watchRef.current = sub;
      setSharingLocation(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Unable to start GPS', err instanceof Error ? err.message : 'Unknown');
    }
  };

  React.useEffect(() => () => stopShareLocation(), [stopShareLocation]);

  const orders = useMemo(() => (ordersQuery.data ?? []) as WorkOrder[], [ordersQuery.data]);

  const partitioned = useMemo(() => {
    const active: WorkOrder[] = [];
    const upcoming: WorkOrder[] = [];
    const done: WorkOrder[] = [];
    for (const o of orders) {
      if (o.status === 'Completed' || o.status === 'Cancelled') done.push(o);
      else if (['EnRoute', 'AtOrigin', 'Loaded', 'InTransit', 'AtDestination', 'Unloaded'].includes(o.status)) active.push(o);
      else upcoming.push(o);
    }
    return { active, upcoming, done };
  }, [orders]);

  const openProof = (order: WorkOrder, kind: 'pickup' | 'delivery', nextStatus: string) => {
    setProofOrder(order);
    setProofKind(kind);
    setProofNextStatus(nextStatus);
    setPhotoUri(null);
    setContainerNumberInput(order.drayage_orders?.container_number ?? '');
    setReceiverName('');
  };

  const closeProof = () => {
    setProofOrder(null);
    setPhotoUri(null);
    setContainerNumberInput('');
    setReceiverName('');
  };

  const pickProofPhoto = async () => {
    try {
      const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
      const useCamera = camera?.granted === true && Platform.OS !== 'web';
      const res = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, mediaTypes: ['images'] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
      if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
    } catch (err) {
      Alert.alert('Camera error', err instanceof Error ? err.message : 'Unable to open camera');
    }
  };

  const submitProof = async () => {
    if (!proofOrder) return;
    if (!photoUri) { Alert.alert('Photo required', `Take a ${proofKind} photo of the container to continue.`); return; }
    if (proofKind === 'delivery' && !receiverName.trim()) { Alert.alert('Receiver required', 'Enter who received the container.'); return; }
    setUploadingProof(true);
    try {
      const filename = `drayage_${proofKind}_${proofOrder.id}_${Date.now()}.jpg`;
      const meta = await pickAndUploadFromUri({
        uri: photoUri,
        bucket: 'attachments',
        path: `drayage/${proofOrder.order_id}/${filename}`,
        contentType: 'image/jpeg',
        entityType: 'drayage_move_proof',
        entityId: proofOrder.id,
        companyId: user?.companyId ?? null,
      });
      await advanceMutation.mutateAsync({
        moveId: proofOrder.id,
        nextStatus: proofNextStatus,
        proofPhotoPath: meta.path,
        containerNumber: proofKind === 'pickup' ? containerNumberInput.trim() || null : null,
        receiverName: proofKind === 'delivery' ? receiverName.trim() : null,
      });
      closeProof();
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleAdvance = (order: WorkOrder) => {
    const next = MOVE_NEXT[order.status];
    if (!next) return;
    // Require proof capture on the pickup (Loaded) and delivery (AtDestination) legs.
    if (next.status === 'Loaded') { openProof(order, 'pickup', next.status); return; }
    if (next.status === 'AtDestination') { openProof(order, 'delivery', next.status); return; }
    Alert.alert(next.label, 'Confirm this action?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void advanceMutation.mutateAsync({ moveId: order.id, nextStatus: next.status }).catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown')) },
    ]);
  };

  const renderCard = (order: WorkOrder, primary: boolean) => {
    const next = MOVE_NEXT[order.status];
    const NextIcon = next?.icon;
    const o = order.drayage_orders;
    return (
      <View key={order.id} style={[styles.jobCard, primary && styles.jobCardActive]}>
        <View style={styles.jobHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.jobTitle}>{order.move_type}</Text>
            <Text style={styles.jobRef}>{o?.reference_code ?? '—'}</Text>
            <View style={styles.metaRow}>
              <Ship size={11} color={C.textMuted} />
              <Text style={styles.metaText}>{o?.container_number || 'Container TBD'} · {o?.container_size}</Text>
            </View>
            {order.appt_date ? (
              <View style={styles.metaRow}>
                <CalendarClock size={11} color={C.green} />
                <Text style={[styles.metaText, { color: C.green }]}>Appt: {order.appt_date} {order.appt_time}</Text>
              </View>
            ) : null}
          </View>
          <StatusBadge status={order.status} />
        </View>

        {/* Route */}
        <View style={styles.routeBox}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: C.blue }]} />
            <Text style={styles.routeText} numberOfLines={1}>
              {terminalName(order.from_terminal_id ?? null) ?? order.from_address ?? 'Pickup'}
            </Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: C.green }]} />
            <Text style={styles.routeText} numberOfLines={1}>
              {terminalName(order.to_terminal_id ?? null) ?? order.to_address ?? 'Destination'}
            </Text>
          </View>
        </View>

        {/* Commodity flags */}
        {o?.is_hazmat || o?.is_overweight ? (
          <View style={styles.flagsRow}>
            {o?.is_hazmat ? <Text style={[styles.flag, { color: C.red, backgroundColor: C.redDim }]}>Hazmat</Text> : null}
            {o?.is_overweight ? <Text style={[styles.flag, { color: C.yellow, backgroundColor: C.yellowDim }]}>Overweight</Text> : null}
          </View>
        ) : null}

        {primary && next ? (
          <TouchableOpacity
            onPress={() => handleAdvance(order)}
            disabled={advanceMutation.isPending}
            style={[styles.primaryBtn, advanceMutation.isPending && { opacity: 0.6 }]}
          >
            {NextIcon ? <NextIcon size={16} color={C.white} /> : null}
            <Text style={styles.primaryBtnText}>{next.label}</Text>
            <ChevronRight size={16} color={C.white} />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={() => messageDispatch(order)}
          disabled={openThreadMutation.isPending}
          style={[styles.msgBtn, openThreadMutation.isPending && { opacity: 0.6 }]}
        >
          <MessageCircle size={15} color={C.accent} />
          <Text style={styles.msgBtnText}>Message dispatch</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (ordersQuery.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading work orders" /></View>;
  if (ordersQuery.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load work orders" onRetry={() => void ordersQuery.refetch()} /></View>;

  const activeOrder = partitioned.active[0] ?? null;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={ordersQuery.isFetching} onRefresh={() => void ordersQuery.refetch()} tintColor={C.accent} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>Drayage Work Orders</Text>
              <Text style={styles.heroTitle}>{user?.name}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/help' as never)} style={styles.helpBtn}>
              <HelpCircle size={16} color={C.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
              <LogOut size={16} color={C.red} />
            </TouchableOpacity>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>{partitioned.active.length}</Text><Text style={styles.heroStatLabel}>Active</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>{partitioned.upcoming.length}</Text><Text style={styles.heroStatLabel}>Upcoming</Text></View>
            <View style={styles.heroStat}><Text style={[styles.heroStatValue, { color: C.green }]}>{partitioned.done.length}</Text><Text style={styles.heroStatLabel}>Done</Text></View>
          </View>
        </View>

        {/* Join a fleet */}
        <TouchableOpacity style={styles.joinBtn} onPress={() => { setJoinCode(''); setJoinVisible(true); }} activeOpacity={0.85}>
          <Users size={16} color={C.blue} />
          <View style={{ flex: 1 }}>
            <Text style={styles.joinBtnTitle}>Join a drayage fleet</Text>
            <Text style={styles.joinBtnDesc}>Enter your company's fleet code to get assigned work</Text>
          </View>
          <ChevronRight size={16} color={C.textMuted} />
        </TouchableOpacity>

        {/* GPS share */}
        <TouchableOpacity
          style={[styles.gpsBtn, sharingLocation && styles.gpsBtnActive]}
          onPress={() => toggleShareLocation(activeOrder)}
        >
          <Radio size={14} color={sharingLocation ? C.white : C.accent} />
          <Text style={[styles.gpsBtnText, sharingLocation && { color: C.white }]}>
            {sharingLocation ? 'Sharing GPS — tap to stop' : 'Share Live Location'}
          </Text>
        </TouchableOpacity>

        {/* Active */}
        {partitioned.active.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Truck size={14} color={C.accent} />
              <Text style={[styles.sectionTitle, { color: C.accent }]}>Now</Text>
            </View>
            {partitioned.active.map((o) => renderCard(o, o === activeOrder))}
          </>
        ) : null}

        {/* Upcoming */}
        {partitioned.upcoming.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <Clock size={14} color={C.textSecondary} />
              <Text style={styles.sectionTitle}>Upcoming</Text>
            </View>
            {partitioned.upcoming.map((o) => renderCard(o, partitioned.active.length === 0))}
          </>
        ) : null}

        {/* Done */}
        {partitioned.done.length > 0 ? (
          <>
            <View style={styles.sectionHeader}>
              <CheckCircle2 size={14} color={C.textMuted} />
              <Text style={[styles.sectionTitle, { color: C.textMuted }]}>Completed</Text>
            </View>
            {partitioned.done.slice(0, 10).map((o) => renderCard(o, false))}
          </>
        ) : null}

        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Anchor size={44} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No work orders yet</Text>
            <Text style={styles.emptyText}>Not seeing any moves? Make sure you've joined your drayage company's fleet using their fleet code.</Text>
            <Button label="Join a fleet" onPress={() => { setJoinCode(''); setJoinVisible(true); }} variant="secondary" icon={<Users size={14} color={C.text} />} />
          </View>
        ) : null}
      </ScrollView>

      {/* Join fleet modal */}
      <Modal visible={joinVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setJoinVisible(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Join a drayage fleet</Text>
            <TouchableOpacity onPress={() => setJoinVisible(false)} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalSub}>
              Ask your drayage company for their fleet code — they'll find it on their Fleet screen under the Drivers tab. Enter it below to link your account so dispatch can assign you container moves.
            </Text>
            <Input label="Fleet code" value={joinCode} onChangeText={setJoinCode} placeholder="e.g. 7KQ4MP" autoCapitalize="characters" />
            <Button
              label="Join fleet"
              onPress={submitJoin}
              loading={joinMutation.isPending}
              fullWidth
              size="lg"
              icon={<Users size={16} color={C.white} />}
            />
            <Button label="Cancel" onPress={() => setJoinVisible(false)} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>

      {/* Proof capture modal */}
      <Modal visible={proofOrder !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeProof}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{proofKind === 'pickup' ? 'Pickup Proof' : 'Delivery Proof'}</Text>
            <TouchableOpacity onPress={closeProof} style={styles.closeBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalSub}>
              {proofKind === 'pickup'
                ? 'Photograph the loaded container and confirm its number before marking it picked up.'
                : 'Photograph the delivered container and record who received it.'}
            </Text>

            <Text style={styles.proofLabel}>Photo</Text>
            <TouchableOpacity onPress={() => void pickProofPhoto()} style={styles.photoBox}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Camera size={32} color={C.accent} />
                  <Text style={styles.photoHint}>Tap to take container photo</Text>
                </View>
              )}
            </TouchableOpacity>
            {photoUri ? (
              <Button label="Retake photo" onPress={() => void pickProofPhoto()} variant="secondary" icon={<ImageIcon size={14} color={C.text} />} />
            ) : null}

            {proofKind === 'pickup' ? (
              <Input label="Container number" value={containerNumberInput} onChangeText={setContainerNumberInput} placeholder="e.g. TCLU1234567" autoCapitalize="characters" />
            ) : (
              <Input label="Received by" value={receiverName} onChangeText={setReceiverName} placeholder="Receiver name" />
            )}

            <Button
              label={proofKind === 'pickup' ? 'Confirm pickup' : 'Confirm delivery'}
              onPress={() => void submitProof()}
              loading={uploadingProof || advanceMutation.isPending}
              fullWidth
              size="lg"
              icon={<CheckCircle2 size={16} color={C.white} />}
            />
            <Button label="Cancel" onPress={closeProof} variant="ghost" fullWidth />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 16, gap: 14 },
  hero: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 18, gap: 6 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greeting: { fontSize: 12, color: C.textMuted, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  heroTitle: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  heroStats: { flexDirection: 'row', gap: 10, marginTop: 10 },
  heroStat: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 12, padding: 12, alignItems: 'center' },
  heroStatValue: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  heroStatLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  helpBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent + '15', borderWidth: 1, borderColor: C.accent + '40', alignItems: 'center', justifyContent: 'center' },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.red + '15', borderWidth: 1, borderColor: C.red + '40', alignItems: 'center', justifyContent: 'center' },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.blue + '40', padding: 14 },
  joinBtnTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  joinBtnDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.accent, paddingVertical: 14 },
  gpsBtnActive: { backgroundColor: C.accent, borderColor: C.accent },
  gpsBtnText: { fontSize: 14, fontWeight: '700' as const, color: C.accent },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  jobCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  jobCardActive: { borderColor: C.accent, borderWidth: 2 },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  jobTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  jobRef: { fontSize: 12, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' as const },
  metaText: { fontSize: 11, color: C.textSecondary },
  routeBox: { backgroundColor: C.bgSecondary, borderRadius: 10, padding: 10, gap: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeLine: { marginLeft: 3, height: 12, width: 2, backgroundColor: C.border },
  routeText: { flex: 1, fontSize: 12, color: C.text },
  flagsRow: { flexDirection: 'row', gap: 6 },
  flag: { fontSize: 10, fontWeight: '700' as const, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' as const },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 14 },
  msgBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent + '15', borderRadius: 12, borderWidth: 1, borderColor: C.accent + '40', paddingVertical: 11 },
  msgBtnText: { fontSize: 13, fontWeight: '700' as const, color: C.accent },
  primaryBtnText: { flex: 1, textAlign: 'center' as const, color: C.white, fontSize: 15, fontWeight: '800' as const },
  empty: { alignItems: 'center' as const, paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const, maxWidth: 280 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: 20, gap: 12, paddingBottom: 60 },
  modalSub: { fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  proofLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 4 },
  photoBox: { height: 200, borderRadius: 14, overflow: 'hidden' as const, borderWidth: 2, borderStyle: 'dashed' as const, borderColor: C.border, backgroundColor: C.card },
  photoPlaceholder: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8 },
  photoPreview: { width: '100%' as const, height: '100%' as const },
  photoHint: { fontSize: 12, color: C.textSecondary },
});
