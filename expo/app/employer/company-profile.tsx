import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Alert, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, Star, MapPin, Building2, Users, Lock, Globe, MessageSquare, AlertTriangle, ShieldCheck, Clock, CreditCard, ChevronRight, Edit3, X, Send, BadgeCheck, Briefcase } from 'lucide-react-native';
import C from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';

interface CompanyRow {
  id: string;
  name: string;
  city: string | null;
  status: string;
  created_at: string;
  display_name: string | null;
  industry: string | null;
  public_bio: string | null;
  logo_url: string | null;
  website: string | null;
  public_contact_email: string | null;
  public_contact_phone: string | null;
  show_public_contact_email: boolean | null;
  show_public_contact_phone: boolean | null;
  legal_business_name: string | null;
  business_number: string | null;
  business_address: string | null;
  admin_contact_name: string | null;
  admin_contact_email: string | null;
  admin_contact_phone: string | null;
  profile_completed_at: string | null;
  submitted_for_approval_at: string | null;
  approval_rejection_reason: string | null;
  verified_at: string | null;
  billing_setup_completed_at: string | null;
}

interface ShiftRow {
  id: string;
  status: string;
  title: string;
  date: string;
  hourly_rate: number | null;
  start_time: string;
}

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface StaffRow { id: string; user_id: string; company_role: string; }

interface PendingWorkerRating {
  assignment_id: string;
  shift_id: string;
  worker_user_id: string;
  worker_name: string | null;
  shift_title: string | null;
}

async function fetchCompanyProfile(companyId: string) {
  const [companyRes, shiftsRes, reviewsRes, staffRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id,name,city,status,created_at,display_name,industry,public_bio,logo_url,website,public_contact_email,public_contact_phone,show_public_contact_email,show_public_contact_phone,legal_business_name,business_number,business_address,admin_contact_name,admin_contact_email,admin_contact_phone,profile_completed_at,submitted_for_approval_at,approval_rejection_reason,verified_at,billing_setup_completed_at')
      .eq('id', companyId)
      .single(),
    supabase
      .from('shift_posts')
      .select('id,status,title,date,hourly_rate,start_time')
      .eq('employer_company_id', companyId),
    supabase
      .from('reviews')
      .select('id,rating,comment,created_at,reviewer_user_id')
      .eq('target_company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('company_users')
      .select('id,user_id,company_role')
      .eq('company_id', companyId),
  ]);

  return {
    company: (companyRes.data ?? null) as CompanyRow | null,
    shifts: (shiftsRes.data ?? []) as ShiftRow[],
    reviews: (reviewsRes.data ?? []) as (ReviewRow & { reviewer_user_id: string | null })[],
    staff: (staffRes.data ?? []) as StaffRow[],
  };
}

async function fetchPendingWorkerRatings(companyId: string, userId: string): Promise<PendingWorkerRating[]> {
  const { data: assigns } = await supabase
    .from('shift_assignments')
    .select('id, shift_id, worker_user_id, status, shift:shift_id(title)')
    .eq('employer_company_id', companyId)
    .in('status', ['Completed', 'HoursConfirmed'])
    .order('id', { ascending: false })
    .limit(20);
  const rows = (assigns ?? []) as Array<{ id: string; shift_id: string; worker_user_id: string; shift: { title: string | null } | null }>;
  if (rows.length === 0) return [];
  const { data: existing } = await supabase
    .from('reviews')
    .select('context_id')
    .eq('reviewer_user_id', userId)
    .eq('context_kind', 'shift_assignment')
    .in('context_id', rows.map((r) => r.id));
  const reviewed = new Set((existing ?? []).map((e) => (e as { context_id: string }).context_id));
  const pending = rows.filter((r) => !reviewed.has(r.id));
  if (pending.length === 0) return [];
  const workerIds = Array.from(new Set(pending.map((p) => p.worker_user_id)));
  const { data: profs } = await supabase
    .from('worker_profiles')
    .select('user_id, display_name')
    .in('user_id', workerIds);
  const nameByUser = new Map<string, string>();
  for (const p of (profs ?? []) as Array<{ user_id: string; display_name: string | null }>) {
    if (p.display_name) nameByUser.set(p.user_id, p.display_name);
  }
  return pending.slice(0, 5).map((r) => ({
    assignment_id: r.id,
    shift_id: r.shift_id,
    worker_user_id: r.worker_user_id,
    worker_name: nameByUser.get(r.worker_user_id) ?? null,
    shift_title: r.shift?.title ?? null,
  }));
}

type CompanyViewMode = 'private' | 'worker' | 'public';

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          color={n <= Math.round(rating) ? C.yellow : C.border}
          fill={n <= Math.round(rating) ? C.yellow : 'transparent'}
        />
      ))}
    </View>
  );
}

