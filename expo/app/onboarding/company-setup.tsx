import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Building2, ChevronLeft, Eye, Lock, CreditCard, CheckCircle } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { COMPANY_TYPE_BY_ROLE, getRoleRoute } from '@/lib/access';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

const INDUSTRIES = ['Logistics', 'Warehousing', 'Manufacturing', 'Retail', 'Construction', 'Hospitality', 'Other'];

type Step = 'public' | 'private' | 'billing' | 'review';

export default function CompanySetup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { memberships, refresh } = useActiveCompany();

  const [step, setStep] = useState<Step>('public');

  // Public (worker-facing)
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [city, setCity] = useState('');
  const [publicBio, setPublicBio] = useState('');
  const [website, setWebsite] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [publicEmail, setPublicEmail] = useState('');
  const [publicPhone, setPublicPhone] = useState('');
  const [showPublicEmail, setShowPublicEmail] = useState<boolean>(false);
  const [showPublicPhone, setShowPublicPhone] = useState<boolean>(false);

  // Private business
  const [legalName, setLegalName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');

  // Billing
  const [billingName, setBillingName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [billingPhone, setBillingPhone] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingMode, setBillingMode] = useState<'ManualInvoice' | 'StripeCheckout' | 'CardOnFile'>('ManualInvoice');
  const [terms, setTerms] = useState('14');

  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // If the user already has a company AND its profile is already complete, jump
  // them home. Otherwise stay on this screen, prefill, and let them finish setup.
  useEffect(() => {
    if (loading) return;
    if (!user || memberships.length === 0) return;
    const m = memberships[0];
    if (prefilled) return;
    setPrefilled(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('companies')
          .select('name,display_name,industry,city,public_bio,website,logo_url,public_contact_email,public_contact_phone,show_public_contact_email,show_public_contact_phone,legal_business_name,business_number,business_address,admin_contact_name,admin_contact_email,admin_contact_phone,billing_contact_name,billing_email,billing_phone,billing_address,billing_mode,payment_terms_days,profile_completed_at,billing_setup_completed_at')
          .eq('id', m.companyId)
          .maybeSingle();
        if (data) {
          // If the company is already fully set up, skip out.
          if (data.profile_completed_at && data.billing_setup_completed_at) {
            router.replace(getRoleRoute(user.role) as never);
            return;
          }
          setName((data.display_name as string) || (data.name as string) || '');
          setIndustry((data.industry as string) || '');
          setCity((data.city as string) || '');
          setPublicBio((data.public_bio as string) || '');
          setWebsite((data.website as string) || '');
          setLogoUrl((data.logo_url as string) || '');
          setPublicEmail((data.public_contact_email as string) || '');
          setPublicPhone((data.public_contact_phone as string) || '');
          setShowPublicEmail(Boolean(data.show_public_contact_email));
          setShowPublicPhone(Boolean(data.show_public_contact_phone));
          setLegalName((data.legal_business_name as string) || '');
          setBusinessNumber((data.business_number as string) || '');
          setBusinessAddress((data.business_address as string) || '');
          setAdminName((data.admin_contact_name as string) || '');
          setAdminEmail((data.admin_contact_email as string) || '');
          setAdminPhone((data.admin_contact_phone as string) || '');
          setBillingName((data.billing_contact_name as string) || '');
          setBillingEmail((data.billing_email as string) || '');
          setBillingPhone((data.billing_phone as string) || '');
          setBillingAddress((data.billing_address as string) || '');
          if (data.billing_mode) setBillingMode(data.billing_mode as 'ManualInvoice' | 'StripeCheckout' | 'CardOnFile');
          if (data.payment_terms_days != null) setTerms(String(data.payment_terms_days));
        }
      } catch (e) {
        console.log('[company-setup] prefill failed', e);
      }
    })();
  }, [user, memberships, router, prefilled, loading]);

  const companyType = user?.role ? COMPANY_TYPE_BY_ROLE[user.role] : undefined;

  const canContinuePublic = name.trim().length >= 2 && industry && city.trim().length >= 2 && publicBio.trim().length >= 20;
  const canContinuePrivate = legalName.trim().length >= 2 && adminName.trim().length >= 2 && /.+@.+\..+/.test(adminEmail.trim());
  const canContinueBilling = billingName.trim().length >= 2 && /.+@.+\..+/.test(billingEmail.trim());

  const showError = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!companyType || !user) {
      showError('Error', 'Unable to determine company type for your role');
      return;
    }
    setLoading(true);
    setSubmitError(null);
    let stepLabel = 'create company';
    let companyId: string | null = null;
    try {
      // 1) Create the company shell.
      const { data: setupData, error: setupErr } = await supabase.rpc('setup_my_company', {
        p_name: name.trim(),
        p_city: city.trim(),
        p_type: companyType,
      });
      if (setupErr) throw setupErr;
      companyId = typeof setupData === 'string' ? setupData : null;

      // Fallback: look up via company_users (companies has no owner_user_id column).
      if (!companyId) {
        const { data: cu, error: cuErr } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('user_id', user.id)
          .eq('company_role', 'Owner')
          .eq('status', 'Active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cuErr) throw cuErr;
        companyId = (cu?.company_id as string | undefined) ?? null;
      }
      if (!companyId) {
        throw new Error('Company id was not returned after creation. Please refresh and try again from Company Profile.');
      }

      // 2) Profile.
      stepLabel = 'save company profile';
      const trimmedPublicEmail = publicEmail.trim();
      const trimmedPublicPhone = publicPhone.trim();
      const { error: profErr } = await supabase.rpc('company_update_profile', {
        p_company_id: companyId,
        p_display_name: name.trim(),
        p_industry: industry,
        p_city: city.trim(),
        p_public_bio: publicBio.trim(),
        p_logo_url: logoUrl.trim() || null,
        p_website: website.trim() || null,
        p_public_contact_email: trimmedPublicEmail || null,
        p_public_contact_phone: trimmedPublicPhone || null,
        p_legal_business_name: legalName.trim(),
        p_business_number: businessNumber.trim() || null,
        p_business_address: businessAddress.trim() || null,
        p_admin_contact_name: adminName.trim(),
        p_admin_contact_email: adminEmail.trim(),
        p_admin_contact_phone: adminPhone.trim() || null,
      });
      if (profErr) throw profErr;

      // 2b) Save the visibility flags directly (these aren't RPC params).
      try {
        await supabase
          .from('companies')
          .update({
            show_public_contact_email: showPublicEmail && Boolean(trimmedPublicEmail),
            show_public_contact_phone: showPublicPhone && Boolean(trimmedPublicPhone),
          })
          .eq('id', companyId);
      } catch (e) {
        console.log('[company-setup] visibility flag update skipped', e);
      }

      // 3) Billing.
      stepLabel = 'save billing setup';
      const { error: billErr } = await supabase.rpc('company_update_billing', {
        p_company_id: companyId,
        p_contact_name: billingName.trim(),
        p_email: billingEmail.trim(),
        p_phone: billingPhone.trim() || null,
        p_address: billingAddress.trim() || null,
        p_billing_mode: billingMode,
        p_payment_terms_days: Math.max(0, Math.min(90, Number(terms) || 14)),
      });
      if (billErr) throw billErr;

      // 4) Submit for approval (non-fatal).
      stepLabel = 'submit for approval';
      try {
        const { error: subErr } = await supabase.rpc('company_submit_for_approval', { p_company_id: companyId });
        if (subErr) console.log('[company-setup] submit_for_approval error', subErr.message);
      } catch (e) {
        console.log('[company-setup] submit_for_approval skipped', e);
      }

      // Fire-and-forget refresh — DO NOT await, it can hang the UI.
      try { void refresh(); } catch (e) { console.log('[company-setup] refresh fire-and-forget failed', e); }

      // Always clear loading and navigate, no matter what.
      setLoading(false);
      router.replace(getRoleRoute(user.role) as never);
      return;
    } catch (err) {
      console.log('[company-setup] failed at', stepLabel, err);
      const msg = err instanceof Error ? err.message : 'Unknown error';

      // If the company itself was created but a later step failed, we don't want to leave
      // the user trapped on this page. Send them to Company Profile so they can finish editing.
      if (companyId) {
        setSubmitError(`Saved your company, but "${stepLabel}" failed: ${msg}. Continue from Company Profile.`);
        showError(
          'Company created — finish setup',
          `We saved your company but couldn't ${stepLabel} (${msg}). Continue from Company Profile.`,
        );
        try { void refresh(); } catch {}
        setLoading(false);
        router.replace('/employer/company-profile' as never);
        return;
      }

      setSubmitError(`Step "${stepLabel}" failed: ${msg}`);
      showError('Could not finish setup', `Step "${stepLabel}" failed: ${msg}`);
    } finally {
      // Belt + suspenders: loading MUST clear in every code path.
      setLoading(false);
    }
  };

  const StepBadge = ({ s, label, idx }: { s: Step; label: string; idx: number }) => {
    const active = step === s;
    const done =
      (step === 'private' && s === 'public') ||
      (step === 'billing' && (s === 'public' || s === 'private')) ||
      (step === 'review' && s !== 'review');
    return (
      <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
        <Text style={[styles.stepDotText, (active || done) && { color: C.white }]}>{done ? '✓' : idx}</Text>
        <Text style={[styles.stepDotLbl, active && { color: C.accent }]}>{label}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />

        <View style={styles.iconWrap}>
          <Building2 size={28} color={C.accent} />
        </View>

        <Text style={styles.title}>Set up your company</Text>
        <Text style={styles.subtitle}>
          Workers and Super Admin will see this profile when reviewing your shifts. Some fields are public, others stay private.
        </Text>

        <View style={styles.stepsRow}>
          <StepBadge s="public" label="Public" idx={1} />
          <View style={styles.stepLine} />
          <StepBadge s="private" label="Business" idx={2} />
          <View style={styles.stepLine} />
          <StepBadge s="billing" label="Billing" idx={3} />
          <View style={styles.stepLine} />
          <StepBadge s="review" label="Review" idx={4} />
        </View>

        {step === 'public' && (
          <View style={styles.form}>
            <View style={styles.visBadge}><Eye size={11} color={C.blue} /><Text style={styles.visBadgeText}>Public — workers will see this</Text></View>
            <Input label="Company name *" value={name} onChangeText={setName} placeholder="Acme Logistics Ltd." />
            <View>
              <Text style={styles.lbl}>Industry *</Text>
              <View style={styles.chipRow}>
                {INDUSTRIES.map((i) => (
                  <TouchableOpacity key={i} onPress={() => setIndustry(i)} style={[styles.chip, industry === i && styles.chipActive]}>
                    <Text style={[styles.chipText, industry === i && styles.chipTextActive]}>{i}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Input label="City / service area *" value={city} onChangeText={setCity} placeholder="Delta, BC" />
            <Input label="Public bio * (min 20 chars)" value={publicBio} onChangeText={setPublicBio} placeholder="Tell workers what you do, what shifts feel like, parking, dress code…" multiline numberOfLines={4} />
            <Input label="Website (optional)" value={website} onChangeText={setWebsite} placeholder="https://" keyboardType="url" autoCapitalize="none" />
            <Input label="Public logo URL (optional)" value={logoUrl} onChangeText={setLogoUrl} placeholder="https://example.com/logo.png" keyboardType="url" autoCapitalize="none" />
            <Text style={styles.helperText}>Paste a public HTTPS image URL only. Do not paste private storage paths. Leave blank to show initials.</Text>

            <Input label="Public contact email (optional)" value={publicEmail} onChangeText={setPublicEmail} placeholder="hello@acme.com" keyboardType="email-address" autoCapitalize="none" />
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Show email to workers</Text>
                <Text style={styles.helperText}>Off by default. When on, workers and the public can see this email.</Text>
              </View>
              <Switch value={showPublicEmail} onValueChange={setShowPublicEmail} disabled={!publicEmail.trim()} />
            </View>

            <Input label="Public contact phone (optional)" value={publicPhone} onChangeText={setPublicPhone} placeholder="(555) 555-0100" keyboardType="phone-pad" />
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Show phone to workers</Text>
                <Text style={styles.helperText}>Off by default. When on, workers and the public can see this phone number.</Text>
              </View>
              <Switch value={showPublicPhone} onValueChange={setShowPublicPhone} disabled={!publicPhone.trim()} />
            </View>

            <Button label="Continue" onPress={() => setStep('private')} fullWidth size="lg" disabled={!canContinuePublic} />
          </View>
        )}

        {step === 'private' && (
          <View style={styles.form}>
            <View style={[styles.visBadge, { backgroundColor: C.yellowDim, borderColor: C.yellow + '40' }]}>
              <Lock size={11} color={C.yellow} />
              <Text style={[styles.visBadgeText, { color: C.yellow }]}>Private — only your team + Super Admin</Text>
            </View>
            <Input label="Legal business name *" value={legalName} onChangeText={setLegalName} placeholder="Acme Logistics Ltd." />
            <Input label="Business number (optional)" value={businessNumber} onChangeText={setBusinessNumber} placeholder="123456789BC0001" />
            <Input label="Business address (optional)" value={businessAddress} onChangeText={setBusinessAddress} placeholder="1234 Industrial Way" />
            <Input label="Admin contact name *" value={adminName} onChangeText={setAdminName} placeholder="Jane Doe" />
            <Input label="Admin email *" value={adminEmail} onChangeText={setAdminEmail} placeholder="ops@acme.com" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Admin phone (optional)" value={adminPhone} onChangeText={setAdminPhone} placeholder="(555) 555-1234" keyboardType="phone-pad" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Back" onPress={() => setStep('public')} variant="ghost" />
              <View style={{ flex: 1 }}>
                <Button label="Continue" onPress={() => setStep('billing')} fullWidth size="lg" disabled={!canContinuePrivate} />
              </View>
            </View>
          </View>
        )}

        {step === 'billing' && (
          <View style={styles.form}>
            <View style={[styles.visBadge, { backgroundColor: C.greenDim, borderColor: C.green + '40' }]}>
              <CreditCard size={11} color={C.green} />
              <Text style={[styles.visBadgeText, { color: C.green }]}>Billing — required to post paid shifts</Text>
            </View>
            <Input label="Billing contact name *" value={billingName} onChangeText={setBillingName} placeholder="Same as admin or AP person" />
            <Input label="Billing email *" value={billingEmail} onChangeText={setBillingEmail} placeholder="ap@acme.com" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Billing phone (optional)" value={billingPhone} onChangeText={setBillingPhone} placeholder="(555) 555-1234" keyboardType="phone-pad" />
            <Input label="Billing address (optional)" value={billingAddress} onChangeText={setBillingAddress} placeholder="" />
            <View>
              <Text style={styles.lbl}>Mode</Text>
              <View style={styles.chipRow}>
                {(['ManualInvoice', 'StripeCheckout', 'CardOnFile'] as const).map((m) => (
                  <TouchableOpacity key={m} onPress={() => setBillingMode(m)} style={[styles.chip, billingMode === m && styles.chipActive]}>
                    <Text style={[styles.chipText, billingMode === m && styles.chipTextActive]}>
                      {m === 'ManualInvoice' ? 'Manual invoice' : m === 'StripeCheckout' ? 'Stripe checkout' : 'Card on file'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Input label="Payment terms (days)" value={terms} onChangeText={(v) => setTerms(v.replace(/[^0-9]/g, ''))} placeholder="14" keyboardType="numeric" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Back" onPress={() => setStep('private')} variant="ghost" />
              <View style={{ flex: 1 }}>
                <Button label="Continue" onPress={() => setStep('review')} fullWidth size="lg" disabled={!canContinueBilling} />
              </View>
            </View>
          </View>
        )}

        {submitError && (
          <View style={{ backgroundColor: C.redDim, borderColor: C.red + '60', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '700' as const, color: C.red, marginBottom: 2 }}>Something went wrong</Text>
            <Text style={{ fontSize: 12, color: C.red, lineHeight: 17 }}>{submitError}</Text>
          </View>
        )}

        {step === 'review' && (
          <View style={styles.form}>
            <View style={[styles.visBadge, { backgroundColor: C.accentDim, borderColor: C.accent + '40' }]}>
              <Eye size={11} color={C.accent} />
              <Text style={[styles.visBadgeText, { color: C.accent }]}>Worker preview</Text>
            </View>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewName}>{name}</Text>
              <Text style={styles.reviewMeta}>{industry} · {city}</Text>
              <Text style={styles.reviewBio}>{publicBio}</Text>
              {website ? <Text style={styles.reviewWebsite}>{website}</Text> : null}
            </View>
            <View style={styles.checklist}>
              <Text style={styles.checklistTitle}>Submission checklist</Text>
              {[
                ['Public profile filled', canContinuePublic],
                ['Business info filled', canContinuePrivate],
                ['Billing set up', canContinueBilling],
              ].map(([label, ok]) => (
                <View key={String(label)} style={styles.checklistRow}>
                  <CheckCircle size={14} color={ok ? C.green : C.textMuted} />
                  <Text style={[styles.checklistText, !ok && { color: C.textMuted }]}>{String(label)}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.privacyNote}>
              By submitting, Super Admin will review your company. You can edit later from Company Profile. Workers never see your billing, business number or admin contacts.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Back" onPress={() => setStep('billing')} variant="ghost" />
              <View style={{ flex: 1 }}>
                <Button
                  label={loading ? 'Submitting…' : 'Create company & submit for approval'}
                  onPress={handleSubmit}
                  loading={loading}
                  fullWidth
                  size="lg"
                  disabled={!canContinuePublic || !canContinuePrivate || !canContinueBilling}
                />
              </View>
            </View>
          </View>
        )}

        {step !== 'public' && (
          <TouchableOpacity onPress={() => setStep(step === 'private' ? 'public' : step === 'billing' ? 'private' : 'billing')} style={styles.backLink}>
            <ChevronLeft size={14} color={C.textMuted} />
            <Text style={styles.backLinkText}>Back</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 20 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 240 },
  iconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: 18 },
  stepsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  stepDot: { alignItems: 'center', gap: 4, minWidth: 60 },
  stepDotActive: {},
  stepDotDone: {},
  stepDotText: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, textAlign: 'center' as const, lineHeight: 22, fontSize: 11, fontWeight: '700' as const, color: C.textMuted },
  stepDotLbl: { fontSize: 10, color: C.textMuted, fontWeight: '600' as const },
  stepLine: { flex: 1, height: 1, backgroundColor: C.border, marginHorizontal: 4, marginBottom: 14 },
  form: { gap: 14 },
  lbl: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: C.accent },
  visBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.blueDim, borderColor: C.blue + '40', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  visBadgeText: { fontSize: 11, color: C.blue, fontWeight: '700' as const },
  reviewCard: { backgroundColor: C.bgSecondary, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, gap: 6 },
  reviewName: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  reviewMeta: { fontSize: 12, color: C.textSecondary },
  reviewBio: { fontSize: 13, color: C.text, lineHeight: 19, marginTop: 4 },
  reviewWebsite: { fontSize: 12, color: C.accent, marginTop: 4 },
  checklist: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  checklistTitle: { fontSize: 12, fontWeight: '700' as const, color: C.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checklistText: { fontSize: 13, color: C.text },
  privacyNote: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', marginTop: 16, padding: 8 },
  backLinkText: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  helperText: { fontSize: 11, color: C.textMuted, lineHeight: 16, marginTop: -8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  toggleLabel: { fontSize: 13, fontWeight: '600' as const, color: C.text },
});
