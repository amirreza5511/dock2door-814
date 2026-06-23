import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import C from '@/constants/colors';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatLabel(iso: string): string {
  if (!iso) return '';
  const [y, m, day] = iso.split('-').map(Number);
  if (!y || !m || !day) return iso;
  const d = new Date(y, m - 1, day);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${day}, ${y}`;
}

interface CalendarFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  /** Minimum selectable date (ISO). Defaults to today. */
  minDate?: string;
  placeholder?: string;
  testID?: string;
}

/** A tappable field that opens a month calendar for selecting a single date. */
export default function CalendarField({ label, value, onChange, minDate, placeholder, testID }: CalendarFieldProps) {
  const [open, setOpen] = useState<boolean>(false);

  const today = useMemo(() => startOfDay(new Date()), []);
  const min = useMemo(() => {
    if (minDate) {
      const [y, m, d] = minDate.split('-').map(Number);
      if (y && m && d) return startOfDay(new Date(y, m - 1, d));
    }
    return today;
  }, [minDate, today]);

  const initialMonth = useMemo(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      if (y && m) return new Date(y, m - 1, 1);
    }
    return new Date(min.getFullYear(), min.getMonth(), 1);
  }, [value, min]);

  const [viewMonth, setViewMonth] = useState<Date>(initialMonth);

  const grid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    return cells;
  }, [viewMonth]);

  const handleSelect = (d: Date) => {
    onChange(toISO(d));
    setOpen(false);
  };

  const goMonth = (delta: number) => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.field}
        onPress={() => { setViewMonth(initialMonth); setOpen(true); }}
        activeOpacity={0.7}
        testID={testID}
      >
        <CalendarIcon size={16} color={C.textMuted} />
        <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]}>
          {value ? formatLabel(value) : (placeholder ?? 'Select a date')}
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

            <View style={styles.monthRow}>
              <TouchableOpacity onPress={() => goMonth(-1)} style={styles.navBtn} hitSlop={8}>
                <ChevronLeft size={20} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}</Text>
              <TouchableOpacity onPress={() => goMonth(1)} style={styles.navBtn} hitSlop={8}>
                <ChevronRight size={20} color={C.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={`${w}-${i}`} style={styles.weekday}>{w}</Text>
              ))}
            </View>

            <View style={styles.daysGrid}>
              {grid.map((d, i) => {
                if (!d) return <View key={`empty-${i}`} style={styles.dayCell} />;
                const iso = toISO(d);
                const disabled = d.getTime() < min.getTime();
                const selected = iso === value;
                const isToday = iso === toISO(today);
                return (
                  <TouchableOpacity
                    key={iso}
                    style={styles.dayCell}
                    disabled={disabled}
                    onPress={() => handleSelect(d)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.dayInner, selected && styles.daySelected, isToday && !selected && styles.dayToday]}>
                      <Text style={[styles.dayText, disabled && styles.dayDisabled, selected && styles.daySelectedText]}>
                        {d.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
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
  sheet: { backgroundColor: C.bgSecondary, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.border },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  monthLabel: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' as const, color: C.textMuted },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  dayInner: { width: '100%', height: '100%', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: C.accent },
  dayToday: { borderWidth: 1, borderColor: C.accent },
  dayText: { fontSize: 14, color: C.text, fontWeight: '500' as const },
  dayDisabled: { color: C.textMuted, opacity: 0.4 },
  daySelectedText: { color: '#fff', fontWeight: '700' as const },
});
