import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Check, MailCheck, FileText, ShieldCheck } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import LegalDocSheet from '@/components/LegalDocSheet';
import C from '@/constants/colors';
import type { UserRole } from '@/constants/types';
import { COMPANY_REQUIRED_ROLES, type Domain, DOMAIN_LABELS, getRoleRoute } from '@/lib/access';
import { TERMS_AND_CONDITIONS, SALES_AGENT_NDA, TERMS_VERSION, NDA_VERSION, type LegalDoc } from '@/constants/legal';

type RoleOption = { id: string; role: UserRole; label: string; desc: string };

const ROLES_BY_WORLD: Record<Domain, RoleOption[]> = {
  labour: [
    { id: 'Employer', role: 'Employer', label: 'Employer', desc: 'Post and manage work shifts' },
    { id: 'Worker', role: 'Worker', label: 'Worker', desc: 'Find and apply for shifts' },
  ],
  logistics: [
    { id: 'Customer', role: 'Customer', label: 'Customer', desc: 'Book warehouse space & services' },
    { id: 'WarehouseProvider', role: 'WarehouseProvider', label: 'Warehouse Provider', desc: 'List and manage storage space' },
    { id: 'ServiceProvider', role: 'ServiceProvider', label: 'Service Provider', desc: 'Offer industrial services' },
    { id: 'GateStaff', role: 'GateStaff', label: 'Gate Staff', desc: 'Run dock and gate check-ins' },
  ],
  freight: [
    { id: 'Shipper', role: 'Shipper', label: 'Shipper', desc: 'Post deliveries — parcel to full load' },
    { id: 'Driver', role: 'Driver', label: 'Owner-Operator', desc: 'Own one truck — accept & deliver loads yourself' },
    { id: 'TruckingCompany', role: 'TruckingCompany', label: 'Fleet / Carrier Company', desc: 'Run a fleet — accept loads & dispatch your drivers' },
  ],
  drayage: [
    { id: 'FreightForwarder', role: 'FreightForwarder', label: 'Importer / Exporter / Freight Forwarder', desc: 'Post import & export container orders and track them live' },
    { id: 'DrayageCompany', role: 'DrayageCompany', label: 'Drayage Company', desc: 'Claim container orders, dispatch drivers & track live' },
    { id: 'DrayageDriver', role: 'Driver', label: 'Drayage Driver', desc: 'Drive container moves — enter your drayage company’s fleet code' },
  ],
};

const WORLD_ORDER: Domain[] = ['labour', 'logistics', 'freight', 'drayage'];

/** Standalone cross-vertical role: sales agents onboard accounts and earn commission. */
const SALES_ROLE: RoleOption = {
  id: 'SalesAgent', role: 'SalesAgent', label: 'Sales Agent',
  desc: 'Onboard warehouses, drivers, employers & more — earn commission from Dock2Door',
};

const NO_COMPANY_ROLES: UserRole[] = ['Worker', 'Driver', 'SalesAgent', 'SuperAdmin'];

