import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import C from '@/constants/colors';

export type CalendarMode = 'day' | 'week' | 'month' | 'list';

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;
  title: string;
  subtitle?: string;
  color?: string;
  meta?: Record<string, unknown>;
}

interface Props {
  events: CalendarEvent[];
  onSelectEvent?: (e: CalendarEvent) => void;
  onSelectDate?: (date: string) => void;
  initialMode?: CalendarMode;
  initialDate?: Date;
  testID?: string;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(d.getDate() - d.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}

export default function CalendarView({ events, onSelectEvent, onSelectDate, initialMode = 'month', initialDate }: Props) {
  const [mode, setMode] = useState<CalendarMode>(initialMode);
  const [cursor, setCursor] = useState<Date>(initialDate ?? new Date());

  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return m;
  }, [events]);

  const headerLabel = useMemo(() => {
    if (mode === 'month') return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    if (mode === 'week') {
      const s = startOfWeek(cursor);
      const e = addDays(s, 6);
      return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}`;
    }
    if (mode === 'day') return `${DOW[cursor.getDay()]} ${MONTHS[cursor.getMonth()]} ${cursor.getDate()}`;
    return 'Upcoming';
  }, [cursor, mode]);

  const navigate = (dir: -1 | 1) => {
    const d = new Date(cursor);
    if (mode === 'month') d.setMonth(d.getMonth() + dir);
    else if (mode === 'week') d.setDate(d.getDate() + 7 * dir);
    else if (mode === 'day') d.setDate(d.getDate() + dir);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigate(-1)} style={styles.navBtn} testID="cal-prev">
          <ChevronLeft size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>{headerLabel}</Text>
        <TouchableOpacity onPress={() => navigate(1)} style={styles.navBtn} testID="cal-next">
          <ChevronRight size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.modeRow}>
        {(['day', 'week', 'month', 'list'] as const).map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeChip, mode === m && styles.modeChipActive]} testID={`cal-mode-${m}`}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'month' && <MonthGrid cursor={cursor} eventsByDate={eventsByDate} onSelectDate={onSelectDate} onSelectEvent={onSelectEvent} />}
      {mode === 'week' && <WeekStrip cursor={cursor} eventsByDate={eventsByDate} onSelectEvent={onSelectEvent} onSelectDate={onSelectDate} />}
      {mode === 'day' && <DayList date={cursor} eventsByDate={eventsByDate} onSelectEvent={onSelectEvent} />}
      {mode === 'list' && <UpcomingList events={events} onSelectEvent={onSelectEvent} />}
    </View>
  );
}

function MonthGrid({ cursor, eventsByDate, onSelectDate, onSelectEvent }: { cursor: Date; eventsByDate: Map<string, CalendarEvent[]>; onSelectDate?: (d: string) => void; onSelectEvent?: (e: CalendarEvent) => void }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
  const today = fmtDate(new Date());

  return (
    <View>
      <View style={styles.dowRow}>
        {DOW.map((d) => <Text key={d} style={styles.dowLabel}>{d}</Text>)}
      </View>
      <View style={styles.monthGrid}>
        {cells.map((d) => {
          const key = fmtDate(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const evs = eventsByDate.get(key) ?? [];
          const isToday = key === today;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => onSelectDate?.(key)}
              style={[styles.monthCell, !inMonth && styles.monthCellMuted, isToday && styles.monthCellToday]}
            >
              <Text style={[styles.dayNum, !inMonth && styles.dayNumMuted, isToday && styles.dayNumToday]}>{d.getDate()}</Text>
              {evs.slice(0, 2).map((e) => (
                <TouchableOpacity key={e.id} onPress={() => onSelectEvent?.(e)}>
                  <View style={[styles.eventDot, { backgroundColor: e.color ?? C.accent }]}>
                    <Text style={styles.eventDotText} numberOfLines={1}>{e.startTime} {e.title}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {evs.length > 2 && <Text style={styles.moreText}>+{evs.length - 2}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function WeekStrip({ cursor, eventsByDate, onSelectEvent, onSelectDate }: { cursor: Date; eventsByDate: Map<string, CalendarEvent[]>; onSelectEvent?: (e: CalendarEvent) => void; onSelectDate?: (d: string) => void }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = fmtDate(new Date());
  return (
    <ScrollView style={{ maxHeight: 520 }}>
      {days.map((d) => {
        const key = fmtDate(d);
        const evs = eventsByDate.get(key) ?? [];
        const isToday = key === today;
        return (
          <TouchableOpacity key={key} onPress={() => onSelectDate?.(key)} style={[styles.weekRow, isToday && styles.weekRowToday]}>
            <View style={styles.weekDayCol}>
              <Text style={styles.weekDow}>{DOW[d.getDay()]}</Text>
              <Text style={styles.weekDayNum}>{d.getDate()}</Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              {evs.length === 0 ? <Text style={styles.weekEmpty}>No shifts</Text> : evs.map((e) => (
                <TouchableOpacity key={e.id} onPress={() => onSelectEvent?.(e)} style={[styles.eventCard, { borderLeftColor: e.color ?? C.accent }]}>
                  <Text style={styles.eventTitle}>{e.title}</Text>
                  <Text style={styles.eventMeta}>{e.startTime} – {e.endTime}{e.subtitle ? ` · ${e.subtitle}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function DayList({ date, eventsByDate, onSelectEvent }: { date: Date; eventsByDate: Map<string, CalendarEvent[]>; onSelectEvent?: (e: CalendarEvent) => void }) {
  const key = fmtDate(date);
  const evs = (eventsByDate.get(key) ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <ScrollView style={{ maxHeight: 520 }}>
      {evs.length === 0 ? (
        <Text style={styles.emptyDay}>Nothing scheduled.</Text>
      ) : evs.map((e) => (
        <TouchableOpacity key={e.id} onPress={() => onSelectEvent?.(e)} style={[styles.eventCard, { borderLeftColor: e.color ?? C.accent }]}>
          <Text style={styles.eventTitle}>{e.title}</Text>
          <Text style={styles.eventMeta}>{e.startTime} – {e.endTime}{e.subtitle ? ` · ${e.subtitle}` : ''}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function UpcomingList({ events, onSelectEvent }: { events: CalendarEvent[]; onSelectEvent?: (e: CalendarEvent) => void }) {
  const today = fmtDate(new Date());
  const sorted = events
    .filter((e) => e.date >= today)
    .slice()
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return (
    <ScrollView style={{ maxHeight: 520 }}>
      {sorted.length === 0 ? (
        <Text style={styles.emptyDay}>Nothing upcoming.</Text>
      ) : sorted.map((e) => (
        <TouchableOpacity key={e.id} onPress={() => onSelectEvent?.(e)} style={[styles.eventCard, { borderLeftColor: e.color ?? C.accent }]}>
          <Text style={styles.eventDate}>{e.date}</Text>
          <Text style={styles.eventTitle}>{e.title}</Text>
          <Text style={styles.eventMeta}>{e.startTime} – {e.endTime}{e.subtitle ? ` · ${e.subtitle}` : ''}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { padding: 6, borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  headerLabel: { fontSize: 16, fontWeight: '800' as const, color: C.text },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeChip: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8, backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border },
  modeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  modeText: { fontSize: 11, color: C.textSecondary, fontWeight: '700' as const, letterSpacing: 0.5 },
  modeTextActive: { color: C.accent },
  dowRow: { flexDirection: 'row' },
  dowLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: C.textMuted, fontWeight: '700' as const, paddingBottom: 6 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: { width: `${100 / 7}%`, minHeight: 64, padding: 4, borderTopWidth: 1, borderRightWidth: 1, borderColor: C.border, gap: 2 },
  monthCellMuted: { opacity: 0.4 },
  monthCellToday: { backgroundColor: C.accentDim },
  dayNum: { fontSize: 11, color: C.text, fontWeight: '700' as const },
  dayNumMuted: { color: C.textMuted },
  dayNumToday: { color: C.accent },
  eventDot: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  eventDotText: { fontSize: 9, color: C.white, fontWeight: '600' as const },
  moreText: { fontSize: 9, color: C.textMuted },
  weekRow: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 6, backgroundColor: C.bgSecondary },
  weekRowToday: { borderColor: C.accent },
  weekDayCol: { width: 48, alignItems: 'center' },
  weekDow: { fontSize: 10, color: C.textMuted, fontWeight: '700' as const },
  weekDayNum: { fontSize: 22, color: C.text, fontWeight: '800' as const },
  weekEmpty: { fontSize: 12, color: C.textMuted, fontStyle: 'italic' as const },
  eventCard: { padding: 10, borderRadius: 8, backgroundColor: C.bgSecondary, borderLeftWidth: 3, borderColor: C.border, marginBottom: 6 },
  eventTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  eventMeta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  eventDate: { fontSize: 11, color: C.accent, fontWeight: '700' as const, marginBottom: 2 },
  emptyDay: { textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 20 },
});
