import React, { useEffect, useMemo, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Image, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Award, MapPin, DollarSign, CheckCircle, Edit, Upload, FileText, Camera, Eye, Lock, ChevronDown, ChevronUp, LogOut, Shield, Home, CreditCard, Phone, User, Star, Globe, Building2, ExternalLink, MessageSquare, Plus, X } from 'lucide-react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useDockData } from '@/hooks/useDockData';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DateField from '@/components/ui/DateField';
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
// Province/state is a free-text field to support global workers

/** Read a local file URI (from DocumentPicker) as a Blob without using fetch(). */
async function readLocalFileAsBlob(uri: string, mimeType: string): Promise<Blob> {
  try {
    // expo-file-system reliably reads file:// URIs on both iOS and Android
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
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

interface OwnReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_company_id: string | null;
  reviewer_company: { name: string } | null;
}

type ViewMode = 'mine' | 'employer' | 'public';

interface PendingRatingRow {
  assignment_id: string;
  shift_id: string;
  employer_company_id: string;
  shift_title: string | null;
  ended_at: string;
  company_name: string | null;
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
  const { workerProfiles, updateWorkerProfile, refetch, isLoading: bootstrapLoading } = useDockData();
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
      setAddressCountry(d.country ?? '');
      setNationality(d.nationality ?? '');
      setGovtIdType((d.govt_id_type as GovtIdType) ?? '');
    }
  }, [privateQuery.data]);

  const ratingSummaryQuery = useQuery({
    queryKey: ['worker-own-rating-summary', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<{ count: number; avg_rating: number } | null> => {
      if (!user) return null;
      const { data } = await supabase
        .from('review_summaries')
        .select('count, avg_rating')
        .eq('target_kind', 'worker')
        .eq('target_id', user.id)
        .maybeSingle();
      return data as { count: number; avg_rating: number } | null;
    },
    staleTime: 30_000,
  });

  const ownReviewsQuery = useQuery({
    queryKey: ['worker-own-reviews', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<OwnReviewRow[]> => {
      if (!user) return [];
      const { data } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at, reviewer_company_id, reviewer_company:reviewer_company_id(name)')
        .eq('target_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      return (data ?? []) as unknown as OwnReviewRow[];
    },
    staleTime: 30_000,
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
  const [uploadVisibility, setUploadVisibility] = useState<'private' | 'company' | 'public'>('company');
  const [showUploadPicker, setShowUploadPicker] = useState(false);

  // ── Preview mode (Private / Employer / Public) ──────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('mine');
  const [addingCert, setAddingCert] = useState(false);
  const [certType, setCertType] = useState<CertType>('Forklift');
  const [certExpiry, setCertExpiry] = useState('');
  const [showCrcForm, setShowCrcForm] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [inlineBio, setInlineBio] = useState('');
  const [savingBio, setSavingBio] = useState(false);

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

  /**
   * Persist a quick change (skills or coverage cities) immediately without opening
   * the full edit form. Uses the canonical RPC, falling back to a direct update.
   */
  const persistQuick = async (patch: { skills?: ShiftCategory[]; cities?: string[]; bio?: string }) => {
    if (!profile) return;
    const skills = patch.skills ?? profile.skills;
    const cities = patch.cities ?? profile.coverageCities;
    const bio = patch.bio ?? profile.bio ?? '';
    setSavingQuick(true);
    try {
      const ex = extendedQuery.data;
      const { error } = await supabase.rpc('update_my_worker_profile', {
        p_bio: bio,
        p_skills: skills,
        p_coverage_cities: cities,
        p_hourly_expectation: profile.hourlyExpectation ?? 0,
        p_tagline: ex?.tagline ?? '',
        p_phone: ex?.phone ?? '',
        p_languages: ex?.languages ?? [],
        p_experience_years: ex?.experience_years ?? 0,
        p_transportation: ex?.transportation ?? '',
        p_emergency_contact_name: ex?.emergency_contact_name ?? '',
        p_emergency_contact_phone: ex?.emergency_contact_phone ?? '',
        p_references_text: ex?.references_text ?? '',
        p_work_history: ex?.work_history ?? '',
        p_education: ex?.education ?? '',
        p_preferred_shift: ex?.preferred_shift ?? '',
        p_linkedin_url: ex?.linkedin_url ?? '',
        p_website_url: ex?.website_url ?? '',
      });
      if (error) {
        await updateWorkerProfile(profile.id, { skills, coverageCities: cities, bio });
      }
      await refetch();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSavingQuick(false);
    }
  };

  const addCity = () => {
    if (!profile) return;
    const c = newCity.trim();
    if (!c) return;
    if (profile.coverageCities.some((x) => x.toLowerCase() === c.toLowerCase())) { setNewCity(''); return; }
    void persistQuick({ cities: [...profile.coverageCities, c] });
    setNewCity('');
  };

  const removeCity = (c: string) => {
    if (!profile) return;
    void persistQuick({ cities: profile.coverageCities.filter((x) => x !== c) });
  };

  const goToMissing = (label: string) => {
    if (label === 'a certification') {
      setAddingCert(true);
      return;
    }
    if (label === 'a bio') {
      setInlineBio(profile?.bio ?? '');
      setEditingBio(true);
      return;
    }
    openEdit();
  };

  const saveInlineBio = async () => {
    if (!profile) return;
    setSavingBio(true);
    try {
      await persistQuick({ bio: inlineBio.trim() });
      setEditingBio(false);
    } finally {
      setSavingBio(false);
    }
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

  /** Encrypt a PII field via the DB's encrypt_pii helper. Returns null for empty input. */
  const encryptField = async (value: string | null): Promise<string | null> => {
    if (!value) return null;
    const { data, error } = await supabase.rpc('encrypt_pii', { p_value: value });
    if (error) throw new Error(`Encryption failed: ${error.message}`);
    return data as string;
  };

  const savePrivateInfo = async () => {
    if (!user) return;
    setSavingPrivate(true);
    try {
      // Encrypt sensitive PII fields before storing
      const [sinEnc, bankAccountEnc, bankTransitEnc, bankInstitutionEnc] = await Promise.all([
        encryptField(sin || null),
        encryptField(bankAccount || null),
        encryptField(bankTransit || null),
        encryptField(bankInstitution || null),
      ]);

      const payload: Record<string, unknown> = {
        user_id: user.id,
        date_of_birth: dob || null,
        gender: gender || null,
        work_permit_status: workPermit || null,
        // Plaintext columns kept for migration safety (dropped in a future migration)
        sin_number: sin || null,
        bank_institution_number: bankInstitution || null,
        bank_transit_number: bankTransit || null,
        bank_account_number: bankAccount || null,
        bank_account_holder_name: bankHolder || null,
        // Encrypted columns (pgcrypto-backed)
        sin_number_enc: sinEnc,
        bank_account_number_enc: bankAccountEnc,
        bank_transit_number_enc: bankTransitEnc,
        bank_institution_number_enc: bankInstitutionEnc,
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
      await queryClient.invalidateQueries({ queryKey: ['dock', 'bootstrap'] });
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
      const { data: row, error: insertErr } = await supabase.from('work_photos').insert({ worker_user_id: user.id, file_path: 'pending', caption: '', visibility: uploadVisibility, moderation_status: 'pending' }).select('id').single();
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
      setShowCrcForm(false);
      setCertExpiry('');
      void queryClient.invalidateQueries({ queryKey: ['worker-certs', user?.id] });
      Alert.alert('Certificate Submitted', 'Admin will review and approve your certificate.');
    },
    onError: (err: unknown) => Alert.alert('Upload failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  /**
   * Upload government ID (stored in certifications bucket as a special cert type).
   *
   * Dedup strategy:
   *  - If an existing Pending row for the same ID type already exists, we re-use it
   *    (update its file_path) rather than creating a duplicate.
   *  - If the previous row was Approved/Rejected/Expired a fresh Pending row is inserted
   *    so the admin can review the replacement document.
   *  - The UI already deduplicates the display list via `idDocs` (latest per type).
   */
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

      const idCertType = `GovtID_${govtIdType}`;

      // Check for an existing Pending row for this ID type — reuse it to avoid duplicates.
      const { data: existingPending } = await supabase
        .from('worker_certifications')
        .select('id')
        .eq('worker_user_id', user.id)
        .eq('type', idCertType)
        .eq('status', 'Pending')
        .maybeSingle();

      let certId: string;
      let isNew = false;

      if (existingPending) {
        // Re-upload: reuse the existing Pending row so admin sees a single entry
        certId = existingPending.id as string;
      } else {
        // New submission (no Pending row — previous was Approved/Rejected/Expired or first upload)
        const { data: row, error: insertErr } = await supabase
          .from('worker_certifications')
          .insert({ worker_user_id: user.id, type: idCertType, expiry_date: null, file_path: '', certificate_file: '', notes: `Government ID: ${govtIdType}` })
          .select('id').single();
        if (insertErr || !row) throw new Error(insertErr?.message ?? 'Unable to create ID record');
        certId = row.id as string;
        isNew = true;
      }

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
        // On upload failure, clean up only if we inserted a fresh row
        if (isNew) await supabase.from('worker_certifications').delete().eq('id', certId);
        throw err;
      }
      await supabase.from('worker_certifications').update({ file_path: path, certificate_file: path }).eq('id', certId);
      // Mirror latest ID path + type in private info for quick admin reference
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
  // Deduplicate: keep only the most-recent row per GovtID type so the UI never shows duplicate IDs.
  const idDocsRaw = myCerts.filter((c) => c.type.startsWith('GovtID_'));
  const idDocs = Object.values(
    idDocsRaw.reduce((acc, doc) => {
      const key = doc.type;
      if (!acc[key] || doc.created_at > acc[key].created_at) acc[key] = doc;
      return acc;
    }, {} as Record<string, CertRow>),
  );
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
    const hasBio = (profile.bio?.trim().length ?? 0) >= 10;
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

  const displayedPhotos = useMemo(() => {
    const photos = photosQuery.data ?? [];
    if (photoVisibility === 'private') return photos;
    if (photoVisibility === 'company') return photos.filter((p) => p.visibility === 'company' || p.visibility === 'public');
    return photos.filter((p) => p.visibility === 'public');
  }, [photosQuery.data, photoVisibility]);

  const photoCounts = useMemo(() => {
    const photos = photosQuery.data ?? [];
    return {
      private: photos.filter((p) => p.visibility === 'private').length,
      company: photos.filter((p) => p.visibility === 'company').length,
      public: photos.filter((p) => p.visibility === 'public').length,
    };
  }, [photosQuery.data]);

  // ── Pending ratings: completed shifts the worker has not yet rated ──
  const pendingRatingsQuery = useQuery({
    queryKey: ['worker-pending-ratings', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<PendingRatingRow[]> => {
      if (!user) return [];
      const { data: assignments } = await supabase
        .from('shift_assignments')
        .select('id, shift_id, employer_company_id, status, shift:shift_id(title, end_at, company:employer_company_id(name))')
        .eq('worker_user_id', user.id)
        .in('status', ['Completed', 'HoursConfirmed'])
        .order('id', { ascending: false })
        .limit(20);
      const rows = (assignments ?? []) as unknown as Array<{ id: string; shift_id: string; employer_company_id: string; shift: { title: string | null; end_at: string | null; company: { name: string | null } | null } | null }>;
      if (rows.length === 0) return [];
      const { data: existing } = await supabase
        .from('reviews')
        .select('context_id')
        .eq('reviewer_user_id', user.id)
        .eq('context_kind', 'shift_assignment')
        .in('context_id', rows.map((r) => r.id));
      const reviewed = new Set((existing ?? []).map((e) => (e as { context_id: string }).context_id));
      return rows
        .filter((r) => !reviewed.has(r.id))
        .map((r) => ({
          assignment_id: r.id,
          shift_id: r.shift_id,
          employer_company_id: r.employer_company_id,
          shift_title: r.shift?.title ?? null,
          ended_at: r.shift?.end_at ?? '',
          company_name: r.shift?.company?.name ?? null,
        }))
        .slice(0, 5);
    },
    staleTime: 30_000,
  });

  if (bootstrapLoading && !profile) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.noProfileText}>Loading your profile…</Text>
      </View>
    );
  }

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

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 16}
      >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 220 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >

        {/* ── Preview mode tabs ── */}
        <View style={styles.viewTabsWrap}>
          <Text style={styles.viewTabsLabel}>Viewing your profile as:</Text>
          <View style={styles.viewTabsRow}>
            {([
              { key: 'mine' as const, label: 'My View', icon: <User size={13} color={viewMode === 'mine' ? C.accent : C.textMuted} /> },
              { key: 'employer' as const, label: 'Employer View', icon: <Building2 size={13} color={viewMode === 'employer' ? C.accent : C.textMuted} /> },
              { key: 'public' as const, label: 'Public View', icon: <Globe size={13} color={viewMode === 'public' ? C.accent : C.textMuted} /> },
            ]).map((t) => (
              <TouchableOpacity key={t.key} onPress={() => setViewMode(t.key)} style={[styles.viewTab, viewMode === t.key && styles.viewTabActive]}>
                {t.icon}
                <Text style={[styles.viewTabText, viewMode === t.key && styles.viewTabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {viewMode === 'employer' && (
            <View style={[styles.previewBanner, { backgroundColor: C.blueDim, borderColor: C.blue + '40' }]}>
              <Building2 size={12} color={C.blue} />
              <Text style={[styles.previewBannerText, { color: C.blue }]}>This is what employers see when reviewing your application. Private info, Government ID, bank details and tax info are never shown.</Text>
            </View>
          )}
          {viewMode === 'public' && (
            <View style={[styles.previewBanner, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
              <Globe size={12} color={C.green} />
              <Text style={[styles.previewBannerText, { color: C.green }]}>This is the public-facing profile. Only public-visible photos and approved credentials appear here.</Text>
            </View>
          )}
        </View>

        {/* ── Pending rating action ── */}
        {viewMode === 'mine' && (pendingRatingsQuery.data ?? []).length > 0 && (
          <Card style={styles.pendingRateCard}>
            <View style={styles.pendingRateHeader}>
              <Star size={14} color={C.yellow} fill={C.yellow} />
              <Text style={styles.pendingRateTitle}>Rate your recent employer{(pendingRatingsQuery.data ?? []).length > 1 ? 's' : ''}</Text>
            </View>
            {(pendingRatingsQuery.data ?? []).slice(0, 3).map((p) => (
              <TouchableOpacity
                key={p.assignment_id}
                onPress={() => router.push('/worker/my-shifts')}
                style={styles.pendingRateRow}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingRateShift}>{p.shift_title ?? 'Shift'}</Text>
                  <Text style={styles.pendingRateCompany}>{p.company_name ?? 'Employer'}</Text>
                </View>
                <View style={styles.pendingRateBtn}>
                  <Text style={styles.pendingRateBtnText}>Rate Now</Text>
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        )}

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

        {/* ── Ratings & Reviews (always shown) ── */}
        {(() => {
          const count = Number(ratingSummaryQuery.data?.count ?? 0);
          const avg = Number(ratingSummaryQuery.data?.avg_rating ?? 0);
          const reviews = ownReviewsQuery.data ?? [];
          return (
            <Card style={styles.ratingsCard}>
              <View style={styles.ratingsHeaderRow}>
                <Star size={15} color={C.yellow} fill={C.yellow} />
                <Text style={styles.ratingsTitle}>Ratings & Reviews</Text>
                {count > 0 && <Text style={styles.ratingsAvgNum}>{avg.toFixed(1)}</Text>}
              </View>
              {count === 0 ? (
                <Text style={styles.ratingsEmptyText}>No reviews yet. Complete shifts to build your rating.</Text>
              ) : (
                <>
                  <View style={styles.ratingsStarsRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={13}
                        color={n <= Math.round(avg) ? C.yellow : C.border}
                        fill={n <= Math.round(avg) ? C.yellow : 'transparent'}
                      />
                    ))}
                    <Text style={styles.ratingsCount}>{count} review{count === 1 ? '' : 's'}</Text>
                  </View>
                  {reviews.slice(0, 3).map((r) => (
                    <View key={r.id} style={styles.reviewRow}>
                      <View style={styles.reviewStarsSmall}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} size={10} color={n <= r.rating ? C.yellow : C.border} fill={n <= r.rating ? C.yellow : 'transparent'} />
                        ))}
                        <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
                      </View>
                      {r.comment ? <Text style={styles.reviewComment}>&quot;{r.comment}&quot;</Text> : null}
                      {r.reviewer_company?.name ? <Text style={styles.reviewerName}>— {r.reviewer_company.name}</Text> : null}
                    </View>
                  ))}
                  {count > 3 && user?.id && (
                    <TouchableOpacity onPress={() => router.push(`/reviews/worker/${user.id}` as any)} style={styles.viewAllReviewsBtn}>
                      <MessageSquare size={12} color={C.accent} />
                      <Text style={styles.viewAllReviewsText}>View all {count} reviews</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </Card>
          );
        })()}

        {/* ── Quick nav buttons ── */}
        {viewMode === 'mine' && user?.id && (
          <View style={styles.quickNavRow}>
            <TouchableOpacity onPress={() => router.push(`/worker/${user.id}` as any)} style={styles.quickNavBtn} activeOpacity={0.8}>
              <ExternalLink size={13} color={C.accent} />
              <Text style={styles.quickNavText}>Open Public Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push(`/reviews/worker/${user.id}` as any)} style={styles.quickNavBtn} activeOpacity={0.8}>
              <MessageSquare size={13} color={C.accent} />
              <Text style={styles.quickNavText}>All Reviews</Text>
            </TouchableOpacity>
          </View>
        )}

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
                <TouchableOpacity key={m} style={styles.missingChip} activeOpacity={0.7} onPress={() => goToMissing(m)}>
                  <Text style={styles.missingText}>+ {m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Identity & Legal Documents
            (most important — employers and platform need these)
            Hidden in Employer/Public preview — these are private to worker & admin.
        ════════════════════════════════════════ */}
        {viewMode === 'mine' && (
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
            {showCrcForm ? (
              <View style={styles.formGap}>
                <DateField
                  label="Expiry Date"
                  value={certExpiry}
                  onChange={setCertExpiry}
                  placeholder="Select expiry date"
                  minimumDate={new Date()}
                />
                <Button
                  label={uploadCertMutation.isPending ? 'Uploading…' : 'Pick File & Submit'}
                  onPress={() => { setCertType('CriminalRecordCheck'); uploadCertMutation.mutate(); }}
                  disabled={uploadCertMutation.isPending || !certExpiry}
                  fullWidth
                  icon={<Upload size={15} color={C.white} />}
                />
                <Button label="Cancel" onPress={() => { setShowCrcForm(false); setCertExpiry(''); }} variant="ghost" fullWidth />
                <Text style={styles.hint}>Accepted: PDF or image. Admin will review and approve.</Text>
              </View>
            ) : (
              <Button
                label={criminalRecordCert ? 'Replace CRC Document' : 'Upload CRC Document'}
                onPress={() => { setCertType('CriminalRecordCheck'); setCertExpiry(criminalRecordCert?.expiry_date ?? ''); setShowCrcForm(true); }}
                variant="ghost"
                fullWidth
                icon={criminalRecordCert ? <Edit size={15} color={C.accent} /> : <Upload size={15} color={C.accent} />}
              />
            )}
          </Card>
        </View>
        )}

        {/* ════════════════════════════════════════
            SECTION: Work Certifications
            In employer/public preview: show only Approved certs as badges.
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <SectionHeader
            title={viewMode === 'mine' ? 'Work Certifications' : 'Approved Qualifications'}
            action={viewMode === 'mine' ? (addingCert ? 'Cancel' : '+ Add') : undefined}
            onAction={viewMode === 'mine' ? () => setAddingCert((v) => !v) : undefined}
          />

          {viewMode !== 'mine' && (
            (() => {
              const approved = workCerts.filter((c) => c.status === 'Approved');
              if (approved.length === 0) {
                return <Card><Text style={styles.noCertText}>No approved qualifications yet.</Text></Card>;
              }
              return (
                <View style={styles.qualBadgeRow}>
                  {approved.map((c) => (
                    <View key={c.id} style={styles.qualBadge}>
                      <Award size={12} color={C.green} />
                      <Text style={styles.qualBadgeText}>{c.type}</Text>
                      {c.expiry_date && <Text style={styles.qualBadgeExpiry}>exp. {c.expiry_date}</Text>}
                    </View>
                  ))}
                </View>
              );
            })()
          )}

          {viewMode === 'mine' && <></>}
          {viewMode === 'mine' && (

          <>
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
              <DateField label="Expiry Date" value={certExpiry} onChange={setCertExpiry} placeholder="Select expiry date" minimumDate={new Date()} />
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
          </>
          )}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Skills & Availability
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skills</Text>
          {viewMode === 'mine' ? (
            <>
              <Text style={styles.inlineHint}>Tap to add or remove your skills</Text>
              <View style={styles.skillsRow}>
                {ALL_SKILLS.map((s) => {
                  const active = profile.skills.includes(s);
                  return (
                    <TouchableOpacity
                      key={s}
                      disabled={savingQuick}
                      onPress={() => void persistQuick({ skills: active ? profile.skills.filter((x) => x !== s) : [...profile.skills, s] })}
                      style={[styles.skillToggle, active && styles.skillToggleActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.skillToggleText, active && styles.skillToggleTextActive]}>{active ? '✓ ' : '+ '}{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <View style={styles.skillsRow}>
              {profile.skills.length === 0 ? (
                <Text style={styles.addSkillPromptText}>No skills listed.</Text>
              ) : profile.skills.map((s) => (
                <View key={s} style={styles.skillChip}><Text style={styles.skillText}>{s}</Text></View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coverage Cities</Text>
          {viewMode === 'mine' && (
            <View style={styles.cityInputRow}>
              <View style={styles.flex1}>
                <Input value={newCity} onChangeText={setNewCity} placeholder="Add a city (e.g. Chicago)" />
              </View>
              <TouchableOpacity onPress={addCity} disabled={savingQuick || !newCity.trim()} style={[styles.addCityBtn, (!newCity.trim()) && styles.addCityBtnDisabled]} activeOpacity={0.8}>
                <Plus size={18} color={C.white} />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.skillsRow}>
            {profile.coverageCities.length === 0 ? (
              <Text style={styles.addSkillPromptText}>{viewMode === 'mine' ? 'Add the cities you can work in.' : 'No coverage cities listed.'}</Text>
            ) : profile.coverageCities.map((c) => (
              viewMode === 'mine' ? (
                <TouchableOpacity key={c} onPress={() => removeCity(c)} disabled={savingQuick} style={styles.cityChip} activeOpacity={0.7}>
                  <MapPin size={11} color={C.blue} />
                  <Text style={styles.cityText}>{c}</Text>
                  <X size={12} color={C.blue} />
                </TouchableOpacity>
              ) : (
                <View key={c} style={styles.cityChip}>
                  <MapPin size={11} color={C.blue} />
                  <Text style={styles.cityText}>{c}</Text>
                </View>
              )
            ))}
          </View>
        </View>

        {/* About */}
        {viewMode === 'mine' ? (
          <View style={styles.section}>
            <View style={sh.row}>
              <Text style={styles.sectionTitle}>About Me</Text>
              {!editingBio && (
                <TouchableOpacity onPress={() => { setInlineBio(profile.bio ?? ''); setEditingBio(true); }} style={sh.actionBtn}>
                  <Text style={sh.actionText}>{profile.bio ? 'Edit' : '+ Add'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {editingBio ? (
              <Card elevated style={styles.formGap}>
                <Input
                  value={inlineBio}
                  onChangeText={setInlineBio}
                  placeholder="Write a short intro about your experience, reliability, and what you're great at (min 10 characters)…"
                  multiline
                  numberOfLines={4}
                />
                <Text style={styles.hint}>{inlineBio.trim().length}/10 characters minimum to count toward your profile.</Text>
                <Button
                  label={savingBio ? 'Saving…' : 'Save Bio'}
                  onPress={saveInlineBio}
                  disabled={savingBio || inlineBio.trim().length < 10}
                  fullWidth
                />
                <Button label="Cancel" onPress={() => setEditingBio(false)} variant="ghost" fullWidth />
              </Card>
            ) : profile.bio ? (
              <Card><Text style={styles.bioText}>{profile.bio}</Text></Card>
            ) : (
              <Card><Text style={styles.addSkillPromptText}>No bio yet. Tap “+ Add” to introduce yourself to employers.</Text></Card>
            )}
          </View>
        ) : profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Me</Text>
            <Card><Text style={styles.bioText}>{profile.bio}</Text></Card>
          </View>
        ) : null}

        {/* ════════════════════════════════════════
            SECTION: Work Photos
            In Employer view: shows company + public approved photos only.
            In Public view: shows public approved only.
            In My view: filterable by visibility tab + per-photo badge + upload visibility selector.
        ════════════════════════════════════════ */}
        <View style={styles.section}>
          <SectionHeader
            title="Work Photos"
            action={viewMode === 'mine' ? (showUploadPicker ? 'Cancel' : '+ Upload') : undefined}
            onAction={viewMode === 'mine' ? () => setShowUploadPicker((v) => !v) : undefined}
          />

          {viewMode === 'mine' && showUploadPicker && (
            <Card elevated style={[styles.formGap, { marginBottom: 12 }]}>
              <Text style={styles.formTitle}>Choose visibility for this photo</Text>
              <View style={styles.uploadVisRow}>
                <TouchableOpacity onPress={() => setUploadVisibility('private')} style={[styles.uploadVisChip, uploadVisibility === 'private' && styles.uploadVisChipActive]}>
                  <Lock size={13} color={uploadVisibility === 'private' ? C.purple : C.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.uploadVisTitle, uploadVisibility === 'private' && { color: C.purple }]}>Private</Text>
                    <Text style={styles.uploadVisSub}>Only you</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setUploadVisibility('company')} style={[styles.uploadVisChip, uploadVisibility === 'company' && styles.uploadVisChipActive]}>
                  <Building2 size={13} color={uploadVisibility === 'company' ? C.blue : C.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.uploadVisTitle, uploadVisibility === 'company' && { color: C.blue }]}>Company</Text>
                    <Text style={styles.uploadVisSub}>Employers you work with</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setUploadVisibility('public')} style={[styles.uploadVisChip, uploadVisibility === 'public' && styles.uploadVisChipActive]}>
                  <Globe size={13} color={uploadVisibility === 'public' ? C.green : C.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.uploadVisTitle, uploadVisibility === 'public' && { color: C.green }]}>Public</Text>
                    <Text style={styles.uploadVisSub}>Public profile</Text>
                  </View>
                </TouchableOpacity>
              </View>
              <Button
                label={uploadWorkPhotoMutation.isPending ? 'Uploading…' : `Upload as ${uploadVisibility}`}
                onPress={() => { uploadWorkPhotoMutation.mutate(); setShowUploadPicker(false); }}
                disabled={uploadWorkPhotoMutation.isPending}
                fullWidth
                icon={<Upload size={15} color={C.white} />}
              />
              <Text style={styles.hint}>Photos are reviewed by admin before becoming visible.</Text>
            </Card>
          )}

          {viewMode === 'mine' && (
            <>
              <Text style={styles.visibilityLabel}>Show photos as:</Text>
              <View style={styles.visibilityRow}>
                <TouchableOpacity onPress={() => setPhotoVisibility('private')} style={[styles.visibilityChip, photoVisibility === 'private' && styles.visibilityActive]}>
                  <Lock size={11} color={photoVisibility === 'private' ? C.accent : C.textMuted} />
                  <Text style={[styles.visibilityText, photoVisibility === 'private' && styles.visibilityTextActive]}>All ({photosQuery.data?.length ?? 0})</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPhotoVisibility('company')} style={[styles.visibilityChip, photoVisibility === 'company' && styles.visibilityActive]}>
                  <Building2 size={11} color={photoVisibility === 'company' ? C.accent : C.textMuted} />
                  <Text style={[styles.visibilityText, photoVisibility === 'company' && styles.visibilityTextActive]}>Employers see ({photoCounts.company + photoCounts.public})</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPhotoVisibility('public')} style={[styles.visibilityChip, photoVisibility === 'public' && styles.visibilityActive]}>
                  <Globe size={11} color={photoVisibility === 'public' ? C.accent : C.textMuted} />
                  <Text style={[styles.visibilityText, photoVisibility === 'public' && styles.visibilityTextActive]}>Public ({photoCounts.public})</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.visibilityHint}>
                {photoVisibility === 'private' && 'Showing every photo you uploaded — only you see this combined view.'}
                {photoVisibility === 'company' && 'Showing the photos employers see when reviewing your application.'}
                {photoVisibility === 'public' && 'Showing photos visible on your public profile.'}
              </Text>
            </>
          )}

          {(() => {
            const approvedOnly = (photosQuery.data ?? []).filter((p) => p.moderation_status === 'approved');
            const employerVisible = approvedOnly.filter((p) => p.visibility === 'company' || p.visibility === 'public');
            const publicVisible = approvedOnly.filter((p) => p.visibility === 'public');
            const list = viewMode === 'mine' ? displayedPhotos : viewMode === 'employer' ? employerVisible : publicVisible;
            if (list.length === 0) {
              const emptyText =
                viewMode === 'mine'
                  ? (photoVisibility === 'private' ? 'No work photos uploaded yet. Tap +Upload above.' : `No ${photoVisibility === 'company' ? 'employer-visible' : 'public-visible'} photos yet. Upload a photo and set visibility to ${photoVisibility === 'company' ? 'Company' : 'Public'}.`)
                  : viewMode === 'employer'
                  ? 'No employer-visible photos yet.'
                  : 'No public-visible photos yet.';
              return <Card><Text style={styles.noCertText}>{emptyText}</Text></Card>;
            }
            return (
              <View style={styles.photoGrid}>
                {list.map((p) => {
                  const visColor = p.visibility === 'public' ? C.green : p.visibility === 'company' ? C.blue : C.purple;
                  const VIcon = p.visibility === 'public' ? Globe : p.visibility === 'company' ? Building2 : Lock;
                  return (
                    <View key={p.id} style={styles.photoCell}>
                      {p.signed_url ? (
                        <Image source={{ uri: p.signed_url }} style={styles.photoImage} />
                      ) : (
                        <View style={styles.photoPlaceholder}><Camera size={18} color={C.textMuted} /></View>
                      )}
                      <View style={[styles.photoVisBadge, { backgroundColor: visColor + '22' }]}>
                        <VIcon size={9} color={visColor} />
                        <Text style={[styles.photoVisBadgeText, { color: visColor }]}>{p.visibility}</Text>
                      </View>
                      {viewMode === 'mine' && (
                        <Text style={styles.photoMeta}>{p.moderation_status}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </View>

        {/* ════════════════════════════════════════
            SECTION: Private & Financial Information
            Hidden entirely in Employer/Public preview — never shared.
        ════════════════════════════════════════ */}
        {viewMode === 'mine' && (
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
              <Input label="City" value={addressCity} onChangeText={setAddressCity} placeholder="e.g. Chicago" />
              <Input label="State / Province / Region" value={addressProvince} onChangeText={setAddressProvince} placeholder="e.g. Illinois" />
              <Input label="Postal / ZIP Code" value={addressPostal} onChangeText={setAddressPostal} placeholder="e.g. 60601" autoCapitalize="characters" />
              <Input label="Country" value={addressCountry} onChangeText={setAddressCountry} placeholder="e.g. United States" />

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
        )}

        {/* ════════════════════════════════════════
            SECTION: Edit Resume (collapsed form, My view only)
        ════════════════════════════════════════ */}
        {editing && (
          <View style={styles.section}>
            <Card elevated>
              <Text style={styles.sectionTitle}>Edit Profile</Text>
              <View style={styles.formGap}>
                <Input label="Headline / Tagline" value={editTagline} onChangeText={setEditTagline} placeholder="Forklift operator · 5 yrs exp." />
                <Input label="About Me" value={editBio} onChangeText={setEditBio} multiline numberOfLines={3} />
                <Input label="Phone" value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" placeholder="+1 555 000 0000" />
                <Input label="Hourly Rate Expectation ($)" value={editRate} onChangeText={setEditRate} keyboardType="numeric" />
                <Input label="Years of Experience" value={editExperience} onChangeText={setEditExperience} keyboardType="numeric" placeholder="3" />
                <Input label="Coverage Cities (comma separated)" value={editCities} onChangeText={setEditCities} placeholder="e.g. Chicago, Naperville, Aurora" />
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

        {/* ── Log out (My view only) ── */}
        {!editing && viewMode === 'mine' && (
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
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.bgSecondary, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  editBtnText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  flex1: { flex: 1 },
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
  inlineHint: { fontSize: 12, color: C.textMuted, marginBottom: 10 },
  cityInputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 12 },
  addCityBtn: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  addCityBtnDisabled: { opacity: 0.4 },
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

  // Ratings
  ratingsCard: { marginBottom: 20, gap: 10 },
  ratingsHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  ratingsTitle: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: C.text },
  ratingsAvgNum: { fontSize: 22, fontWeight: '800' as const, color: C.yellow },
  ratingsStarsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  ratingsCount: { fontSize: 12, color: C.textSecondary, marginLeft: 6 },
  reviewRow: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  reviewStarsSmall: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3 },
  reviewDate: { fontSize: 10, color: C.textMuted, marginLeft: 6 },
  reviewComment: { fontSize: 13, color: C.textSecondary, lineHeight: 18, fontStyle: 'italic' as const },
  reviewerName: { fontSize: 11, color: C.textMuted },
  loadingText: { fontSize: 14, color: C.textSecondary },
  visibilityLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  visibilityHint: { fontSize: 11, color: C.textMuted, fontStyle: 'italic' as const, marginBottom: 10 },

  // Preview tabs
  viewTabsWrap: { marginBottom: 14, gap: 8 },
  viewTabsLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  viewTabsRow: { flexDirection: 'row' as const, gap: 6, backgroundColor: C.card, borderRadius: 10, padding: 4, borderWidth: 1, borderColor: C.border },
  viewTab: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 5, paddingVertical: 8, borderRadius: 8 },
  viewTabActive: { backgroundColor: C.accentDim },
  viewTabText: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted },
  viewTabTextActive: { color: C.accent },
  previewBanner: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, borderRadius: 8, padding: 10, borderWidth: 1 },
  previewBannerText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' as const },

  // Pending rating
  pendingRateCard: { marginBottom: 14, gap: 10, backgroundColor: C.yellowDim, borderColor: C.yellow + '40', borderWidth: 1 },
  pendingRateHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  pendingRateTitle: { fontSize: 14, fontWeight: '800' as const, color: C.text },
  pendingRateRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 10, backgroundColor: C.bgSecondary, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  pendingRateShift: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  pendingRateCompany: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  pendingRateBtn: { backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  pendingRateBtnText: { fontSize: 12, color: C.white, fontWeight: '700' as const },

  // Quick nav
  quickNavRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 18 },
  quickNavBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 10, backgroundColor: C.accentDim, borderRadius: 10, borderWidth: 1, borderColor: C.accent + '40' },
  quickNavText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },

  // Ratings empty
  ratingsEmptyText: { fontSize: 13, color: C.textMuted, lineHeight: 18, fontStyle: 'italic' as const },
  viewAllReviewsBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 5, paddingVertical: 8, marginTop: 4 },
  viewAllReviewsText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },

  // Qualification badges (employer/public view)
  qualBadgeRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  qualBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.greenDim, borderRadius: 8, borderWidth: 1, borderColor: C.green + '40' },
  qualBadgeText: { fontSize: 12, color: C.green, fontWeight: '700' as const },
  qualBadgeExpiry: { fontSize: 10, color: C.textMuted },

  // Upload visibility picker
  uploadVisRow: { gap: 8 },
  uploadVisChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  uploadVisChipActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  uploadVisTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  uploadVisSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },

  // Per-photo badge
  photoVisBadge: { position: 'absolute' as const, top: 4, left: 4, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  photoVisBadgeText: { fontSize: 9, fontWeight: '700' as const, textTransform: 'capitalize' as const },

  // Logout
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: 12, backgroundColor: C.red + '15', borderWidth: 1, borderColor: C.red + '40' },
  logoutText: { fontSize: 15, fontWeight: '700' as const, color: C.red },

  // Empty state
  emptyProfileCard: { width: '88%', gap: 14 },
  noProfileTitle: { fontSize: 20, color: C.text, fontWeight: '800' as const, textAlign: 'center' },
  noProfileText: { fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
});
