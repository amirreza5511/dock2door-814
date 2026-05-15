import React, { useEffect, useMemo, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Award, MapPin, DollarSign, CheckCircle, Edit, Upload, FileText, Camera, Eye, Lock, ChevronDown, ChevronUp, LogOut, Shield, Home, CreditCard, Phone, User } from 'lucide-react-native';
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

type CertType = 'Forklift' | 'HighReach' | 'DriversLicence' | 'CriminalRecordCheck';
const CERT_TYPES: { value: CertType; label: string; icon: string }[] = [
  { value: 'Forklift', label: 'Forklift Cert', icon: '🏗️' },
  { value: 'HighReach', label: 'High Reach', icon: '🔼' },
  { value: 'DriversLicence', label: "Driver's Licence", icon: '🪪' },
  { value: 'CriminalRecordCheck', label: 'Criminal Record', icon: '🔍' },
];

const GOVT_ID_TYPES = ['Passport', 'Drivers Licence', 'PR Card', 'National ID', 'Other'] as const;
type GovtIdType = typeof GOVT_ID_TYPES[number];

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'] as const;
const WORK_PERMIT_OPTIONS = ['Citizen', 'PR', 'Open Work Permit', 'Employer-Specific Work Permit', 'Student Work Permit', 'Other'] as const;
const PROVINCE_OPTIONS = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** Read a local file URI (from DocumentPicker) as a Blob without using fetch(). */
async function readLocalFileAsBlob(uri: string, mimeType: string): Promise<Blob> {
  try {
    // expo-file-system reliably reads file:// URIs on both iOS and Android
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const byteString = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const buf = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i += 1) buf[i] = byteString.charCodeAt(i);
    return new Blob([buf], { type: mimeType });
  } catch (fsErr) {
    // Last resort: try fetch (works on web)
    const res = await fetch(uri);
    return await res.blob();
  }
}

async function assetToBlob(asset: ImagePicker.ImagePickerAsset): Promise<Blob> {
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

interface PrivateInfo {
  date_of_birth: string | null;
  gender: string | null;
  work_permit_status: string | null;
  sin_number: string | null;
  bank_institution_number: string | null;
  bank_transit_number: string | null;
  bank_account_number: string | null;
  bank_account_holder_name: string | null;
  // Address fields (migration 0031)
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  nationality: string | null;
  govt_id_path: string | null;
  govt_id_type: string | null;
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
    } catch { return row; }
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

/** Section header with optional action */
function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={sh.row}>
      <Text style={sh.title}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} style={sh.actionBtn}>
          <Text style={sh.actionText}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
const sh = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  actionBtn: { padding: 6 },
  actionText: { fontSize: 14, color: C.accent, fontWeight: '700' as const },
});

