import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Award, MapPin, DollarSign, CheckCircle, Edit, Upload, FileText } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import C from '@/constants/colors';
import type { ShiftCategory } from '@/constants/types';
import { supabase } from '@/lib/supabase';
import { buildCertPath, getSignedUrl, uploadFileWithMetadata } from '@/lib/storage-files';

const ALL_SKILLS: ShiftCategory[] = ['General', 'Driver', 'Forklift', 'HighReach'];

interface CertRow {
  id: string;
  worker_user_id: string;
  type: string;
  expiry_date: string | null;
  file_path: string | null;
  certificate_file: string | null;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Expired';
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

async function listMyCerts(userId: string): Promise<CertRow[]> {
  const { data, error } = await supabase
    .from('worker_certifications')
    .select('id,worker_user_id,type,expiry_date,file_path,certificate_file,status,notes,reviewed_at,created_at')
    .eq('worker_user_id', userId)
    .order('created_at', { ascending: false })
    .returns<CertRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default function WorkerProfile() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { workerProfiles, updateWorkerProfile } = useDockData();
  const queryClient = useQueryClient();

  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id), [workerProfiles, user]);

  const certsQuery = useQuery({
    queryKey: ['worker-certs', user?.id],
    queryFn: () => (user ? listMyCerts(user.id) : Promise.resolve([] as CertRow[])),
    enabled: Boolean(user),
    staleTime: 15_000,
  });

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

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (!certExpiry.trim()) throw new Error('Enter expiry date (YYYY-MM-DD)');

      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/pdf', 'image/*'],
      });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const asset = picked.assets[0];
      const filename = asset.name ?? `certificate-${Date.now()}`;
      const mime = asset.mimeType ?? 'application/octet-stream';

      // 1) Insert the cert row FIRST so the storage path uses its real id.
      const { data: row, error: insertErr } = await supabase
        .from('worker_certifications')
        .insert({
          worker_user_id: user.id,
          type: certType,
          expiry_date: certExpiry,
          file_path: '',
          certificate_file: '',
          notes: '',
        })
        .select('id')
        .single();
      if (insertErr || !row) throw new Error(insertErr?.message ?? 'Unable to create certification');

      const certId = row.id as string;
      const path = buildCertPath(user.id, certId, filename);

      let body: Blob;
      if (Platform.OS === 'web' && asset.file) {
        body = asset.file;
      } else {
        const res = await fetch(asset.uri);
        body = await res.blob();
      }

      try {
        await uploadFileWithMetadata({
          bucket: 'certifications',
          path,
          file: body,
          contentType: mime,
          entityType: 'worker_certification',
          entityId: certId,
          companyId: null,
        });
      } catch (err) {
        // rollback cert row if upload fails
        await supabase.from('worker_certifications').delete().eq('id', certId);
        throw err;
      }

      const { error: updateErr } = await supabase
        .from('worker_certifications')
        .update({ file_path: path, certificate_file: path })
        .eq('id', certId);
      if (updateErr) throw new Error(updateErr.message);

      return certId;
    },
    onSuccess: (result) => {
      if (!result) return;
      setAddingCert(false);
      setCertExpiry('');
      void queryClient.invalidateQueries({ queryKey: ['worker-certs', user?.id] });
      Alert.alert('Certificate Submitted', 'Admin will review and approve your certificate.');
    },
    onError: (err: unknown) => {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  const openCert = async (row: CertRow) => {
    const path = row.file_path ?? row.certificate_file;
    if (!path) { Alert.alert('No file attached'); return; }
    try {
      const url = await getSignedUrl('certifications', path, 60);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        const { Linking } = await import('react-native');
        await Linking.openURL(url);
      }
    } catch (err) {
      Alert.alert('Unable to open file', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const myCerts = certsQuery.data ?? [];

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
        <TouchableOpacity onPress={() => { setEditBio(profile.bio); setEditRate(String(profile.hourlyExpectation)); setEditCities(profile.coverageCities.join(', ')); setEditSkills(profile.skills); setEditing(true); }} style={styles.editBtn} testID="edit-profile-btn">
          <Edit size={16} color={C.textSecondary} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
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

        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Me</Text>
            <Card>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </Card>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            <TouchableOpacity onPress={() => setAddingCert((v) => !v)} style={styles.addCertBtn} testID="add-cert-btn">
              <Text style={styles.addCertText}>{addingCert ? 'Cancel' : '+ Add'}</Text>
            </TouchableOpacity>
          </View>

          {addingCert && (
            <Card elevated style={styles.addCertForm}>
              <Text style={styles.formTitle}>New Certification</Text>
              <View style={styles.certTypeRow}>
                {(['Forklift', 'HighReach'] as const).map((t) => (
                  <TouchableOpacity key={t} onPress={() => setCertType(t)} style={[styles.certTypeChip, certType === t && styles.certTypeChipActive]}>
                    <Text style={[styles.certTypeText, certType === t && styles.certTypeTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.formGap}>
                <Input label="Expiry Date (YYYY-MM-DD)" value={certExpiry} onChangeText={setCertExpiry} placeholder="2026-06-30" testID="cert-expiry-input" />
                <Button
                  label={uploadMutation.isPending ? 'Uploading…' : 'Pick file & Submit'}
                  onPress={() => uploadMutation.mutate()}
                  disabled={uploadMutation.isPending}
                  fullWidth
                  icon={<Upload size={15} color={C.white} />}
                />
                <Text style={styles.hint}>Accepted: PDF or image. File goes to secure storage; admin will review.</Text>
              </View>
            </Card>
          )}

          {certsQuery.isLoading ? (
            <Text style={styles.noCertText}>Loading certifications…</Text>
          ) : myCerts.length === 0 ? (
            <Card>
              <Text style={styles.noCertText}>No certifications uploaded yet.</Text>
            </Card>
          ) : (
            myCerts.map((c) => {
              const statusColor = c.status === 'Approved' ? C.green : c.status === 'Rejected' ? C.red : C.yellow;
              const dim = c.status === 'Approved' ? C.greenDim : c.status === 'Rejected' ? C.redDim : C.yellowDim;
              return (
                <Card key={c.id} style={styles.certCard}>
                  <TouchableOpacity onPress={() => void openCert(c)} activeOpacity={0.85}>
                    <View style={styles.certRow}>
                      <View style={[styles.certIcon, { backgroundColor: dim }]}>
                        <Award size={18} color={statusColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.certType}>{c.type} Certificate</Text>
                        <Text style={styles.certExpiry}>Expires: {c.expiry_date ?? '—'}</Text>
                        {c.file_path ? (
                          <View style={styles.fileRow}>
                            <FileText size={11} color={C.textMuted} />
                            <Text style={styles.certFile} numberOfLines={1}>{(c.file_path.split('/').pop() ?? c.file_path)}</Text>
                          </View>
                        ) : null}
                        {c.status === 'Rejected' && c.notes ? (
                          <Text style={styles.rejectNote}>Reason: {c.notes}</Text>
                        ) : null}
                      </View>
                      <StatusBadge status={c.status} />
                    </View>
                  </TouchableOpacity>
                </Card>
              );
            })
          )}
        </View>

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
  addCertForm: { marginBottom: 12 },
  formTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  certCard: { marginBottom: 8 },
  certRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  certIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  certType: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  certExpiry: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  certFile: { fontSize: 11, color: C.textMuted, flex: 1 },
  rejectNote: { fontSize: 12, color: C.red, marginTop: 4 },
  certTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  certTypeChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  certTypeChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  certTypeText: { fontSize: 14, color: C.textSecondary, fontWeight: '600' as const },
  certTypeTextActive: { color: C.accent },
  formGap: { gap: 12 },
  hint: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  skillsLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const, marginBottom: 8 },
  skillToggle: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  skillToggleActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  skillToggleText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  skillToggleTextActive: { color: C.accent },
  noProfileText: { fontSize: 16, color: C.textSecondary },
});
