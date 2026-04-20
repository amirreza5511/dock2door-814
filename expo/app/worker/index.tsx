import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, CalendarCheck, CheckCircle, Clock, DollarSign, LogOut, Award } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import ResponsiveContainer from '@/components/ui/ResponsiveContainer';

export default function WorkerDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { workerProfiles, shiftApplications, shiftAssignments, timeEntries, shiftPosts, workerCertifications } = useDockData();

  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);
  const myApps = useMemo(() => shiftApplications.filter((a) => a.workerUserId === user?.id), [shiftApplications, user]);
  const myAssignments = useMemo(() => shiftAssignments.filter((a) => a.workerUserId === user?.id), [shiftAssignments, user]);
  const myCerts = useMemo(() => workerCertifications.filter((c) => c.workerUserId === user?.id), [workerCertifications, user]);
  const myTimeEntries = useMemo(() => timeEntries.filter((t) => myAssignments.some((a) => a.id === t.assignmentId)), [timeEntries, myAssignments]);

  const stats = useMemo(() => ({
    applied: myApps.filter((a) => a.status === 'Applied').length,
    scheduled: myAssignments.filter((a) => a.status === 'Scheduled').length,
    completed: myAssignments.filter((a) => a.status === 'Completed').length,
    earned: myTimeEntries.filter((t) => t.employerConfirmedHours).reduce((sum, t) => {
      const ass = myAssignments.find((a) => a.id === t.assignmentId);
      return sum + (t.employerConfirmedHours ?? 0) * (ass?.confirmedRate ?? 0);
    }, 0),
  }), [myApps, myAssignments, myTimeEntries]);

  const recentAssignments = useMemo(() => [...myAssignments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4), [myAssignments]);

  const getShift = (id: string) => shiftPosts.find((s) => s.id === id);

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>Worker Portal</Text>
          <Text style={styles.name}>{user?.name}</Text>
          {profile && (
            <View style={styles.skillsRow}>
              {profile.skills.map((s) => (
                <View key={s} style={styles.skillChip}>
                  <Text style={styles.skillText}>{s}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <LogOut size={18} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <ResponsiveContainer padded={false}>
        <View style={styles.statsGrid}>
          {[
            { label: 'Applied', value: stats.applied, icon: Clock, color: C.yellow },
            { label: 'Scheduled', value: stats.scheduled, icon: CalendarCheck, color: C.blue },
            { label: 'Completed', value: stats.completed, icon: CheckCircle, color: C.green },
            { label: 'Earned', value: `$${stats.earned}`, icon: DollarSign, color: C.accent },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + '20' }]}>
                <s.icon size={18} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Certifications */}
        {myCerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            {myCerts.map((c) => (
              <Card key={c.id} style={styles.certCard}>
                <View style={styles.certRow}>
                  <View style={[styles.certIcon, { backgroundColor: c.adminApproved ? C.greenDim : C.yellowDim }]}>
                    <Award size={16} color={c.adminApproved ? C.green : C.yellow} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.certType}>{c.type} Certificate</Text>
                    <Text style={styles.certExpiry}>Expires: {c.expiryDate}</Text>
                  </View>
                  <StatusBadge status={c.adminApproved ? 'Approved' : 'PendingApproval'} />
                </View>
              </Card>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Assignments</Text>
            <TouchableOpacity onPress={() => router.push('/worker/my-shifts' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentAssignments.length === 0 ? (
            <Card><Text style={styles.emptyText}>No assignments yet. Browse open shifts!</Text></Card>
          ) : recentAssignments.map((a) => {
            const shift = getShift(a.shiftId);
            return (
              <Card key={a.id} style={styles.assignCard}>
                <View style={styles.assignRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftTitle}>{shift?.title ?? a.shiftId}</Text>
                    <Text style={styles.shiftMeta}>{shift?.locationCity} · {shift?.date} · ${a.confirmedRate}/hr</Text>
                  </View>
                  <StatusBadge status={a.status} />
                </View>
              </Card>
            );
          })}
        </View>

        <View style={styles.section}>
          <View style={styles.ctaRow}>
            <Card onPress={() => router.push('/worker/browse' as any)} style={styles.ctaCard}>
              <View style={[styles.ctaIcon, { backgroundColor: C.accentDim }]}>
                <Search size={22} color={C.accent} />
              </View>
              <Text style={styles.ctaTitle}>Browse Shifts</Text>
              <Text style={styles.ctaDesc}>Find open shifts near you</Text>
            </Card>
            <Card onPress={() => router.push('/worker/profile' as any)} style={styles.ctaCard}>
              <View style={[styles.ctaIcon, { backgroundColor: C.blueDim }]}>
                <Award size={22} color={C.blue} />
              </View>
              <Text style={styles.ctaTitle}>My Profile</Text>
              <Text style={styles.ctaDesc}>Skills & certifications</Text>
            </Card>
          </View>
        </View>
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgSecondary },
  greeting: { fontSize: 13, color: C.textSecondary },
  name: { fontSize: 22, fontWeight: '800' as const, color: C.text, letterSpacing: -0.3, marginBottom: 6 },
  skillsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  skillChip: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: C.accentDim, borderRadius: 6 },
  skillText: { fontSize: 11, color: C.accent, fontWeight: '600' as const },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginBottom: 24 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4 },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: C.text, marginBottom: 12 },
  seeAll: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  certCard: { marginBottom: 8 },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  certIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  certType: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  certExpiry: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  assignCard: { marginBottom: 8 },
  assignRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  shiftTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  shiftMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  ctaRow: { flexDirection: 'row', gap: 12 },
  ctaCard: { flex: 1, gap: 8 },
  ctaIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  ctaDesc: { fontSize: 12, color: C.textSecondary },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
});
