import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, FileText, MapPin, MessageCircle, Navigation, Package, Phone, Radio, ScanLine, Truck, UserCheck, UserRound, Warehouse, Moon, X } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import BarcodeScannerModal from '@/components/BarcodeScannerModal';
import SignaturePad from '@/components/SignaturePad';
import C from '@/constants/colors';
import { LOAD_STATUS_FLOW, VEHICLE_LABEL, VehicleType } from '@/constants/loads';
import { trpc } from '@/lib/trpc';
import { pickAndUploadFromUri, uploadFileWithMetadata } from '@/lib/storage-files';
import { useAuthStore } from '@/store/auth';

type LoadRow = {
  id: string; vehicle_type: string; pallets: number; delivery_speed: string; status: string;
  pickup_address?: string | null; dropoff_address?: string | null;
  distance_km: number; total_price: number; provider_net: number;
  accepted_driver_user_id?: string | null;
  recipient_name?: string | null; recipient_phone?: string | null;
  uses_hub?: boolean | null; hub_name?: string | null; hub_leg_status?: string | null;
  driver_hold?: boolean | null; driver_hold_fee?: number | null;
  handling_fee?: number | null; storage_per_day?: number | null;
  bol_number?: string | null;
};

type FleetDriver = { id: string; name: string; userId: string | null; email: string | null; phone: string | null; licenseNumber: string | null };

/** A pending advance that needs photo proof before it can be committed. */
type ProofRequest = { load: LoadRow; nextStatus: string; kind: 'pickup' | 'delivery' };

interface Props {
  title?: string;
  /** 'accepted' = carrier/driver runs the trip; 'posted' = shipper tracks read-only. */
  source?: 'accepted' | 'posted';
}

