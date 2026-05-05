import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import CalendarView, { CalendarEvent } from '@/components/CalendarView';

interface ShiftRow {
  id: string;
  title: string;
  category: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  workers_needed: number;
  location_city: string | null;
}

export default function EmployerCalendar() {
  const insets = useSafeAreaInsets();
  const { activeCompany } = useActiveCompany();

  const shiftsQ = useQuery({
    queryKey: ['employer-cal', activeCompany?.companyId],
    enabled: Boolean(activeCompany?.companyId),
    queryFn: async (): Promise<ShiftRow[]> => {
      const { data, error } = await supabase
        .from('shift_posts')
        .select('id,title,category,date,start_time,end_time,status,workers_needed,location_city')
        .eq('employer_company_id', activeCompany!.companyId)
        .order('date');
      if (error) throw new Error(error.message);
      return (data ?? []) as ShiftRow[];
    },
  });

  const events: CalendarEvent[] = useMemo(() => (shiftsQ.data ?? []).map((s) => ({
    id: s.id,
    date: s.date,
    startTime: s.start_time,
    endTime: s.end_time,
    title: s.title,
    subtitle: `${s.category} · ${s.workers_needed}w · ${s.status}`,
    color: s.status === 'Filled' ? C.green : s.status === 'Cancelled' ? C.red : C.accent,
  })), [shiftsQ.data]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Shift Calendar</Text>
        <Text style={styles.sub}>{events.length} shifts</Text>
      </View>
      <View style={styles.body}>
        <CalendarView
          events={events}
          initialMode="month"
          onSelectEvent={(e) => Alert.alert(e.title, `${e.date} ${e.startTime}-${e.endTime}\n${e.subtitle ?? ''}`, [
            { text: 'Open', onPress: () => router.push(`/employer/shifts?id=${e.id}`) },
            { text: 'Close', style: 'cancel' },
          ])}
          onSelectDate={(d) => router.push(`/employer/create-shift?date=${d}`)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  sub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  body: { padding: 16 },
});
