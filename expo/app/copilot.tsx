import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, RefreshControl,
  type NativeSyntheticEvent, type TextInputKeyPressEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Send, Sparkles, ChevronLeft, ShieldCheck, AlertTriangle, Lightbulb, Info,
  OctagonAlert, Radar, Check, X, Play, Brain, Trash2, Repeat2, TrendingDown,
  DollarSign, Plus, Mic, Square, Paperclip, ImageIcon, FileText,
} from 'lucide-react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import { askAssistant, transcribeAudio, type AiMessage, type AiImageAttachment } from '@/lib/ai';
import {
  buildCopilotSystemPrompt, parseCopilotReply, copilotSuggestions,
  type CopilotAction,
} from '@/lib/copilot';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

type TabKey = 'chat' | 'alerts' | 'insights';

interface UiMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions: CopilotAction[];
  /** Thumbnails/labels for anything the user attached to this turn. */
  attachments?: ChatAttachment[];
}

/** A pending or sent chat attachment (photo for vision, or a document). */
interface ChatAttachment {
  id: string;
  kind: 'image' | 'doc';
  name: string;
  /** Full data URI for images (used for the thumbnail and vision). */
  dataUrl?: string;
}

interface AiEvent {
  id: string;
  kind: string;
  severity: string;
  source: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

const SEVERITY_COLOR: Record<string, string> = { critical: C.red, high: C.red, medium: C.yellow, low: C.blue };

function kindIcon(kind: string) {
  if (kind === 'error') return OctagonAlert;
  if (kind === 'suggestion') return Lightbulb;
  if (kind === 'info') return Info;
  return AlertTriangle;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function sanitizeActions(raw: unknown): CopilotAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is CopilotAction => typeof a === 'object' && a !== null && typeof (a as { type?: unknown }).type === 'string')
    .map((a) => ({ ...a, label: a.label ?? String(a.type), params: a.params ?? {} }));
}

