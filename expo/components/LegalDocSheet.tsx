import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ShieldCheck } from 'lucide-react-native';
import C from '@/constants/colors';
import type { LegalDoc } from '@/constants/legal';

interface Props {
  doc: LegalDoc | null;
  visible: boolean;
  onClose: () => void;
}

/** Full-screen reader for a legal document (Terms, NDA, Privacy). */
export default function LegalDocSheet({ doc, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBadge}><ShieldCheck size={16} color={C.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{doc?.title ?? 'Document'}</Text>
                {doc ? <Text style={styles.version}>Version {doc.version}</Text> : null}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}><X size={20} color={C.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.text}>{doc?.body ?? ''}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bgSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', borderTopWidth: 1, borderColor: C.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: C.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBadge: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  version: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  closeBtn: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  body: { padding: 18 },
  text: { fontSize: 13, color: C.textSecondary, lineHeight: 21 },
});
