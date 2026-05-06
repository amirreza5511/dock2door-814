import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Award, MapPin, DollarSign, CheckCircle, Edit, Upload, FileText, Camera, Eye } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
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
import { buildCertPath, buildWorkerPhotoPath, getSignedUrl, uploadFileWithMetadata } from '@/lib/storage-files';

const ALL_SKILLS: ShiftCategory[] = ['General', 'Driver', 'Forklift', 'HighReach'];

async function assetToBlob(asset: ImagePicker.ImagePickerAsset): Promise<Blob> {
  // Prefer the File object the web picker hands us — avoids fetching a blob:/data: URI which
  // can throw "TypeError: Failed to fetch" under strict CSP or after the URL is revoked.
  if (Platform.OS === 'web') {
    const maybeFile = (asset as unknown as { file?: File }).file;
    if (maybeFile) return maybeFile;
  }
  if (asset.base64 && asset.base64.length > 0) {
    const mime = asset.mimeType ?? 'image/jpeg';
    const byteString = typeof atob === 'function' ? atob(asset.base64) : Buffer.from(asset.base64, 'base64').toString('binary');
    const buf = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i += 1) buf[i] = byteString.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }
  try {
    const res = await fetch(asset.uri);
    return await res.blob();
  } catch (err) {
    console.log('[profile] assetToBlob fetch failed', err);
    throw new Error('Could not read selected image. Please try a different photo.');
  }
}

interface WorkPhotoRow { id: string; file_path: string; signed_url?: string; caption: string | null; visibility: 'private' | 'company' | 'public'; moderation_status: 'pending' | 'approved' | 'rejected'; created_at: string; }

interface EditableWorkerProfile {
  id: string;
  userId: string;
  displayName: string;
  skills: ShiftCategory[];
  coverageCities: string[];
  hourlyExpectation: number;
  verified: boolean;
  status: 'Active' | 'Suspended';
  bio: string;
  profilePhotoPath?: string;
  avatarPath?: string;
}

interface ExtendedFields {
  tagline: string;
  phone: string;
  languages: string[];
  experience_years: number;
  transportation: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  references_text: string;
  work_history: string;
  education: string;
  preferred_shift: string;
  linkedin_url: string;
  website_url: string;
}

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

