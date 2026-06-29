import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Globe, Check, X } from 'lucide-react-native';
import C from '@/constants/colors';
import { LANGUAGES, tUI } from '@/constants/i18n';
import { useHelpLanguage } from '@/store/help-language';

/**
 * Compact language switcher for the Help Center. Shows a globe + the current
 * language's native name, and opens a sheet to pick one of the supported
 * languages. The choice is persisted and shared across every help screen.
 */
function LanguagePicker({ accent = C.accent }: { accent?: string }) {
  const insets = useSafeAreaInsets();
  const lang = useHelpLanguage((s) => s.lang);
  const setLang = useHelpLanguage((s) => s.setLang);
  const [open, setOpen] = useState<boolean>(false);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { borderColor: accent }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
      >
        <Globe size={15} color={accent} />
        <Text style={[styles.triggerText, { color: accent }]} numberOfLines={1}>
          {current.native}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{tUI(lang, 'chooseLanguage')}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
                <X size={18} color={C.textSecondary} />
              </TouchableOpacity>
            </View>

            {LANGUAGES.map((l) => {
              const selected = l.code === lang;
              return (
                <TouchableOpacity
                  key={l.code}
                  style={[styles.row, selected && { borderColor: accent, backgroundColor: C.cardElevated }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    setLang(l.code);
                    setOpen(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowNative}>{l.native}</Text>
                    <Text style={styles.rowLabel}>{l.label}</Text>
                  </View>
                  {selected && (
                    <View style={[styles.check, { backgroundColor: accent }]}>
                      <Check size={13} color={C.white} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default React.memo(LanguagePicker);

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 36, paddingHorizontal: 10, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, maxWidth: 110,
  },
  triggerText: { fontSize: 12, fontWeight: '700' as const },

  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bgSecondary, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderColor: C.border,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800' as const, color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
  },
  rowNative: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  rowLabel: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
