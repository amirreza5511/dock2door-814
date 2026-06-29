import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, ActivityIndicator, Alert, Linking, Share, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Contacts from 'expo-contacts';
import {
  useAudioRecorder, useAudioPlayer, AudioModule, setAudioModeAsync, RecordingPresets,
} from 'expo-audio';
import {
  ChevronLeft, Camera, Image as ImageIcon, Mic, Users, Send, Search, X,
  MessageCircle, Play, Square, Trash2, ShieldCheck, Phone, RotateCcw,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { requestPermission } from '@/lib/device-permissions';

const INVITE_TEXT =
  'Join me on Dock2Door — book loads, manage shifts, and track deliveries. Download the app to get started.';

interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
}

/** Strip a phone number down to digits (+ kept) for deep links. */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^0-9]/g, '');
}

export default function DeviceToolsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // ── Photo capture / gallery ──
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<boolean>(false);

  const takePhoto = useCallback(async () => {
    setPhotoBusy(true);
    try {
      const state = await requestPermission('camera');
      if (state !== 'granted') {
        Alert.alert('Camera blocked', 'Enable camera access in your phone settings to take photos.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
      if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
    } catch (e) {
      Alert.alert('Camera unavailable', e instanceof Error ? e.message : 'Try the gallery instead.');
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const pickPhoto = useCallback(async () => {
    setPhotoBusy(true);
    try {
      const state = await requestPermission('photos');
      if (state !== 'granted') {
        Alert.alert('Photos blocked', 'Enable photo access in your phone settings to attach images.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
      if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
    } catch (e) {
      Alert.alert('Gallery unavailable', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  // ── Voice notes ──
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState<boolean>(false);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const player = useAudioPlayer(voiceUri ?? undefined);

  const startRecording = useCallback(async () => {
    try {
      const state = await requestPermission('microphone');
      if (state !== 'granted') {
        Alert.alert('Microphone blocked', 'Enable microphone access in your phone settings to record voice notes.');
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      Alert.alert('Cannot record', e instanceof Error ? e.message : 'Please try again.');
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      await recorder.stop();
      setVoiceUri(recorder.uri ?? null);
    } catch {
      // ignore
    } finally {
      setRecording(false);
    }
  }, [recorder]);

  const playVoice = useCallback(() => {
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // ignore
    }
  }, [player]);

  // ── Contacts + invite ──
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState<boolean>(false);
  const [contactsDenied, setContactsDenied] = useState<boolean>(false);
  const [contactSearch, setContactSearch] = useState<string>('');

  const openInvite = useCallback(async () => {
    setInviteOpen(true);
    setContactsDenied(false);
    if (contacts.length > 0) return;
    setContactsLoading(true);
    try {
      const state = await requestPermission('contacts');
      if (state !== 'granted') {
        setContactsDenied(true);
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const rows: ContactRow[] = (data ?? [])
        .filter((c) => Boolean(c.name))
        .map((c) => ({
          id: c.id ?? c.name ?? Math.random().toString(36),
          name: c.name ?? 'Unknown',
          phone: c.phoneNumbers?.[0]?.number ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(rows);
    } catch {
      setContactsDenied(true);
    } finally {
      setContactsLoading(false);
    }
  }, [contacts.length]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q));
  }, [contacts, contactSearch]);

  const inviteVia = useCallback(async (contact: ContactRow, channel: 'whatsapp' | 'sms' | 'share') => {
    const firstName = contact.name.split(' ')[0] ?? 'there';
    const message = `Hi ${firstName}! ${INVITE_TEXT}`;
    try {
      if (channel === 'whatsapp') {
        if (!contact.phone) {
          Alert.alert('No number', 'This contact has no phone number for WhatsApp.');
          return;
        }
        const phone = normalizePhone(contact.phone).replace('+', '');
        const url = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`;
        const can = await Linking.canOpenURL(url);
        if (!can) {
          Alert.alert('WhatsApp not installed', 'WhatsApp does not appear to be available on this device.');
          return;
        }
        await Linking.openURL(url);
        return;
      }
      if (channel === 'sms') {
        if (!contact.phone) {
          Alert.alert('No number', 'This contact has no phone number to text.');
          return;
        }
        const phone = normalizePhone(contact.phone);
        const sep = Platform.OS === 'ios' ? '&' : '?';
        const url = `sms:${phone}${sep}body=${encodeURIComponent(message)}`;
        await Linking.openURL(url);
        return;
      }
      await Share.share({ message });
    } catch (e) {
      Alert.alert('Could not open', e instanceof Error ? e.message : 'Please try a different option.');
    }
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <ChevronLeft size={22} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIcon}>
            <Phone size={18} color={C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>Device & Sharing</Text>
            <Text style={styles.headerSub} numberOfLines={1}>Camera, voice, contacts & invites</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => router.push('/permissions' as never)} style={styles.permBtn} hitSlop={8}>
          <ShieldCheck size={20} color={C.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Photo */}
        <Text style={styles.sectionLabel}>PHOTO & CAMERA</Text>
        <View style={styles.card}>
          {photoUri ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" />
              <TouchableOpacity style={styles.previewClear} onPress={() => setPhotoUri(null)}>
                <Trash2 size={16} color={C.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.placeholder}>
              <ImageIcon size={28} color={C.textMuted} />
              <Text style={styles.placeholderText}>No photo yet</Text>
            </View>
          )}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => void takePhoto()} disabled={photoBusy} activeOpacity={0.85}>
              <Camera size={17} color={C.accent} />
              <Text style={styles.actionBtnText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => void pickPhoto()} disabled={photoBusy} activeOpacity={0.85}>
              <ImageIcon size={17} color={C.accent} />
              <Text style={styles.actionBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
          {photoUri && (
            <TouchableOpacity
              style={styles.shareRow}
              onPress={() => void Share.share(Platform.OS === 'ios' ? { url: photoUri } : { message: photoUri })}
              activeOpacity={0.85}
            >
              <Send size={15} color={C.text} />
              <Text style={styles.shareRowText}>Share photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Voice */}
        <Text style={styles.sectionLabel}>VOICE NOTE</Text>
        <View style={styles.card}>
          <View style={styles.voiceRow}>
            {recording ? (
              <TouchableOpacity style={[styles.recBtn, { backgroundColor: C.redDim }]} onPress={() => void stopRecording()} activeOpacity={0.85}>
                <Square size={20} color={C.red} fill={C.red} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.recBtn, { backgroundColor: C.accentDim }]} onPress={() => void startRecording()} activeOpacity={0.85}>
                <Mic size={22} color={C.accent} />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.voiceTitle}>{recording ? 'Recording…' : voiceUri ? 'Voice note ready' : 'Tap to record'}</Text>
              <Text style={styles.voiceSub}>{recording ? 'Tap stop when done' : voiceUri ? 'Play it back or re-record' : 'Hold a quick voice memo'}</Text>
            </View>
            {voiceUri && !recording && (
              <>
                <TouchableOpacity style={styles.iconBtn} onPress={playVoice} activeOpacity={0.85}>
                  <Play size={18} color={C.green} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={() => { setVoiceUri(null); }} activeOpacity={0.85}>
                  <RotateCcw size={18} color={C.textSecondary} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Contacts / invite */}
        <Text style={styles.sectionLabel}>INVITE FROM CONTACTS</Text>
        <TouchableOpacity style={styles.inviteCard} onPress={() => void openInvite()} activeOpacity={0.9}>
          <View style={[styles.cardIcon, { backgroundColor: C.greenDim }]}>
            <Users size={20} color={C.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Invite teammates & drivers</Text>
            <Text style={styles.cardDesc}>Pick a contact and send an invite over WhatsApp, SMS, or share sheet.</Text>
          </View>
          <Send size={18} color={C.green} />
        </TouchableOpacity>

        <Text style={styles.footNote}>
          These features use your phone&apos;s hardware and work on a real device. On the web preview some
          options (camera, contacts) may be limited.
        </Text>
      </ScrollView>

      {/* Invite modal */}
      <Modal visible={inviteOpen} animationType="slide" transparent onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite a contact</Text>
              <TouchableOpacity onPress={() => setInviteOpen(false)} hitSlop={8}>
                <X size={22} color={C.text} />
              </TouchableOpacity>
            </View>

            {contactsLoading ? (
              <ActivityIndicator color={C.accent} style={{ marginVertical: 40 }} />
            ) : contactsDenied ? (
              <View style={styles.deniedWrap}>
                <Users size={28} color={C.textMuted} />
                <Text style={styles.deniedText}>
                  Contacts access is off. You can still share an invite link with anyone.
                </Text>
                <TouchableOpacity
                  style={styles.deniedBtn}
                  onPress={() => void Share.share({ message: INVITE_TEXT })}
                  activeOpacity={0.85}
                >
                  <Send size={16} color={C.white} />
                  <Text style={styles.deniedBtnText}>Share invite link</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.searchBar}>
                  <Search size={18} color={C.textMuted} />
                  <TextInput
                    value={contactSearch}
                    onChangeText={setContactSearch}
                    placeholder="Search contacts"
                    placeholderTextColor={C.textMuted}
                    style={styles.searchInput}
                    autoCorrect={false}
                  />
                </View>
                <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
                  {filteredContacts.map((c) => (
                    <View key={c.id} style={styles.contactRow}>
                      <View style={styles.contactAvatar}>
                        <Text style={styles.contactInitial}>{c.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
                        {c.phone && <Text style={styles.contactPhone} numberOfLines={1}>{c.phone}</Text>}
                      </View>
                      <TouchableOpacity style={styles.chanBtn} onPress={() => void inviteVia(c, 'whatsapp')} hitSlop={6}>
                        <MessageCircle size={18} color={C.green} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.chanBtn} onPress={() => void inviteVia(c, 'sms')} hitSlop={6}>
                        <Send size={18} color={C.blue} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {filteredContacts.length === 0 && (
                    <Text style={styles.emptyContacts}>No contacts match your search.</Text>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  permBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },

  scroll: { padding: 16 },
  sectionLabel: { fontSize: 11, color: C.accent, fontWeight: '700' as const, letterSpacing: 1.2, marginTop: 12, marginBottom: 8 },

  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 12 },

  previewWrap: { position: 'relative' as const },
  preview: { width: '100%', height: 180, borderRadius: 12, backgroundColor: C.cardElevated },
  previewClear: { position: 'absolute' as const, top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: C.overlay, alignItems: 'center', justifyContent: 'center' },
  placeholder: { height: 120, borderRadius: 12, backgroundColor: C.cardElevated, alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText: { fontSize: 13, color: C.textMuted },

  btnRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: 12, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent,
  },
  actionBtnText: { fontSize: 14, fontWeight: '700' as const, color: C.accent },

  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, borderRadius: 12, backgroundColor: C.cardElevated },
  shareRowText: { fontSize: 14, fontWeight: '600' as const, color: C.text },

  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  voiceTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  voiceSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.cardElevated, alignItems: 'center', justifyContent: 'center' },

  inviteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  cardDesc: { fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 16 },

  footNote: { fontSize: 12, color: C.textMuted, lineHeight: 17, marginTop: 20 },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 16, borderWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, height: 44, marginBottom: 10,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 14 },

  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  contactAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.cardElevated, alignItems: 'center', justifyContent: 'center' },
  contactInitial: { fontSize: 16, fontWeight: '700' as const, color: C.textSecondary },
  contactName: { fontSize: 14, fontWeight: '600' as const, color: C.text },
  contactPhone: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  chanBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  emptyContacts: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const, paddingVertical: 24 },

  deniedWrap: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 12 },
  deniedText: { fontSize: 13, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  deniedBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 20, borderRadius: 12, backgroundColor: C.accent },
  deniedBtnText: { fontSize: 14, fontWeight: '700' as const, color: C.white },
});