async function listMyPhotos(userId: string): Promise<WorkPhotoRow[]> {
  const { data, error } = await supabase
    .from('work_photos')
    .select('id,file_path,caption,visibility,moderation_status,created_at')
    .eq('worker_user_id', userId)
    .order('created_at', { ascending: false })
    .returns<WorkPhotoRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return Promise.all(rows.map(async (row) => {
    if (!row.file_path || row.file_path === 'pending') return row;
    try {
      const signedUrl = await getSignedUrl('worker-photos', row.file_path, 120);
      return { ...row, signed_url: signedUrl };
    } catch {
      return row;
    }
  }));
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
  const { workerProfiles, updateWorkerProfile, refetch } = useDockData();
  const queryClient = useQueryClient();

  const profile = useMemo(() => workerProfiles.find((w) => w.userId === user?.id) as EditableWorkerProfile | undefined, [workerProfiles, user]);

  const photosQuery = useQuery({
    queryKey: ['worker-work-photos', user?.id],
    queryFn: () => (user ? listMyPhotos(user.id) : Promise.resolve([] as WorkPhotoRow[])),
    enabled: Boolean(user),
    staleTime: 15_000,
  });

  const certsQuery = useQuery({
    queryKey: ['worker-certs', user?.id],
    queryFn: () => (user ? listMyCerts(user.id) : Promise.resolve([] as CertRow[])),
    enabled: Boolean(user),
    staleTime: 15_000,
  });

  const extendedQuery = useQuery({
    queryKey: ['worker-profile-extended', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<ExtendedFields | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('worker_profiles')
        .select('tagline,phone,languages,experience_years,transportation,emergency_contact_name,emergency_contact_phone,references_text,work_history,education,preferred_shift,linkedin_url,website_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as ExtendedFields | null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [editBio, setEditBio] = useState(profile?.bio ?? '');
  const [editRate, setEditRate] = useState(String(profile?.hourlyExpectation ?? ''));
  const [editCities, setEditCities] = useState((profile?.coverageCities ?? []).join(', '));
  const [editSkills, setEditSkills] = useState<ShiftCategory[]>(profile?.skills ?? []);
  const [editTagline, setEditTagline] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editLanguages, setEditLanguages] = useState<string>('');
  const [editExperience, setEditExperience] = useState<string>('');
  const [editTransport, setEditTransport] = useState<string>('');
  const [editEmergencyName, setEditEmergencyName] = useState<string>('');
  const [editEmergencyPhone, setEditEmergencyPhone] = useState<string>('');
  const [editReferences, setEditReferences] = useState<string>('');
  const [editWorkHistory, setEditWorkHistory] = useState<string>('');
  const [editEducation, setEditEducation] = useState<string>('');
  const [editPreferredShift, setEditPreferredShift] = useState<string>('');
  const [editLinkedin, setEditLinkedin] = useState<string>('');
  const [editWebsite, setEditWebsite] = useState<string>('');

  const [photoVisibility, setPhotoVisibility] = useState<'private' | 'company' | 'public'>('company');
  const [addingCert, setAddingCert] = useState(false);
  const [certType, setCertType] = useState<'Forklift' | 'HighReach'>('Forklift');
  const [certExpiry, setCertExpiry] = useState('');

  const toggleSkill = (s: ShiftCategory) => {
    setEditSkills((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const openEdit = () => {
    setEditBio(profile?.bio ?? '');
    setEditRate(String(profile?.hourlyExpectation ?? ''));
    setEditCities((profile?.coverageCities ?? []).join(', '));
    setEditSkills(profile?.skills ?? []);
    const ex = extendedQuery.data;
    setEditTagline(ex?.tagline ?? '');
    setEditPhone(ex?.phone ?? '');
    setEditLanguages((ex?.languages ?? []).join(', '));
    setEditExperience(String(ex?.experience_years ?? ''));
    setEditTransport(ex?.transportation ?? '');
    setEditEmergencyName(ex?.emergency_contact_name ?? '');
    setEditEmergencyPhone(ex?.emergency_contact_phone ?? '');
    setEditReferences(ex?.references_text ?? '');
    setEditWorkHistory(ex?.work_history ?? '');
    setEditEducation(ex?.education ?? '');
    setEditPreferredShift(ex?.preferred_shift ?? '');
    setEditLinkedin(ex?.linkedin_url ?? '');
    setEditWebsite(ex?.website_url ?? '');
    setEditing(true);
  };

  const saveProfile = async () => {
    if (!profile) return;
    try {
      const cities = editCities.split(',').map((s) => s.trim()).filter(Boolean);
      const langs = editLanguages.split(',').map((s) => s.trim()).filter(Boolean);
      // Try the consolidated RPC first (handles all extended fields).
      const { error: rpcErr } = await supabase.rpc('update_my_worker_profile', {
        p_bio: editBio,
        p_skills: editSkills,
        p_coverage_cities: cities,
        p_hourly_expectation: Number(editRate) || 0,
        p_tagline: editTagline,
        p_phone: editPhone,
        p_languages: langs,
        p_experience_years: Number(editExperience) || 0,
        p_transportation: editTransport,
        p_emergency_contact_name: editEmergencyName,
        p_emergency_contact_phone: editEmergencyPhone,
        p_references_text: editReferences,
        p_work_history: editWorkHistory,
        p_education: editEducation,
        p_preferred_shift: editPreferredShift,
        p_linkedin_url: editLinkedin,
        p_website_url: editWebsite,
      });
      if (rpcErr) {
        // Fallback to legacy update if RPC isn't deployed yet.
        await updateWorkerProfile(profile.id, {
          bio: editBio,
          hourlyExpectation: Number(editRate) || 0,
          coverageCities: cities,
          skills: editSkills,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['worker-profile-extended', user?.id] });
      await refetch();
      setEditing(false);
      Alert.alert('Profile updated', 'Your worker resume is saved.');
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Unable to save profile');
    }
  };

  const createProfile = async () => {
    if (!user) return;
    setCreatingProfile(true);
    try {
      const displayName = user.name || user.email.split('@')[0] || 'Worker';
      const { error } = await supabase.rpc('ensure_my_worker_profile', { p_display_name: displayName });
      if (error) {
        // Fallback: direct insert if RPC isn't deployed yet
        const { error: insertErr } = await supabase.from('worker_profiles').insert({
          user_id: user.id,
          display_name: displayName,
          skills: [],
          coverage_cities: [],
          hourly_expectation: 0,
          bio: '',
          status: 'Active',
        });
        if (insertErr) throw new Error(insertErr.message);
      }
      await refetch();
      setEditing(true);
      Alert.alert('Profile created', 'Add your photo, skills, resume details, and certificates now.');
    } catch (err) {
      Alert.alert('Create failed', err instanceof Error ? err.message : 'Unable to create worker profile');
    } finally {
      setCreatingProfile(false);
    }
  };

  const uploadProfilePhotoMutation = useMutation({
    mutationFn: async () => {
      if (!user || !profile) throw new Error('Not authenticated');
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) throw new Error('Photo library permission denied. Enable it in Settings.');
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsEditing: true, aspect: [1, 1] });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const asset = picked.assets[0];
      const photoId = `profile-${Date.now()}`;
      const path = buildWorkerPhotoPath(user.id, photoId, 'profile.jpg');
      const blob = await assetToBlob(asset);
      await uploadFileWithMetadata({ bucket: 'worker-photos', path, file: blob, contentType: asset.mimeType ?? 'image/jpeg', entityType: 'worker_profile_photo', entityId: profile.id, companyId: null });
      const { error } = await supabase.from('worker_profiles').update({ profile_photo_path: path, avatar_path: path }).eq('id', profile.id);
      if (error) throw new Error(error.message);
      return path;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: [['dock', 'bootstrap'], { type: 'query' }] }); await queryClient.invalidateQueries({ queryKey: ['worker-profile-photo', user?.id] }); Alert.alert('Profile photo updated'); },
    onError: (err: unknown) => Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  const uploadWorkPhotoMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) throw new Error('Photo library permission denied. Enable it in Settings.');
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82 });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const asset = picked.assets[0];
      const blob = await assetToBlob(asset);
      const { data: row, error: insertErr } = await supabase.from('work_photos').insert({ worker_user_id: user.id, file_path: 'pending', caption: '', visibility: photoVisibility, moderation_status: 'pending' }).select('id').single();
      if (insertErr || !row) throw new Error(insertErr?.message ?? 'Unable to create photo');
      const id = row.id as string;
      const path = buildWorkerPhotoPath(user.id, id, `work-${Date.now()}.jpg`);
      try {
        await uploadFileWithMetadata({ bucket: 'worker-photos', path, file: blob, contentType: asset.mimeType ?? 'image/jpeg', entityType: 'work_photo', entityId: id, companyId: null });
      } catch (err) { await supabase.from('work_photos').delete().eq('id', id); throw err; }
      const { error } = await supabase.from('work_photos').update({ file_path: path }).eq('id', id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['worker-work-photos', user?.id] }); Alert.alert('Photo submitted', 'Admin moderation is required before public/company display.'); },
    onError: (err: unknown) => Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error'),
  });

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
  const profilePhotoPath = profile?.profilePhotoPath ?? profile?.avatarPath ?? '';
  const profilePhotoQuery = useQuery({
    queryKey: ['worker-profile-photo', user?.id, profilePhotoPath],
    queryFn: () => profilePhotoPath ? getSignedUrl('worker-photos', profilePhotoPath, 120) : Promise.resolve(''),
    enabled: Boolean(profilePhotoPath),
    staleTime: 60_000,
  });

  if (!profile) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Card style={styles.emptyProfileCard}>
          <Text style={styles.noProfileTitle}>Create your worker profile</Text>
          <Text style={styles.noProfileText}>Build your resume-style profile with a photo, bio, skills, certificates, work photos, and availability so companies can hire you.</Text>
          <Button label={creatingProfile ? 'Creating…' : 'Create My Profile'} onPress={createProfile} disabled={creatingProfile || !user} fullWidth icon={<Edit size={15} color={C.white} />} />
        </Card>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Profile</Text>
        <TouchableOpacity onPress={openEdit} style={styles.editBtn} testID="edit-profile-btn">
          <Edit size={16} color={C.textSecondary} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <TouchableOpacity style={styles.avatarWrap} onPress={() => uploadProfilePhotoMutation.mutate()}>
            {profilePhotoQuery.data ? (
              <Image source={{ uri: profilePhotoQuery.data }} style={styles.avatarImage} />
            ) : <Text style={styles.avatarText}>{(profile.displayName ?? 'W').charAt(0) || 'W'}</Text>}
            <View style={styles.cameraBadge}><Camera size={12} color={C.white} /></View>
          </TouchableOpacity>
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
            <View style={styles.profileActionRow}>
              <TouchableOpacity onPress={() => uploadProfilePhotoMutation.mutate()} style={styles.profileActionBtn} disabled={uploadProfilePhotoMutation.isPending} testID="change-photo-btn">
                <Camera size={13} color={C.accent} />
                <Text style={styles.profileActionText}>{uploadProfilePhotoMutation.isPending ? 'Uploading…' : 'Change Photo'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openEdit} style={styles.profileActionBtn}>
                <Edit size={13} color={C.accent} />
                <Text style={styles.profileActionText}>Edit Profile</Text>
              </TouchableOpacity>
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
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Work Photos</Text>
            <TouchableOpacity onPress={() => uploadWorkPhotoMutation.mutate()} style={styles.addCertBtn}><Text style={styles.addCertText}>+ Upload</Text></TouchableOpacity>
          </View>
          <View style={styles.visibilityRow}>
            {(['private', 'company', 'public'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => setPhotoVisibility(v)}
                style={[styles.visibilityChip, photoVisibility === v && styles.visibilityActive]}
              >
                <Eye size={11} color={photoVisibility === v ? C.accent : C.textMuted} />
                <Text style={[styles.visibilityText, photoVisibility === v && styles.visibilityTextActive]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {(photosQuery.data ?? []).length === 0 ? (
            <Card>
              <Text style={styles.noCertText}>No work photos uploaded yet.</Text>
            </Card>
          ) : (
            <View style={styles.photoGrid}>
              {(photosQuery.data ?? []).map((p) => (
                <View key={p.id} style={styles.photoCell}>
                  {p.signed_url ? (
                    <Image source={{ uri: p.signed_url }} style={styles.photoImage} />
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <Camera size={18} color={C.textMuted} />
                    </View>
                  )}
                  <Text style={styles.photoMeta}>{`${p.visibility} · ${p.moderation_status}`}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

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

        {profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Me</Text>
            <Card>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </Card>
          </View>
        ) : null}

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
                        {c.file_path && c.file_path.length > 0 ? (
                          <View style={styles.fileRow}>
                            <FileText size={11} color={C.textMuted} />
                            <Text style={styles.certFile} numberOfLines={1}>{(c.file_path.split('/').pop() ?? c.file_path)}</Text>
                          </View>
                        ) : null}
                        {c.status === 'Rejected' && c.notes && c.notes.length > 0 ? (
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
                <Input label="Headline / Tagline" value={editTagline} onChangeText={setEditTagline} placeholder="Forklift operator · 5 yrs · Vancouver" />
                <Input label="About Me" value={editBio} onChangeText={setEditBio} multiline numberOfLines={3} />
                <Input label="Phone" value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" placeholder="+1 604 555 0100" />
                <Input label="Hourly Rate Expectation ($)" value={editRate} onChangeText={setEditRate} keyboardType="numeric" />
                <Input label="Years of Experience" value={editExperience} onChangeText={setEditExperience} keyboardType="numeric" placeholder="3" />
                <Input label="Coverage Cities (comma separated)" value={editCities} onChangeText={setEditCities} placeholder="Vancouver, Richmond, Delta" />
                <Input label="Languages (comma separated)" value={editLanguages} onChangeText={setEditLanguages} placeholder="English, Punjabi" />
                <Input label="Transportation" value={editTransport} onChangeText={setEditTransport} placeholder="Own vehicle / Transit" />
                <Input label="Preferred Shift" value={editPreferredShift} onChangeText={setEditPreferredShift} placeholder="Day / Night / Swing" />
                <Input label="Work History" value={editWorkHistory} onChangeText={setEditWorkHistory} multiline numberOfLines={4} placeholder="Most recent jobs, dates, employers" />
                <Input label="Education" value={editEducation} onChangeText={setEditEducation} multiline numberOfLines={2} />
                <Input label="References" value={editReferences} onChangeText={setEditReferences} multiline numberOfLines={2} placeholder="Name, role, company, phone" />
                <Input label="Emergency Contact Name" value={editEmergencyName} onChangeText={setEditEmergencyName} />
                <Input label="Emergency Contact Phone" value={editEmergencyPhone} onChangeText={setEditEmergencyPhone} keyboardType="phone-pad" />
                <Input label="LinkedIn URL" value={editLinkedin} onChangeText={setEditLinkedin} autoCapitalize="none" />
                <Input label="Website / Portfolio URL" value={editWebsite} onChangeText={setEditWebsite} autoCapitalize="none" />
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
  avatarImage: { width: '100%', height: '100%', borderRadius: 36 },
  cameraBadge: { position: 'absolute', right: -2, bottom: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
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
  visibilityRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  visibilityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  visibilityActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  visibilityText: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  visibilityTextActive: { color: C.accent },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoCell: { width: '31.8%', aspectRatio: 0.86, backgroundColor: C.card, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  photoImage: { width: '100%', flex: 1 },
  photoMeta: { fontSize: 9, color: C.textMuted, padding: 4, textTransform: 'capitalize' as const },
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
  profileActionRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  profileActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.accentDim, borderWidth: 1, borderColor: C.accent },
  profileActionText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  emptyProfileCard: { width: '88%', gap: 14 },
  noProfileTitle: { fontSize: 20, color: C.text, fontWeight: '800' as const, textAlign: 'center' },
  noProfileText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