function BillingSetupSection({ companyId }: { companyId: string }) {
  const q = useQuery({
    queryKey: ['company-billing-status', companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from('companies')
        .select('billing_mode, billing_email, billing_contact_name, billing_setup_completed_at')
        .eq('id', companyId)
        .maybeSingle();
      return data as { billing_mode: string | null; billing_email: string | null; billing_contact_name: string | null; billing_setup_completed_at: string | null } | null;
    },
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
  const setup = Boolean(q.data?.billing_setup_completed_at);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 10 }}>Billing</Text>
      <TouchableOpacity
        onPress={() => router.push('/employer/billing' as any)}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          padding: 14, borderRadius: 12, borderWidth: 1,
          backgroundColor: setup ? C.greenDim : C.yellowDim,
          borderColor: (setup ? C.green : C.yellow) + '50',
        }}
      >
        <CreditCard size={18} color={setup ? C.green : C.yellow} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700' as const, color: setup ? C.green : C.yellow }}>
            {setup ? 'Billing set up' : 'Billing not set up'}
          </Text>
          <Text style={{ fontSize: 11, color: (setup ? C.green : C.yellow) + 'cc', marginTop: 2 }}>
            {setup
              ? `${q.data?.billing_mode ?? 'ManualInvoice'} · ${q.data?.billing_email ?? ''}`
              : 'Required before posting paid shifts. Add a billing contact + email.'}
          </Text>
        </View>
        <ChevronRight size={16} color={setup ? C.green : C.yellow} />
      </TouchableOpacity>
    </View>
  );
}