export default function MyLoadsScreen({ title = 'My loads', source = 'accepted' }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const acceptedQuery = trpc.loads.listAccepted.useQuery(undefined, { refetchInterval: 20000, enabled: source === 'accepted' });
  const postedQuery = trpc.loads.listPosted.useQuery(undefined, { refetchInterval: 20000, enabled: source === 'posted' });
  const query = source === 'accepted' ? acceptedQuery : postedQuery;
  const canRun = source === 'accepted';
  const advance = trpc.loads.advance.useMutation({
    onSuccess: async () => { await query.refetch(); },
  });
  const updateLocation = trpc.loads.updateLocation.useMutation();
  const openThread = trpc.messaging.openLoadThread.useMutation();

  // Opens (or reuses) the load conversation and jumps into it. Everyone tied to
  // the load — shipper, assigned driver and the fleet dispatcher — shares it.
  const openLoadChat = async (loadId: string) => {
    try {
      const res = await openThread.mutateAsync({ loadId });
      router.push(`/messages/${res.threadId}` as never);
    } catch (err) {
      Alert.alert('Unable to open chat', err instanceof Error ? err.message : 'Try again.');
    }
  };

  // Tap-to-call the drop-off recipient captured when the load was posted.
  const callRecipient = async (phone: string) => {
    const url = `tel:${phone.replace(/[^+0-9]/g, '')}`;
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (!ok) { Alert.alert('Unable to call', 'Calling is not available on this device.'); return; }
    await Linking.openURL(url);
  };

  const user = useAuthStore((s) => s.user);
  // Only a carrier (trucking) company can dispatch accepted loads to its drivers.
  const canDispatch = source === 'accepted' && user?.role === 'TruckingCompany' && Boolean(user?.companyId);
  const [dispatchFor, setDispatchFor] = useState<string | null>(null);
  const fleetDriversQuery = trpc.loads.fleetDrivers.useQuery(undefined, { enabled: canDispatch });
  const fleetDrivers = useMemo<FleetDriver[]>(() => (fleetDriversQuery.data ?? []) as FleetDriver[], [fleetDriversQuery.data]);
  const dispatch = trpc.loads.dispatch.useMutation({
    onSuccess: async () => { setDispatchFor(null); await query.refetch(); },
  });
  const assignLeg = trpc.loads.assignLeg.useMutation({
    onSuccess: async () => { setDispatchFor(null); await query.refetch(); },
  });
  const driverHold = trpc.loads.driverHold.useMutation({
    onSuccess: async () => { await query.refetch(); },
  });

  // Driver chooses to keep a hub-routed load in their own truck overnight (earns
  // the hub fee themselves) instead of dropping it at the warehouse.
  const toggleTruckHold = (l: LoadRow) => {
    const holding = Boolean(l.driver_hold);
    const bonus = Number(l.handling_fee ?? 0) + Number(l.storage_per_day ?? 0);
    Alert.alert(
      holding ? 'Route through the hub instead?' : 'Hold in your truck overnight?',
      holding
        ? 'This sends the load back through the warehouse hub and removes the hold bonus from your payout.'
        : `Skip the warehouse — keep the goods in your truck and deliver directly next day. You earn the hub fee: +$${bonus.toFixed(2)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: holding ? 'Use hub' : 'Hold it',
          onPress: () => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            driverHold.mutate({ id: l.id, hold: !holding }, {
              onError: (e) => Alert.alert('Unable to update', e instanceof Error ? e.message : 'Error'),
            });
          },
        },
      ],
    );
  };

  // --- Proof capture (pickup / delivery) ---
  const [proof, setProof] = useState<ProofRequest | null>(null);
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState<string>('');
  const [submittingProof, setSubmittingProof] = useState<boolean>(false);
  const [signatureSvg, setSignatureSvg] = useState<string>('');

  // --- Pickup piece scanning ---
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [scanLoadId, setScanLoadId] = useState<string | null>(null);
  const [scanState, setScanState] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 });
  const scanPiece = trpc.loads.scanPiece.useMutation();

  const openScanner = (loadId: string) => {
    setScanLoadId(loadId);
    setScanState({ scanned: 0, total: 0 });
    setScannerOpen(true);
  };

  const handleScanned = (barcode: string) => {
    scanPiece.mutate({ barcode }, {
      onSuccess: (res) => {
        const r = res as { loadId?: string; scannedCount?: number; totalCount?: number; alreadyScanned?: boolean };
        if (scanLoadId && r.loadId && r.loadId !== scanLoadId) {
          Alert.alert('Different shipment', 'That label belongs to another shipment.');
          return;
        }
        setScanState({ scanned: Number(r.scannedCount ?? 0), total: Number(r.totalCount ?? 0) });
      },
      onError: (e) => Alert.alert('Scan failed', e instanceof Error ? e.message : 'Unknown'),
    });
  };

  const loads = useMemo<LoadRow[]>(() => (query.data ?? []) as LoadRow[], [query.data]);
  const active = loads.filter((l) => ['Accepted', 'EnRoute', 'Arrived'].includes(l.status));
  const done = loads.filter((l) => ['Delivered', 'Cancelled'].includes(l.status));

  // --- Live location sharing for the driver while a load is in motion ---
  const [sharing, setSharing] = useState<boolean>(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  // The load currently being moved on the road (EnRoute / Arrived) — its driver shares GPS.
  const trackingLoad = useMemo(
    () => active.find((l) => ['EnRoute', 'Arrived'].includes(l.status) && l.accepted_driver_user_id === user?.id) ?? null,
    [active, user?.id],
  );
  const trackingLoadId = trackingLoad?.id ?? null;

  useEffect(() => {
    if (source !== 'accepted' || Platform.OS === 'web' || !trackingLoadId) {
      try { watchRef.current?.remove(); } catch {}
      watchRef.current = null;
      setSharing(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 30, timeInterval: 8000 },
          (loc) => {
            void updateLocation.mutateAsync({ id: trackingLoadId, lat: loc.coords.latitude, lng: loc.coords.longitude }).catch(() => {});
          },
        );
        if (cancelled) { sub.remove(); return; }
        watchRef.current = sub;
        setSharing(true);
      } catch {
        // Location unavailable — tracking simply won't update; not fatal.
      }
    })();
    return () => {
      cancelled = true;
      try { watchRef.current?.remove(); } catch {}
      watchRef.current = null;
      setSharing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, trackingLoadId]);

  const assignDriver = async (loadId: string, driver: FleetDriver) => {
    if (!driver.userId) {
      Alert.alert('Driver not linked', `${driver.name} isn’t a registered app user yet. Add their account email in Fleet so they can receive dispatched loads.`);
      return;
    }
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const target = loads.find((l) => l.id === loadId);
      if (target?.uses_hub && !target.driver_hold) {
        // Hub loads dispatch by leg: pickup while heading to the hub, delivery
        // once released. Falls through to a normal dispatch otherwise.
        const leg: 'pickup' | 'delivery' = target.hub_leg_status === 'Released' ? 'delivery' : 'pickup';
        await assignLeg.mutateAsync({ id: loadId, leg, driverUserId: driver.userId });
      } else {
        await dispatch.mutateAsync({ id: loadId, driverUserId: driver.userId });
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Unable to dispatch', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const move = async (l: LoadRow) => {
    const flow = LOAD_STATUS_FLOW[l.status];
    if (!flow) return;
    // Proof gates: going EnRoute needs a pickup photo; Delivered needs a delivery photo + receiver.
    if (flow.next === 'EnRoute') { openProof(l, 'EnRoute', 'pickup'); return; }
    if (flow.next === 'Delivered') { openProof(l, 'Delivered', 'delivery'); return; }
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await advance.mutateAsync({ id: l.id, status: flow.next });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Unable to update', err instanceof Error ? err.message : 'Unknown');
    }
  };

  const openProof = (load: LoadRow, nextStatus: string, kind: 'pickup' | 'delivery') => {
    setProof({ load, nextStatus, kind });
    setProofPhoto(null);
    setReceiverName('');
    setSignatureSvg('');
  };

  const pickProofPhoto = async () => {
    const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
    const useCamera = camera?.granted === true && Platform.OS !== 'web';
    const res = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!res.canceled && res.assets[0]) setProofPhoto(res.assets[0].uri);
  };

  const submitProof = async () => {
    if (!proof) return;
    if (!proofPhoto) { Alert.alert(proof.kind === 'pickup' ? 'Take a pickup photo' : 'Take a delivery photo'); return; }
    if (proof.kind === 'delivery' && !receiverName.trim()) { Alert.alert('Receiver name required'); return; }
    setSubmittingProof(true);
    try {
      const ts = Date.now();
      const filename = `${proof.kind}_${proof.load.id}_${ts}.jpg`;
      const meta = await pickAndUploadFromUri({
        uri: proofPhoto,
        bucket: 'attachments',
        path: `load-proof/${proof.load.id}/${filename}`,
        contentType: 'image/jpeg',
        entityType: 'load_proof',
        entityId: proof.load.id,
        companyId: user?.companyId ?? null,
      });

      // Upload the drawn signature (SVG) on delivery, when captured.
      let signaturePath: string | null = null;
      if (proof.kind === 'delivery' && signatureSvg.trim()) {
        const sigBytes = new TextEncoder().encode(signatureSvg);
        const sigMeta = await uploadFileWithMetadata({
          bucket: 'attachments',
          path: `load-proof/${proof.load.id}/signature_${ts}.svg`,
          file: sigBytes,
          contentType: 'image/svg+xml',
          entityType: 'load_signature',
          entityId: proof.load.id,
          companyId: user?.companyId ?? null,
        });
        signaturePath = sigMeta.path;
      }

      await advance.mutateAsync({
        id: proof.load.id,
        status: proof.nextStatus,
        proofPhotoPath: meta.path,
        receiverName: proof.kind === 'delivery' ? receiverName.trim() : null,
        signaturePath,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProof(null);
      setProofPhoto(null);
      setReceiverName('');
      setSignatureSvg('');
    } catch (err) {
      Alert.alert('Unable to submit', err instanceof Error ? err.message : 'Unknown');
    } finally {
      setSubmittingProof(false);
    }
  };

  if (query.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading your trips" /></View>;
  if (query.isError) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="error" title="Unable to load trips" onRetry={() => void query.refetch()} /></View>;

  const renderCard = (l: LoadRow, primary: boolean) => {
    const flow = canRun ? LOAD_STATUS_FLOW[l.status] : undefined;
    const trackable = source === 'posted' && ['Accepted', 'EnRoute', 'Arrived', 'Delivered'].includes(l.status);
    return (
      <Card key={l.id} style={StyleSheet.flatten([styles.card, primary && styles.cardActive])}>
        <View style={styles.cardTop}>
          <View style={styles.vehBadge}><Text style={styles.vehBadgeText}>{VEHICLE_LABEL[l.vehicle_type as VehicleType] ?? l.vehicle_type}</Text></View>
          <StatusBadge status={l.status} />
        </View>
        <View style={styles.routeCol}>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.green }]} /><Text style={styles.routeText} numberOfLines={1}>{l.pickup_address || 'Pickup point'}</Text></View>
          <View style={styles.routeLineRow}><View style={[styles.dot, { backgroundColor: C.red }]} /><Text style={styles.routeText} numberOfLines={1}>{l.dropoff_address || 'Drop-off point'}</Text></View>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.meta}><Package size={12} color={C.textMuted} /><Text style={styles.metaText}>{l.pallets} {l.pallets === 1 ? 'pallet' : 'pallets'}</Text></View>
          <View style={styles.meta}><MapPin size={12} color={C.textMuted} /><Text style={styles.metaText}>{l.distance_km} km</Text></View>
          <Text style={styles.earn}>${Number(source === 'posted' ? l.total_price : l.provider_net).toFixed(2)}</Text>
        </View>
        {flow ? (
          <TouchableOpacity style={[styles.primaryBtn, advance.isPending && { opacity: 0.6 }]} disabled={advance.isPending} onPress={() => void move(l)}>
            <Truck size={15} color={C.white} />
            <Text style={styles.primaryBtnText}>{flow.label}</Text>
            <ChevronRight size={16} color={C.white} />
          </TouchableOpacity>
        ) : l.status === 'Delivered' ? (
          <View style={styles.deliveredRow}><CheckCircle2 size={14} color={C.green} /><Text style={styles.deliveredText}>Delivered</Text></View>
        ) : null}

        {trackable ? (
          <TouchableOpacity style={styles.trackBtn} onPress={() => router.push({ pathname: '/shipper/track', params: { id: l.id } } as never)}>
            <Navigation size={14} color={C.blue} />
            <Text style={styles.trackBtnText}>Track shipment</Text>
            <ChevronRight size={15} color={C.blue} />
          </TouchableOpacity>
        ) : null}

        {source === 'posted' ? (
          <TouchableOpacity style={styles.docBtn} onPress={() => router.push({ pathname: '/shipper/documents', params: { loadId: l.id } } as never)}>
            <FileText size={14} color={C.accent} />
            <Text style={styles.docBtnText}>Labels &amp; BOL{l.bol_number ? ` · ${l.bol_number}` : ''}</Text>
            <ChevronRight size={15} color={C.accent} />
          </TouchableOpacity>
        ) : null}

        {['Accepted', 'EnRoute', 'Arrived', 'Delivered'].includes(l.status) && l.accepted_driver_user_id ? (
          <View style={styles.contactRow}>
            <TouchableOpacity style={styles.contactBtn} disabled={openThread.isPending} onPress={() => void openLoadChat(l.id)}>
              <MessageCircle size={14} color={C.accent} />
              <Text style={styles.contactBtnText}>{source === 'posted' ? 'Message driver' : 'Message shipper'}</Text>
            </TouchableOpacity>
            {source === 'accepted' && (l.recipient_phone ?? '').trim() ? (
              <TouchableOpacity style={[styles.contactBtn, styles.contactBtnCall]} onPress={() => void callRecipient(l.recipient_phone as string)}>
                <Phone size={14} color={C.green} />
                <Text style={[styles.contactBtnText, { color: C.green }]} numberOfLines={1}>Call {l.recipient_name?.trim() || 'recipient'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {canRun && l.uses_hub && (l.hub_leg_status === 'Pending' || l.driver_hold) && ['Accepted', 'EnRoute'].includes(l.status) ? (
          <TouchableOpacity
            style={[styles.holdBtn, l.driver_hold && styles.holdBtnActive]}
            disabled={driverHold.isPending}
            onPress={() => toggleTruckHold(l)}
          >
            <Moon size={14} color={l.driver_hold ? C.white : C.purple} />
            <Text style={[styles.holdBtnText, l.driver_hold && { color: C.white }]}>
              {l.driver_hold
                ? `Holding overnight · +$${(Number(l.handling_fee ?? 0) + Number(l.storage_per_day ?? 0)).toFixed(2)}`
                : 'Hold in my truck overnight'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {l.uses_hub && !l.driver_hold ? (
          <View style={styles.hubTag}>
            <Warehouse size={12} color={C.blue} />
            <Text style={styles.hubTagText} numberOfLines={1}>
              Via hub{l.hub_name ? ` · ${l.hub_name}` : ''}{l.hub_leg_status && l.hub_leg_status !== 'None' ? ` · ${l.hub_leg_status}` : ''}
            </Text>
          </View>
        ) : null}

        {canDispatch && ['Accepted', 'EnRoute', 'Arrived'].includes(l.status) ? (
          <TouchableOpacity style={styles.dispatchBtn} onPress={() => setDispatchFor(l.id)}>
            <UserCheck size={14} color={C.accent} />
            <Text style={styles.dispatchBtnText}>
              {l.uses_hub ? 'Assign leg to driver' : (l.accepted_driver_user_id ? 'Reassign driver' : 'Dispatch to driver')}
            </Text>
          </TouchableOpacity>
        ) : null}

      </Card>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={18} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      {sharing ? (
        <View style={styles.shareBar}>
          <Radio size={13} color={C.green} />
          <Text style={styles.shareBarText}>Sharing your live location with the shipper</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={C.accent} />}
      >
        {loads.length === 0 ? (
          <EmptyState icon={Truck} title={source === 'posted' ? 'No posted loads yet' : 'No accepted loads yet'} description={source === 'posted' ? 'Post a load and track its progress here as a driver picks it up.' : 'Accept a load from the marketplace and it will show up here to run.'} />
        ) : null}

        {active.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Active</Text>
            {active.map((l, i) => renderCard(l, i === 0))}
          </>
        ) : null}

        {done.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>History</Text>
            {done.map((l) => renderCard(l, false))}
          </>
        ) : null}
      </ScrollView>

      {/* Proof of pickup / delivery */}
      <Modal visible={proof !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setProof(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{proof?.kind === 'pickup' ? 'Proof of pickup' : 'Proof of delivery'}</Text>
            <TouchableOpacity onPress={() => setProof(null)} style={styles.iconBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.proofHint}>
              {proof?.kind === 'pickup'
                ? 'Take a photo of the cargo at pickup before you start the trip.'
                : 'Take a photo at the drop-off and enter who received the shipment.'}
            </Text>
            {proof?.kind === 'pickup' ? (
              <TouchableOpacity style={styles.scanCta} onPress={() => proof && openScanner(proof.load.id)}>
                <ScanLine size={18} color={C.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanCtaTitle}>Scan the piece labels</Text>
                  <Text style={styles.scanCtaDesc}>
                    {scanLoadId === proof.load.id && scanState.total > 0
                      ? `${scanState.scanned} of ${scanState.total} scanned`
                      : 'Scan each pallet/box QR at pickup'}
                  </Text>
                </View>
                <ChevronRight size={16} color={C.accent} />
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity onPress={() => void pickProofPhoto()} style={styles.photoBox}>
              {proofPhoto ? (
                <Image source={{ uri: proofPhoto }} style={styles.photoPreview} contentFit="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Camera size={30} color={C.accent} />
                  <Text style={styles.photoHint}>{Platform.OS === 'web' ? 'Choose a photo' : 'Take photo'}</Text>
                </View>
              )}
            </TouchableOpacity>
            {proofPhoto ? (
              <Button label="Retake photo" onPress={() => void pickProofPhoto()} variant="secondary" icon={<Camera size={14} color={C.text} />} />
            ) : null}

            {proof?.kind === 'delivery' ? (
              <>
                <Input label="Received by" value={receiverName} onChangeText={setReceiverName} placeholder="Name of person who received it" />
                <Text style={styles.sigLabel}>Receiver signature</Text>
                <SignaturePad onChange={setSignatureSvg} />
              </>
            ) : null}

            <Button
              label={proof?.kind === 'pickup' ? 'Confirm pickup & start trip' : 'Confirm delivery'}
              onPress={() => void submitProof()}
              loading={submittingProof || advance.isPending}
              fullWidth
              size="lg"
              icon={<CheckCircle2 size={16} color={C.white} />}
            />
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={dispatchFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDispatchFor(null)}>
        <View style={[styles.modal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Dispatch to driver</Text>
            <TouchableOpacity onPress={() => setDispatchFor(null)} style={styles.iconBtn}><X size={18} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {fleetDriversQuery.isLoading ? (
              <ScreenFeedback state="loading" title="Loading your drivers" />
            ) : fleetDrivers.length === 0 ? (
              <EmptyState icon={UserRound} title="No drivers in your fleet" description="Add drivers under Fleet (with their account email) so you can dispatch loads to them." />
            ) : (
              fleetDrivers.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.driverRow, !d.userId && styles.driverRowDisabled]}
                  disabled={dispatch.isPending || assignLeg.isPending}
                  onPress={() => { if (dispatchFor) void assignDriver(dispatchFor, d); }}
                >
                  <View style={styles.driverIcon}><UserRound size={16} color={d.userId ? C.green : C.textMuted} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{d.name}</Text>
                    <Text style={styles.driverMeta}>
                      {d.userId ? (d.licenseNumber || d.phone || 'Ready for dispatch') : 'Not a registered app user — add their email in Fleet'}
                    </Text>
                  </View>
                  {d.userId ? <ChevronRight size={16} color={C.textMuted} /> : null}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={handleScanned}
        title="Scan pickup labels"
        subtitle="Point at each pallet/box QR code"
        progress={scanState.total > 0 ? `${scanState.scanned} of ${scanState.total} scanned` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  docBtnText: { flex: 1, fontSize: 13, fontWeight: '700' as const, color: C.accent },
  scanCta: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55', borderRadius: 12, padding: 14 },
  scanCtaTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  scanCtaDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  sigLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text, marginBottom: -2 },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  shareBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.greenDim, borderBottomWidth: 1, borderBottomColor: C.green + '40' },
  shareBarText: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  scroll: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '800' as const, color: C.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  card: { gap: 10 },
  cardActive: { borderColor: C.accent, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vehBadge: { backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  vehBadgeText: { fontSize: 11, fontWeight: '800' as const, color: C.blue },
  routeCol: { gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 13, color: C.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  earn: { marginLeft: 'auto', fontSize: 15, fontWeight: '800' as const, color: C.green },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13 },
  primaryBtnText: { flex: 1, textAlign: 'center' as const, color: C.white, fontSize: 14, fontWeight: '800' as const },
  deliveredRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 4 },
  deliveredText: { fontSize: 13, color: C.green, fontWeight: '700' as const },
  trackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, backgroundColor: C.blueDim, borderWidth: 1, borderColor: C.blue + '55' },
  trackBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.blue },
  contactRow: { flexDirection: 'row', gap: 8 },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '55' },
  contactBtnCall: { backgroundColor: C.greenDim, borderColor: C.green + '55' },
  contactBtnText: { fontSize: 12.5, fontWeight: '800' as const, color: C.accent },
  dispatchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent },
  dispatchBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.accent },
  holdBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, backgroundColor: C.purpleDim, borderWidth: 1, borderColor: C.purple + '55' },
  holdBtnActive: { backgroundColor: C.purple, borderColor: C.purple },
  holdBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.purple },
  hubTag: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  hubTagText: { fontSize: 11, fontWeight: '700' as const, color: C.blue },
  modal: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  modalBody: { padding: 20, gap: 14 },
  proofHint: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  photoBox: { height: 200, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  photoPreview: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoHint: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14 },
  driverRowDisabled: { opacity: 0.55 },
  driverIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenDim },
  driverName: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  driverMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
