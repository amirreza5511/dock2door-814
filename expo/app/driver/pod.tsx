import React, { useMemo, useRef, useState } from 'react';
import { Alert, PanResponder, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Svg, { Polyline } from 'react-native-svg';
import { Camera, Check, ClipboardCheck, FileCheck2, ImageIcon, PenLine, Trash2 } from 'lucide-react-native';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import StatusBadge from '@/components/ui/StatusBadge';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { pickAndUploadFromUri } from '@/lib/storage-files';
import { useAuthStore } from '@/store/auth';

type JobRow = { id: string; appointment_type: string; status: string; scheduled_start: string; truck_plate?: string | null; dock_door?: string | null; data?: { podFileId?: string | null } | null };

export default function DriverPodScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId?: string }>();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();
  const jobsQuery = trpc.operations.driverJobs.useQuery();
  const attachMutation = trpc.pod.attach.useMutation({
    onSuccess: async () => {
      await utils.operations.driverJobs.invalidate();
      await utils.pod.list.invalidate();
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(params.appointmentId ?? null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [signaturePoints, setSignaturePoints] = useState<string[]>([]);
  const [currentStroke, setCurrentStroke] = useState<string>('');
  const [signerName, setSignerName] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const padRef = useRef<View>(null);

  const jobs = useMemo<JobRow[]>(() => (jobsQuery.data ?? []) as JobRow[], [jobsQuery.data]);
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);
  const completable = useMemo(() => jobs.filter((j) => ['AtDoor', 'Loading', 'Unloading', 'Completed'].includes(j.status)), [jobs]);

  const podQuery = trpc.pod.list.useQuery({ appointmentId: selectedId ?? undefined }, { enabled: Boolean(selectedId) });

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      setCurrentStroke(`${locationX},${locationY}`);
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      setCurrentStroke((prev) => `${prev} ${locationX},${locationY}`);
    },
    onPanResponderRelease: () => {
      setSignaturePoints((prev) => (currentStroke ? [...prev, currentStroke] : prev));
      setCurrentStroke('');
    },
  }), [currentStroke]);

  const pickPhoto = async () => {
    const camera = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
    const useCamera = camera?.granted === true;
    const res = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  };

  const clearSignature = () => { setSignaturePoints([]); setCurrentStroke(''); };

  const submit = async () => {
    if (!selectedId) { Alert.alert('Pick a job first'); return; }
    if (!photoUri) { Alert.alert('Take a photo of the cargo / receipt'); return; }
    if (signaturePoints.length === 0) { Alert.alert('Signature required'); return; }
    if (!signerName.trim()) { Alert.alert('Signer name required'); return; }
    setUploading(true);
    try {
      const ts = Date.now();
      const filename = `pod_${selectedId}_${ts}.jpg`;
      const meta = await pickAndUploadFromUri({
        uri: photoUri,
        bucket: 'attachments',
        path: `pods/${selectedId}/${filename}`,
        contentType: 'image/jpeg',
        entityType: 'pod',
        entityId: selectedId,
        companyId: user?.companyId ?? null,
      });
      await attachMutation.mutateAsync({
        appointmentId: selectedId,
        filePath: meta.path,
        signerName: signerName.trim(),
        notes: notes.trim() || undefined,
      });
      Alert.alert('POD captured', 'Proof of delivery saved and sent to the warehouse.');
      setPhotoUri(null);
      setSignaturePoints([]);
      setSignerName('');
      setNotes('');
      if (params.appointmentId) router.back();
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unable to save POD');
    } finally {
      setUploading(false);
    }
  };

  if (jobsQuery.isLoading) return <View style={[styles.root, styles.centered, { backgroundColor: C.bg }]}><ScreenFeedback state="loading" title="Loading" /></View>;

  const pods = (podQuery.data ?? []) as Array<{ id: string; signer_name?: string; file_path: string; created_at: string; notes?: string | null }>;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={jobsQuery.isFetching} onRefresh={() => void jobsQuery.refetch()} tintColor={C.accent} />}
      >
        <Text style={styles.title}>Proof of Delivery</Text>
        <Text style={styles.subtitle}>Capture photo + signature for the completed delivery.</Text>

        <Text style={styles.sectionLabel}>Select job</Text>
        {completable.length === 0 ? (
          <View style={styles.empty}><ClipboardCheck size={34} color={C.textMuted} /><Text style={styles.emptyText}>No jobs ready for POD yet.</Text></View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {completable.map((j) => {
              const active = selectedId === j.id;
              const hasPod = Boolean(j.data?.podFileId);
              return (
                <TouchableOpacity key={j.id} onPress={() => setSelectedId(j.id)} style={[styles.jobChip, active && styles.jobChipActive]}>
                  <Text style={[styles.jobChipTitle, active && { color: C.accent }]}>{j.appointment_type}</Text>
                  <Text style={styles.jobChipMeta}>{j.truck_plate ?? '—'} · Door {j.dock_door ?? '—'}</Text>
                  <View style={{ marginTop: 6 }}>
                    <StatusBadge status={hasPod ? 'POD' : j.status} size="sm" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {selected ? (
          <>
            <Text style={styles.sectionLabel}>1. Photo</Text>
            <TouchableOpacity onPress={() => void pickPhoto()} style={styles.photoBox} testID="pod-photo">
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Camera size={32} color={C.accent} />
                  <Text style={styles.photoHint}>Take photo of cargo / receipt</Text>
                </View>
              )}
            </TouchableOpacity>
            {photoUri ? (
              <Button label="Retake photo" onPress={() => void pickPhoto()} variant="secondary" icon={<ImageIcon size={14} color={C.text} />} />
            ) : null}

            <Text style={styles.sectionLabel}>2. Signature</Text>
            <View style={styles.signatureBox} ref={padRef} {...panResponder.panHandlers}>
              {signaturePoints.length === 0 && !currentStroke ? (
                <View style={styles.signatureHint}>
                  <PenLine size={20} color={C.textMuted} />
                  <Text style={styles.signatureHintText}>Sign here</Text>
                </View>
              ) : null}
              <Svg style={StyleSheet.absoluteFill}>
                {signaturePoints.map((s, i) => (
                  <Polyline key={i} points={s} fill="none" stroke={C.text} strokeWidth={2} />
                ))}
                {currentStroke ? <Polyline points={currentStroke} fill="none" stroke={C.text} strokeWidth={2} /> : null}
              </Svg>
            </View>
            <TouchableOpacity onPress={clearSignature} style={styles.clearBtn}>
              <Trash2 size={14} color={C.red} />
              <Text style={styles.clearBtnText}>Clear signature</Text>
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>3. Details</Text>
            <Input label="Signed by" value={signerName} onChangeText={setSignerName} placeholder="Receiver name" />
            <Input label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Seal #, condition, exceptions…" multiline numberOfLines={3} />

            <Button
              label="Submit POD"
              onPress={() => void submit()}
              loading={uploading || attachMutation.isPending}
              fullWidth
              size="lg"
              icon={<Check size={16} color={C.white} />}
            />

            {pods.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Previous PODs for this job</Text>
                {pods.map((p) => (
                  <View key={p.id} style={styles.podRow}>
                    <FileCheck2 size={16} color={C.green} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.podTitle}>{p.signer_name || 'Signed POD'}</Text>
                      <Text style={styles.podMeta}>{new Date(p.created_at).toLocaleString()}</Text>
                      {p.notes ? <Text style={styles.podNotes}>{p.notes}</Text> : null}
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { justifyContent: 'center', padding: 20 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  subtitle: { fontSize: 13, color: C.textSecondary, marginBottom: 4 },
  sectionLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 6 },
  chipRow: { gap: 8 },
  jobChip: { width: 180, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  jobChipActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  jobChipTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  jobChipMeta: { fontSize: 11, color: C.textMuted, marginTop: 4 },
  photoBox: { height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderStyle: 'dashed' as const, borderColor: C.border, backgroundColor: C.card },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoPreview: { width: '100%', height: '100%' },
  photoHint: { fontSize: 12, color: C.textSecondary },
  signatureBox: { height: 160, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, position: 'relative' as const, overflow: 'hidden' },
  signatureHint: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 6 },
  signatureHintText: { fontSize: 12, color: C.textMuted },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end' },
  clearBtnText: { fontSize: 12, color: C.red, fontWeight: '700' as const },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 13, color: C.textMuted },
  podRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  podTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  podMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  podNotes: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
});
