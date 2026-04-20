import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CalendarDays, Users, Clock, CheckCircle, LogOut } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function EmployerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { shiftPosts, shiftApplications, shiftAssignments, timeEntries, companies } = useDockData();

  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user]);
  const myShifts = useMemo(() => shiftPosts.filter((s) => s.employerCompanyId === user?.companyId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [shiftPosts, user]);
  const myShiftIds = useMemo(() => myShifts.map((s) => s.id), [myShifts]);
  const myApplications = useMemo(() => shiftApplications.filter((a) => myShiftIds.includes(a.shiftId)), [shiftApplications, myShiftIds]);
  const myAssignments = useMemo(() => shiftAssignments.filter((a) => myShiftIds.includes(a.shiftId)), [shiftAssignments, myShiftIds]);
  const pendingTimeConfirmations = useMemo(() => timeEntries.filter((t) => myAssignments.some((a) => a.id === t.assignmentId) && t.endTimestamp && !t.employerConfirmedHours), [timeEntries, myAssignments]);

  const stats = useMemo(() => ({
    activeShifts: myShifts.filter((s) => ['Posted', 'InProgress'].includes(s.status)).length,
    pendingApplicants: myApplications.filter((a) => a.status === 'Applied').length,
    assignedWorkers: myAssignments.filter((a) => a.status === 'Scheduled').length,
    pendingTimeConfirm: pendingTimeConfirmations.length,
  }), [myShifts, myApplications, myAssignments, pendingTimeConfirmations]);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>Employer Portal</Text>
          <Text style={styles.name}>{user?.name}</Text>
          {company && <Text style={styles.company}>{company.name}</Text>}
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <View style={styles.statsGrid}>
          {[
            { label: 'Active Shifts', value: stats.activeShifts, icon: CalendarDays, color: C.blue },
            { label: 'New Applicants', value: stats.pendingApplicants, icon: Users, color: C.yellow, hl: stats.pendingApplicants > 0 },
            { label: 'Assigned Workers', value: stats.assignedWorkers, icon: CheckCircle, color: C.green },
            { label: 'Confirm Hours', value: stats.pendingTimeConfirm, icon: Clock, color: C.accent, hl: stats.pendingTimeConfirm > 0 },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, s.hl && styles.statHl]}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                <s.icon size={18} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {stats.pendingApplicants > 0 && (
          <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)} style={styles.alertBanner}>
            <Users size={16} color={C.yellow} />
            <Text style={styles.alertText}>{stats.pendingApplicants} worker(s) applied — review in Shifts</Text>
          </TouchableOpacity>
        )}

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Shifts</Text>
            <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          {myShifts.length === 0 ? (
            <Card><Text style={styles.emptyText}>No shifts posted yet.</Text></Card>
          ) : myShifts.slice(0, 5).map((s) => {
            const apps = myApplications.filter((a) => a.shiftId === s.id && a.status === 'Applied').length;
            return (
              <Card key={s.id} style={styles.shiftCard}>
                <View style={styles.shiftTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftTitle}>{s.title}</Text>
                    <Text style={styles.shiftMeta}>{s.locationCity} · {s.date} · {s.startTime}–{s.endTime}</Text>
                  </View>
                  <StatusBadge status={s.status} />
                </View>
                <View style={styles.shiftBottom}>
                  <Text style={styles.shiftRate}>${s.hourlyRate}/hr</Text>
                  {apps > 0 && (
                    <View style={styles.appsBadge}>
                      <Users size={12} color={C.yellow} />
                      <Text style={styles.appsCount}>{apps} applicant{apps > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                </View>
              </Card>
            );
          })}
        </View>

        <View style={styles.section}>
          <Card onPress={() => router.push('/employer/create-shift' as any)} elevated>
            <View style={styles.createRow}>
              <View style={[styles.createIcon, { backgroundColor: C.accentDim }]}>
                <CalendarDays size={22} color={C.accent} />
              </View>
              <View>
                <Text style={styles.createTitle}>Post New Shift</Text>
                <Text style={styles.createDesc}>Find workers fast</Text>
              </View>
            </View>
          </Card>
        </View>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  greeting: { fontSize: 13, color: C.textSecondary },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3 },
  company: { fontSize: 13, color: C.accent, fontWeight: '600' as const, marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statHl: { borderColor: C.yellow + '60', backgroundColor: C.yellowDim },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 16, backgroundColor: C.yellowDim, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.yellow + '40' },
  alertText: { flex: 1, fontSize: 13, color: C.yellow },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  shiftCard: { marginBottom: 8 },
  shiftTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  shiftTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  shiftMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  shiftBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  shiftRate: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  appsBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.yellowDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  appsCount: { fontSize: 12, color: C.yellow, fontWeight: '600' as const },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  createIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  createTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text },
  createDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
});
