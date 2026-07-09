import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
  Platform, Linking, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  LifeBuoy, Sparkles, BookOpen, MessageCircle, Phone, X, ChevronRight, Megaphone, Mail, MapPin,
} from 'lucide-react-native';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { SUPPORT_PHONE, COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONES, COMPANY_EMAILS } from '@/constants/support';

/**
 * Shared support entry point. Renders a compact header icon button that opens a
 * sheet giving every screen the same four actions: AI Assistant, Help Center,
 * message the admin/support team, and call support. Drop it into any screen
 * header so users are never more than one tap from help.
 */
export default function SupportMenu({ tint }: { tint?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [open, setOpen] = useState<boolean>(false);
  const accent = tint ?? C.accent;

  const supportM = trpc.messaging.openSupportThread.useMutation({
    onSuccess: (res: { threadId: string }) => {
      setOpen(false);
      router.push(`/messages/${res.threadId}` as never);
    },
    onError: (error: { message: string }) => Alert.alert('Unable to contact support', error.message),
  });

  const go = useCallback((path: string) => {
    setOpen(false);
    router.push(path as never);
  }, [router]);

  const call = useCallback(async () => {
    const url = `tel:${SUPPORT_PHONE.replace(/[^+0-9]/g, '')}`;
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (!ok) {
      Alert.alert('Calling unavailable', `You can reach the dock2door team at ${SUPPORT_PHONE}.`);
      return;
    }
    setOpen(false);
    await Linking.openURL(url);
  }, []);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: accent + '18', borderColor: accent + '40' }]}
        testID="support-menu-btn"
        accessibilityLabel="Help and support"
      >
        <LifeBuoy size={18} color={accent} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <View style={styles.sheetHead}>
              <View style={styles.sheetTitleWrap}>
                <View style={[styles.headIcon, { backgroundColor: accent + '20' }]}>
                  <LifeBuoy size={18} color={accent} />
                </View>
                <View>
                  <Text style={styles.sheetTitle}>Help & support</Text>
                  <Text style={styles.sheetSub}>We&apos;re here whenever you need us</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
                <X size={18} color={C.textSecondary} />
              </TouchableOpacity>
            </View>

            <SupportRow
              icon={<Sparkles size={20} color={C.accent} />}
              tint={C.accentDim}
              title="AI Assistant"
              subtitle="Ask anything about your work — instant answers"
              onPress={() => go('/assistant')}
            />
            <SupportRow
              icon={<BookOpen size={20} color={C.green} />}
              tint={C.greenDim}
              title="Help Center & Manual"
              subtitle="Guides for every screen in your language"
              onPress={() => go('/help')}
            />
            <SupportRow
              icon={<MessageCircle size={20} color={C.blue} />}
              tint={C.blueDim}
              title="Message the team"
              subtitle="Text our admins & support — we reply here"
              loading={supportM.isPending}
              onPress={() => supportM.mutate(undefined)}
            />
            <SupportRow
              icon={<Phone size={20} color={C.purple} />}
              tint={C.purpleDim}
              title="Call support"
              subtitle="Talk to a person on the dock2door team"
              onPress={() => void call()}
            />
            <SupportRow
              icon={<Megaphone size={20} color={C.accent} />}
              tint={C.accentDim}
              title="Advertise your business"
              subtitle="Promote your business across the app"
              onPress={() => go('/advertise')}
              last
            />

            <View style={styles.contactCard}>
              <Text style={styles.contactBrand}>{COMPANY_NAME}</Text>
              <Text style={styles.contactCaption}>The freight company behind Dock2Door</Text>
              <View style={styles.contactList}>
                {COMPANY_PHONES.map((p) => (
                  <TouchableOpacity
                    key={p.number}
                    style={styles.contactItem}
                    onPress={() => void Linking.openURL(`tel:${p.number.replace(/[^+0-9]/g, '')}`)}
                  >
                    <Phone size={14} color={accent} />
                    <Text style={styles.contactText}>{p.number} · {p.label}</Text>
                  </TouchableOpacity>
                ))}
                {COMPANY_EMAILS.map((e) => (
                  <TouchableOpacity
                    key={e}
                    style={styles.contactItem}
                    onPress={() => void Linking.openURL(`mailto:${e}`)}
                  >
                    <Mail size={14} color={accent} />
                    <Text style={styles.contactText}>{e}</Text>
                  </TouchableOpacity>
                ))}
                <View style={styles.contactItem}>
                  <MapPin size={14} color={accent} />
                  <Text style={styles.contactText}>{COMPANY_ADDRESS}</Text>
                </View>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function SupportRow({
  icon, tint, title, subtitle, onPress, loading, last,
}: {
  icon: React.ReactNode; tint: string; title: string; subtitle: string;
  onPress: () => void; loading?: boolean; last?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} disabled={loading} style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      {loading ? <ActivityIndicator size="small" color={C.accent} /> : <ChevronRight size={18} color={C.textMuted} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bgSecondary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderColor: C.border,
    ...(Platform.OS === 'web' ? { maxWidth: 520, width: '100%', alignSelf: 'center' as const } : null),
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, backgroundColor: C.border, marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  sheetSub: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  closeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  rowIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  rowSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  contactCard: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  contactBrand: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  contactCaption: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  contactList: { marginTop: 10, gap: 8 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactText: { fontSize: 12, color: C.textSecondary, flex: 1 },
});
