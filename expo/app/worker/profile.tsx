import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Award, MapPin, DollarSign, CheckCircle, Edit } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftCategory } from '@/constants/types';

const ALL_SKILLS: ShiftCategory[] = ['General', 'Driver', 'Forklift', 'HighReach'];

export default function WorkerProfile() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { workerProfiles, workerCertifications, updateWorkerProfile, addWorkerCertification } = useDockData();

  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);
  const myCerts = useMemo(() => workerCertifications.filter((c) => c.workerUserId === user?.id), [workerCertifications, user]);

  const [editing, setEditing] = useState(false);
  const [editBio, setEditBio] = useState(profile?.bio ?? '');
  const [editRate, setEditRate] = useState(String(profile?.hourlyExpectation ?? ''));
  const [editCities, setEditCities] = useState((profile?.coverageCities ?? []).join(', '));
  const [editSkills, setEditSkills] = useState<ShiftCategory[]>(profile?.skills ?? []);

  const [addingCert, setAddingCert] = useState(false);
  const [certType, setCertType] = useState<'Forklift' | 'HighReach'>('Forklift');
  const [certExpiry, setCertExpiry] = useState('');

  const toggleSkill = (s: ShiftCategory) => {
    setEditSkills((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const saveProfile = () => {
    if (!profile) return;
    updateWorkerProfile(profile.id, {
      bio: editBio,
      hourlyExpectation: Number(editRate),
      coverageCities: editCities.split(',').map((s) => s.trim()).filter(Boolean),
      skills: editSkills,
    });
    setEditing(false);
    Alert.alert('Profile Updated!');
  };

  const handleAddCert = () => {
    if (!certExpiry || !user) { Alert.alert('Enter expiry date'); return; }
    addWorkerCertification({
      id: `wc${Date.now()}`,
      workerUserId: user.id,
      type: certType,
      expiryDate: certExpiry,
      certificateFile: `cert-${user.id}-${certType}.pdf`,
      adminApproved: false,
    });
    setAddingCert(false);
    setCertExpiry('');
    Alert.alert('Certificate Submitted', 'Admin will review and approve your certificate.');
  };

  if (!profile) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.noProfileText}>No worker profile found. Contact support.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Profile</Text>
        <TouchableOpacity onPress={() => { setEditBio(profile.bio); setEditRate(String(profile.hourlyExpectation)); setEditCities(profile.coverageCities.join(', ')); setEditSkills(profile.skills); setEditing(true); }} style={styles.editBtn}>
          <Edit size={16} color={C.textSecondary} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarText}>{profile.displayName.charAt(0)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>{profile.displayName}</Text>
            <View style={styles.verifiedRow}>
              {profile.verified && (
                <View style={styles.verifiedBadge}>
                  <CheckCircle size={12} color={C.green} />
                  <Text style={styles.verifiedText}>Verified Worker</Text>
                </View>
              )}
              <StatusBadge status={profile.status} />
            </View>
          </View>
        </View>

        <Card style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <DollarSign size={16} color={C.green} />
              <Text style={styles.statValue}>${profile.hourlyExpectation}/hr</Text>
              <Text style={styles.statLabel}>Expected Rate</Text>
            </View>
            <View style={[styles.stat, styles.statBorder]}>
              <MapPin size={16} color={C.blue} />
              <Text style={styles.statValue}>{profile.coverageCities.length}</Text>
              <Text style={styles.statLabel}>Cities</Text>
            </View>
            <View style={styles.stat}>
              <Award size={16} color={C.accent} />
              <Text style={styles.statValue}>{profile.skills.length}</Text>
              <Text style={styles.statLabel}>Skills</Text>
            </View>
          </View>
        </Card>

        {/* Skills */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skillsRow}>
            {profile.skills.map((s) => (
              <View key={s} style={styles.skillChip}>
                <Text style={styles.skillText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Coverage */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coverage Cities</Text>
          <View style={styles.skillsRow}>
            {profile.coverageCities.map((c) => (
              <View key={c} style={styles.cityChip}>
                <MapPin size={11} color={C.blue} />
                <Text style={styles.cityText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Bio */}
        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Me</Text>
            <Card>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </Card>
          </View>
        )}

        {/* Certifications */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            <TouchableOpacity onPress={() => setAddingCert(true)} style={styles.addCertBtn}>
              <Text style={styles.addCertText}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {myCerts.length === 0 && (
            <Card>
              <Text style={styles.noCertText}>No certifications uploaded yet.</Text>
            </Card>
          )}
          {myCerts.map((c) => (
            <Card key={c.id} style={styles.certCard}>
              <View style={styles.certRow}>
                <View style={[styles.certIcon, { backgroundColor: c.adminApproved ? C.greenDim : C.yellowDim }]}>
                  <Award size={18} color={c.adminApproved ? C.green : C.yellow} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.certType}>{c.type} Certificate</Text>
                  <Text style={styles.certExpiry}>Expires: {c.expiryDate}</Text>
                  <Text style={styles.certFile}>{c.certificateFile}</Text>
                </View>
                <StatusBadge status={c.adminApproved ? 'Approved' : 'PendingApproval'} />
              </View>
            </Card>
          ))}
        </View>

        {/* Add Cert Form */}
        {addingCert && (
          <View style={styles.section}>
            <Card elevated>
              <Text style={styles.sectionTitle}>Add Certification</Text>
              <View style={styles.certTypeRow}>
                {(['Forklift', 'HighReach'] as ('Forklift' | 'HighReach')[]).map((t) => (
                  <TouchableOpacity key={t} onPress={() => setCertType(t)} style={[styles.certTypeChip, certType === t && styles.certTypeChipActive]}>
                    <Text style={[styles.certTypeText, certType === t && styles.certTypeTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.formGap}>
                <Input label="Expiry Date (YYYY-MM-DD)" value={certExpiry} onChangeText={setCertExpiry} placeholder="2026-06-30" />
                <Button label="Submit Certificate" onPress={handleAddCert} fullWidth icon={<CheckCircle size={15} color={C.white} />} />
                <Button label="Cancel" onPress={() => setAddingCert(false)} variant="ghost" fullWidth />
              </View>
            </Card>
          </View>
        )}

        {/* Edit Modal */}
        {editing && (
          <View style={styles.section}>
            <Card elevated>
              <Text style={styles.sectionTitle}>Edit Profile</Text>
              <View style={styles.formGap}>
                <Input label="About Me" value={editBio} onChangeText={setEditBio} multiline numberOfLines={3} />
                <Input label="Hourly Rate Expectation ($)" value={editRate} onChangeText={setEditRate} keyboardType="numeric" />
                <Input label="Coverage Cities (comma separated)" value={editCities} onChangeText={setEditCities} placeholder="Vancouver, Richmond, Delta" />
                <View>
                  <Text style={styles.skillsLabel}>Skills</Text>
                  <View style={styles.skillsRow}>
                    {ALL_SKILLS.map((s) => (
                      <TouchableOpacity key={s} onPress={() => toggleSkill(s)} style={[styles.skillToggle, editSkills.includes(s) && styles.skillToggleActive]}>
                        <Text style={[styles.skillToggleText, editSkills.includes(s) && styles.skillToggleTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <Button label="Save Profile" onPress={saveProfile} fullWidth icon={<CheckCircle size={15} color={C.white} />} />
                <Button label="Cancel" onPress={() => setEditing(false)} variant="ghost" fullWidth />
              </View>
            </Card>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  editBtnText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  scroll: { padding: 20, gap: 0 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  avatarWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.accent },
  avatarText: { fontSize: 28, fontWeight: '800' as const, color: C.accent },
  profileInfo: { flex: 1, gap: 6 },
  displayName: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  statsCard: { marginBottom: 20 },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },
  section: { marginBottom: 20 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  skillsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  skillChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.accentDim, borderRadius: 8 },
  skillText: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  cityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.blueDim, borderRadius: 8 },
  cityText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  bioText: { fontSize: 14, color: C.textSecondary, lineHeight: 22 },
  addCertBtn: { padding: 6 },
  addCertText: { fontSize: 14, color: C.accent, fontWeight: '700' as const },
  noCertText: { fontSize: 13, color: C.textMuted, textAlign: 'center' },
  certCard: { marginBottom: 8 },
  certRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  certIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  certType: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  certExpiry: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  certFile: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  certTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  certTypeChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  certTypeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  certTypeText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  certTypeTextActive: { color: C.accent },
  formGap: { gap: 12 },
  skillsLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const, marginBottom: 8 },
  skillToggle: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  skillToggleActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  skillToggleText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  skillToggleTextActive: { color: C.accent },
  noProfileText: { fontSize: 16, color: C.textSecondary },
});
