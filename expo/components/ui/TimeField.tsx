import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Clock, X } from 'lucide-react-native';
import C from '@/constants/colors';

/** All 30-minute slots across a day as "HH:MM" 24h strings. */
const SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

/** Formats an "HH:MM" 24h string into a 12h label like "2:30 PM". */
export function formatTimeLabel(value: string): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = mStr ?? '00';
  if (!Number.isFinite(h)) return value;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

interface TimeFieldProps {
  label: string;
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
  testID?: string;
}

/** A tappable field that opens a list of 30-minute time slots. */
export default function TimeField({ label, value, onChange, placeholder, testID }: TimeFieldProps) {
  const [open, setOpen] = useState<boolean>(false);

  const handleSelect = (slot: string) => {
    onChange(slot);
    setOpen(false);
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.field}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        testID={testID}
      >
        <Clock size={16} color={C.textMuted} />
        <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]}>
          {value ? formatTimeLabel(value) : (placeholder ?? 'Select a time')}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <X size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.slotScroll} showsVerticalScrollIndicator={false}>
              {SLOTS.map((slot) => {
                const selected = slot === value;
                return (
                  <TouchableOpacity
                    key={slot}
                    style={[styles.slot, selected && styles.slotSelected]}
                    onPress={() => handleSelect(slot)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.slotText, selected && styles.slotTextSelected]}>
                      {formatTimeLabel(slot)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, height: 46 },
  fieldText: { fontSize: 14, color: C.text, fontWeight: '500' as const },
  fieldPlaceholder: { color: C.textMuted, fontWeight: '400' as const },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: C.bgSecondary, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.border, maxHeight: '70%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  slotScroll: { flexGrow: 0 },
  slot: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, marginBottom: 4 },
  slotSelected: { backgroundColor: C.accent },
  slotText: { fontSize: 15, color: C.text, fontWeight: '500' as const, textAlign: 'center' },
  slotTextSelected: { color: '#fff', fontWeight: '700' as const },
});