export default function Signup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const register = useAuthStore((s) => s.register);
  const params = useLocalSearchParams<{ ref?: string }>();
  const invitedCode = typeof params.ref === 'string' ? params.ref.trim().toUpperCase() : '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [city, setCity] = useState('');
  const [fleetCode, setFleetCode] = useState('');
  const [agentCode, setAgentCode] = useState(invitedCode);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRole: UserRole | null = selectedId
    ? ([...WORLD_ORDER.flatMap((w) => ROLES_BY_WORLD[w]), SALES_ROLE].find((r) => r.id === selectedId)?.role ?? null)
    : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);

  const isSalesAgent = selectedRole === 'SalesAgent';
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedNda, setAcceptedNda] = useState(false);
  const [ndaName, setNdaName] = useState('');
  const [viewingDoc, setViewingDoc] = useState<LegalDoc | null>(null);

  const handleRegister = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!email.trim()) { setError('Email is required'); return; }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (!selectedRole) { setError('Please select your role'); return; }
    if (!NO_COMPANY_ROLES.includes(selectedRole) && !companyName.trim()) { setError('Company name is required for this role'); return; }
    if (!acceptedTerms) { setError('Please accept the Terms & Conditions to continue'); return; }
    if (selectedRole === 'SalesAgent') {
      if (!acceptedNda) { setError('Sales Agents must agree to the Non-Disclosure Agreement'); return; }
      if (!ndaName.trim()) { setError('Type your full legal name to sign the NDA'); return; }
    }

    setLoading(true);
    try {
      const result = await register({
        name: name.trim(), email: email.trim(), password, role: selectedRole,
        companyName: companyName.trim(), city: city.trim(), fleetCode: fleetCode.trim(), agentCode: agentCode.trim(),
        acceptedTerms, termsVersion: TERMS_VERSION,
        acceptedNda: selectedRole === 'SalesAgent' ? acceptedNda : false,
        ndaVersion: NDA_VERSION,
        ndaSignedName: selectedRole === 'SalesAgent' ? ndaName.trim() : '',
      });
      if (!result.success) {
        setError(result.error ?? 'Registration failed');
      } else if (result.needsEmailConfirmation) {
        // No session yet — email must be confirmed first. Show a clear
        // "check your email" state instead of navigating into a dead session.
        setConfirmEmailSent(true);
      } else {
        if (COMPANY_REQUIRED_ROLES.includes(selectedRole)) {
          router.replace('/onboarding/company-setup' as never);
        } else {
          router.replace(getRoleRoute(selectedRole) as never);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  if (confirmEmailSent) {
    return (
      <View style={[styles.confirmWrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />
        <View style={styles.confirmIcon}>
          <MailCheck size={36} color={C.accent} />
        </View>
        <Text style={styles.confirmTitle}>Check your email</Text>
        <Text style={styles.confirmBody}>
          We sent a confirmation link to{'\n'}
          <Text style={styles.confirmEmail}>{email.trim()}</Text>
        </Text>
        <Text style={styles.confirmHint}>
          Tap the link in that email to verify your account, then come back and sign in.
        </Text>
        <Button
          label="Go to Sign In"
          onPress={() => router.replace('/auth/login' as never)}
          fullWidth
          size="lg"
        />
        <TouchableOpacity onPress={() => setConfirmEmailSent(false)} style={styles.confirmBackBtn}>
          <Text style={styles.switchLink}>Use a different email</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />

        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={20} color={C.textSecondary} />
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>Dock2Door</Text>
          </View>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join the global logistics marketplace</Text>
        </View>

        <View style={styles.form}>
          <Input label="Full Name" value={name} onChangeText={setName} placeholder="Jane Smith" testID="input-name" />
          <Input label="Email" value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" testID="input-email" />
          <Input label="Password" value={password} onChangeText={setPassword} placeholder="Min. 6 characters" secureTextEntry testID="input-password" />
          {!NO_COMPANY_ROLES.includes((selectedRole ?? '') as UserRole) ? (
            <>
              <Input label="Company Name" value={companyName} onChangeText={setCompanyName} placeholder="Dock2Door Logistics Ltd." testID="input-company-name" />
              <Input label="City" value={city} onChangeText={setCity} placeholder="e.g. Chicago" testID="input-city" />
            </>
          ) : null}
          {selectedRole === 'Driver' ? (
            <View style={styles.fleetCodeBox}>
              <Input
                label="Fleet code (optional)"
                value={fleetCode}
                onChangeText={(v) => setFleetCode(v.toUpperCase())}
                placeholder="e.g. AB7K2P"
                autoCapitalize="characters"
                testID="input-fleet-code"
              />
              <Text style={styles.fleetCodeHint}>
                Joining a fleet or carrier company? Enter the code your dispatcher gave you and you’ll show up in their fleet automatically. Leave blank if you’re an independent owner-operator.
              </Text>
            </View>
          ) : null}

          {selectedRole && selectedRole !== 'SalesAgent' ? (
            <View style={styles.fleetCodeBox}>
              <Input
                label="Referral code (optional)"
                value={agentCode}
                onChangeText={(v) => setAgentCode(v.toUpperCase())}
                placeholder="e.g. AG7K2PQ"
                autoCapitalize="characters"
                testID="input-agent-code"
              />
              <Text style={styles.fleetCodeHint}>
                Were you referred by a Dock2Door sales agent? Enter their code so they get credit for bringing you on board. Leave blank if not.
              </Text>
            </View>
          ) : null}

          <View>
            <Text style={styles.roleLabel}>Your Role</Text>
            {WORLD_ORDER.map((world) => (
              <View key={world} style={styles.worldGroup}>
                <Text style={styles.worldHeading}>{DOMAIN_LABELS[world]}</Text>
                <View style={styles.rolesGrid}>
                  {ROLES_BY_WORLD[world].map((r) => {
                    const selected = selectedId === r.id;
                    return (
                      <TouchableOpacity
                        key={r.id}
                        onPress={() => setSelectedId(r.id)}
                        style={[styles.roleCard, selected && styles.roleCardSelected]}
                        activeOpacity={0.8}
                        testID={`role-${r.id}`}
                      >
                        {selected && (
                          <View style={styles.checkIcon}>
                            <Check size={12} color={C.white} />
                          </View>
                        )}
                        <Text style={[styles.roleTitle, selected && styles.roleTitleSelected]}>{r.label}</Text>
                        <Text style={styles.roleDesc}>{r.desc}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            <View style={styles.worldGroup}>
              <Text style={styles.worldHeading}>Sales & Partnerships</Text>
              <View style={styles.rolesGrid}>
                {[SALES_ROLE].map((r) => {
                  const selected = selectedId === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => setSelectedId(r.id)}
                      style={[styles.roleCard, selected && styles.roleCardSelected]}
                      activeOpacity={0.8}
                      testID={`role-${r.id}`}
                    >
                      {selected && (
                        <View style={styles.checkIcon}>
                          <Check size={12} color={C.white} />
                        </View>
                      )}
                      <Text style={[styles.roleTitle, selected && styles.roleTitleSelected]}>{r.label}</Text>
                      <Text style={styles.roleDesc}>{r.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {selectedRole ? (
            <View style={styles.legalBox}>
              {isSalesAgent ? (
                <View style={styles.ndaBlock}>
                  <View style={styles.ndaHead}>
                    <ShieldCheck size={16} color={C.accent} />
                    <Text style={styles.ndaHeadText}>Sales Agent agreement</Text>
                  </View>
                  <Text style={styles.ndaHint}>As a Sales Agent you handle confidential leads and customer data, so you must sign our NDA before you start.</Text>
                  <TouchableOpacity
                    onPress={() => setAcceptedNda((v) => !v)}
                    activeOpacity={0.8}
                    style={styles.checkRow}
                    testID="accept-nda"
                  >
                    <View style={[styles.checkbox, acceptedNda && styles.checkboxOn]}>
                      {acceptedNda ? <Check size={14} color={C.white} /> : null}
                    </View>
                    <Text style={styles.checkText}>
                      I have read and agree to the{' '}
                      <Text style={styles.legalLink} onPress={() => setViewingDoc(SALES_AGENT_NDA)}>Non-Disclosure Agreement</Text>.
                    </Text>
                  </TouchableOpacity>
                  {acceptedNda ? (
                    <Input
                      label="Type your full legal name to sign"
                      value={ndaName}
                      onChangeText={setNdaName}
                      placeholder="e.g. Jane A. Smith"
                      autoCapitalize="words"
                      testID="nda-signature"
                    />
                  ) : null}
                </View>
              ) : null}

              <TouchableOpacity
                onPress={() => setAcceptedTerms((v) => !v)}
                activeOpacity={0.8}
                style={styles.checkRow}
                testID="accept-terms"
              >
                <View style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}>
                  {acceptedTerms ? <Check size={14} color={C.white} /> : null}
                </View>
                <Text style={styles.checkText}>
                  I agree to the{' '}
                  <Text style={styles.legalLink} onPress={() => setViewingDoc(TERMS_AND_CONDITIONS)}>Terms &amp; Conditions</Text>
                  {' '}and Privacy Policy.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setViewingDoc(TERMS_AND_CONDITIONS)} style={styles.readLink}>
                <FileText size={13} color={C.textMuted} />
                <Text style={styles.readLinkText}>Read the full documents</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="Create Account"
            onPress={handleRegister}
            loading={loading}
            fullWidth
            size="lg"
            disabled={!selectedRole || !acceptedTerms || (isSalesAgent && (!acceptedNda || !ndaName.trim()))}
          />

          <TouchableOpacity onPress={() => router.push('/auth/login' as any)} style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account? </Text>
            <Text style={styles.switchLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <LegalDocSheet doc={viewingDoc} visible={!!viewingDoc} onClose={() => setViewingDoc(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  back: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  header: { marginBottom: 32 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  logoDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent },
  logoText: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  title: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 16, color: C.textSecondary },
  form: { gap: 16 },
  roleLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, marginBottom: 10, letterSpacing: 0.3 },
  worldGroup: { marginBottom: 18 },
  worldHeading: { fontSize: 11, fontWeight: '700' as const, color: C.accent, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' as const },
  rolesGrid: { gap: 8 },
  roleCard: {
    padding: 14, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    position: 'relative',
  },
  roleCardSelected: { borderColor: C.accent, backgroundColor: C.accentDim },
  checkIcon: {
    position: 'absolute', top: 10, right: 10,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
  },
  roleTitle: { fontSize: 15, fontWeight: '700' as const, color: C.text, marginBottom: 2 },
  roleTitleSelected: { color: C.accent },
  roleDesc: { fontSize: 12, color: C.textSecondary },
  fleetCodeBox: { gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14 },
  fleetCodeHint: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  error: { fontSize: 13, color: C.red, textAlign: 'center' },
  legalBox: { gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14 },
  ndaBlock: { gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  ndaHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ndaHeadText: { fontSize: 13, fontWeight: '800' as const, color: C.text, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  ndaHint: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: C.accent, borderColor: C.accent },
  checkText: { flex: 1, fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  legalLink: { color: C.accent, fontWeight: '700' as const },
  readLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  readLinkText: { fontSize: 12, color: C.textMuted, fontWeight: '600' as const },
  confirmWrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  confirmIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  confirmTitle: { fontSize: 28, fontWeight: '800' as const, color: C.text, letterSpacing: -0.6, marginBottom: 12, textAlign: 'center' as const },
  confirmBody: { fontSize: 16, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 24, marginBottom: 16 },
  confirmEmail: { color: C.text, fontWeight: '700' as const },
  confirmHint: { fontSize: 14, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 21, marginBottom: 32 },
  confirmBackBtn: { marginTop: 20, alignItems: 'center' as const },
  switchRow: { flexDirection: 'row', justifyContent: 'center' },
  switchText: { fontSize: 14, color: C.textSecondary },
  switchLink: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
});
