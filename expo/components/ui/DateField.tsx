import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import C from '@/constants/colors';

interface Props {
  label?: string;
  /** ISO date string YYYY-MM-DD, or '' when unset. */
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
}

/** Convert a Date to a YYYY-MM-DD string in local time. */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string to a local Date, falling back to today. */
function fromIso(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date();
}

function formatFriendly(s: string): string {
  if (!s) return '';
  const d = fromIso(s);
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Cross-platform date selector. No manual typing — users pick from a calendar.
 * - Web: native browser date input.
 * - iOS/Android: tap to open the system date picker.
 */
export default function DateField({ label, value, onChange, placeholder = 'Select date', minimumDate, maximumDate }: Props) {
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === 'web') {
    // Use the native HTML date input for a real dropdown calendar on web.
    return (
      <View style={styles.container}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View style={styles.inputWrap}>
          <CalendarDays size={16} color={C.textMuted} />
          {React.createElement('input', {
            type: 'date',
            value,
            min: minimumDate ? toIso(minimumDate) : undefined,
            max: maximumDate ? toIso(maximumDate) : undefined,
            onChange: (e: { target: { value: string } }) => onChange(e.target.value),
            style: {
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: C.text,
              fontSize: 15,
              fontFamily: 'inherit',
            },
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={styles.inputWrap} onPress={() => setShowPicker(true)} activeOpacity={0.7}>
        <CalendarDays size={16} color={C.textMuted} />
        <Text style={[styles.valueText, !value && styles.placeholderText]}>
          {value ? formatFriendly(value) : placeholder}
        </Text>
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={fromIso(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          themeVariant="dark"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(_e, d) => {
            if (Platform.OS === 'android') setShowPicker(false);
            if (d) onChange(toIso(d));
          }}
          style={styles.iosPicker}
        />
      )}
      {Platform.OS === 'ios' && showPicker && (
        <TouchableOpacity style={styles.doneBtn} onPress={() => setShowPicker(false)}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, letterSpacing: 0.3 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.bgSecondary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  valueText: { flex: 1, color: C.text, fontSize: 15 },
  placeholderText: { color: C.textMuted },
  iosPicker: { alignSelf: 'flex-start' },
  doneBtn: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 16, backgroundColor: C.accentDim, borderRadius: 8 },
  doneText: { color: C.accent, fontWeight: '700' as const, fontSize: 14 },
});