export default function WorkerProfile() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
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

  const privateQuery = useQuery({
    queryKey: ['worker-private-info', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<PrivateInfo | null> => {
      if (!user) return null;
      const { data } = await supabase
        .from('worker_private_info')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      return data as PrivateInfo | null;
    },
  });

  useEffect(() => {
    if (privateQuery.data) {
      const d = privateQuery.data;
      setDob(d.date_of_birth ?? '');
      setGender(d.gender ?? '');
      setWorkPermit(d.work_permit_status ?? '');
      setSin(d.sin_number ?? '');
      setBankInstitution(d.bank_institution_number ?? '');
      setBankTransit(d.bank_transit_number ?? '');
      setBankAccount(d.bank_account_number ?? '');
      setBankHolder(d.bank_account_holder_name ?? '');
      // Address fields
      setAddressLine1(d.address_line1 ?? '');
      setAddressLine2(d.address_line2 ?? '');
      setAddressCity(d.city ?? '');
      setAddressProvince(d.province ?? '');
      setAddressPostal(d.postal_code ?? '');
      setAddressCountry(d.country ?? 'Canada');
      setNationality(d.nationality ?? '');
      setGovtIdType((d.govt_id_type as GovtIdType) ?? '');
    }
  }, [privateQuery.data]);

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

  // ── Edit form state ──────────────────────────────────────────────
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

  // ── Photo & cert state ───────────────────────────────────────────
  const [photoVisibility, setPhotoVisibility] = useState<'private' | 'company' | 'public'>('company');
  const [addingCert, setAddingCert] = useState(false);
  const [certType, setCertType] = useState<CertType>('Forklift');
  const [certExpiry, setCertExpiry] = useState('');

  // ── Private info state ───────────────────────────────────────────
  const [privateExpanded, setPrivateExpanded] = useState(false);
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [workPermit, setWorkPermit] = useState('');
  const [sin, setSin] = useState('');
  const [bankInstitution, setBankInstitution] = useState('');
  const [bankTransit, setBankTransit] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [savingPrivate, setSavingPrivate] = useState(false);
  // Address
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressProvince, setAddressProvince] = useState('');
  const [addressPostal, setAddressPostal] = useState('');
  const [addressCountry, setAddressCountry] = useState('Canada');
  const [nationality, setNationality] = useState('');
  // Govt ID
  const [govtIdType, setGovtIdType] = useState<GovtIdType | ''>('');
  const [uploadingGovtId, setUploadingGovtId] = useState(false);

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

  const savePrivateInfo = async () => {
    if (!user) return;
    setSavingPrivate(true);
    try {
      const payload: Record<string, unknown> = {
        user_id: user.id,
        date_of_birth: dob || null,
        gender: gender || null,
        work_permit_status: workPermit || null,
        sin_number: sin || null,
        bank_institution_number: bankInstitution || null,
        bank_transit_number: bankTransit || null,
        bank_account_number: bankAccount || null,
        bank_account_holder_name: bankHolder || null,
        address_line1: addressLine1 || null,
        address_line2: addressLine2 || null,
        city: addressCity || null,
        province: addressProvince || null,
        postal_code: addressPostal || null,
        country: addressCountry || 'Canada',
        nationality: nationality || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('worker_private_info').upsert(payload, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
      await queryClient.invalidateQueries({ queryKey: ['worker-private-info', user.id] });
      Alert.alert('Saved', 'Your private information has been updated.');
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Unable to save private info');
    } finally {
      setSavingPrivate(false);
    }
  };

  const createProfile = async () => {
    if (!user) return;
    setCreatingProfile(true);
    try {
      const displayName = user.name || user.email.split('@')[0] || 'Worker';
      const { error } = await supabase.rpc('ensure_my_worker_profile', { p_display_name: displayName });
      if (error) throw new Error(error.message);
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [['dock', 'bootstrap'], { type: 'query' }] });
      await queryClient.invalidateQueries({ queryKey: ['worker-profile-photo', user?.id] });
      Alert.alert('Profile photo updated');
    },
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['worker-work-photos', user?.id] });
      Alert.alert('Photo submitted', 'Admin moderation required before public display.');
    },
    onError: (err: unknown) => Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  const uploadCertMutation = useMutation({
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
      const { data: row, error: insertErr } = await supabase
        .from('worker_certifications')
        .insert({ worker_user_id: user.id, type: certType, expiry_date: certExpiry, file_path: '', certificate_file: '', notes: '' })
        .select('id').single();
      if (insertErr || !row) throw new Error(insertErr?.message ?? 'Unable to create certification');
      const certId = row.id as string;
      const path = buildCertPath(user.id, certId, filename);
      let body: Blob;
      if (Platform.OS === 'web' && asset.file) {
        body = asset.file;
      } else {
        body = await readLocalFileAsBlob(asset.uri, mime);
      }
      try {
        await uploadFileWithMetadata({ bucket: 'certifications', path, file: body, contentType: mime, entityType: 'worker_certification', entityId: certId, companyId: null });
      } catch (err) {
        await supabase.from('worker_certifications').delete().eq('id', certId);
        throw err;
      }
      const { error: updateErr } = await supabase.from('worker_certifications').update({ file_path: path, certificate_file: path }).eq('id', certId);
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
    onError: (err: unknown) => Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  /** Upload government ID (stored in certifications bucket as a special cert type) */
  const uploadGovtId = async () => {
    if (!user) return;
    if (!govtIdType) { Alert.alert('Select ID type', 'Choose which type of government ID you are uploading.'); return; }
    setUploadingGovtId(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/pdf', 'image/*'],
      });
      if (picked.canceled || !picked.assets?.[0]) { setUploadingGovtId(false); return; }
      const asset = picked.assets[0];
      const filename = asset.name ?? `govt-id-${Date.now()}`;
      const mime = asset.mimeType ?? 'application/octet-stream';
      // Store as a cert row with type = "GovtID_<type>" so it's tracked
      const { data: row, error: insertErr } = await supabase
        .from('worker_certifications')
        .insert({ worker_user_id: user.id, type: `GovtID_${govtIdType}`, expiry_date: null, file_path: '', certificate_file: '', notes: `Government ID: ${govtIdType}` })
        .select('id').single();
      if (insertErr || !row) throw new Error(insertErr?.message ?? 'Unable to create ID record');
      const certId = row.id as string;
      const path = buildCertPath(user.id, certId, filename);
      let body: Blob;
      if (Platform.OS === 'web' && asset.file) {
        body = asset.file;
      } else {
        body = await readLocalFileAsBlob(asset.uri, mime);
      }
      try {
        await uploadFileWithMetadata({ bucket: 'certifications', path, file: body, contentType: mime, entityType: 'worker_govt_id', entityId: certId, companyId: null });
      } catch (err) {
        await supabase.from('worker_certifications').delete().eq('id', certId);
        throw err;
      }
      await supabase.from('worker_certifications').update({ file_path: path, certificate_file: path }).eq('id', certId);
      // Also update govt_id_path in private info
      await supabase.from('worker_private_info').upsert({ user_id: user.id, govt_id_path: path, govt_id_type: govtIdType, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      await queryClient.invalidateQueries({ queryKey: ['worker-certs', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['worker-private-info', user?.id] });
      Alert.alert('ID Uploaded', 'Your government ID has been submitted for admin verification.');
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUploadingGovtId(false);
    }
  };

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
  // Split certs: work certs vs govt ID docs
  const workCerts = myCerts.filter((c) => !c.type.startsWith('GovtID_'));
  const idDocs = myCerts.filter((c) => c.type.startsWith('GovtID_'));
  const criminalRecordCert = workCerts.find((c) => c.type === 'CriminalRecordCheck');

  const profilePhotoPath = profile?.profilePhotoPath ?? profile?.avatarPath ?? '';
  const profilePhotoQuery = useQuery({
    queryKey: ['worker-profile-photo', user?.id, profilePhotoPath],
    queryFn: () => profilePhotoPath ? getSignedUrl('worker-photos', profilePhotoPath, 120) : Promise.resolve(''),
    enabled: Boolean(profilePhotoPath),
    staleTime: 60_000,
  });

  // Profile completion %
  const completionData = useMemo(() => {
    if (!profile) return { pct: 0, missing: [] as string[] };
    const hasPhoto = Boolean(profile.profilePhotoPath ?? profile.avatarPath);
    const hasBio = (profile.bio?.length ?? 0) > 20;
    const hasSkills = profile.skills.length > 0;
    const hasCities = profile.coverageCities.length > 0;
    const hasApprovedCert = workCerts.some((c) => c.status === 'Approved');
    const hasBank = Boolean(privateQuery.data?.bank_account_number && privateQuery.data?.bank_institution_number);
    const hasAddress = Boolean(privateQuery.data?.address_line1 && privateQuery.data?.city);
    const hasIdDoc = idDocs.length > 0;
    const pct = (hasPhoto ? 15 : 0) + (hasBio ? 10 : 0) + (hasSkills ? 10 : 0) + (hasCities ? 10 : 0) + (hasApprovedCert ? 15 : 0) + (hasBank ? 15 : 0) + (hasAddress ? 10 : 0) + (hasIdDoc ? 15 : 0);
    const missing = [
      !hasPhoto && 'a profile photo',
      !hasIdDoc && 'government ID',
      !hasAddress && 'home address',
      !hasBank && 'bank info for payment',
      !hasApprovedCert && 'a certification',
      !hasBio && 'a bio',
      !hasSkills && 'skills',
      !hasCities && 'coverage cities',
    ].filter(Boolean) as string[];
    return { pct, missing };
  }, [profile, workCerts, idDocs, privateQuery.data]);

  const ext = extendedQuery.data;

  if (!profile) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Card style={styles.emptyProfileCard}>
          <Text style={styles.noProfileTitle}>Create your worker profile</Text>
          <Text style={styles.noProfileText}>Build your resume-style profile with a photo, skills, certifications, and payment details so companies can hire you.</Text>
          <Button label={creatingProfile ? 'Creating…' : 'Create My Profile'} onPress={createProfile} disabled={creatingProfile || !user} fullWidth icon={<Edit size={15} color={C.white} />} />
        </Card>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>My Profile</Text>
        <TouchableOpacity onPress={openEdit} style={styles.editBtn}>
          <Edit size={16} color={C.textSecondary} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <View style={styles.profileCard}>
          <TouchableOpacity style={styles.avatarWrap} onPress={() => uploadProfilePhotoMutation.mutate()}>
            {profilePhotoQuery.data ? (
              <Image source={{ uri: profilePhotoQuery.data }} style={styles.avatarImage} />
            ) : <Text style={styles.avatarText}>{(profile.displayName ?? 'W').charAt(0) || 'W'}</Text>}
            <View style={styles.cameraBadge}><Camera size={12} color={C.white} /></View>
          </TouchableOpacity>
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>{profile.displayName}</Text>
            {ext?.tagline ? <Text style={styles.tagline}>{ext.tagline}</Text> : null}
            <View style={styles.verifiedRow}>
              {profile.verified && (
                <View style={styles.verifiedBadge}>
                  <CheckCircle size={12} color={C.green} />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              )}
              <StatusBadge status={profile.status} />
            </View>
            {ext?.phone ? (
              <View style={styles.phoneRow}>
                <Phone size={12} color={C.textMuted} />
                <Text style={styles.phoneText}>{ext.phone}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Stats ── */}
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
              <Text style={styles.statValue}>{workCerts.filter((c) => c.status === 'Approved').length}</Text>
              <Text style={styles.statLabel}>Certs ✓</Text>
            </View>
          </View>
        </Card>

        {/* ── Profile completion ── */}
        <View style={styles.completionWrap}>
          <View style={styles.completionTop}>
            <Text style={styles.completionLabel}>Profile {completionData.pct}% complete</Text>
            {completionData.missing.length > 0 && (
              <Text style={styles.completionHint}>→ add {completionData.missing[0]}</Text>
            )}
          </View>
          <View style={styles.completionBg}>
            <View style={[styles.completionFill, { width: `${completionData.pct}%` as any, backgroundColor: completionData.pct >= 80 ? C.green : completionData.pct >= 50 ? C.blue : C.yellow }]} />
          </View>
          {completionData.missing.length > 0 && (
            <View style={styles.missingRow}>
              {completionData.missing.slice(0, 3).map((m) => (
                <View key={m} style={styles.missingChip}>
                  <Text style={styles.missingText}>+ {m}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Identity & Legal Documents
            (most important — employers and platform need these)
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderCard}>
            <Shield size={15} color={C.accent} />
            <Text style={styles.sectionHeaderTitle}>Identity & Legal Documents</Text>
          </View>

          {/* Government ID upload */}
          <Card style={styles.identityCard}>
            <Text style={styles.identityCardTitle}>🪪 Government ID</Text>
            <Text style={styles.identityCardSub}>Required for employment. Accepted: Passport, Driver's Licence, PR Card.</Text>
            {idDocs.length > 0 ? (
              <View style={styles.idDocList}>
                {idDocs.map((doc) => {
                  const label = doc.type.replace('GovtID_', '');
                  const color = doc.status === 'Approved' ? C.green : doc.status === 'Rejected' ? C.red : C.yellow;
                  const dim = doc.status === 'Approved' ? C.greenDim : doc.status === 'Rejected' ? C.redDim : C.yellowDim;
                  return (
                    <TouchableOpacity key={doc.id} onPress={() => void openCert(doc)} style={[styles.idDocRow, { backgroundColor: dim }]}>
                      <CreditCard size={14} color={color} />
                      <Text style={[styles.idDocLabel, { color }]}>{label}</Text>
                      <Text style={[styles.idDocStatus, { color }]}>{doc.status}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.idMissingBadge}>
                <Text style={styles.idMissingText}>⚠ No ID uploaded — required before your first shift</Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>ID Type</Text>
            <View style={styles.chipRow}>
              {GOVT_ID_TYPES.map((t) => (
                <TouchableOpacity key={t} onPress={() => setGovtIdType(t)} style={[styles.chip, govtIdType === t && styles.chipActive]}>
                  <Text style={[styles.chipText, govtIdType === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button
              label={uploadingGovtId ? 'Uploading…' : idDocs.length > 0 ? 'Upload New ID' : 'Upload Government ID'}
              onPress={uploadGovtId}
              disabled={uploadingGovtId || !govtIdType}
              fullWidth
              icon={<Upload size={15} color={C.white} />}
            />
            <Text style={styles.hint}>PDF or image. Stored encrypted. Only you and platform admins can view.</Text>
          </Card>

          {/* Criminal Record Check */}
          <Card style={[styles.identityCard, { marginTop: 10 }]}>
            <Text style={styles.identityCardTitle}>🔍 Criminal Record Check</Text>
            <Text style={styles.identityCardSub}>Required for many industrial employers. Upload a police-issued CRC document.</Text>
            {criminalRecordCert ? (
              <TouchableOpacity onPress={() => void openCert(criminalRecordCert)} style={[styles.idDocRow, { backgroundColor: criminalRecordCert.status === 'Approved' ? C.greenDim : criminalRecordCert.status === 'Rejected' ? C.redDim : C.yellowDim }]}>
                <FileText size={14} color={criminalRecordCert.status === 'Approved' ? C.green : criminalRecordCert.status === 'Rejected' ? C.red : C.yellow} />
                <Text style={styles.idDocLabel}>CRC · Expires: {criminalRecordCert.expiry_date ?? '—'}</Text>
                <Text style={[styles.idDocStatus, { color: criminalRecordCert.status === 'Approved' ? C.green : criminalRecordCert.status === 'Rejected' ? C.red : C.yellow }]}>{criminalRecordCert.status}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.idMissingBadge}>
                <Text style={styles.idMissingText}>Not uploaded</Text>
              </View>
            )}
            <Button
              label="Upload CRC Document"
              onPress={() => { setCertType('CriminalRecordCheck'); setAddingCert(true); }}
              variant="ghost"
              fullWidth
              icon={<Upload size={15} color={C.accent} />}
            />
          </Card>
        </View>

        {/* ════════════════════════════════════════
            SECTION: Work Certifications
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <SectionHeader
            title="Work Certifications"
            action={addingCert ? 'Cancel' : '+ Add'}
            onAction={() => setAddingCert((v) => !v)}
          />

          {addingCert && (
            <Card elevated style={styles.formGap}>
              <Text style={styles.formTitle}>Upload Certification</Text>
              <View style={styles.chipRow}>
                {CERT_TYPES.map((t) => (
                  <TouchableOpacity key={t.value} onPress={() => setCertType(t.value)} style={[styles.chip, certType === t.value && styles.chipActive]}>
                    <Text style={styles.chipEmoji}>{t.icon}</Text>
                    <Text style={[styles.chipText, certType === t.value && styles.chipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Input label="Expiry Date (YYYY-MM-DD)" value={certExpiry} onChangeText={setCertExpiry} placeholder="2026-06-30" />
              <Button
                label={uploadCertMutation.isPending ? 'Uploading…' : 'Pick File & Submit'}
                onPress={() => uploadCertMutation.mutate()}
                disabled={uploadCertMutation.isPending}
                fullWidth
                icon={<Upload size={15} color={C.white} />}
              />
              <Text style={styles.hint}>Accepted: PDF or image. Admin will review and approve.</Text>
            </Card>
          )}

          {certsQuery.isLoading ? (
            <Text style={styles.noCertText}>Loading…</Text>
          ) : workCerts.length === 0 ? (
            <Card><Text style={styles.noCertText}>No certifications uploaded yet.</Text></Card>
          ) : (
            workCerts.map((c) => {
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
                        {c.status === 'Rejected' && c.notes ? <Text style={styles.rejectNote}>Reason: {c.notes}</Text> : null}
                      </View>
                      <StatusBadge status={c.status} />
                    </View>
                  </TouchableOpacity>
                </Card>
              );
            })
          )}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Skills & Availability
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skillsRow}>
            {profile.skills.length === 0 ? (
              <TouchableOpacity onPress={openEdit} style={styles.addSkillPrompt}>
                <Text style={styles.addSkillPromptText}>+ Tap Edit to add your skills</Text>
              </TouchableOpacity>
            ) : profile.skills.map((s) => (
              <View key={s} style={styles.skillChip}>
                <Text style={styles.skillText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coverage Cities</Text>
          <View style={styles.skillsRow}>
            {profile.coverageCities.length === 0 ? (
              <TouchableOpacity onPress={openEdit} style={styles.addSkillPrompt}>
                <Text style={styles.addSkillPromptText}>+ Tap Edit to add cities</Text>
              </TouchableOpacity>
            ) : profile.coverageCities.map((c) => (
              <View key={c} style={styles.cityChip}>
                <MapPin size={11} color={C.blue} />
                <Text style={styles.cityText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* About */}
        {profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Me</Text>
            <Card><Text style={styles.bioText}>{profile.bio}</Text></Card>
          </View>
        ) : null}

        {/* ════════════════════════════════════════
            SECTION: Work Photos
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <SectionHeader
            title="Work Photos"
            action="+ Upload"
            onAction={() => uploadWorkPhotoMutation.mutate()}
          />
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
            <Card><Text style={styles.noCertText}>No work photos uploaded yet.</Text></Card>
          ) : (
            <View style={styles.photoGrid}>
              {(photosQuery.data ?? []).map((p) => (
                <View key={p.id} style={styles.photoCell}>
                  {p.signed_url ? (
                    <Image source={{ uri: p.signed_url }} style={styles.photoImage} />
                  ) : (
                    <View style={styles.photoPlaceholder}><Camera size={18} color={C.textMuted} /></View>
                  )}
                  <Text style={styles.photoMeta}>{`${p.visibility} · ${p.moderation_status}`}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Private & Financial Information
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <TouchableOpacity
            onPress={() => setPrivateExpanded((v) => !v)}
            style={styles.privateHeaderCard}
          >
            <View style={styles.privateHeaderLeft}>
              <Lock size={15} color={C.purple} />
              <View>
                <Text style={styles.sectionTitle}>Private Information</Text>
                <Text style={styles.privateSubtitle}>Home address · Tax info · Bank details · Stored securely</Text>
              </View>
            </View>
            {privateExpanded ? <ChevronUp size={18} color={C.textMuted} /> : <ChevronDown size={18} color={C.textMuted} />}
          </TouchableOpacity>

          {privateExpanded && (
            <Card elevated style={styles.formGap}>
              <Text style={styles.privacyNotice}>🔒 Encrypted. Visible only to you and platform admins. Never shared with employers.</Text>

              {/* ─ Personal ─ */}
              <Text style={styles.subSectionTitle}>Personal</Text>
              <Input label="Date of Birth" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
              <View>
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.chipRow}>
                  {GENDER_OPTIONS.map((g) => (
                    <TouchableOpacity key={g} onPress={() => setGender(gender === g ? '' : g)} style={[styles.chip, gender === g && styles.chipActive]}>
                      <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Input label="Nationality (country of citizenship)" value={nationality} onChangeText={setNationality} placeholder="Canadian, Indian, Filipino…" />
              <View>
                <Text style={styles.fieldLabel}>Work Permit / Immigration Status</Text>
                <View style={styles.chipRow}>
                  {WORK_PERMIT_OPTIONS.map((p) => (
                    <TouchableOpacity key={p} onPress={() => setWorkPermit(workPermit === p ? '' : p)} style={[styles.chip, workPermit === p && styles.chipActive]}>
                      <Text style={[styles.chipText, workPermit === p && styles.chipTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Input label="SIN Number" value={sin} onChangeText={setSin} placeholder="XXX-XXX-XXX" secureTextEntry />

              {/* ─ Home Address ─ */}
              <Text style={styles.subSectionTitle}>
                <Home size={13} color={C.textSecondary} /> Home Address
              </Text>
              <Text style={styles.subSectionNote}>Required for T4 slips and direct deposit setup.</Text>
              <Input label="Street Address" value={addressLine1} onChangeText={setAddressLine1} placeholder="123 Main Street" />
              <Input label="Apt / Suite / Unit (optional)" value={addressLine2} onChangeText={setAddressLine2} placeholder="Unit 204" />
              <Input label="City" value={addressCity} onChangeText={setAddressCity} placeholder="Vancouver" />
              <View>
                <Text style={styles.fieldLabel}>Province</Text>
                <View style={styles.chipRow}>
                  {PROVINCE_OPTIONS.map((prov) => (
                    <TouchableOpacity key={prov} onPress={() => setAddressProvince(addressProvince === prov ? '' : prov)} style={[styles.chip, addressProvince === prov && styles.chipActive]}>
                      <Text style={[styles.chipText, addressProvince === prov && styles.chipTextActive]}>{prov}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Input label="Postal Code" value={addressPostal} onChangeText={setAddressPostal} placeholder="V6B 1A1" autoCapitalize="characters" />
              <Input label="Country" value={addressCountry} onChangeText={setAddressCountry} placeholder="Canada" />

              {/* ─ Bank Info ─ */}
              <Text style={styles.subSectionTitle}>Bank Info (Direct Deposit)</Text>
              <Text style={styles.subSectionNote}>Required to receive payment for completed shifts.</Text>
              <Input label="Institution Number (3 digits)" value={bankInstitution} onChangeText={setBankInstitution} keyboardType="numeric" placeholder="001" />
              <Input label="Transit Number (5 digits)" value={bankTransit} onChangeText={setBankTransit} keyboardType="numeric" placeholder="00001" />
              <Input label="Account Number" value={bankAccount} onChangeText={setBankAccount} keyboardType="numeric" placeholder="1234567" />
              <Input label="Account Holder Name" value={bankHolder} onChangeText={setBankHolder} placeholder="Full legal name on account" />

              <Button
                label={savingPrivate ? 'Saving…' : 'Save Private Info'}
                onPress={savePrivateInfo}
                disabled={savingPrivate}
                fullWidth
                icon={<Lock size={15} color={C.white} />}
              />
            </Card>
          )}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Edit Resume (collapsed form)
        ════════════════════════════════════════ */}
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
                <Input label="Education / Training" value={editEducation} onChangeText={setEditEducation} multiline numberOfLines={2} />
                <Input label="References" value={editReferences} onChangeText={setEditReferences} multiline numberOfLines={2} placeholder="Name, role, company, phone" />
                <Input label="Emergency Contact Name" value={editEmergencyName} onChangeText={setEditEmergencyName} />
                <Input label="Emergency Contact Phone" value={editEmergencyPhone} onChangeText={setEditEmergencyPhone} keyboardType="phone-pad" />
                <Input label="LinkedIn URL" value={editLinkedin} onChangeText={setEditLinkedin} autoCapitalize="none" />
                <Input label="Website / Portfolio" value={editWebsite} onChangeText={setEditWebsite} autoCapitalize="none" />
                <View>
                  <Text style={styles.fieldLabel}>Skills</Text>
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

        {/* ── Log out ── */}
        {!editing && (
          <View style={[styles.section, { marginTop: 8 }]}>
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Log Out', 'Are you sure you want to log out?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Log Out', style: 'destructive', onPress: () => void logout() },
                ]);
              }}
              style={styles.logoutBtn}
              activeOpacity={0.8}
            >
              <LogOut size={18} color={C.red} />
              <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>
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

  // Hero
  profileCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  avatarWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.accent },
  avatarImage: { width: '100%', height: '100%', borderRadius: 36 },
  cameraBadge: { position: 'absolute', right: -2, bottom: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, fontWeight: '800' as const, color: C.accent },
  profileInfo: { flex: 1, gap: 5 },
  displayName: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  tagline: { fontSize: 13, color: C.textSecondary },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedText: { fontSize: 11, color: C.green, fontWeight: '600' as const },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phoneText: { fontSize: 12, color: C.textMuted },

  // Stats
  statsCard: { marginBottom: 20 },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary },

  // Completion
  completionWrap: { marginBottom: 20, gap: 6 },
  completionTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  completionLabel: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  completionHint: { fontSize: 11, color: C.accent },
  completionBg: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' as const },
  completionFill: { height: 6, borderRadius: 3 },
  missingRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  missingChip: { backgroundColor: C.yellowDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  missingText: { fontSize: 11, color: C.yellow, fontWeight: '600' as const },

  // Section
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  sectionHeaderCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 12 },
  sectionHeaderTitle: { fontSize: 16, fontWeight: '800' as const, color: C.text },

  // Identity cards
  identityCard: { marginBottom: 0 },
  identityCardTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 4 },
  identityCardSub: { fontSize: 12, color: C.textMuted, marginBottom: 12, lineHeight: 17 },
  idDocList: { gap: 8, marginBottom: 12 },
  idDocRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, padding: 10, borderRadius: 8 },
  idDocLabel: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: C.text },
  idDocStatus: { fontSize: 12, fontWeight: '700' as const },
  idMissingBadge: { backgroundColor: C.yellowDim, borderRadius: 8, padding: 10, marginBottom: 12 },
  idMissingText: { fontSize: 12, color: C.yellow, fontWeight: '600' as const },

  // Chips
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 },
  chip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent },
  chipEmoji: { fontSize: 13 },

  // Certs
  certCard: { marginBottom: 8 },
  certRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  certIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  certType: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  certExpiry: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  rejectNote: { fontSize: 12, color: C.red, marginTop: 4 },
  formTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginBottom: 10 },

  // Skills
  skillsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  skillChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.accentDim, borderRadius: 8 },
  skillText: { fontSize: 13, color: C.accent, fontWeight: '600' as const },
  cityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.blueDim, borderRadius: 8 },
  cityText: { fontSize: 12, color: C.blue, fontWeight: '600' as const },
  addSkillPrompt: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' as const },
  addSkillPromptText: { fontSize: 13, color: C.textMuted },
  skillToggle: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  skillToggleActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  skillToggleText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  skillToggleTextActive: { color: C.accent },

  // Bio
  bioText: { fontSize: 14, color: C.textSecondary, lineHeight: 22 },

  // Photos
  visibilityRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  visibilityChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  visibilityActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  visibilityText: { fontSize: 11, color: C.textMuted, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  visibilityTextActive: { color: C.accent },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoCell: { width: '31.8%', aspectRatio: 0.86, backgroundColor: C.card, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  photoImage: { width: '100%', flex: 1 },
  photoMeta: { fontSize: 9, color: C.textMuted, padding: 4, textTransform: 'capitalize' as const },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Private info
  privateHeaderCard: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 14, backgroundColor: C.bgSecondary, borderRadius: 12, borderWidth: 1, borderColor: C.purple + '40', marginBottom: 10 },
  privateHeaderLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  privateSubtitle: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  privacyNotice: { fontSize: 12, color: C.textMuted, lineHeight: 18, backgroundColor: C.card, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.border },
  subSectionTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text, marginTop: 8, marginBottom: 4 },
  subSectionNote: { fontSize: 11, color: C.textMuted, marginBottom: 10 },
  fieldLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const, marginBottom: 8 },
  formGap: { gap: 12 },
  hint: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  noCertText: { fontSize: 13, color: C.textMuted, textAlign: 'center' },

  // Logout
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: 12, backgroundColor: C.red + '15', borderWidth: 1, borderColor: C.red + '40' },
  logoutText: { fontSize: 15, fontWeight: '700' as const, color: C.red },

  // Empty state
  emptyProfileCard: { width: '88%', gap: 14 },
  noProfileTitle: { fontSize: 20, color: C.text, fontWeight: '800' as const, textAlign: 'center' },
  noProfileText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
});
