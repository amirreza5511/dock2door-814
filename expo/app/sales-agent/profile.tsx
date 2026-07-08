import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, User, Building2, MapPin, Wallet, CheckCheck, BadgeCheck, ShieldCheck, FileText, Phone } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import LegalDocSheet from '@/components/LegalDocSheet';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { SALES_AGENT_NDA, TERMS_AND_CONDITIONS, type LegalDoc } from '@/constants/legal';

const PAYOUT_METHODS = ['Bank transfer', 'PayPal', 'Interac e-Transfer', 'Cheque', 'Other'];
const ID_TYPES = ["Driver's licence", 'Passport', 'National ID', 'Other'];

interface AgentRecord {
  agent_code?: string;
  legal_name?: string; business_name?: string; phone?: string; territory?: string;
  address_line1?: string; address_line2?: string; city?: string; region?: string; postal_code?: string; country?: string;
  tax_id?: string; website?: string; linkedin?: string; bio?: string;
  id_type?: string; id_number?: string; date_of_birth?: string;
  emergency_name?: string; emergency_phone?: string;
  payout_method?: string; payout_details?: string;
  profile_completed_at?: string | null;
}

interface LegalRow { doc_type: string; doc_version: string; signed_name: string; accepted_at: string }

type Form = {
  legalName: string; businessName: string; phone: string; territory: string;
  addressLine1: string; addressLine2: string; city: string; region: string; postalCode: string; country: string;
  taxId: string; website: string; linkedin: string; bio: string;
  idType: string; idNumber: string; dateOfBirth: string;
  emergencyName: string; emergencyPhone: string;
  payoutMethod: string; payoutDetails: string;
};

const EMPTY: Form = {
  legalName: '', businessName: '', phone: '', territory: '',
  addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', country: '',
  taxId: '', website: '', linkedin: '', bio: '',
  idType: '', idNumber: '', dateOfBirth: '',
  emergencyName: '', emergencyPhone: '',
  payoutMethod: '', payoutDetails: '',
};

