import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Building2 } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useActiveCompany } from '@/providers/ActiveCompanyProvider';
import { COMPANY_TYPE_BY_ROLE, getRoleRoute } from '@/lib/access';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import C from '@/constants/colors';

export default function CompanySetup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { memberships, refresh } = useActiveCompany();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);

  // If user already has a company, skip onboarding
  useEffect(() => {
    if (memberships.length > 0 && user) {
      router.replace(getRoleRoute(user.role) as never);
    }
  }, [memberships.length, user, router]);

  const companyType = user?.role ? COMPANY_TYPE_BY_ROLE[user.role] : undefined;

  const handleSubmit = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Company name is required'); return; }
    if (!city.trim()) { Alert.alert('Error', 'City is required'); return; }
    if (!companyType) { Alert.alert('Error', 'Unable to determine company type for your role'); return; }
    if (!user) return;

    setLoading(true);
    try {
      const { error } = await supabase.rpc('setup_my_company', {
        p_name: name.trim(),
        p_city: city.trim(),
        p_type: companyType,
      });
      if (error) throw error;
      // Best-effort: notify admins about the new pending company. Never blocks onboarding.
      void (async () => {
        const [adminsRes, companyRes] = await Promise.all([
          supabase.from('user_roles').select('user_id').eq('role', 'admin'),
          supabase.from('companies').select('id, name, type')
            .eq('owner_user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1).maybeSingle(),
        ]);
        const admins = adminsRes.data ?? [];
        const co = companyRes.data;
        if (!co || admins.length === 0) return;
        await Promise.all(admins.map((a) => supabase.from('notifications').insert({
          user_id: a.user_id,
          kind: 'company_pending',
          title: 'New company pending approval',
          body: `${co.name} (${(co.type as string | null) ?? companyType}) has registered and requires your review in Compliance.`,
          entity_type: 'companies',
          entity_id: co.id,
        })));
      })();
      await refresh();
      router.replace(getRoleRoute(user.role) as never);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to create company');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={['#0D1E35', C.bg]} style={styles.heroBg} />

        <View style={styles.iconWrap}>
          <Building2 size={32} color={C.accent} />
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>Set up your company</Text>
          <Text style={styles.subtitle}>
            One last step — tell us about your company to get started on Dock2Door.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Company Name"
            value={name}
            onChangeText={setName}
            placeholder="Acme Logistics Ltd."
            testID="input-company-name"
          />
          <Input
            label="City"
            value={city}
            onChangeText={setCity}
            placeholder="e.g. Chicago"
            testID="input-city"
          />

          {companyType ? (
            <View style={styles.typeRow}>
              <Text style={styles.typeLabel}>Company Type</Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeValue}>{companyType}</Text>
              </View>
            </View>
          ) : null}

          <Button
            label="Create Company & Continue"
            onPress={handleSubmit}
            loading={loading}
            fullWidth
            size="lg"
            disabled={!name.trim() || !city.trim()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: C.accentDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: C.textSecondary, lineHeight: 22 },
  form: { gap: 16 },
  typeRow: { gap: 6 },
  typeLabel: { fontSize: 13, fontWeight: '600' as const, color: C.textSecondary, letterSpacing: 0.3 },
  typeBadge: {
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  typeValue: { fontSize: 14, color: C.text, fontWeight: '600' as const },
});