export default function CompanyProfileScreen(props: { overrideCompanyId?: string } = {}) {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ companyId?: string; id?: string }>();
  const user = useAuthStore((s) => s.user);
  const { activeCompanyId, isLoading: activeCompanyLoading, memberships } = useActiveCompany();
  // Accept `companyId` (legacy employer route) or `id` (neutral /company/[id] route),
  // or an explicit prop override when embedded by the neutral route.
  // Fall back to the active company so /employer/company-profile (no param) still works.
  // Fall back through: route param → active company → first membership → user.companyId.
  // memberships[0] is critical: right after company creation, memberships arrive
  // populated but activeCompanyId is still null for a tick while the provider's
  // async useEffect reads AsyncStorage. Without this fallback the screen flashes
  // "Company not found".
  const companyId =
    props.overrideCompanyId ??
    params.companyId ??
    params.id ??
    activeCompanyId ??
    memberships[0]?.companyId ??
    user?.companyId ??
    '';
  const [viewMode, setViewMode] = useState<CompanyViewMode>('private');

  const profileQ = useQuery({
    queryKey: ['company-profile', companyId],
    queryFn: () => fetchCompanyProfile(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });

  const isMember = useMemo(() => {
    if (!user?.id || !profileQ.data?.staff) return false;
    return profileQ.data.staff.some((s) => s.user_id === user.id);
  }, [user, profileQ.data]);

  const effectiveMode: CompanyViewMode = isMember ? viewMode : 'worker';

  const pendingRatingsQ = useQuery({
    queryKey: ['employer-pending-worker-ratings', companyId, user?.id],
    queryFn: () => fetchPendingWorkerRatings(companyId, user!.id),
    enabled: Boolean(companyId && user?.id && isMember),
    staleTime: 30_000,
  });

  const { company, shifts, reviews, staff } = profileQ.data ?? {
    company: null,
    shifts: [],
    reviews: [],
    staff: [],
  };

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  }, [reviews]);

  const totalPosted = shifts.length;
  const totalCompleted = shifts.filter((s) => s.status === 'Completed').length;
  const fillRate = totalPosted > 0 ? Math.round((totalCompleted / totalPosted) * 100) : 0;

  // Rating distribution
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  const isOwnerOrAdmin = useMemo(() => {
    if (!user?.id) return false;
    return (staff ?? []).some((s) => s.user_id === user.id && (s.company_role === 'Owner' || s.company_role === 'Admin'));
  }, [staff, user]);

  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [eDisplayName, setEDisplayName] = useState('');
  const [eIndustry, setEIndustry] = useState('');
  const [eCity, setECity] = useState('');
  const [eBio, setEBio] = useState('');
  const [eWebsite, setEWebsite] = useState('');
  const [eLegal, setELegal] = useState('');
  const [eBizNum, setEBizNum] = useState('');
  const [eBizAddr, setEBizAddr] = useState('');
  const [eAdminName, setEAdminName] = useState('');
  const [eAdminEmail, setEAdminEmail] = useState('');
  const [eAdminPhone, setEAdminPhone] = useState('');
  const [eLogoUrl, setELogoUrl] = useState('');
  const [ePublicEmail, setEPublicEmail] = useState('');
  const [ePublicPhone, setEPublicPhone] = useState('');
  const [eShowPublicEmail, setEShowPublicEmail] = useState<boolean>(false);
  const [eShowPublicPhone, setEShowPublicPhone] = useState<boolean>(false);

  useEffect(() => {
    if (!company) return;
    setEDisplayName(company.display_name ?? company.name ?? '');
    setEIndustry(company.industry ?? '');
    setECity(company.city ?? '');
    setEBio(company.public_bio ?? '');
    setEWebsite(company.website ?? '');
    setELegal(company.legal_business_name ?? '');
    setEBizNum(company.business_number ?? '');
    setEBizAddr(company.business_address ?? '');
    setEAdminName(company.admin_contact_name ?? '');
    setEAdminEmail(company.admin_contact_email ?? '');
    setEAdminPhone(company.admin_contact_phone ?? '');
    setELogoUrl(company.logo_url ?? '');
    setEPublicEmail(company.public_contact_email ?? '');
    setEPublicPhone(company.public_contact_phone ?? '');
    setEShowPublicEmail(Boolean(company.show_public_contact_email));
    setEShowPublicPhone(Boolean(company.show_public_contact_phone));
  }, [company]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (eDisplayName.trim().length < 2) throw new Error('Company name required');
      if (!eIndustry) throw new Error('Industry required');
      if (eCity.trim().length < 2) throw new Error('City required');
      if (eBio.trim().length < 20) throw new Error('Public bio must be at least 20 characters');
      if (eLegal.trim().length < 2) throw new Error('Legal business name required');
      if (eAdminName.trim().length < 2) throw new Error('Admin contact name required');
      if (!/.+@.+\..+/.test(eAdminEmail.trim())) throw new Error('Valid admin email required');
      const { error } = await supabase.rpc('company_update_profile', {
        p_company_id: companyId,
        p_display_name: eDisplayName.trim(),
        p_industry: eIndustry,
        p_city: eCity.trim(),
        p_public_bio: eBio.trim(),
        p_logo_url: eLogoUrl.trim() || null,
        p_website: eWebsite.trim() || null,
        p_public_contact_email: ePublicEmail.trim() || null,
        p_public_contact_phone: ePublicPhone.trim() || null,
        p_legal_business_name: eLegal.trim(),
        p_business_number: eBizNum.trim() || null,
        p_business_address: eBizAddr.trim() || null,
        p_admin_contact_name: eAdminName.trim(),
        p_admin_contact_email: eAdminEmail.trim(),
        p_admin_contact_phone: eAdminPhone.trim() || null,
      });
      if (error) throw error;
      // Persist contact visibility flags directly (not RPC params).
      try {
        await supabase
          .from('companies')
          .update({
            show_public_contact_email: eShowPublicEmail && Boolean(ePublicEmail.trim()),
            show_public_contact_phone: eShowPublicPhone && Boolean(ePublicPhone.trim()),
          })
          .eq('id', companyId);
      } catch (e) {
        console.log('[company-profile] visibility flag update skipped', e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-profile', companyId] });
      setEditOpen(false);
    },
    onError: (e: unknown) => Alert.alert('Unable to save', e instanceof Error ? e.message : 'Unknown error'),
  });

  const submitForApproval = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('company_submit_for_approval', { p_company_id: companyId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-profile', companyId] }),
    onError: (e: unknown) => Alert.alert('Cannot submit', e instanceof Error ? e.message : 'Unknown error'),
  });

  const profileChecklist: { label: string; ok: boolean }[] = company ? [
    { label: 'Company name', ok: Boolean((company.display_name ?? company.name)?.trim()) },
    { label: 'Industry', ok: Boolean(company.industry?.trim()) },
    { label: 'City / service area', ok: Boolean(company.city?.trim()) },
    { label: 'Public bio (20+ chars)', ok: (company.public_bio?.trim().length ?? 0) >= 20 },
    { label: 'Legal business name', ok: Boolean(company.legal_business_name?.trim()) },
    { label: 'Admin contact', ok: Boolean(company.admin_contact_name?.trim() && company.admin_contact_email?.trim()) },
    { label: 'Billing set up', ok: Boolean(company.billing_setup_completed_at) },
  ] : [];
  const profileComplete = profileChecklist.every((c) => c.ok);

  const recentShifts = [...shifts]
    .sort((a, b) => new Date(b.date + 'T00:00').getTime() - new Date(a.date + 'T00:00').getTime())
    .slice(0, 3);

  const memberSince = company ? new Date(company.created_at).getFullYear() : null;

  // Wait for the active-company query before declaring "not found". Without this, a fresh
  // login flashes "Company not found" because memberships are still in flight.
  if (!companyId) {
    const noCompanyYet = !activeCompanyLoading && memberships.length === 0;
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>{noCompanyYet ? 'No company yet. Finish setup first.' : 'Loading…'}</Text>
        {noCompanyYet && (
          <TouchableOpacity onPress={() => router.replace('/onboarding/company-setup' as never)} style={styles.backFallback}>
            <Text style={styles.backFallbackText}>Go to Company Setup</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (profileQ.isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (!company) {
    // If the row genuinely doesn't exist yet (e.g. the query raced ahead of
    // setup_my_company's commit), retry instead of dead-ending the user.
    return (
      <View style={[styles.root, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.loadingText}>{profileQ.isFetching ? 'Loading…' : 'Company not found.'}</Text>
        {!profileQ.isFetching && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => profileQ.refetch()} style={styles.backFallback}>
              <Text style={styles.backFallbackText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/onboarding/company-setup' as never)} style={styles.backFallback}>
              <Text style={styles.backFallbackText}>Company setup</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Company Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* View mode tabs (only members can preview) */}
        {isMember && (
          <View style={styles.viewTabsWrap}>
            <Text style={styles.viewTabsLabel}>Viewing company profile as:</Text>
            <View style={styles.viewTabsRow}>
              {([
                { key: 'private' as const, label: 'My Company', Icon: ShieldCheck },
                { key: 'worker' as const, label: 'Worker View', Icon: Users },
                { key: 'public' as const, label: 'Public View', Icon: Globe },
              ]).map((t) => (
                <TouchableOpacity key={t.key} onPress={() => setViewMode(t.key)} style={[styles.viewTab, viewMode === t.key && styles.viewTabActive]}>
                  <t.Icon size={13} color={viewMode === t.key ? C.accent : C.textMuted} />
                  <Text style={[styles.viewTabText, viewMode === t.key && styles.viewTabTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {effectiveMode === 'worker' && (
              <View style={[styles.previewBanner, { backgroundColor: C.blueDim, borderColor: C.blue + '40' }]}>
                <Users size={12} color={C.blue} />
                <Text style={[styles.previewBannerText, { color: C.blue }]}>This is what workers see when applying to your shifts. Internal staff, billing and contact details are never shown here.</Text>
              </View>
            )}
            {effectiveMode === 'public' && (
              <View style={[styles.previewBanner, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
                <Globe size={12} color={C.green} />
                <Text style={[styles.previewBannerText, { color: C.green }]}>Public-facing profile. Only the company name, city, rating summary and approval status are visible.</Text>
              </View>
            )}
          </View>
        )}

        {/* Approval status banner — only for members */}
        {effectiveMode === 'private' && isMember && (
          (() => {
            const status = company.status;
            if (status === 'PendingApproval' || status === 'Pending') {
              return (
                <View style={[styles.statusBanner, { backgroundColor: C.yellowDim, borderColor: C.yellow + '60' }]}>
                  <Clock size={14} color={C.yellow} />
                  <Text style={[styles.statusBannerText, { color: C.yellow }]}>Waiting for Super Admin approval. You can complete your profile while we review.</Text>
                </View>
              );
            }
            if (status === 'Rejected') {
              return (
                <View style={[styles.statusBanner, { backgroundColor: C.redDim, borderColor: C.red + '60' }]}>
                  <AlertTriangle size={14} color={C.red} />
                  <Text style={[styles.statusBannerText, { color: C.red }]}>Company application was rejected. Contact support to review the reason and resubmit.</Text>
                </View>
              );
            }
            if (status === 'Suspended') {
              return (
                <View style={[styles.statusBanner, { backgroundColor: C.redDim, borderColor: C.red + '60' }]}>
                  <AlertTriangle size={14} color={C.red} />
                  <Text style={[styles.statusBannerText, { color: C.red }]}>Company is currently suspended. Shift posting is disabled. Contact support.</Text>
                </View>
              );
            }
            return null;
          })()
        )}

        {/* Pending rating action — owner/admin only */}
        {effectiveMode === 'private' && isMember && (pendingRatingsQ.data ?? []).length > 0 && (
          <Card style={styles.pendingRateCard}>
            <View style={styles.pendingRateHeader}>
              <Star size={14} color={C.yellow} fill={C.yellow} />
              <Text style={styles.pendingRateTitle}>Rate worker{(pendingRatingsQ.data ?? []).length > 1 ? 's' : ''} from recent shifts</Text>
            </View>
            {(pendingRatingsQ.data ?? []).slice(0, 3).map((p) => (
              <TouchableOpacity
                key={p.assignment_id}
                onPress={() => router.push('/employer/shifts' as any)}
                style={styles.pendingRateRow}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingRateShift}>{p.shift_title ?? 'Shift'}</Text>
                  <Text style={styles.pendingRateCompany}>{p.worker_name ?? 'Worker'}</Text>
                </View>
                <View style={styles.pendingRateBtn}>
                  <Text style={styles.pendingRateBtnText}>Rate Now</Text>
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {/* Header Card */}
        <View style={styles.companyCard}>
          <View style={styles.companyIconWrap}>
            <Building2 size={28} color={C.accent} />
          </View>
          <Text style={styles.companyName}>{company.name}</Text>
          {company.city && (
            <View style={styles.cityRow}>
              <MapPin size={13} color={C.textMuted} />
              <Text style={styles.cityText}>{company.city}</Text>
            </View>
          )}
          <View style={styles.companyMeta}>
            <Text style={styles.memberSince}>Member since {memberSince}</Text>
            <StatusBadge status={company.status} />
          </View>
          {effectiveMode === 'private' && isOwnerOrAdmin && (
            <View style={styles.headerActionRow}>
              <TouchableOpacity onPress={() => setEditOpen(true)} style={styles.headerActionBtn} activeOpacity={0.8}>
                <Edit3 size={12} color={C.accent} />
                <Text style={styles.headerActionText}>Edit Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/employer/shifts' as any)} style={styles.headerActionBtn} activeOpacity={0.8}>
                <Text style={styles.headerActionText}>Manage Shifts</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Industry + verified badge (shown in all view modes when present) */}
          {(company.industry || company.verified_at) && (
            <View style={styles.subMetaRow}>
              {company.industry ? (
                <View style={styles.industryChip}>
                  <Briefcase size={11} color={C.textMuted} />
                  <Text style={styles.industryChipText}>{company.industry}</Text>
                </View>
              ) : null}
              {company.verified_at && (company.status === 'Active' || company.status === 'Approved') ? (
                <View style={styles.verifiedChip}>
                  <BadgeCheck size={11} color={C.green} />
                  <Text style={styles.verifiedChipText}>Verified</Text>
                </View>
              ) : null}
            </View>
          )}
          {/* Public bio shown to everyone */}
          {company.public_bio ? (
            <Text style={styles.publicBio}>{company.public_bio}</Text>
          ) : effectiveMode !== 'private' ? null : null}
          {/* Website link in public/worker views */}
          {company.website ? (
            <TouchableOpacity onPress={() => { /* opened by user */ }}>
              <Text style={styles.websiteLink}>{company.website}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Stats Row — operational stats (Shifts Posted, Fill Rate) are internal; only rating is public-safe */}
        <Card style={styles.statsCard}>
          <View style={styles.statsRow}>
            {effectiveMode === 'private' && isMember && (
              <>
                <View style={styles.stat}>
                  <Text style={styles.statVal}>{totalPosted}</Text>
                  <Text style={styles.statLbl}>Shifts Posted</Text>
                </View>
                <View style={[styles.stat, styles.statMid]}>
                  <Text style={[styles.statVal, { color: fillRate > 70 ? C.green : fillRate > 40 ? C.yellow : C.red }]}>
                    {fillRate}%
                  </Text>
                  <Text style={styles.statLbl}>Fill Rate</Text>
                </View>
              </>
            )}
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: avgRating > 0 ? C.yellow : C.textMuted }]}>
                {avgRating > 0 ? avgRating.toFixed(1) : '—'} ★
              </Text>
              <Text style={styles.statLbl}>Avg Rating</Text>
            </View>
            <View style={[styles.stat, effectiveMode === 'private' && isMember ? null : styles.statMid]}>
              <Text style={styles.statVal}>{reviews.length}</Text>
              <Text style={styles.statLbl}>Reviews</Text>
            </View>
          </View>
        </Card>

        {/* Profile completion checklist — private view only */}
        {effectiveMode === 'private' && isMember && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile completion</Text>
            <Card>
              <View style={styles.trustList}>
                {profileChecklist.map(({ label, ok }) => (
                  <View key={label} style={styles.trustRow}>
                    <CheckCircle size={15} color={ok ? C.green : C.textMuted} />
                    <Text style={[styles.trustText, !ok && { color: C.textMuted }]}>{label}</Text>
                  </View>
                ))}
              </View>
              {!profileComplete && isOwnerOrAdmin && (
                <TouchableOpacity onPress={() => setEditOpen(true)} style={[styles.headerActionBtn, { marginTop: 12, alignSelf: 'flex-start' }]} activeOpacity={0.8}>
                  <Edit3 size={12} color={C.accent} />
                  <Text style={styles.headerActionText}>Complete profile</Text>
                </TouchableOpacity>
              )}
              {profileComplete && company.status !== 'Active' && company.status !== 'Approved' && isOwnerOrAdmin && !company.submitted_for_approval_at && (
                <TouchableOpacity onPress={() => submitForApproval.mutate()} style={[styles.headerActionBtn, { marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.accent, borderColor: C.accent }]} activeOpacity={0.8}>
                  <Send size={12} color={C.white} />
                  <Text style={[styles.headerActionText, { color: C.white }]}>Submit for approval</Text>
                </TouchableOpacity>
              )}
            </Card>
          </View>
        )}

        {/* Billing setup — private view only */}
        {effectiveMode === 'private' && isMember && (
          <BillingSetupSection companyId={companyId} />
        )}

        {/* Private business info — only members in My Company view */}
        {effectiveMode === 'private' && isMember && (company.legal_business_name || company.admin_contact_name) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Business information (private)</Text>
            <Card>
              <View style={{ gap: 8 }}>
                {company.legal_business_name ? <Text style={styles.kv}><Text style={styles.kvLbl}>Legal name: </Text>{company.legal_business_name}</Text> : null}
                {company.business_number ? <Text style={styles.kv}><Text style={styles.kvLbl}>Business #: </Text>{company.business_number}</Text> : null}
                {company.business_address ? <Text style={styles.kv}><Text style={styles.kvLbl}>Address: </Text>{company.business_address}</Text> : null}
                {company.admin_contact_name ? <Text style={styles.kv}><Text style={styles.kvLbl}>Admin: </Text>{company.admin_contact_name}{company.admin_contact_email ? ` · ${company.admin_contact_email}` : ''}{company.admin_contact_phone ? ` · ${company.admin_contact_phone}` : ''}</Text> : null}
                <Text style={[styles.kvLbl, { fontSize: 10, marginTop: 4 }]}>Workers and the public never see these fields.</Text>
              </View>
            </Card>
          </View>
        )}

        {/* Trust & Verification — only visible to company members in My Company view (contains staff count / internal verification) */}
        {effectiveMode === 'private' && isMember && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trust & Verification</Text>
          <Card>
            <View style={styles.trustList}>
              {[
                { label: 'Identity verified', ok: company.status !== 'PendingApproval' },
                { label: `Payment on time`, ok: company.status === 'Active' || company.status === 'Approved' },
                { label: `Active since ${memberSince}`, ok: true },
                { label: `${staff.length} team member${staff.length !== 1 ? 's' : ''}`, ok: true },
              ].map(({ label, ok }) => (
                <View key={label} style={styles.trustRow}>
                  <CheckCircle size={15} color={ok ? C.green : C.textMuted} />
                  <Text style={[styles.trustText, !ok && { color: C.textMuted }]}>{label}</Text>
                </View>
              ))}
            </View>
          </Card>
        </View>
        )}

        {/* Reviews */}
        <View style={styles.section}>
          <View style={styles.reviewHeaderRow}>
            <Text style={styles.sectionTitle}>Reviews ({reviews.length})</Text>
            {reviews.length > 3 && companyId && (
              <TouchableOpacity onPress={() => router.push(`/reviews/company/${companyId}` as any)} style={styles.viewAllReviewsBtn} activeOpacity={0.8}>
                <MessageSquare size={11} color={C.accent} />
                <Text style={styles.viewAllReviewsText}>View all</Text>
              </TouchableOpacity>
            )}
          </View>
          {reviews.length > 0 && (
            <Card style={{ marginBottom: 10 }}>
              {/* Star distribution */}
              {dist.map(({ star, count }) => {
                const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                return (
                  <View key={star} style={styles.distRow}>
                    <Text style={styles.distStar}>{star}★</Text>
                    <View style={styles.distBar}>
                      <View style={[styles.distFill, { width: `${pct}%` as any }]} />
                    </View>
                    <Text style={styles.distCount}>{count}</Text>
                  </View>
                );
              })}
              <View style={styles.avgRow}>
                <Text style={styles.avgNum}>{avgRating.toFixed(1)}</Text>
                <StarRow rating={avgRating} />
                <Text style={styles.avgTotal}>({reviews.length})</Text>
              </View>
            </Card>
          )}
          {reviews.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No reviews yet. Reviews appear here after workers complete shifts and rate your company.</Text>
            </Card>
          ) : (
            reviews.map((r) => (
              <Card key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewTop}>
                  <StarRow rating={r.rating} size={12} />
                  <Text style={styles.reviewDate}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </Text>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
              </Card>
            ))
          )}
        </View>

        {/* Recent Shifts — internal operational history, only visible to company members in My Company view */}
        {effectiveMode === 'private' && isMember && recentShifts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Shifts</Text>
            {recentShifts.map((s) => (
              <Card key={s.id} style={styles.shiftCard}>
                <View style={styles.shiftRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shiftTitle}>{s.title}</Text>
                    <Text style={styles.shiftMeta}>{s.date}</Text>
                  </View>
                  <View style={styles.shiftRight}>
                    {s.hourly_rate != null && (
                      <Text style={styles.shiftRate}>${s.hourly_rate}/hr</Text>
                    )}
                    <StatusBadge status={s.status} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Edit Profile modal */}
      <Modal visible={editOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => setEditOpen(false)} style={styles.backBtn}><X size={18} color={C.text} /></TouchableOpacity>
            <Text style={styles.headerTitle}>Edit Company Profile</Text>
            <View style={{ width: 36 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.editSection}>Public (workers will see)</Text>
            <FormField label="Company name *" value={eDisplayName} onChange={setEDisplayName} />
            <View>
              <Text style={styles.editLbl}>Industry *</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {['Logistics', 'Warehousing', 'Manufacturing', 'Retail', 'Construction', 'Hospitality', 'Other'].map((i) => (
                  <TouchableOpacity key={i} onPress={() => setEIndustry(i)} style={[styles.editChip, eIndustry === i && styles.editChipActive]}>
                    <Text style={[styles.editChipText, eIndustry === i && styles.editChipTextActive]}>{i}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <FormField label="City / service area *" value={eCity} onChange={setECity} />
            <FormField label="Public bio * (min 20 chars)" value={eBio} onChange={setEBio} multiline />
            <FormField label="Website" value={eWebsite} onChange={setEWebsite} />
            <FormField label="Public logo URL" value={eLogoUrl} onChange={setELogoUrl} />
            <Text style={styles.editHelp}>Paste a public HTTPS image URL only. Never paste private storage paths. Leave blank to show initials.</Text>

            <FormField label="Public contact email" value={ePublicEmail} onChange={setEPublicEmail} keyboardType="email-address" />
            <View style={styles.editToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editToggleLabel}>Show email to workers</Text>
                <Text style={styles.editHelp}>Off by default. When on, workers and the public can see this email.</Text>
              </View>
              <Switch value={eShowPublicEmail} onValueChange={setEShowPublicEmail} disabled={!ePublicEmail.trim()} />
            </View>

            <FormField label="Public contact phone" value={ePublicPhone} onChange={setEPublicPhone} keyboardType="phone-pad" />
            <View style={styles.editToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editToggleLabel}>Show phone to workers</Text>
                <Text style={styles.editHelp}>Off by default. When on, workers and the public can see this phone.</Text>
              </View>
              <Switch value={eShowPublicPhone} onValueChange={setEShowPublicPhone} disabled={!ePublicPhone.trim()} />
            </View>

            <Text style={styles.editSection}>Business (private)</Text>
            <FormField label="Legal business name *" value={eLegal} onChange={setELegal} />
            <FormField label="Business number" value={eBizNum} onChange={setEBizNum} />
            <FormField label="Business address" value={eBizAddr} onChange={setEBizAddr} />
            <FormField label="Admin contact name *" value={eAdminName} onChange={setEAdminName} />
            <FormField label="Admin email *" value={eAdminEmail} onChange={setEAdminEmail} keyboardType="email-address" />
            <FormField label="Admin phone" value={eAdminPhone} onChange={setEAdminPhone} keyboardType="phone-pad" />
            <TouchableOpacity onPress={() => saveProfile.mutate()} disabled={saveProfile.isPending} style={[styles.saveBig, saveProfile.isPending && { opacity: 0.6 }]}>
              <Text style={styles.saveBigText}>{saveProfile.isPending ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/employer/billing' as any)} style={[styles.headerActionBtn, { alignSelf: 'flex-start' }]} activeOpacity={0.8}>
              <CreditCard size={12} color={C.accent} />
              <Text style={styles.headerActionText}>Edit billing</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function FormField({ label, value, onChange, multiline, keyboardType }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad' }) {
  return (
    <View>
      <Text style={styles.editLbl}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        placeholderTextColor={C.textMuted}
        style={[styles.editInput, multiline && { minHeight: 90, textAlignVertical: 'top' as const }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: C.text, flex: 1, textAlign: 'center' as const },
  loadingText: { fontSize: 14, color: C.textSecondary },
  backFallback: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.card, borderRadius: 10 },
  backFallbackText: { color: C.accent, fontWeight: '600' as const },
  scroll: { padding: 16 },
  // Company card
  companyCard: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: C.bgSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    gap: 8,
  },
  companyIconWrap: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.accent,
  },
  companyName: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cityText: { fontSize: 13, color: C.textSecondary },
  companyMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberSince: { fontSize: 12, color: C.textMuted },
  // Stats
  statsCard: { marginBottom: 16 },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  statVal: { fontSize: 22, fontWeight: '800' as const, color: C.text },
  statLbl: { fontSize: 11, color: C.textSecondary, textAlign: 'center' as const },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 10 },
  // Trust
  trustList: { gap: 10 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trustText: { fontSize: 14, color: C.text },
  // Reviews
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  distStar: { fontSize: 12, color: C.textMuted, width: 22, textAlign: 'right' as const },
  distBar: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  distFill: { height: 6, backgroundColor: C.yellow, borderRadius: 3 },
  distCount: { fontSize: 12, color: C.textMuted, width: 20, textAlign: 'center' as const },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  avgNum: { fontSize: 22, fontWeight: '800' as const, color: C.yellow },
  avgTotal: { fontSize: 13, color: C.textMuted },
  reviewCard: { marginBottom: 8 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reviewDate: { fontSize: 11, color: C.textMuted, marginLeft: 'auto' as any },
  reviewComment: { fontSize: 13, color: C.textSecondary, lineHeight: 20 },
  emptyText: { fontSize: 13, color: C.textMuted, textAlign: 'center' as const },
  // Recent shifts
  shiftCard: { marginBottom: 8 },
  shiftRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  shiftTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  shiftMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  shiftRight: { alignItems: 'flex-end', gap: 4 },
  shiftRate: { fontSize: 13, color: C.green, fontWeight: '700' as const },
  // View mode tabs
  viewTabsWrap: { marginBottom: 14 },
  viewTabsLabel: { fontSize: 11, color: C.textMuted, marginBottom: 6, fontWeight: '600' as const },
  viewTabsRow: { flexDirection: 'row', gap: 6 },
  viewTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  viewTabActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  viewTabText: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  viewTabTextActive: { color: C.accent },
  previewBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  previewBannerText: { fontSize: 11, lineHeight: 16, flex: 1 },
  // Status banner
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 14 },
  statusBannerText: { fontSize: 12, lineHeight: 17, flex: 1, fontWeight: '600' as const },
  // Pending rating
  pendingRateCard: { marginBottom: 14, backgroundColor: C.yellowDim, borderColor: C.yellow + '40', borderWidth: 1 },
  pendingRateHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  pendingRateTitle: { fontSize: 13, fontWeight: '700' as const, color: C.text },
  pendingRateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  pendingRateShift: { fontSize: 13, fontWeight: '600' as const, color: C.text },
  pendingRateCompany: { fontSize: 11, color: C.textSecondary },
  pendingRateBtn: { backgroundColor: C.yellow, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  pendingRateBtnText: { fontSize: 12, color: C.white, fontWeight: '700' as const },
  // Header actions
  headerActionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  headerActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  headerActionText: { fontSize: 12, color: C.accent, fontWeight: '700' as const },
  // Reviews header
  reviewHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  viewAllReviewsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  viewAllReviewsText: { fontSize: 11, color: C.accent, fontWeight: '600' as const },
  subMetaRow: { flexDirection: 'row', gap: 6, marginTop: 8, justifyContent: 'center', flexWrap: 'wrap' },
  industryChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  industryChipText: { fontSize: 11, color: C.textMuted, fontWeight: '600' as const },
  verifiedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.greenDim, borderWidth: 1, borderColor: C.green + '40' },
  verifiedChipText: { fontSize: 11, color: C.green, fontWeight: '700' as const },
  publicBio: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginTop: 10, textAlign: 'center' as const, paddingHorizontal: 8 },
  websiteLink: { fontSize: 12, color: C.accent, marginTop: 6, fontWeight: '600' as const },
  kv: { fontSize: 13, color: C.text, lineHeight: 19 },
  kvLbl: { color: C.textMuted },
  editSection: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 8 },
  editLbl: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 6 },
  editInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14 },
  editChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  editChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  editChipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  editChipTextActive: { color: C.accent },
  saveBig: { backgroundColor: C.accent, paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  saveBigText: { color: C.white, fontWeight: '800' as const, fontSize: 15 },
});

// Make headerActionBtn a flex row to accommodate icons.