export default function CopilotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();
  const scrollRef = useRef<ScrollView>(null);

  const [tab, setTab] = useState<TabKey>('chat');
  const [messages, setMessages] = useState<UiMsg[] | null>(null);
  const [input, setInput] = useState<string>('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attaching, setAttaching] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [memoryDraft, setMemoryDraft] = useState<string>('');
  const [ideas, setIdeas] = useState<string>('');
  const [ideasLoading, setIdeasLoading] = useState<boolean>(false);
  const [alertFilter, setAlertFilter] = useState<'open' | 'all'>('open');

  const contextQuery = trpc.ai.context.useQuery(undefined, { refetchInterval: 60000, staleTime: 30000 });
  const historyQuery = trpc.ai.chatHistory.useQuery();
  const memoriesQuery = trpc.ai.memories.useQuery();
  const eventsQuery = trpc.ai.events.useQuery(undefined, { refetchInterval: 30000 });
  const streetTurnsQuery = trpc.drayage.streetTurnSuggestions.useQuery();

  const appendChat = trpc.ai.appendChat.useMutation();
  const clearChat = trpc.ai.clearChat.useMutation();
  const addMemory = trpc.ai.addMemory.useMutation({ onSuccess: () => void utils.ai.memories.invalidate() });
  const deleteMemory = trpc.ai.deleteMemory.useMutation({ onSuccess: () => void utils.ai.memories.invalidate() });
  const runWatchdog = trpc.ai.runWatchdog.useMutation({ onSuccess: () => void utils.ai.events.invalidate() });
  const setEventStatus = trpc.ai.setEventStatus.useMutation({ onSuccess: () => void utils.ai.events.invalidate() });
  const dispatchMove = trpc.drayage.dispatchMove.useMutation();
  const assignEquipment = trpc.drayage.assignEquipment.useMutation();
  const setCharges = trpc.drayage.setCharges.useMutation();
  const linkStreetTurn = trpc.drayage.linkStreetTurn.useMutation();
  const submitCustomization = trpc.customization.submit.useMutation();
  const createShift = trpc.shifts.create.useMutation();
  const acceptApplicant = trpc.shifts.acceptApplicant.useMutation();
  const applyShift = trpc.shifts.apply.useMutation();
  const dispatchLoad = trpc.loads.dispatch.useMutation();
  const createLoad = trpc.freight.create.useMutation();
  const createDrayageOrder = trpc.drayage.createOrder.useMutation();
  const forwardIntake = trpc.ai.forwardIntake.useMutation();
  const createTicket = trpc.tickets.create.useMutation();

  const context = contextQuery.data as Record<string, unknown> | null | undefined;
  const isCompany = !!(context && typeof context === 'object' && 'orders' in context);
  const roleStr = typeof context?.role === 'string' ? (context.role as string) : '';
  const companyTypeStr = typeof context?.companyType === 'string' ? (context.companyType as string) : '';
  const suggestions = useMemo(() => copilotSuggestions(roleStr, companyTypeStr), [roleStr, companyTypeStr]);
  const memories = useMemo(
    () => ((memoriesQuery.data ?? []) as { id: string; content: string }[]),
    [memoriesQuery.data],
  );

  // Reset local chat state whenever the signed-in user changes so a new
  // account never sees the previous account's conversation.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const chatUserRef = useRef<string | null>(userId);
  useEffect(() => {
    if (chatUserRef.current !== userId) {
      chatUserRef.current = userId;
      setMessages(null);
      setDoneKeys(new Set());
      setIdeas('');
      void utils.ai.chatHistory.invalidate();
    }
  }, [userId, utils]);

  // Hydrate chat from persisted history once.
  useEffect(() => {
    if (messages === null && historyQuery.data) {
      const rows = (historyQuery.data as { id: string; role: string; content: string; actions?: unknown }[]).map((r): UiMsg => ({
        id: r.id,
        role: r.role === 'assistant' ? 'assistant' : 'user',
        content: r.content,
        actions: sanitizeActions(r.actions),
      }));
      setMessages(rows);
    }
  }, [historyQuery.data, messages]);

  // Kick a watchdog scan when the copilot opens (fire-and-forget).
  const scannedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!scannedRef.current) {
      scannedRef.current = true;
      runWatchdog.mutate(undefined, { onError: () => undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    const pending = attachments;
    if ((!trimmed && pending.length === 0) || sending) return;
    // Fold attachment labels into the message text so both the AI and the
    // persisted history keep a record of what was shared.
    const docNote = pending.filter((a) => a.kind === 'doc').map((a) => `[Attached document: ${a.name}]`).join('\n');
    const imgNote = pending.filter((a) => a.kind === 'image').length > 0
      ? `[Attached ${pending.filter((a) => a.kind === 'image').length} photo(s)]`
      : '';
    const composed = [trimmed, imgNote, docNote].filter(Boolean).join('\n').trim() || '(see attachment)';
    const images: AiImageAttachment[] = pending
      .filter((a) => a.kind === 'image' && a.dataUrl)
      .map((a) => ({ dataUrl: a.dataUrl as string }));
    const userMsg: UiMsg = { id: `u-${Date.now()}`, role: 'user', content: composed, actions: [], attachments: pending };
    const history = [...(messages ?? []), userMsg];
    setMessages(history);
    setInput('');
    setAttachments([]);
    setSending(true);
    scrollDown();
    void appendChat.mutateAsync({ items: [{ role: 'user', content: composed }] }).catch(() => undefined);
    try {
      const system = buildCopilotSystemPrompt(context ?? {}, memories.map((m) => m.content));
      const prior: AiMessage[] = history.slice(-16).map((m) => ({ role: m.role, content: m.content }));
      const raw = await askAssistant([{ role: 'system', content: system }, ...prior], images);
      const parsed = parseCopilotReply(raw);
      const aiMsg: UiMsg = { id: `a-${Date.now()}`, role: 'assistant', content: parsed.text, actions: parsed.actions };
      setMessages((prev) => [...(prev ?? []), aiMsg]);
      void appendChat.mutateAsync({ items: [{ role: 'assistant', content: parsed.text, actions: parsed.actions }] }).catch(() => undefined);
      if (parsed.memory) {
        void addMemory.mutateAsync({ content: parsed.memory }).catch(() => undefined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) => [...(prev ?? []), { id: `e-${Date.now()}`, role: 'assistant', content: msg, actions: [] }]);
    } finally {
      setSending(false);
      scrollDown();
    }
  }, [messages, sending, attachments, context, memories, appendChat, addMemory, scrollDown]);

  // ── Enter to send (web): Enter submits, Shift+Enter makes a newline ──
  const onInputKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    const ev = e as unknown as { nativeEvent: { key: string; shiftKey?: boolean }; preventDefault?: () => void };
    if (ev.nativeEvent.key === 'Enter' && !ev.nativeEvent.shiftKey) {
      ev.preventDefault?.();
      void send(input);
    }
  }, [send, input]);

  // ── Attachments: photo (vision) or document ──
  const readAsDataUrl = useCallback(async (uri: string, mime: string): Promise<string> => {
    // On web, expo-file-system is unavailable — read the blob URI with FileReader.
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(blob);
      });
    }
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${mime};base64,${base64}`;
  }, []);

  const attachPhoto = useCallback(async () => {
    if (attaching || sending) return;
    setAttaching(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos', 'Photo access is needed to attach an image. You can enable it in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.7, base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const mime = a.mimeType ?? 'image/jpeg';
      const dataUrl = a.base64 ? `data:${mime};base64,${a.base64}` : await readAsDataUrl(a.uri, mime);
      setAttachments((prev) => [...prev, { id: `img-${Date.now()}`, kind: 'image', name: a.fileName ?? 'photo.jpg', dataUrl }]);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert('Could not attach photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAttaching(false);
    }
  }, [attaching, sending, readAsDataUrl]);

  const attachDocument = useCallback(async () => {
    if (attaching || sending) return;
    setAttaching(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*', 'text/*',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true, multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const mime = a.mimeType ?? 'application/octet-stream';
      // Images picked as documents still go through vision.
      if (mime.startsWith('image/')) {
        const dataUrl = await readAsDataUrl(a.uri, mime);
        setAttachments((prev) => [...prev, { id: `img-${Date.now()}`, kind: 'image', name: a.name ?? 'image', dataUrl }]);
      } else {
        setAttachments((prev) => [...prev, { id: `doc-${Date.now()}`, kind: 'doc', name: a.name ?? 'document' }]);
      }
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert('Could not attach document', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setAttaching(false);
    }
  }, [attaching, sending, readAsDataUrl]);

  const chooseAttachment = useCallback(() => {
    if (attaching || sending) return;
    Alert.alert('Add attachment', 'Share a photo or a document with the assistant.', [
      { text: 'Photo', onPress: () => void attachPhoto() },
      { text: 'Document', onPress: () => void attachDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [attaching, sending, attachPhoto, attachDocument]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const runAction = useCallback(async (msgId: string, idx: number, action: CopilotAction) => {
    const key = `${msgId}:${idx}`;
    if (runningKey || doneKeys.has(key)) return;
    setRunningKey(key);
    // When an action creates a freight load we deep-link to its live quotes.
    let createdLoadId: string | null = null;
    try {
      const p = action.params as Record<string, unknown>;
      if (action.type === 'dispatch_move') {
        if (!p.moveId || !p.driverUserId) throw new Error('The proposal is missing the move or driver id.');
        await dispatchMove.mutateAsync({
          moveId: String(p.moveId),
          driverUserId: String(p.driverUserId),
          apptDate: p.apptDate ? String(p.apptDate) : undefined,
          apptTime: p.apptTime ? String(p.apptTime) : undefined,
        });
      } else if (action.type === 'assign_equipment') {
        if (!p.orderId) throw new Error('The proposal is missing the order id.');
        await assignEquipment.mutateAsync({
          orderId: String(p.orderId),
          truckId: p.truckId ? String(p.truckId) : null,
          chassisId: p.chassisId ? String(p.chassisId) : null,
          trailerId: p.trailerId ? String(p.trailerId) : null,
        });
      } else if (action.type === 'set_charges') {
        if (!p.orderId) throw new Error('The proposal is missing the order id.');
        const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
        const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
        await setCharges.mutateAsync({
          orderId: String(p.orderId),
          perDiemFreeDays: num(p.perDiemFreeDays), perDiemLastFreeDay: str(p.perDiemLastFreeDay), perDiemDailyRate: num(p.perDiemDailyRate),
          demurrageFreeDays: num(p.demurrageFreeDays), demurrageLastFreeDay: str(p.demurrageLastFreeDay), demurrageDailyRate: num(p.demurrageDailyRate),
          storageFreeDays: num(p.storageFreeDays), storageLastFreeDay: str(p.storageLastFreeDay), storageDailyRate: num(p.storageDailyRate),
        });
      } else if (action.type === 'link_street_turn') {
        if (!p.providerOrderId || !p.receiverOrderId) throw new Error('The proposal is missing order ids.');
        await linkStreetTurn.mutateAsync({ providerOrderId: String(p.providerOrderId), receiverOrderId: String(p.receiverOrderId) });
      } else if (action.type === 'create_shift') {
        if (!p.title || !p.date || !p.startTime || !p.endTime) throw new Error('The proposal is missing shift details.');
        await createShift.mutateAsync({
          title: String(p.title),
          category: p.category ? String(p.category) : 'General',
          date: String(p.date),
          startTime: String(p.startTime),
          endTime: String(p.endTime),
          workersNeeded: p.workersNeeded ? Number(p.workersNeeded) : 1,
          hourlyRate: p.hourlyRate != null ? Number(p.hourlyRate) : null,
          locationCity: p.locationCity ? String(p.locationCity) : '',
          requirements: p.requirements ? String(p.requirements) : '',
          notes: p.notes ? String(p.notes) : '',
        });
      } else if (action.type === 'accept_applicant') {
        if (!p.applicationId) throw new Error('The proposal is missing the application id.');
        await acceptApplicant.mutateAsync({
          applicationId: String(p.applicationId),
          rate: p.rate != null ? Number(p.rate) : undefined,
        });
      } else if (action.type === 'apply_shift') {
        if (!p.shiftId) throw new Error('The proposal is missing the shift id.');
        await applyShift.mutateAsync({ shiftId: String(p.shiftId) });
      } else if (action.type === 'dispatch_load') {
        if (!p.loadId || !p.driverUserId) throw new Error('The proposal is missing the load or driver id.');
        await dispatchLoad.mutateAsync({ id: String(p.loadId), driverUserId: String(p.driverUserId) });
      } else if (action.type === 'create_load') {
        const originCity = p.originCity ? String(p.originCity) : '';
        const destCity = p.destCity ? String(p.destCity) : '';
        if (!originCity || !destCity) throw new Error('The proposal is missing the origin or destination city.');
        const modeRaw = p.freightMode ? String(p.freightMode) : 'truck';
        const freightMode = (['truck', 'lcl', 'fcl'].includes(modeRaw) ? modeRaw : 'truck') as 'truck' | 'lcl' | 'fcl';
        const unitRaw = p.weightUnit ? String(p.weightUnit) : 'kg';
        const weightUnit = (unitRaw === 'lb' ? 'lb' : 'kg') as 'kg' | 'lb';
        const finalMile = p.finalMile === true;
        const created = await createLoad.mutateAsync({
          title: p.title ? String(p.title) : `${originCity} → ${destCity}`,
          originCountry: p.originCountry ? String(p.originCountry) : 'Canada',
          originCity,
          destCountry: p.destCountry ? String(p.destCountry) : 'Canada',
          destCity,
          freightMode,
          weight: p.weight != null ? Number(p.weight) : 0,
          weightUnit,
          pieces: p.pieces != null ? Math.max(Number(p.pieces), 1) : 1,
          commodity: p.commodity ? String(p.commodity) : '',
          currency: p.currency ? String(p.currency) : 'CAD',
          notes: p.notes ? String(p.notes) : '',
          readyDate: p.readyDate ? String(p.readyDate) : undefined,
          deliveryMethod: finalMile ? 'door_pickup' : 'booking_only',
          needsContainerPickup: finalMile,
        });
        createdLoadId = created?.id ? String(created.id) : null;
      } else if (action.type === 'create_drayage_order') {
        if (!p.direction || !p.containerNumber) throw new Error('The proposal is missing the direction or container number.');
        await createDrayageOrder.mutateAsync({
          direction: String(p.direction),
          containerNumber: String(p.containerNumber),
          containerSize: p.containerSize ? String(p.containerSize) : '40ft',
          commodity: p.commodity ? String(p.commodity) : '',
          weightKg: p.weightKg != null ? Number(p.weightKg) : 0,
          pickupAddress: p.pickupAddress ? String(p.pickupAddress) : '',
          pickupCity: p.pickupCity ? String(p.pickupCity) : '',
          deliveryAddress: p.deliveryAddress ? String(p.deliveryAddress) : '',
          deliveryCity: p.deliveryCity ? String(p.deliveryCity) : '',
          notes: p.notes ? String(p.notes) : '',
          targetDrayageCompanyId: p.targetDrayageCompanyId ? String(p.targetDrayageCompanyId) : null,
        });
      } else if (action.type === 'forward_intake') {
        if (!p.targetCompanyId || !p.body) throw new Error('The proposal is missing the target company or the summary.');
        const fw = await forwardIntake.mutateAsync({
          targetCompanyId: String(p.targetCompanyId),
          subject: p.subject ? String(p.subject) : action.label,
          body: String(p.body),
        });
        if (fw?.threadId) {
          setTimeout(() => router.push(`/messages/${fw.threadId}` as never), 600);
        }
      } else if (action.type === 'escalate_human') {
        const tk = await createTicket.mutateAsync({
          subject: p.subject ? String(p.subject) : action.label,
          summary: p.summary ? String(p.summary) : '',
        });
        if (tk?.threadId) {
          setTimeout(() => router.push(`/messages/${tk.threadId}` as never), 600);
        }
      } else if (action.type === 'run_watchdog') {
        await runWatchdog.mutateAsync(undefined);
      } else if (action.type === 'request_customization') {
        const title = p.title ? String(p.title) : action.label;
        if (!title.trim()) throw new Error('The proposal is missing a title.');
        await submitCustomization.mutateAsync({
          title,
          details: p.details ? String(p.details) : '',
          payload: (typeof p.payload === 'object' && p.payload !== null ? p.payload : {}) as Record<string, unknown>,
        });
      } else {
        throw new Error('Unknown action type.');
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDoneKeys((prev) => new Set(prev).add(key));
      const confirm = createdLoadId
        ? `✅ Done: ${action.label}\n\nYour load is posted. Opening its live quotes — carriers will send competing prices here.`
        : `✅ Done: ${action.label}`;
      setMessages((prev) => [...(prev ?? []), { id: `c-${Date.now()}`, role: 'assistant', content: confirm, actions: [] }]);
      void appendChat.mutateAsync({ items: [{ role: 'assistant', content: confirm }] }).catch(() => undefined);
      await Promise.all([
        utils.ai.context.invalidate(),
        utils.ai.events.invalidate(),
        utils.drayage.dashboard.invalidate(),
        utils.drayage.streetTurnSuggestions.invalidate(),
      ]);
      if (createdLoadId) {
        const loadId = createdLoadId;
        setTimeout(() => router.push(`/global-freight/${loadId}` as never), 700);
      }
      scrollDown();
    } catch (e) {
      Alert.alert('Action failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunningKey(null);
    }
  }, [runningKey, doneKeys, dispatchMove, assignEquipment, setCharges, linkStreetTurn, runWatchdog, submitCustomization, createShift, acceptApplicant, applyShift, dispatchLoad, createDrayageOrder, forwardIntake, createTicket, router, appendChat, utils, scrollDown]);

  // ── Voice input: record → transcribe → drop into the composer ──
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState<boolean>(false);
  const [transcribing, setTranscribing] = useState<boolean>(false);

  const toggleMic = useCallback(async () => {
    if (transcribing || sending) return;
    if (!recording) {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Microphone', 'Microphone access is needed for voice input. You can enable it in Settings.');
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setRecording(true);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch (e) {
        Alert.alert('Voice input failed', e instanceof Error ? e.message : 'Unable to start recording.');
      }
      return;
    }
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording captured.');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const text = await transcribeAudio(base64, 'audio/m4a');
      if (text) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      Alert.alert('Voice input failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTranscribing(false);
    }
  }, [recording, transcribing, sending, recorder]);

  const confirmClear = useCallback(() => {
    Alert.alert('Clear conversation?', 'The chat history will be deleted. Memories stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: () => void clearChat.mutateAsync(undefined)
          .then(() => setMessages([]))
          .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown')),
      },
    ]);
  }, [clearChat]);

  const generateIdeas = useCallback(async () => {
    if (ideasLoading) return;
    setIdeasLoading(true);
    setIdeas('');
    try {
      const system = buildCopilotSystemPrompt(context ?? {}, memories.map((m) => m.content));
      const raw = await askAssistant([
        { role: 'system', content: system },
        { role: 'user', content: 'Give me your best concrete money-making and cost-cutting suggestions right now, strictly based on the snapshot: pairable street turns, accruing or soon-due per diem/demurrage/storage, idle or overdue rentals, dead-run cost, unassigned moves. Short bullet list with $ estimates where possible. Do NOT emit an actions block.' },
      ]);
      setIdeas(parseCopilotReply(raw).text);
    } catch (e) {
      setIdeas(e instanceof Error ? e.message : 'Unable to generate suggestions.');
    } finally {
      setIdeasLoading(false);
    }
  }, [ideasLoading, context, memories]);

  const events = (eventsQuery.data ?? []) as AiEvent[];
  const shownEvents = alertFilter === 'open' ? events.filter((e) => e.status === 'open') : events;
  const openCount = events.filter((e) => e.status === 'open').length;
  const streetTurns = (streetTurnsQuery.data ?? []) as Record<string, unknown>[];
  const dead = (context as { deadRuns7d?: { empty_miles?: number; deadhead_miles?: number; dead_cost?: number; savings_cost?: number } } | null | undefined)?.deadRuns7d;
  const companyName = (context as { companyName?: string } | null | undefined)?.companyName ?? '';

  const empty = (messages ?? []).length === 0;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.aiBadge}><Sparkles size={14} color={C.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>AI Copilot</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {companyName ? `Watching ${companyName}` : 'Your personal AI operator'}
            </Text>
          </View>
        </View>
        {tab === 'chat' && !empty ? (
          <TouchableOpacity onPress={confirmClear} style={styles.backBtn}>
            <Trash2 size={17} color={C.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {([
          ['chat', 'Chat', Sparkles],
          ['alerts', 'Alerts', Radar],
          ['insights', 'Insights', Lightbulb],
        ] as [TabKey, string, typeof Sparkles][]).map(([key, label, IconCmp]) => (
          <TouchableOpacity key={key} onPress={() => setTab(key)} style={[styles.tabBtn, tab === key && styles.tabBtnActive]}>
            <IconCmp size={14} color={tab === key ? C.accent : C.textMuted} />
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            {key === 'alerts' && openCount > 0 ? (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{openCount}</Text></View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'chat' ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 104}
        >
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {empty ? (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIcon}><Sparkles size={28} color={C.accent} /></View>
                <Text style={styles.emptyTitle}>Your own AI brain</Text>
                <Text style={styles.emptySub}>
                  I see your live data and I can actually do things — book workers, dispatch drivers, coordinate containers, reach providers, or bring in a human. You approve every action with one tap. Speak or type in any language.
                </Text>
                <View style={styles.suggestions}>
                  {suggestions.map((s) => (
                    <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => void send(s)}>
                      <Text style={styles.suggestionText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              (messages ?? []).map((m) => (
                <View key={m.id}>
                  <View style={[styles.bubbleRow, m.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAi]}>
                    <View style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                      {m.attachments && m.attachments.length > 0 ? (
                        <View style={styles.msgAttachments}>
                          {m.attachments.map((att) => (
                            att.kind === 'image' && att.dataUrl ? (
                              <Image key={att.id} source={{ uri: att.dataUrl }} style={styles.msgThumb} contentFit="cover" />
                            ) : (
                              <View key={att.id} style={styles.msgDocChip}>
                                <FileText size={13} color={m.role === 'user' ? C.white : C.textMuted} />
                                <Text style={[styles.msgDocText, m.role === 'user' && { color: C.white }]} numberOfLines={1}>{att.name}</Text>
                              </View>
                            )
                          ))}
                        </View>
                      ) : null}
                      {m.content ? <Text style={[styles.bubbleText, m.role === 'user' && { color: C.white }]}>{m.content}</Text> : null}
                    </View>
                  </View>
                  {m.actions.length > 0 ? m.actions.map((a, idx) => {
                    const key = `${m.id}:${idx}`;
                    const done = doneKeys.has(key);
                    const running = runningKey === key;
                    return (
                      <View key={key} style={styles.actionCard}>
                        <View style={styles.actionHead}>
                          <ShieldCheck size={15} color={C.purple} />
                          <Text style={styles.actionLabel}>{a.label}</Text>
                        </View>
                        {a.reason ? <Text style={styles.actionReason}>{a.reason}</Text> : null}
                        <View style={styles.actionBtns}>
                          <TouchableOpacity
                            style={[styles.approveBtn, done && styles.approveBtnDone]}
                            disabled={done || running}
                            onPress={() => void runAction(m.id, idx, a)}
                          >
                            {running ? <ActivityIndicator size="small" color={C.white} />
                              : done ? <Check size={15} color={C.white} />
                              : <Play size={15} color={C.white} />}
                            <Text style={styles.approveBtnText}>{done ? 'Executed' : 'Approve & run'}</Text>
                          </TouchableOpacity>
                          {!done ? (
                            <TouchableOpacity
                              style={styles.skipBtn}
                              disabled={running}
                              onPress={() => setDoneKeys((prev) => new Set(prev).add(key))}
                            >
                              <X size={15} color={C.textMuted} />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    );
                  }) : null}
                </View>
              ))
            )}
            {sending ? (
              <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
                <View style={[styles.bubble, styles.bubbleAi, styles.typing]}>
                  <ActivityIndicator size="small" color={C.accent} />
                  <Text style={styles.typingText}>Checking your operation…</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.composerWrap, { paddingBottom: insets.bottom + 10 }]}>
            {attachments.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachStrip} contentContainerStyle={styles.attachStripContent}>
                {attachments.map((att) => (
                  <View key={att.id} style={styles.attachChip}>
                    {att.kind === 'image' && att.dataUrl ? (
                      <Image source={{ uri: att.dataUrl }} style={styles.attachThumb} contentFit="cover" />
                    ) : (
                      <View style={styles.attachDoc}><FileText size={16} color={C.accent} /></View>
                    )}
                    <Text style={styles.attachName} numberOfLines={1}>{att.name}</Text>
                    <TouchableOpacity onPress={() => removeAttachment(att.id)} style={styles.attachRemove} hitSlop={8}>
                      <X size={12} color={C.white} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.composer}>
              <TouchableOpacity
                onPress={chooseAttachment}
                disabled={attaching || sending}
                style={styles.micBtn}
                testID="copilot-attach"
              >
                {attaching ? <ActivityIndicator size="small" color={C.accent} /> : <Paperclip size={18} color={C.accent} />}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void toggleMic()}
                disabled={transcribing || sending}
                style={[styles.micBtn, recording && styles.micBtnRecording]}
                testID="copilot-mic"
              >
                {transcribing ? (
                  <ActivityIndicator size="small" color={C.accent} />
                ) : recording ? (
                  <Square size={16} color={C.white} fill={C.white} />
                ) : (
                  <Mic size={18} color={C.accent} />
                )}
              </TouchableOpacity>
              <TextInput
                value={input}
                onChangeText={setInput}
                onKeyPress={onInputKeyPress}
                placeholder={recording ? 'Listening… tap ■ to stop' : 'Ask, act, attach, or say “remember…”'}
                placeholderTextColor={recording ? C.red : C.textMuted}
                style={styles.input}
                multiline
                editable={!sending}
              />
              <TouchableOpacity
                onPress={() => void send(input)}
                disabled={sending || (input.trim().length === 0 && attachments.length === 0)}
                style={[styles.sendBtn, (sending || (input.trim().length === 0 && attachments.length === 0)) && styles.sendBtnDisabled]}
              >
                <Send size={18} color={C.white} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : tab === 'alerts' ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={eventsQuery.isFetching} onRefresh={() => void eventsQuery.refetch()} tintColor={C.accent} />}
        >
          <View style={styles.alertTop}>
            <View style={styles.filterRow}>
              {(['open', 'all'] as const).map((f) => (
                <TouchableOpacity key={f} onPress={() => setAlertFilter(f)} style={[styles.filterChip, alertFilter === f && styles.filterChipActive]}>
                  <Text style={[styles.filterText, alertFilter === f && styles.filterTextActive]}>{f === 'open' ? `Open (${openCount})` : 'All'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.scanBtn}
              disabled={runWatchdog.isPending}
              onPress={() => runWatchdog.mutate(undefined, {
                onSuccess: (r: { created: number }) => {
                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Scan complete', r.created > 0 ? `${r.created} new finding(s) recorded.` : 'No new issues found. All clear!');
                },
                onError: (e: Error) => Alert.alert('Scan failed', e.message),
              })}
            >
              {runWatchdog.isPending ? <ActivityIndicator size="small" color={C.white} /> : <Radar size={15} color={C.white} />}
              <Text style={styles.scanBtnText}>Scan now</Text>
            </TouchableOpacity>
          </View>

          {shownEvents.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}><ShieldCheck size={28} color={C.green} /></View>
              <Text style={styles.emptyTitle}>All clear</Text>
              <Text style={styles.emptySub}>The watchdog found nothing that needs your attention. Errors and risks will show up here automatically.</Text>
            </View>
          ) : shownEvents.map((e) => {
            const KindIcon = kindIcon(e.kind);
            const color = SEVERITY_COLOR[e.severity] ?? C.blue;
            const isOpen = e.status === 'open';
            return (
              <Card key={e.id} style={[styles.eventCard, isOpen && { borderColor: color + '55' }]}>
                <View style={styles.eventHead}>
                  <View style={[styles.eventIcon, { backgroundColor: color + '18' }]}>
                    <KindIcon size={15} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.eventTitle, !isOpen && { color: C.textMuted }]}>{e.title}</Text>
                    <Text style={styles.eventMeta}>
                      {e.severity.toUpperCase()} · {e.source === 'app_error' ? 'app error' : e.source} · {timeAgo(e.created_at)}{!isOpen ? ` · ${e.status}` : ''}
                    </Text>
                  </View>
                </View>
                {e.body ? <Text style={styles.eventBody}>{e.body}</Text> : null}
                {isOpen ? (
                  <View style={styles.eventBtns}>
                    <TouchableOpacity
                      style={[styles.eventBtn, { backgroundColor: C.green + '15', borderColor: C.green + '44' }]}
                      onPress={() => setEventStatus.mutate({ id: e.id, status: 'resolved' })}
                    >
                      <Check size={13} color={C.green} />
                      <Text style={[styles.eventBtnText, { color: C.green }]}>Resolved</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.eventBtn}
                      onPress={() => setEventStatus.mutate({ id: e.id, status: 'dismissed' })}
                    >
                      <X size={13} color={C.textMuted} />
                      <Text style={styles.eventBtnText}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={contextQuery.isFetching} onRefresh={() => void contextQuery.refetch()} tintColor={C.accent} />}
        >
          {isCompany ? (
            <>
              {/* Dead runs mini */}
              <Card style={styles.insightCard}>
                <View style={styles.insightHead}>
                  <TrendingDown size={16} color={C.red} />
                  <Text style={styles.insightTitle}>Dead runs — last 7 days</Text>
                </View>
                <View style={styles.miniStats}>
                  <View style={styles.miniStat}>
                    <Text style={styles.miniValue}>{(Number(dead?.empty_miles ?? 0) + Number(dead?.deadhead_miles ?? 0)).toFixed(1)} mi</Text>
                    <Text style={styles.miniLabel}>empty miles</Text>
                  </View>
                  <View style={styles.miniStat}>
                    <Text style={[styles.miniValue, { color: C.red }]}>${Number(dead?.dead_cost ?? 0).toFixed(0)}</Text>
                    <Text style={styles.miniLabel}>cost</Text>
                  </View>
                  <View style={styles.miniStat}>
                    <Text style={[styles.miniValue, { color: C.green }]}>${Number(dead?.savings_cost ?? 0).toFixed(0)}</Text>
                    <Text style={styles.miniLabel}>saved</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => router.push('/drayage-company/dead-runs' as never)}>
                  <Text style={styles.linkText}>Open full report ›</Text>
                </TouchableOpacity>
              </Card>

              {/* Street turns */}
              <Card style={styles.insightCard}>
                <View style={styles.insightHead}>
                  <Repeat2 size={16} color={C.purple} />
                  <Text style={styles.insightTitle}>Street-turn opportunities</Text>
                </View>
                {streetTurns.length === 0 ? (
                  <Text style={styles.insightEmpty}>No pairable moves right now. New matches appear as empties head back.</Text>
                ) : streetTurns.map((s) => (
                  <View key={`${String(s.provider_order_id)}-${String(s.receiver_order_id)}`} style={styles.stRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stTitle}>{String(s.provider_ref)} → {String(s.receiver_ref)}</Text>
                      <Text style={styles.stMeta}>{String(s.terminal)} · ≈{String(s.saved_miles ?? 0)} mi · ${String(s.saved_cost ?? 0)} saved</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.stPairBtn}
                      disabled={linkStreetTurn.isPending}
                      onPress={() => void linkStreetTurn
                        .mutateAsync({ providerOrderId: String(s.provider_order_id), receiverOrderId: String(s.receiver_order_id) })
                        .then(async () => {
                          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          await Promise.all([utils.drayage.streetTurnSuggestions.invalidate(), utils.ai.context.invalidate()]);
                        })
                        .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'))}
                    >
                      <Text style={styles.stPairText}>Pair</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* Revenue advisor */}
          <Card style={styles.insightCard}>
            <View style={styles.insightHead}>
              <DollarSign size={16} color={C.green} />
              <Text style={styles.insightTitle}>Revenue advisor</Text>
            </View>
            <Text style={styles.insightEmpty}>Concrete ways to make (or stop losing) money, based on your live data.</Text>
            <TouchableOpacity style={styles.ideasBtn} disabled={ideasLoading} onPress={() => void generateIdeas()}>
              {ideasLoading ? <ActivityIndicator size="small" color={C.white} /> : <Sparkles size={15} color={C.white} />}
              <Text style={styles.ideasBtnText}>{ideasLoading ? 'Analyzing…' : 'Generate suggestions'}</Text>
            </TouchableOpacity>
            {ideas ? <Text style={styles.ideasText}>{ideas}</Text> : null}
          </Card>

          {/* Memories */}
          <Card style={styles.insightCard}>
            <View style={styles.insightHead}>
              <Brain size={16} color={C.blue} />
              <Text style={styles.insightTitle}>Memory</Text>
            </View>
            <Text style={styles.insightEmpty}>Facts the copilot keeps across sessions. Say “remember …” in chat, or add one here.</Text>
            <View style={styles.memAddRow}>
              <TextInput
                value={memoryDraft}
                onChangeText={setMemoryDraft}
                placeholder="e.g. Always keep two chassis at the yard"
                placeholderTextColor={C.textMuted}
                style={styles.memInput}
              />
              <TouchableOpacity
                style={[styles.memAddBtn, memoryDraft.trim().length === 0 && styles.sendBtnDisabled]}
                disabled={memoryDraft.trim().length === 0 || addMemory.isPending}
                onPress={() => {
                  const c = memoryDraft.trim();
                  setMemoryDraft('');
                  void addMemory.mutateAsync({ content: c }).catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Unknown'));
                }}
              >
                <Plus size={16} color={C.white} />
              </TouchableOpacity>
            </View>
            {memories.map((m) => (
              <View key={m.id} style={styles.memRow}>
                <Text style={styles.memText}>{m.content}</Text>
                <TouchableOpacity onPress={() => deleteMemory.mutate({ id: m.id })} hitSlop={8}>
                  <Trash2 size={15} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  aiBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tabBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  tabText: { fontSize: 12.5, fontWeight: '700' as const, color: C.textMuted },
  tabTextActive: { color: C.accent },
  tabBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontSize: 10, fontWeight: '800' as const, color: C.white },

  scroll: { padding: 16, gap: 12, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  emptySub: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19, paddingHorizontal: 20, marginBottom: 14 },
  suggestions: { gap: 8, width: '100%' },
  suggestionChip: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  suggestionText: { fontSize: 13, color: C.text, fontWeight: '500' as const },

  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAi: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: C.accent, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, color: C.text, lineHeight: 20 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText: { fontSize: 13, color: C.textSecondary },

  actionCard: { marginTop: 8, marginLeft: 6, marginRight: 30, backgroundColor: C.purple + '10', borderWidth: 1, borderColor: C.purple + '44', borderRadius: 14, padding: 12, gap: 8 },
  actionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionLabel: { flex: 1, fontSize: 13.5, fontWeight: '800' as const, color: C.text },
  actionReason: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.purple, borderRadius: 10, paddingVertical: 10 },
  approveBtnDone: { backgroundColor: C.green },
  approveBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.white },
  skipBtn: { width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },

  composerWrap: { backgroundColor: C.bgSecondary, borderTopWidth: 1, borderTopColor: C.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  attachStrip: { maxHeight: 76, paddingTop: 10 },
  attachStripContent: { paddingHorizontal: 12, gap: 8, flexDirection: 'row' },
  attachChip: { width: 120, height: 56, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8 },
  attachThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.bg },
  attachDoc: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  attachName: { flex: 1, fontSize: 11, color: C.text, fontWeight: '600' as const },
  attachRemove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  msgAttachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  msgThumb: { width: 120, height: 90, borderRadius: 10, backgroundColor: C.bg },
  msgDocChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#00000022', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, maxWidth: 200 },
  msgDocText: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const, flexShrink: 1 },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: C.text, fontSize: 14 },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: C.border },
  micBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent + '40', alignItems: 'center', justifyContent: 'center' },
  micBtnRecording: { backgroundColor: C.red, borderColor: C.red },

  alertTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
  filterTextActive: { color: C.accent },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  scanBtnText: { fontSize: 13, fontWeight: '800' as const, color: C.white },
  eventCard: { gap: 8 },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eventIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  eventTitle: { fontSize: 13.5, fontWeight: '800' as const, color: C.text },
  eventMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  eventBody: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  eventBtns: { flexDirection: 'row', gap: 8 },
  eventBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  eventBtnText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },

  insightCard: { gap: 10 },
  insightHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insightTitle: { fontSize: 14.5, fontWeight: '800' as const, color: C.text, flex: 1 },
  insightEmpty: { fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  miniStats: { flexDirection: 'row', gap: 10 },
  miniStat: { flex: 1, backgroundColor: C.bgSecondary, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' as const, gap: 2 },
  miniValue: { fontSize: 16, fontWeight: '900' as const, color: C.text },
  miniLabel: { fontSize: 10.5, color: C.textMuted },
  linkText: { fontSize: 13, fontWeight: '800' as const, color: C.accent },
  stRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },
  stTitle: { fontSize: 13, fontWeight: '800' as const, color: C.text },
  stMeta: { fontSize: 11.5, color: C.textSecondary, marginTop: 2 },
  stPairBtn: { backgroundColor: C.purple, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 },
  stPairText: { fontSize: 12.5, fontWeight: '800' as const, color: C.white },
  ideasBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.green, borderRadius: 10, paddingVertical: 11 },
  ideasBtnText: { fontSize: 13.5, fontWeight: '800' as const, color: C.white },
  ideasText: { fontSize: 13, color: C.text, lineHeight: 20, backgroundColor: C.bgSecondary, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  memAddRow: { flexDirection: 'row', gap: 8 },
  memInput: { flex: 1, height: 42, backgroundColor: C.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, color: C.text, fontSize: 13 },
  memAddBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  memRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },
  memText: { flex: 1, fontSize: 12.5, color: C.text, lineHeight: 18 },
});
