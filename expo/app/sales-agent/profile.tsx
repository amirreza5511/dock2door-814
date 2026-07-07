import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Phone, MapPin, Wallet, CheckCheck } from 'lucide-react-native';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ScreenFeedback from '@/components/ui/ScreenFeedback';
import SupportMenu from '@/components/SupportMenu';
import C from '@/constants/colors';
import { trpc } from '@/lib/trpc';

const PAYOUT_METHODS = ['Bank transfer', 'PayPal', 'Interac e-Transfer', 'Cheque', 'Other'];

interface AgentRecord {
  agent_code?: string; phone?: string; territory?: string; payout_method?: string; payout_details?: string;
}

export default function SalesAgentProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const utils = trpc.useUtils();

  const agentQuery = trpc.sales.myAgent.useQuery();
  const agent = agentQuery.data as AgentRecord | null | undefined;

  const [phone, setPhone] = useState('');
  const [territory, setTerritory] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('');
  const [payoutDetails, setPayoutDetails] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (agent && !hydrated) {
      setPhone(agent.phone ?? '');
      setTerritory(agent.territory ?? '');
      setPayoutMethod(agent.payout_method ?? '');
      setPayoutDetails(agent.payout_details ?? '');
      setHydrated(true);
    }
  }, [agent, hydrated]);

  const save = trpc.sales.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.sales.myAgent.invalidate();
      Alert.alert('Profile saved', 'Your details are up to date.');
      router.back();
    },
    onError: (e) => Alert.alert('Could not save', e instanceof Error ? e.message : 'Error'),
  });

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

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Complete your profile so we know how to reach you and how to pay your commission.</Text>

        <Card style={styles.card}>
          <View style={styles.rowHead}><Phone size={16} color={C.accent} /><Text style={styles.rowHeadText}>Contact</Text></View>
          <Input label="Phone number" value={phone} onChangeText={setPhone} placeholder="+1 555 000 0000" keyboardType="phone-pad" />
          <View style={styles.rowHead}><MapPin size={16} color={C.blue} /><Text style={styles.rowHeadText}>Territory</Text></View>
          <Input label="Region / territory" value={territory} onChangeText={setTerritory} placeholder="e.g. Greater Vancouver, BC" />
        </Card>

        <Card style={styles.card}>
          <View style={styles.rowHead}><Wallet size={16} color={C.green} /><Text style={styles.rowHeadText}>Payout</Text></View>
          <Text style={styles.pickerLabel}>How do you want to get paid?</Text>
          <View style={styles.methodWrap}>
            {PAYOUT_METHODS.map((m) => {
              const active = payoutMethod === m;
              return (
                <TouchableOpacity key={m} onPress={() => setPayoutMethod(m)} style={[styles.methodChip, active && styles.methodChipActive]}>
                  {active ? <CheckCheck size={14} color={C.accent} /> : null}
                  <Text style={[styles.methodText, active && { color: C.accent }]}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Input label="Payout details" value={payoutDetails} onChangeText={setPayoutDetails} placeholder="Account number, email, or address for payment" multiline numberOfLines={3} />
          <Text style={styles.privacyHint}>Your payout details are private and only used to send your commission payments.</Text>
        </Card>

        <Button label="Save profile" onPress={() => save.mutate({ phone: phone.trim(), territory: territory.trim(), payoutMethod, payoutDetails: payoutDetails.trim() })} loading={save.isPending} fullWidth size="lg" />
      </ScrollView>
    </KeyboardAvoidingView>
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
  intro: { fontSize: 13, color: C.textSecondary, lineHeight: 19, paddingTop: 4 },
  card: { padding: 16, gap: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  rowHeadText: { fontSize: 13, fontWeight: '700' as const, color: C.text, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  pickerLabel: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  methodWrap: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  methodChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  methodChipActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  methodText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' as const },
  privacyHint: { fontSize: 11, color: C.textMuted, lineHeight: 16 },
});