export default function SalesAgentProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const agentQuery = trpc.sales.myAgent.useQuery();
  const legalQuery = trpc.sales.myLegal.useQuery();
  const agent = agentQuery.data as AgentRecord | null | undefined;
  const legal = useMemo(() => (legalQuery.data as LegalRow[] | undefined) ?? [], [legalQuery.data]);

  const [form, setForm] = useState<Form>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<LegalDoc | null>(null);

  useEffect(() => {
    if (agent && !hydrated) {
      setForm({
        legalName: agent.legal_name ?? '', businessName: agent.business_name ?? '',
        phone: agent.phone ?? '', territory: agent.territory ?? '',
        addressLine1: agent.address_line1 ?? '', addressLine2: agent.address_line2 ?? '',
        city: agent.city ?? '', region: agent.region ?? '', postalCode: agent.postal_code ?? '', country: agent.country ?? '',
        taxId: agent.tax_id ?? '', website: agent.website ?? '', linkedin: agent.linkedin ?? '', bio: agent.bio ?? '',
        idType: agent.id_type ?? '', idNumber: agent.id_number ?? '', dateOfBirth: agent.date_of_birth ?? '',
        emergencyName: agent.emergency_name ?? '', emergencyPhone: agent.emergency_phone ?? '',
        payoutMethod: agent.payout_method ?? '', payoutDetails: agent.payout_details ?? '',
      });
      setHydrated(true);
    }
  }, [agent, hydrated]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((p) => ({ ...p, [k]: v }));

  const save = trpc.sales.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.sales.myAgent.invalidate();
      Alert.alert('Profile saved', 'Your professional profile is up to date.');
      router.back();
    },
    onError: (e) => Alert.alert('Could not save', e instanceof Error ? e.message : 'Error'),
  });

  const completion = useMemo(() => {
    const required = [form.legalName, form.phone, form.territory, form.addressLine1, form.city, form.country, form.payoutMethod, form.payoutDetails];
    const filled = required.filter((v) => v.trim()).length;
    return Math.round((filled / required.length) * 100);
  }, [form]);

  const termsRec = legal.find((l) => l.doc_type === 'terms');
  const ndaRec = legal.find((l) => l.doc_type === 'nda');

  if (agentQuery.isLoading) {
    return <View style={[styles.root, styles.center]}><ScreenFeedback state="loading" title="Loading profile" /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#12253D', C.bg]} style={styles.heroBg} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Agent profile</Text>
        <SupportMenu />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card elevated style={styles.completionCard}>
          <View style={styles.completionTop}>
            <View>
              <Text style={styles.completionLabel}>Profile completeness</Text>
              <Text style={styles.completionValue}>{completion}%</Text>
            </View>
            <View style={styles.codePill}><Text style={styles.codePillText}>{agent?.agent_code ?? '——'}</Text></View>
          </View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${completion}%` }]} /></View>
          <Text style={styles.completionHint}>A complete, professional profile builds trust with the businesses you onboard and speeds up your payouts.</Text>
        </Card>

        <Section icon={<User size={16} color={C.accent} />} title="Personal details">
          <Input label="Full legal name" value={form.legalName} onChangeText={(v) => set('legalName', v)} placeholder="Jane A. Smith" autoCapitalize="words" />
          <Row>
            <Half><Input label="Date of birth" value={form.dateOfBirth} onChangeText={(v) => set('dateOfBirth', v)} placeholder="YYYY-MM-DD" /></Half>
            <Half><Input label="Phone" value={form.phone} onChangeText={(v) => set('phone', v)} placeholder="+1 555 000 0000" keyboardType="phone-pad" /></Half>
          </Row>
          <Input label="Short bio" value={form.bio} onChangeText={(v) => set('bio', v)} placeholder="A line or two about your experience and the businesses you work with." multiline numberOfLines={3} />
        </Section>

        <Section icon={<Building2 size={16} color={C.blue} />} title="Business & tax">
          <Input label="Business / trading name (optional)" value={form.businessName} onChangeText={(v) => set('businessName', v)} placeholder="Smith Sales Co." />
          <Input label="Tax / business number (optional)" value={form.taxId} onChangeText={(v) => set('taxId', v)} placeholder="GST/HST or EIN" />
          <Row>
            <Half><Input label="Website" value={form.website} onChangeText={(v) => set('website', v)} placeholder="https://" autoCapitalize="none" /></Half>
            <Half><Input label="LinkedIn" value={form.linkedin} onChangeText={(v) => set('linkedin', v)} placeholder="Profile URL" autoCapitalize="none" /></Half>
          </Row>
        </Section>

        <Section icon={<MapPin size={16} color={C.purple} />} title="Address & territory">
          <Input label="Address line 1" value={form.addressLine1} onChangeText={(v) => set('addressLine1', v)} placeholder="Street address" />
          <Input label="Address line 2 (optional)" value={form.addressLine2} onChangeText={(v) => set('addressLine2', v)} placeholder="Unit, suite, etc." />
          <Row>
            <Half><Input label="City" value={form.city} onChangeText={(v) => set('city', v)} placeholder="Vancouver" /></Half>
            <Half><Input label="Province / state" value={form.region} onChangeText={(v) => set('region', v)} placeholder="BC" /></Half>
          </Row>
          <Row>
            <Half><Input label="Postal / ZIP" value={form.postalCode} onChangeText={(v) => set('postalCode', v)} placeholder="V6B 1A1" autoCapitalize="characters" /></Half>
            <Half><Input label="Country" value={form.country} onChangeText={(v) => set('country', v)} placeholder="Canada" /></Half>
          </Row>
          <Input label="Sales territory / region" value={form.territory} onChangeText={(v) => set('territory', v)} placeholder="e.g. Greater Vancouver, BC" />
        </Section>

        <Section icon={<BadgeCheck size={16} color={C.yellow} />} title="Identity verification">
          <Text style={styles.pickerLabel}>ID document type</Text>
          <View style={styles.chipWrap}>
            {ID_TYPES.map((t) => {
              const active = form.idType === t;
              return (
                <TouchableOpacity key={t} onPress={() => set('idType', t)} style={[styles.chip, active && styles.chipActive]}>
                  {active ? <CheckCheck size={13} color={C.accent} /> : null}
                  <Text style={[styles.chipText, active && { color: C.accent }]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Input label="ID number" value={form.idNumber} onChangeText={(v) => set('idNumber', v)} placeholder="Document number" autoCapitalize="characters" />
          <Text style={styles.privacyHint}>Your ID details are private, encrypted at rest, and only used to verify your identity for payouts.</Text>
        </Section>

        <Section icon={<Phone size={16} color={C.red} />} title="Emergency contact">
          <Row>
            <Half><Input label="Name" value={form.emergencyName} onChangeText={(v) => set('emergencyName', v)} placeholder="Contact name" /></Half>
            <Half><Input label="Phone" value={form.emergencyPhone} onChangeText={(v) => set('emergencyPhone', v)} placeholder="+1 555 000 0000" keyboardType="phone-pad" /></Half>
          </Row>
        </Section>

        <Section icon={<Wallet size={16} color={C.green} />} title="Payout">
          <Text style={styles.pickerLabel}>How do you want to get paid?</Text>
          <View style={styles.chipWrap}>
            {PAYOUT_METHODS.map((m) => {
              const active = form.payoutMethod === m;
              return (
                <TouchableOpacity key={m} onPress={() => set('payoutMethod', m)} style={[styles.chip, active && styles.chipActive]}>
                  {active ? <CheckCheck size={13} color={C.accent} /> : null}
                  <Text style={[styles.chipText, active && { color: C.accent }]}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Input label="Payout details" value={form.payoutDetails} onChangeText={(v) => set('payoutDetails', v)} placeholder="Account number, email, or address for payment" multiline numberOfLines={3} />
        </Section>

        <Section icon={<ShieldCheck size={16} color={C.accent} />} title="Agreements">
          <LegalRowItem
            title="Terms & Conditions"
            signed={!!termsRec}
            meta={termsRec ? `Accepted v${termsRec.doc_version}` : 'Not on file'}
            onView={() => setViewingDoc(TERMS_AND_CONDITIONS)}
          />
          <LegalRowItem
            title="Non-Disclosure Agreement"
            signed={!!ndaRec}
            meta={ndaRec ? `Signed by ${ndaRec.signed_name || 'you'} · v${ndaRec.doc_version}` : 'Not signed'}
            onView={() => setViewingDoc(SALES_AGENT_NDA)}
          />
        </Section>

        <Button label="Save profile" onPress={() => save.mutate(form)} loading={save.isPending} fullWidth size="lg" style={{ marginTop: 6 }} />
      </ScrollView>
      <LegalDocSheet doc={viewingDoc} visible={!!viewingDoc} onClose={() => setViewingDoc(null)} />
    </KeyboardAvoidingView>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.card}>
      <View style={styles.rowHead}>{icon}<Text style={styles.rowHeadText}>{title}</Text></View>
      {children}
    </Card>
  );
}
function Row({ children }: { children: React.ReactNode }) { return <View style={styles.row}>{children}</View>; }
function Half({ children }: { children: React.ReactNode }) { return <View style={{ flex: 1 }}>{children}</View>; }

function LegalRowItem({ title, signed, meta, onView }: { title: string; signed: boolean; meta: string; onView: () => void }) {
  return (
    <TouchableOpacity onPress={onView} activeOpacity={0.8} style={styles.legalRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.legalTitle}>{title}</Text>
        <Text style={[styles.legalMeta, signed && { color: C.green }]}>{meta}</Text>
      </View>
      <View style={[styles.legalBadge, { backgroundColor: signed ? C.greenDim : C.card }]}>
        {signed ? <BadgeCheck size={16} color={C.green} /> : <FileText size={16} color={C.textMuted} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 180 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  title: { fontSize: 18, fontWeight: '800' as const, color: C.text },
  scroll: { paddingHorizontal: 16, gap: 14 },
  completionCard: { padding: 16, gap: 10 },
  completionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  completionLabel: { fontSize: 12, color: C.textSecondary, fontWeight: '600' as const },
  completionValue: { fontSize: 30, fontWeight: '800' as const, color: C.text, letterSpacing: -1 },
  codePill: { backgroundColor: C.bgSecondary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.border },
  codePillText: { fontSize: 15, fontWeight: '800' as const, color: C.accent, letterSpacing: 2 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: C.bgSecondary, overflow: 'hidden' as const },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: C.accent },
  completionHint: { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  card: { padding: 16, gap: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  rowHeadText: { fontSize: 13, fontWeight: '700' as const, color: C.text, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  row: { flexDirection: 'row', gap: 10 },
  pickerLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  chipText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  privacyHint: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  legalTitle: { fontSize: 14, fontWeight: '700' as const, color: C.text },
  legalMeta: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  legalBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
